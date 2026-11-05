"""Email verification domain services.

Invariants:
1. Hash-only: Tokens are stored solely as SHA-256 digests in EmailVerificationToken.
2. Single-use: Verified token is atomically stamped with used_at=now();
   subsequent attempts are rejected.
3. 24-hour TTL: Tokens expire after 24 hours (now + 24h).
4. Bound strictly to user, registered email, auth_version, and 'email-verification:' HMAC prefix.
5. Delivery dispatched out-of-request (T02) via EmailVerificationDelivery with status PENDING.
6. Rate limited resend: Rapid resend attempts are throttled via AuthRateBucket.
7. Resend invalidation policy: Resending invalidates all previous unconsumed tokens and marks
   unprocessed deliveries as superseded.
8. Atomic state transition: Token consumption, email verification, and role grant commit together.
9. Eligibility: Eligible student accounts with pending student requests are automatically granted
   the student role via grant_student_role. Teacher accounts remain pending admin approval (B05).
   Never self-grant teacher or admin.
10. Revoked grant protection: Revoked grants are never restored via automated verification.
11. Security negatives: Inactive accounts, wrong accounts, mismatched emails, or stale auth_versions
    are safely rejected without secret leakage or state mutation.
"""

import re
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from identity.managers import canonical_email
from identity.models import (
    EmailVerificationDelivery,
    EmailVerificationToken,
    Role,
    RoleGrant,
    RoleRequest,
    User,
    VerifiedEmail,
)
from identity.services.accounts import STUDENT_EMAIL_REGEX, confirm_email
from identity.services.common import digest, lock_role_policy, locked_user
from identity.services.passwords import rate_limit
from identity.services.roles import grant_student_role
from identity.transport import derive_email_verification_token
from platform_core.errors import DomainError


def issue_verification_token(
    *, user: User
) -> tuple[str, EmailVerificationToken, EmailVerificationDelivery]:
    """Issue a single-use 24-hour verification token and delivery record.

    Only token.digest is persisted. The raw token is derived via HMAC-SHA256
    keyed with SECRET_KEY and returned to caller / dispatcher.
    """
    if user.pk:
        user.refresh_from_db(fields=["auth_version"])
    now = timezone.now().replace(microsecond=0)
    token = EmailVerificationToken(
        user=user,
        email=user.email,
        auth_version=user.auth_version,
        created_at=now,
        expires_at=now + timedelta(hours=24),
    )
    raw_token = derive_email_verification_token(token)
    token.digest = digest(raw_token)
    token.save()

    delivery = EmailVerificationDelivery.objects.create(
        token=token,
        user=user,
        email=user.email,
        status=EmailVerificationDelivery.Status.PENDING,
        attempts=0,
        max_attempts=3,
    )
    delivery.raw_token = raw_token
    return raw_token, token, delivery


def resend_email_verification(
    *, email: str, request_ip: str | None = None
) -> EmailVerificationDelivery | None:
    """Resend email verification token for an unverified account.

    Policy:
    1. Canonicalizes email; safely returns None if email is invalid or user does not exist.
    2. Rate limited via AuthRateBucket per email (and IP if provided).
    3. If user is inactive or already verified, safely returns None (prevents account enumeration).
    4. Atomically invalidates all prior unconsumed tokens for this user by setting used_at=now().
    5. Marks prior pending/processing deliveries as superseded.
    6. Issues a new 24h verification token and creates a PENDING delivery for T02 dispatcher.
    7. Zero network/SMTP I/O in transaction.
    """
    try:
        canonical = canonical_email(email)
    except Exception:
        return None

    if not canonical:
        return None

    # Rate limiting: max 5 requests per 15 minutes per email
    rate_limit(scope="resend_verification_email", identity=canonical, maximum=5)
    if request_ip:
        rate_limit(scope="resend_verification_ip", identity=request_ip, maximum=10)

    user = User.objects.filter(email=canonical).first()
    if user is None or not user.is_active:
        return None

    # Fast pre-check: if already verified, do nothing
    verified = VerifiedEmail.objects.filter(user=user, verified_at__isnull=False).first()
    if verified and verified.email_digest == digest(user.email):
        return None

    with transaction.atomic():
        user = locked_user(user.id)
        if not user.is_active:
            return None

        verified = VerifiedEmail.objects.filter(user=user, verified_at__isnull=False).first()
        if verified and verified.email_digest == digest(user.email):
            return None

        now = timezone.now().replace(microsecond=0)

        # Invalidate all prior unconsumed tokens for this user
        EmailVerificationToken.objects.filter(
            user=user,
            used_at__isnull=True,
        ).update(used_at=now)

        # Supersede any uncompleted deliveries
        EmailVerificationDelivery.objects.filter(
            user=user,
            status__in=[
                EmailVerificationDelivery.Status.PENDING,
                EmailVerificationDelivery.Status.PROCESSING,
            ],
        ).update(
            status=EmailVerificationDelivery.Status.FAILED,
            last_error_code="superseded_by_resend",
        )

        raw_token, token, delivery = issue_verification_token(user=user)
        return delivery


