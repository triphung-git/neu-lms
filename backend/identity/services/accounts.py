import re

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from identity.managers import canonical_email
from identity.models import (
    Role,
    RoleRequest,
    User,
    VerifiedEmail,
)
from identity.services.common import (
    digest,
    has_role,
    invalidate_sessions,
    lock_role_policy,
    locked_user,
    preserve_last_admin,
    require_active,
    require_admin,
)
from platform_core.errors import DomainError
from platform_core.events import record_change

STUDENT_EMAIL_REGEX = r"^1124[0-9]{4}@st\.neu\.edu\.vn$"
ALLOWED_REGISTRATION_ROLES = {Role.STUDENT, Role.TEACHER}
FORBIDDEN_REGISTRATION_FIELDS = {
    "is_superuser",
    "is_staff",
    "is_active",
    "actor",
    "actor_id",
    "roles",
    "grants",
    "permissions",
}


def create_account(*, email, password=None, display_name=""):
    email = canonical_email(email)
    if len(display_name) > 150:
        raise DomainError("INVALID_DISPLAY_NAME")
    candidate = User(email=email, display_name=display_name)
    if password is not None:
        validate_password(password, candidate)
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                email=email, password=password, display_name=display_name
            )
            VerifiedEmail.objects.create(user=user)
            record_change(
                action="account.created",
                resource_type="user",
                resource_id=user.id,
                system_actor="registration",
            )
            return user
    except IntegrityError as error:
        if (
            getattr(getattr(error.__cause__, "diag", None), "constraint_name", None)
            == "identity_user_email_key"
        ):
            raise DomainError("EMAIL_ALREADY_REGISTERED") from None
        raise


@transaction.atomic
def confirm_email(*, user_id, expected_email):
    """Trusted verifier entry point only. B03 must consume a valid token atomically.

    No HTTP route exposes this function. It does not accept arbitrary actor metadata
    and cannot attach an additional address or change the registered email.
    """
    lock_role_policy()
    user = locked_user(user_id)
    require_active(user)
    if canonical_email(expected_email) != user.email:
        raise DomainError("EMAIL_MISMATCH")
    verification, _ = VerifiedEmail.objects.get_or_create(user=user)
    if verification.verified_at and verification.email_digest == digest(user.email):
        return verification
    verification.verified_at = timezone.now()
    verification.email_digest = digest(user.email)
    verification.save()
    record_change(
        action="email.verified",
        resource_type="user",
        resource_id=user.id,
        system_actor="email_verifier",
    )
    return verification


@transaction.atomic
def set_account_active(*, actor_id, user_id, active, current_password=None, enforce_reauth=False):
    if type(active) is not bool:
        raise DomainError("INVALID_ACCOUNT_STATE")
    lock_role_policy()
    actor = require_admin(actor_id)
    user = locked_user(user_id)
    if user.is_active == active:
        return user
    if not active:
        if enforce_reauth and has_role(user, Role.ADMIN):
            if not current_password:
                raise DomainError("REAUTH_REQUIRED")
            if not actor.check_password(current_password):
                raise DomainError("INVALID_CREDENTIALS")
        preserve_last_admin(user)
    user.is_active = active
    user.save(update_fields=["is_active", "updated_at"])
    invalidate_sessions(user, "account_state_changed")
    record_change(
        action="account.active_changed",
        resource_type="user",
        resource_id=user.id,
        actor=actor,
        metadata={"active": active},
    )
    return user


@transaction.atomic
def admin_initiate_password_reset(*, actor_id, user_id):
    lock_role_policy()
    actor = require_admin(actor_id)
    user = locked_user(user_id)
    require_active(user)
    from identity.services.passwords import request_password_reset

    request_password_reset(email=user.email)
    record_change(
        action="account.password_reset_initiated",
        resource_type="user",
        resource_id=user.id,
        actor=actor,
    )
    return user


def register_account(*, email, password, display_name="", requested_role=None, **kwargs):
    """Self-service registration entry point for students and teachers (B04).

    Invariants:
    1. Role must be student or teacher; self-asserted admin/actor fields are rejected.
    2. Student email must strictly match STUDENT_EMAIL_REGEX; teacher email can be any valid email.
    3. Creates user, unverified email record, pending RoleRequest, and delivery intent atomically.
    4. Never issues RoleGrant directly. Unverified accounts have no learning/teaching permissions.
    5. Zero network/SMTP I/O in transaction; delivery record is created as 'pending'.
    6. Email uniqueness enforced by DB and pre-check; duplicate raises EMAIL_ALREADY_REGISTERED.
    7. No secondary or linked emails supported.
    """
    if requested_role is None and "role" in kwargs and len(kwargs) == 1:
        requested_role = kwargs.pop("role")

    if kwargs:
        raise DomainError("FORBIDDEN_REGISTRATION_FIELDS")

    if requested_role not in ALLOWED_REGISTRATION_ROLES:
        raise DomainError("ROLE_NOT_REQUESTABLE")

    email = canonical_email(email)

    if requested_role == Role.STUDENT and not re.fullmatch(STUDENT_EMAIL_REGEX, email):
        raise DomainError("INVALID_STUDENT_EMAIL_DOMAIN")

    if not password or not isinstance(password, str):
        raise ValidationError("Password is required.")

    if len(display_name) > 150:
        raise DomainError("INVALID_DISPLAY_NAME")

    if User.objects.filter(email=email).exists():
        raise DomainError("EMAIL_ALREADY_REGISTERED")

    with transaction.atomic():
        user = create_account(email=email, password=password, display_name=display_name)

        role_request = RoleRequest.objects.create(
            user=user,
            role=requested_role,
            status=RoleRequest.Status.PENDING,
        )
        record_change(
            action="role.requested",
            resource_type="role_request",
            resource_id=role_request.id,
            actor=user,
            metadata={"role": requested_role},
        )

        from identity.services.verification import issue_verification_token

        raw_token, token, delivery = issue_verification_token(user=user)

        user.role_request = role_request
        user.verification_delivery = delivery
        user.raw_verification_token = raw_token
        return user


from identity.services.verification import (  # noqa: E402
    issue_verification_token,
    resend_email_verification,
    verify_email,
)

__all__ = [
    "ALLOWED_REGISTRATION_ROLES",
    "FORBIDDEN_REGISTRATION_FIELDS",
    "STUDENT_EMAIL_REGEX",
    "confirm_email",
    "create_account",
    "issue_verification_token",
    "register_account",
    "resend_email_verification",
    "set_account_active",
    "verify_email",
]
