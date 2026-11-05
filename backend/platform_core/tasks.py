from celery import shared_task
from django.conf import settings

from .notification_email import dispatch_notifications, enqueue_notifications


@shared_task(acks_late=True, reject_on_worker_lost=True)
def process_notification_emails():
    if not settings.NOTIFICATION_EMAIL_ENABLED:
        return {"status": "disabled"}
    return {"queued": enqueue_notifications(), "sent": dispatch_notifications()}
