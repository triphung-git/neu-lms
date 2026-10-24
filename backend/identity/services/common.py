import hashlib

from django.db import connection
from django.utils import timezone

from identity.models import Role, RoleGrant, User, UserSession, VerifiedEmail
from platform_core.errors import DomainError


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def lock_role_policy():
    """Every role/account-state mutation takes this lock before locking users.

    A transaction-scoped PostgreSQL lock serializes the last-admin invariant,
    including bootstrap when there are no rows to lock yet.
    """
    if not connection.in_atomic_block:
        raise RuntimeError("Role policy lock requires transaction.atomic")
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(%s)", [7310142001])


def locked_user(user_id):
    return User.objects.select_for_update().get(pk=user_id)


def require_active(user):
    if not user.is_active:
        raise DomainError("ACCOUNT_INACTIVE")


def has_role(user, role):
    return (
        user.is_active
        and RoleGrant.objects.filter(user=user, role=role, revoked_at__isnull=True).exists()
    )


def require_admin(actor_id):
    actor = User.objects.get(pk=actor_id)
    if not has_role(actor, Role.ADMIN):
        raise DomainError("FORBIDDEN")
    return actor


def require_verified(user):
    if not VerifiedEmail.objects.filter(
        user=user, verified_at__isnull=False, email_digest=digest(user.email)
    ).exists():
        raise DomainError("EMAIL_NOT_VERIFIED")


def preserve_last_admin(user):
    if (
        has_role(user, Role.ADMIN)
        and not RoleGrant.objects.filter(
            role=Role.ADMIN, revoked_at__isnull=True, user__is_active=True
        )
        .exclude(user=user)
        .exists()
    ):
        raise DomainError("LAST_ACTIVE_ADMIN")


def invalidate_sessions(user, reason):
    user.auth_version += 1
    user.save(update_fields=["auth_version", "updated_at"])
    UserSession.objects.filter(user=user, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoke_reason=reason
    )
