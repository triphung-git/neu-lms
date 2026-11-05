from __future__ import annotations

import hashlib

from django.conf import settings
from django.core.management.base import (
    BaseCommand,
    CommandError,
)
from django.db.models import F

from ai_assistant.embeddings import (
    EmbeddingError,
    embed_text,
)
from ai_assistant.models import MaterialChunkEmbedding
from ai_assistant.retrieval import (
    MAX_DOCUMENT_CHARS,
    chunk_extraction_text,
)
from files.models import FilePurpose, FileStatus
from materials.models import MaterialFileExtraction
from materials.statuses import ExtractionStatus


class Command(BaseCommand):
    help = "Create or update embeddings for published, clean course materials."

    def add_arguments(self, parser):
        parser.add_argument("--extraction-id", type=str, default=None)

        parser.add_argument(
            "--course-id",
            type=str,
            default=None,
            help="Only index one course UUID.",
        )

        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help="Maximum number of extractions to process.",
        )

        parser.add_argument(
            "--force",
            action="store_true",
            help="Re-create all embeddings.",
        )

        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Preview eligible materials without calling Gemini.",
        )

    def handle(self, *args, **options):

        course_id = options["course_id"]
        limit = options["limit"]
        force = options["force"]
        dry_run = options["dry_run"]

        if limit is not None and limit <= 0:
            raise CommandError("--limit must be greater than zero.")

        model = settings.AI_EMBEDDING_MODEL
        dimensions = settings.AI_EMBEDDING_DIMENSIONS

        extractions = (
            MaterialFileExtraction.objects.filter(
                status=ExtractionStatus.SUCCESS,
                stored_file__status=FileStatus.CLEAN,
                stored_file__purpose=FilePurpose.COURSE_MATERIAL,
                # File and course must match.
                stored_file__course_id=F("material_version__material__course_id"),
                # Only published materials.
                material_version__is_published=True,
                material_version__material__is_hidden=False,
                material_version__material__published_version_id=F("material_version_id"),
                # Extraction must reference its actual manifest file.
                material_file__material_version_id=F("material_version_id"),
                material_file__file_id=F("stored_file_id"),
                # Verify extraction and manifest checksums.
                file_hash=F("material_file__sha256_hash"),
            )
            .filter(file_hash=F("stored_file__sha256_hash"))
            .exclude(file_hash="")
            .select_related(
                "material_version__material",
                "material_version__material__course",
                "material_file",
                "stored_file",
            )
            .order_by("material_version__material__title", "id")
        )

        if options.get("extraction_id"):
            extractions = extractions.filter(pk=options["extraction_id"])

        if course_id:
            extractions = extractions.filter(material_version__material__course_id=course_id)

        if limit:
            extractions = extractions[:limit]

        created_count = 0
        updated_count = 0
        skipped_count = 0
        deleted_count = 0
        failed_count = 0

        total = extractions.count()

        self.stdout.write(self.style.SUCCESS(f"Eligible extractions: {total}"))

        if dry_run:
            for extraction in extractions:
                self.stdout.write(f"DRY RUN: {extraction.stored_file.file_name}")

            self.stdout.write(self.style.WARNING("Dry-run completed. No embeddings were created."))
            return

        for extraction in extractions:
            material = extraction.material_version.material
            course = material.course

            title = material.title
            document_title = f"{course.code} - {title}"

            text = (extraction.extracted_text or "")[:MAX_DOCUMENT_CHARS]

            chunks = chunk_extraction_text(text)

            if not chunks:
                self.stdout.write(self.style.WARNING(f"Skipped empty extraction: {extraction.id}"))
                continue

            existing = {
                item.chunk_index: item
                for item in MaterialChunkEmbedding.objects.filter(
                    extraction=extraction,
                    embedding_model=model,
                )
            }

            extraction_complete = True

            self.stdout.write(f"Indexing: {title} ({len(chunks)} chunks)")

            for chunk_index, (page_number, chunk) in enumerate(chunks):
                # Include title in the hash because title is part
                # of the text submitted to Gemini.
                content_hash = hashlib.sha256(f"{document_title}\0{chunk}".encode()).hexdigest()

                previous = existing.get(chunk_index)

                if (
                    not force
                    and previous is not None
                    and previous.content_hash == content_hash
                    and previous.dimensions == dimensions
                    and len(previous.embedding) == dimensions
                ):
                    # Keep page metadata synchronized.
                    if previous.page_number != page_number:
                        previous.page_number = page_number
                        previous.text = chunk
                        previous.save(
                            update_fields=[
                                "page_number",
                                "text",
                                "updated_at",
                            ]
                        )

                    skipped_count += 1
                    continue

                try:
                    vector = embed_text(
                        chunk,
                        title=document_title,
                    )

                except EmbeddingError as exc:
                    extraction_complete = False
                    failed_count += 1

                    self.stderr.write(
                        self.style.ERROR(
                            f"Embedding failed for extraction "
                            f"{extraction.id}, chunk {chunk_index}: {exc}"
                        )
                    )
                    break

                _, created = MaterialChunkEmbedding.objects.update_or_create(
                    extraction=extraction,
                    chunk_index=chunk_index,
                    embedding_model=model,
                    defaults={
                        "page_number": page_number,
                        "text": chunk,
                        "content_hash": content_hash,
                        "dimensions": dimensions,
                        "embedding": vector,
                    },
                )

                if created:
                    created_count += 1
                else:
                    updated_count += 1

            # Do not delete old vectors if an API request failed.
            # A subsequent run can safely resume the indexing job.
            if extraction_complete:
                stale = MaterialChunkEmbedding.objects.filter(
                    extraction=extraction,
                    embedding_model=model,
                    chunk_index__gte=len(chunks),
                )

                deleted, _ = stale.delete()
                deleted_count += deleted

            self.stdout.write(
                f"Finished: {title} | chunks={len(chunks)} | complete={extraction_complete}"
            )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Embedding indexing summary"))

        self.stdout.write(f"Created: {created_count}")
        self.stdout.write(f"Updated: {updated_count}")
        self.stdout.write(f"Skipped: {skipped_count}")
        self.stdout.write(f"Deleted stale: {deleted_count}")
        self.stdout.write(f"Failed extractions: {failed_count}")

        if failed_count:
            raise CommandError(f"Indexing failed for {failed_count} extractions; safe to retry.")
