"""Password operations. Callers must enforce CSRF and rate limits before invocation."""

import hashlib
import hmac
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models, transaction
from django.utils import timezone
from rest_framework.exceptions import AuthenticationFailed, Throttled, ValidationError

from identity.managers import canonical_email
from identity.models import AuthRateBucket, PasswordResetDelivery, PasswordResetToken, User
from identity.services.common import digest, invalidate_sessions, locked_user, require_active
from identity.services.sessions import issue_session
from platform_core.events import record_change


def derive_password_reset_token(token: PasswordResetToken) -> str:
    """Deterministically derive a 256-bit token from token metadata and SECRET_KEY.

    Binding:
      - token.id (UUIDv4)
      - token.user_id (UUID)
      - token.auth_version (int)
      - int(token.created_at.timestamp())
    Entropy:
      - HMAC-SHA256 keyed with settings.SECRET_KEY over unique token metadata.
      - Produces 256 bits of cryptographic entropy.
    Secret Rotation:
      - Tokens depend on SECRET_KEY. In-flight tokens expire after TTL (30 min).
    """
    ts = int(token.created_at.timestamp())
    msg = f"password-reset:{token.id}:{token.user_id}:{token.auth_version}:{ts}".encode()
    secret = settings.SECRET_KEY.encode("utf-8")
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


def cleanup_expired_auth_data(*, now=None):
    """Purge stale rate-limit buckets and expired/used password reset tokens.

    Safe to execute periodically via cron or maintenance tasks.
    """
    now = now or timezone.now()
    bucket_cutoff = now - timedelta(hours=24)
    buckets_deleted, _ = AuthRateBucket.objects.filter(starts_at__lt=bucket_cutoff).delete()

    token_cutoff = now - timedelta(days=7)
    tokens_deleted, _ = PasswordResetToken.objects.filter(
        models.Q(expires_at__lt=now) | models.Q(used_at__lt=token_cutoff)
    ).delete()

    from identity.models import EmailVerificationToken

    verification_tokens_deleted, _ = EmailVerificationToken.objects.filter(
        models.Q(expires_at__lt=now) | models.Q(used_at__lt=token_cutoff)
    ).delete()

    return {
        "buckets_deleted": buckets_deleted,
        "tokens_deleted": tokens_deleted,
        "verification_tokens_deleted": verification_tokens_deleted,
    }


def rate_limit(*, scope, identity, maximum=10):
    # PostgreSQL is shared across API workers. Commit counters independently of
    # the operation so failed credentials/validation cannot roll them back.
    key = digest(f"{scope}:{identity}")
    with transaction.atomic():
        AuthRateBucket.objects.get_or_create(key=key)
        bucket = AuthRateBucket.objects.select_for_update().get(pk=key)
        now = timezone.now()
        if now >= bucket.starts_at + timedelta(minutes=15):
            bucket.starts_at, bucket.attempts = now, 0
        if bucket.attempts >= maximum:
            wait = max(1, int((bucket.starts_at + timedelta(minutes=15) - now).total_seconds()))
        else:
            bucket.attempts += 1
            bucket.save()
            wait = None
    if wait is not None:
        raise Throttled(wait=wait)


def login_password(*, email, password):
    try:
        email = canonical_email(email)
    except (DjangoValidationError, TypeError, ValueError):
        email = ""
    user = User.objects.filter(email=email).first()
    if user is None:
        # Match password hashing cost without storing a dummy account.
        User().set_password(password)
        raise AuthenticationFailed("Email or password is incorrect.")
    with transaction.atomic():
        user = locked_user(user.id)
        if not user.check_password(password) or not user.is_active:
            raise AuthenticationFailed("Email or password is incorrect.")
        return user, issue_session(user_id=user.id)


@transaction.atomic
def change_password(*, user_id, current_password, new_password):
    user = locked_user(user_id)
    require_active(user)
    if not user.check_password(current_password):
        raise ValidationError({"current_password": "Current password is incorrect."})
    validate_password(new_password, user)
    user.set_password(new_password)
    user.save(update_fields=["password", "updated_at"])
    invalidate_sessions(user, "password_changed")
    record_change(action="password.changed", resource_type="user", resource_id=user.id, actor=user)


@transaction.atomic
def request_password_reset(*, email):
    try:
        canonical = canonical_email(email)
    except (DjangoValidationError, TypeError, ValueError):
        canonical = ""
    user = User.objects.filter(email=canonical, is_active=True).first()
    if user is None:
        return
    user = locked_user(user.id)
    if not user.is_active:
        return

    now = timezone.now().replace(microsecond=0)
    token_id = uuid.uuid4()
    token = PasswordResetToken(
        id=token_id,
        user=user,
        auth_version=user.auth_version,
        created_at=now,
        expires_at=now + timedelta(minutes=30),
    )
    raw_token = derive_password_reset_token(token)
    token.digest = digest(raw_token)
    token.save()

    PasswordResetDelivery.objects.create(
        token=token,
        user=user,
        email=user.email,
        status=PasswordResetDelivery.Status.PENDING,
        attempts=0,
        max_attempts=3,
    )
    # Delivery committed with status PENDING. Dispatcher will send email asynchronously.


@transaction.atomic
def reset_password(*, token, new_password):
    candidate = PasswordResetToken.objects.filter(digest=digest(token)).first()
    if candidate is None:
        raise ValidationError({"token": "Reset link is invalid or expired."})
    user = locked_user(candidate.user_id)
    candidate = PasswordResetToken.objects.select_for_update().get(pk=candidate.id)
    if (
        not user.is_active
        or candidate.used_at
        or candidate.expires_at <= timezone.now()
        or candidate.auth_version != user.auth_version
    ):
        raise ValidationError({"token": "Reset link is invalid or expired."})
    validate_password(new_password, user)
    user.set_password(new_password)
    user.save(update_fields=["password", "updated_at"])
    candidate.used_at = timezone.now()
    candidate.save(update_fields=["used_at"])
    invalidate_sessions(user, "password_reset")
    record_change(action="password.reset", resource_type="user", resource_id=user.id, actor=user)
