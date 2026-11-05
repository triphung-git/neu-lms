import logging

from botocore.exceptions import BotoCoreError, ClientError
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(acks_late=True, reject_on_worker_lost=True)
def process_pending_files():
    from files.models import FileStatus, StoredFile
    from files.services import cleanup_expired_upload_intents, scan_stored_file

    cleanup_expired_upload_intents()
    ids = list(
        StoredFile.objects.filter(status=FileStatus.SCANNING)
        .order_by("updated_at", "id")
        .values_list("id", flat=True)[:50]
    )
    for file_id in ids:
        try:
            scan_stored_file(file_id=file_id)
        except (OSError, ValueError, BotoCoreError, ClientError):
            # SCANNING is durable; the next scheduled pass retries, without granting access.
            # Rotate failed rows so a full batch of failures cannot starve later uploads.
            StoredFile.objects.filter(pk=file_id, status=FileStatus.SCANNING).update(
                updated_at=timezone.now()
            )
            logger.warning("File scan deferred; file_id=%s", file_id)
            continue
