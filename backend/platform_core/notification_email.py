"""Opt-in SMTP delivery with durable deduplication, bounded retries and access checks.

SMTP is at-least-once: a crash after server acceptance can cause a duplicate.
No scores or announcement body are placed in email; the link requires login.
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMessage
from django.db import transaction
from django.db.models import Exists, OuterRef
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from assignments.models import AssignmentStatus, SubmissionGradeEntry
from courses.models import CourseAnnouncementReceipt, Membership
from identity.models import Role
from identity.services.common import has_role, require_verified
from platform_core.errors import DomainError

from .models import NotificationEmailDelivery as Delivery

logger = logging.getLogger(__name__)
MAX_ATTEMPTS = 5


def enqueue_notifications(batch_size=100):
    cutoff = parse_datetime(settings.NOTIFICATION_EMAIL_START_AT)
    if cutoff is None or timezone.is_naive(cutoff):
        raise ImproperlyConfigured(
            "NOTIFICATION_EMAIL_START_AT must be an ISO timestamp with timezone"
        )
    count = 0
    receipts = (
        CourseAnnouncementReceipt.objects.filter(
            announcement__published_at__gte=cutoff,
        )
        .alias(
            queued=Exists(
                Delivery.objects.filter(
                    kind="announcement",
                    source_id=OuterRef("pk"),
                    recipient_id=OuterRef("membership__student_id"),
                )
            )
        )
        .filter(queued=False)
        .select_related("membership")
        .order_by("pk")[:batch_size]
    )
    for receipt in receipts:
        _, created = Delivery.objects.get_or_create(
            kind="announcement", source_id=receipt.pk, recipient_id=receipt.membership.student_id
        )
        count += int(created)
    grades = (
        SubmissionGradeEntry.objects.filter(
            status=SubmissionGradeEntry.Status.PUBLISHED,
            created_at__gte=cutoff,
        )
        .alias(
            queued=Exists(
                Delivery.objects.filter(
                    kind="grade",
                    source_id=OuterRef("pk"),
                    recipient_id=OuterRef("submission__student_id"),
                )
            )
        )
        .filter(queued=False)
        .select_related("submission")
        .order_by("pk")[:batch_size]
    )
    for grade in grades:
        _, created = Delivery.objects.get_or_create(
            kind="grade", source_id=grade.pk, recipient_id=grade.submission.student_id
        )
        count += int(created)
    return count


def email_content(delivery):
    user = delivery.recipient
    if not has_role(user, Role.STUDENT):
        return None
    try:
        require_verified(user)
    except DomainError:
        return None
    if delivery.kind == "announcement":
        receipt = (
            CourseAnnouncementReceipt.objects.filter(
                pk=delivery.source_id,
                membership__student=user,
                membership__status=Membership.Status.ACTIVE,
            )
            .select_related("announcement__course")
            .first()
        )
        if receipt is None:
            return None
        course = receipt.announcement.course
        title = "Bạn có thông báo môn học mới"
        path = f"/sv/thong-bao?mon={course.pk}&thongBao={receipt.announcement_id}"
    else:
        grade = (
            SubmissionGradeEntry.objects.filter(
                pk=delivery.source_id,
                submission__student=user,
                status=SubmissionGradeEntry.Status.PUBLISHED,
                submission__assignment__published_at__isnull=False,
                submission__assignment__status__in=[
                    AssignmentStatus.PUBLISHED,
                    AssignmentStatus.CLOSED,
                    AssignmentStatus.ARCHIVED,
                ],
            )
            .select_related("submission__assignment__course")
            .first()
        )
        if grade is None:
            return None
        course = grade.submission.assignment.course
        if not Membership.objects.filter(
            course=course, student=user, status=Membership.Status.ACTIVE
        ).exists():
            return None
        title = "Điểm bài tập của bạn đã được công bố"
        path = f"/sv/mon-hoc/{course.pk}/bai-tap/{grade.submission.assignment_id}"
    base = settings.PUBLIC_APP_ORIGIN.rstrip("/")
    return title, f"{title}.\nHọc phần: {course.name}\nĐăng nhập để xem: {base}{path}"


def dispatch_notifications(batch_size=50):
    # A worker terminated mid-send is recoverable; email providers may duplicate that send.
    Delivery.objects.filter(
        status="processing", locked_at__lt=timezone.now() - timedelta(minutes=10)
    ).update(status="pending")
    sent = 0
    for _ in range(batch_size):
        with transaction.atomic():
            delivery = (
                Delivery.objects.select_for_update(skip_locked=True)
                .filter(
                    status="pending", available_at__lte=timezone.now(), attempts__lt=MAX_ATTEMPTS
                )
                .order_by("available_at", "id")
                .first()
            )
            if delivery is None:
                break
            delivery.status, delivery.locked_at = "processing", timezone.now()
            delivery.attempts += 1
            delivery.save(update_fields=["status", "locked_at", "attempts"])
        delivery = Delivery.objects.select_related("recipient").get(pk=delivery.pk)
        try:
            content = email_content(delivery)
            if content is None:
                Delivery.objects.filter(pk=delivery.pk).update(status="skipped", locked_at=None)
                continue
            subject, body = content
            message = EmailMessage(
                subject=subject,
                body=body,
                to=[delivery.recipient.email],
                headers={"Message-ID": f"<neu-notice-{delivery.pk}@notifications.neu-lms>"},
            )
            if message.send(fail_silently=False) != 1:
                raise RuntimeError("EMAIL_NOT_ACCEPTED")
        except Exception as exc:
            code = type(exc).__name__[:64]
            Delivery.objects.filter(pk=delivery.pk).update(
                status="failed" if delivery.attempts >= MAX_ATTEMPTS else "pending",
                locked_at=None,
                last_error_code=code,
                available_at=timezone.now()
                + timedelta(seconds=min(3600, 60 * 2**delivery.attempts)),
            )
            logger.warning("Notification email failed; delivery=%s code=%s", delivery.pk, code)
        else:
            Delivery.objects.filter(pk=delivery.pk).update(
                status="sent", sent_at=timezone.now(), locked_at=None, last_error_code=""
            )
            sent += 1
    # Exhausted leases must not remain permanently pending after a crash on final attempt.
    Delivery.objects.filter(status="pending", attempts__gte=MAX_ATTEMPTS).update(status="failed")
    return sent
