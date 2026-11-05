"""Periodic reconciliation recovers missed publications and provider failures."""

import hashlib
import io
import json
import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.management import call_command
from django.db import connection
from django.db.models import F
from django.utils import timezone

from files.models import FilePurpose, FileStatus
from materials.models import MaterialFileExtraction
from materials.statuses import ExtractionStatus

from .models import EmbeddingIndexState

logger = logging.getLogger(__name__)
INDEX_LOCK = 70914021


def eligible_extractions():
    return (
        MaterialFileExtraction.objects.filter(
            status=ExtractionStatus.SUCCESS,
            stored_file__status=FileStatus.CLEAN,
            stored_file__purpose=FilePurpose.COURSE_MATERIAL,
            stored_file__course_id=F("material_version__material__course_id"),
            material_version__is_published=True,
            material_version__material__is_hidden=False,
            material_version__material__published_version_id=F("material_version_id"),
            material_file__material_version_id=F("material_version_id"),
            material_file__file_id=F("stored_file_id"),
            file_hash=F("material_file__sha256_hash"),
        )
        .filter(file_hash=F("stored_file__sha256_hash"))
        .exclude(file_hash="")
    )


def index_signature(extraction):
    material = extraction.material_version.material
    # Version this signature whenever chunking rules change.
    payload = [
        "chunks-v1",
        extraction.file_hash,
        material.title,
        material.course.code,
        settings.AI_EMBEDDING_MODEL,
        settings.AI_EMBEDDING_DIMENSIONS,
        extraction.extracted_text,
    ]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode()).hexdigest()


def reconcile_embeddings(batch_size=5):
    processed = 0
    for extraction in (
        eligible_extractions()
        .select_related("material_version__material__course")
        .order_by("id")
        .iterator(chunk_size=100)
    ):
        signature = index_signature(extraction)
        state, _ = EmbeddingIndexState.objects.get_or_create(
            extraction=extraction, defaults={"signature": signature}
        )
        if state.signature != signature:
            state.signature, state.status, state.attempts = signature, "pending", 0
            state.retry_at, state.last_error_code = None, ""
        if state.status == "ready" or (state.retry_at and state.retry_at > timezone.now()):
            continue
        state.attempts += 1
        state.status = "processing"
        state.save()
        try:
            call_command(
                "index_material_embeddings",
                extraction_id=str(extraction.id),
                stdout=io.StringIO(),
                stderr=io.StringIO(),
            )
        except Exception as exc:
            state.status = "failed"
            state.last_error_code = type(exc).__name__[:64]
            state.retry_at = timezone.now() + timedelta(
                seconds=min(3600, 30 * 2 ** min(state.attempts, 7))
            )
            logger.warning(
                "Embedding indexing failed; extraction=%s code=%s",
                extraction.id,
                state.last_error_code,
            )
        else:
            state.status, state.last_error_code, state.retry_at = "ready", "", None
        state.save()
        processed += 1
        if processed >= batch_size:
            break
    return processed


@shared_task(acks_late=True, reject_on_worker_lost=True, soft_time_limit=1800, time_limit=1830)
def process_embedding_index():
    if not settings.AI_AUTO_INDEX_ENABLED or not settings.AI_API_KEY:
        return {"status": "disabled"}
    # One reconciler across workers; session lock is released even after task failure.
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [INDEX_LOCK])
        if not cursor.fetchone()[0]:
            return {"status": "busy"}
    try:
        return {"processed": reconcile_embeddings()}
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(%s)", [INDEX_LOCK])
