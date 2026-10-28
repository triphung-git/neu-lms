import logging
from datetime import timedelta

from botocore.exceptions import BotoCoreError, ClientError
from celery import shared_task
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from courses.models import Course

from .models import MaterialVersion, MaterialVersionStatus, ProcessingStatus
from .services import extract_version_materials

logger = logging.getLogger(__name__)


@shared_task(
    acks_late=True,
    reject_on_worker_lost=True,
    bind=True,
    max_retries=3,
    soft_time_limit=660,
    time_limit=690,
)
def extract_material_version_task(self, version_id):
    version = MaterialVersion.objects.select_related("material").filter(pk=version_id).first()
    if version is None:
        return {"status": "not_found", "version_id": version_id}
    if version.lifecycle_status == MaterialVersionStatus.DRAFT:
        return {"status": "draft", "version_id": version_id}
    key = int(version.id.int % (2**63 - 1))
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_try_advisory_lock(%s)", [key])
        if not cursor.fetchone()[0]:
            return {"status": "busy", "version_id": version_id}
    try:
        with transaction.atomic():
            Course.objects.select_for_update().get(pk=version.material.course_id)
            version.refresh_from_db()
            if version.processing_status in {
                ProcessingStatus.READY,
                ProcessingStatus.NO_TEXT,
                ProcessingStatus.UNSUPPORTED,
            }:
                return {"status": version.processing_status, "version_id": version_id}
            if version.extraction_attempts >= 3:
                version.processing_status = ProcessingStatus.FAILED
                version.save(update_fields=["processing_status"])
                return {"status": "failed", "version_id": version_id}
            version.extraction_attempts += 1
            version.extraction_started_at = timezone.now()
            version.processing_status = ProcessingStatus.PROCESSING
            version.save(
                update_fields=["extraction_attempts", "extraction_started_at", "processing_status"]
            )
        try:
            version = extract_version_materials(version)
        except (OSError, BotoCoreError, ClientError):
            status = (
                ProcessingStatus.PENDING
                if version.extraction_attempts < 3
                else ProcessingStatus.FAILED
            )
            MaterialVersion.objects.filter(pk=version.pk).update(processing_status=status)
            logger.warning("Material storage processing deferred; version_id=%s", version_id)
            return {"status": status, "version_id": version_id}
        return {"status": version.processing_status, "version_id": version_id}
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_unlock(%s)", [key])


@shared_task(acks_late=True, reject_on_worker_lost=True)
def process_pending_material_extractions():
    cutoff = timezone.now() - timedelta(seconds=60)
    rows = (
        MaterialVersion.objects.exclude(lifecycle_status=MaterialVersionStatus.DRAFT)
        .filter(
            processing_status__in=[ProcessingStatus.PENDING, ProcessingStatus.PROCESSING],
        )
        .filter(Q(extraction_dispatched_at__isnull=True) | Q(extraction_dispatched_at__lt=cutoff))
    )
    for version_id in rows.order_by("extraction_dispatched_at", "id").values_list("id", flat=True)[
        :20
    ]:
        claimed = (
            MaterialVersion.objects.filter(pk=version_id)
            .filter(
                Q(extraction_dispatched_at__isnull=True) | Q(extraction_dispatched_at__lt=cutoff)
            )
            .update(extraction_dispatched_at=timezone.now())
        )
        if claimed:
            try:
                extract_material_version_task.delay(str(version_id))
            except Exception:
                logger.warning("Material dispatch deferred; version_id=%s", version_id)