def verify_email(*, token: str) -> dict:
    """Consume an email verification token, update VerifiedEmail, and grant eligible student roles.

    Invariants:
    1. Token must be valid, unexpired, unconsumed, and match user's current auth_version and email.
    2. Invalid, reused, or expired tokens raise safe DomainError("TOKEN_INVALID_OR_EXPIRED").
    3. Inactive accounts raise DomainError("ACCOUNT_INACTIVE").
    4. Account or email mismatch raises DomainError("EMAIL_MISMATCH").
    5. Token consumption and email verification are atomic.
    6. Eligible student accounts (email matches student regex and has a pending student RoleRequest)
       are granted the student role via grant_student_role.
    7. Teacher accounts have their email verified, but their RoleRequest remains PENDING awaiting
       admin approval (B05). Never self-grant teacher or admin!
    8. Revoked grants are NEVER restored by automated verification.
    """
    if not token or not isinstance(token, str):
        raise DomainError("TOKEN_INVALID_OR_EXPIRED")

    token_digest = digest(token)
    candidate = EmailVerificationToken.objects.filter(digest=token_digest).first()
    if candidate is None:
        raise DomainError("TOKEN_INVALID_OR_EXPIRED")

    with transaction.atomic():
        lock_role_policy()
        user = locked_user(candidate.user_id)
        if not user.is_active:
            raise DomainError("ACCOUNT_INACTIVE")

        token_record = EmailVerificationToken.objects.select_for_update().get(pk=candidate.id)

        now = timezone.now()
        if token_record.used_at is not None:
            raise DomainError("TOKEN_INVALID_OR_EXPIRED")
        if token_record.expires_at <= now:
            raise DomainError("TOKEN_INVALID_OR_EXPIRED")
        if token_record.auth_version != user.auth_version:
            raise DomainError("TOKEN_INVALID_OR_EXPIRED")
        if token_record.email != user.email:
            raise DomainError("EMAIL_MISMATCH")
        if derive_email_verification_token(token_record) != token:
            raise DomainError("TOKEN_INVALID_OR_EXPIRED")

        # Mark token consumed
        token_record.used_at = now
        token_record.save(update_fields=["used_at"])

        # Atomically confirm email via trusted verifier entry point
        confirm_email(user_id=user.id, expected_email=token_record.email)

        # Automated Role Grant logic
        # Never restore a grant that was previously revoked!
        has_revoked_student = RoleGrant.objects.filter(
            user=user, role=Role.STUDENT, revoked_at__isnull=False
        ).exists()

        if not has_revoked_student:
            student_req = (
                RoleRequest.objects.select_for_update()
                .filter(user=user, role=Role.STUDENT, status=RoleRequest.Status.PENDING)
                .first()
            )
            if student_req and re.fullmatch(STUDENT_EMAIL_REGEX, user.email):
                grant_student_role(user_id=user.id)

        active_roles = list(
            RoleGrant.objects.filter(user=user, revoked_at__isnull=True).values_list(
                "role", flat=True
            )
        )

        return {
            "user": user,
            "email": user.email,
            "verified": True,
            "granted_roles": sorted(active_roles),
        }
