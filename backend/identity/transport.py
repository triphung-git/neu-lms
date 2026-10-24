import logging
import smtplib
import socket
from urllib.parse import quote

from django.conf import settings
from django.core.mail import send_mail
from django.db import models, transaction
from django.utils import timezone

from identity.models import PasswordResetDelivery

logger = logging.getLogger(__name__)


def classify_smtp_error(exc: Exception) -> str:
    """Classify SMTP/network exceptions into structured machine-readable error codes.

    Never leak stack trace, server host, or credentials.
    """
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return "smtp_timeout"
    if isinstance(exc, (smtplib.SMTPConnectError, ConnectionError)):
        return "smtp_connection_error"
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return "smtp_recipient_refused"
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "smtp_auth_error"
    if isinstance(exc, smtplib.SMTPServerDisconnected):
        return "smtp_server_disconnected"
    if isinstance(exc, smtplib.SMTPResponseException):
        return "smtp_response_error"
    if isinstance(exc, smtplib.SMTPException):
        return "smtp_error"
    if isinstance(exc, OSError):
        return "smtp_network_error"
    return "unknown_transport_error"


def deliver_password_reset(delivery_id):
    """Deliver password reset email with delivery state tracking and retry limits.

    Invariants:
    1. No network I/O in database transaction: Row-locking and state transition
       to PROCESSING occur in a fast initial atomic block; send_mail runs outside any
       transaction; terminal status (SENT/FAILED/PENDING) commits in a separate block.
    2. Idempotent & Duplicate-dispatch safe: If already SENT or currently PROCESSING,
       duplicate invocations exit immediately.
    3. Zero token leakage: Only minimal delivery IDs are logged; no token, email,
       password, or raw traceback ever enters logs, audit, or exception messages.
    4. Fragment-based URL: The derived token is placed in '#token=...', ensuring
       it is never transmitted in HTTP request lines or captured in access logs.
    """
    from identity.services.common import digest
    from identity.services.passwords import derive_password_reset_token

    # Step 1: Check and reserve delivery record inside a quick atomic transaction
    with transaction.atomic():
        delivery = (
            PasswordResetDelivery.objects.select_for_update()
            .select_related("token", "user")
            .filter(pk=delivery_id)
            .first()
        )
        if delivery is None:
            logger.warning("Password reset delivery record not found (delivery_id=%s)", delivery_id)
            return None

        if delivery.status == PasswordResetDelivery.Status.SENT:
            # Already delivered; idempotent exit prevents duplicate dispatch.
            return delivery

        now = timezone.now()
        if delivery.status == PasswordResetDelivery.Status.PROCESSING:
            # Check for stale processing (> 5 minutes) before skipping
            stale_threshold = now - timezone.timedelta(minutes=5)
            if delivery.last_attempt_at and delivery.last_attempt_at > stale_threshold:
                return delivery

        if delivery.attempts >= delivery.max_attempts:
            logger.warning(
                "Password reset delivery skipped: max attempts reached "
                "(delivery_id=%s, attempts=%s)",
                delivery.id,
                delivery.attempts,
            )
            return delivery

        token = delivery.token
        if token.used_at or token.expires_at <= now:
            delivery.status = PasswordResetDelivery.Status.FAILED
            delivery.last_error_code = "token_expired_or_used"
            delivery.save(update_fields=["status", "last_error_code"])
            return delivery

        if token.auth_version != delivery.user.auth_version:
            delivery.status = PasswordResetDelivery.Status.FAILED
            delivery.last_error_code = "stale_auth_version"
            delivery.save(update_fields=["status", "last_error_code"])
            return delivery

        raw_token = derive_password_reset_token(token)
        if digest(raw_token) != token.digest:
            delivery.status = PasswordResetDelivery.Status.FAILED
            delivery.last_error_code = "token_derivation_mismatch"
            delivery.save(update_fields=["status", "last_error_code"])
            return delivery

        delivery.status = PasswordResetDelivery.Status.PROCESSING
        delivery.attempts += 1
        delivery.last_attempt_at = now
        delivery.save(update_fields=["status", "attempts", "last_attempt_at"])

        recipient_email = delivery.email
        url = f"{settings.PUBLIC_APP_ORIGIN}/reset-password#token={quote(raw_token)}"

    # Step 2: Network I/O strictly OUTSIDE transaction
    send_success = False
    error_code = ""
    try:
        send_mail(
            "NEU LMS: password reset",
            (
                f"Reset your password within 30 minutes: {url}\n"
                "Ignore this email if you did not request it."
            ),
            settings.DEFAULT_FROM_EMAIL,
            [recipient_email],
            fail_silently=False,
        )
        send_success = True
    except (smtplib.SMTPException, OSError, ConnectionError, TimeoutError) as exc:
        error_code = classify_smtp_error(exc)
        logger.error(
            "Password reset delivery attempt failed (delivery_id=%s, error_code=%s, attempt=%s)",
            delivery_id,
            error_code,
            delivery.attempts,
        )

    # Step 3: Record terminal result in a second quick transaction
    with transaction.atomic():
        delivery = PasswordResetDelivery.objects.select_for_update().get(pk=delivery_id)
        if send_success:
            delivery.status = PasswordResetDelivery.Status.SENT
            delivery.sent_at = timezone.now()
            delivery.last_error_code = ""
        else:
            if delivery.attempts >= delivery.max_attempts:
                delivery.status = PasswordResetDelivery.Status.FAILED
            else:
                delivery.status = PasswordResetDelivery.Status.PENDING
            delivery.last_error_code = error_code
        delivery.save(update_fields=["status", "sent_at", "last_error_code"])

    return delivery


def retry_pending_reset_deliveries(max_batch: int = 50):
    """Retry deliveries that are pending or have stale processing status.

    Ignores expired or consumed tokens.
    """
    now = timezone.now()
    stale_threshold = now - timezone.timedelta(minutes=5)
    candidates = list(
        PasswordResetDelivery.objects.filter(
            models.Q(status=PasswordResetDelivery.Status.PENDING)
            | models.Q(
                status=PasswordResetDelivery.Status.PROCESSING,
                last_attempt_at__lt=stale_threshold,
            ),
            attempts__lt=models.F("max_attempts"),
            token__expires_at__gt=now,
            token__used_at__isnull=True,
        )
        .order_by("created_at")
        .values_list("id", flat=True)[:max_batch]
    )
    results = []
    for delivery_id in candidates:
        delivery = deliver_password_reset(delivery_id)
        if delivery:
            results.append(delivery)
    return results
