from django.contrib.auth.password_validation import validate_password
from django.db import IntegrityError, transaction
from django.utils import timezone

from identity.managers import canonical_email
from identity.models import User, VerifiedEmail
from identity.services.common import (
    digest,
    invalidate_sessions,
    lock_role_policy,
    locked_user,
    preserve_last_admin,
    require_active,
    require_admin,
)
from platform_core.errors import DomainError
from platform_core.events import record_change


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
def set_account_active(*, actor_id, user_id, active):
    if type(active) is not bool:
        raise DomainError("INVALID_ACCOUNT_STATE")
    lock_role_policy()
    actor = require_admin(actor_id)
    user = locked_user(user_id)
    if user.is_active == active:
        return user
    if not active:
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
