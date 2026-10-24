from django.db import transaction

from identity.managers import canonical_email
from identity.models import Role, RoleGrant, User
from identity.services.accounts import confirm_email, create_account
from identity.services.common import invalidate_sessions, lock_role_policy, require_active
from platform_core.errors import DomainError
from platform_core.events import record_change


@transaction.atomic
def bootstrap_admin(*, email, password=None, display_name="", ownership_confirmed=False):
    """Internal command boundary only. Never expose this as an HTTP registration option."""
    if ownership_confirmed is not True:
        raise DomainError("EMAIL_OWNERSHIP_CONFIRMATION_REQUIRED")
    lock_role_policy()
    email = canonical_email(email)
    user = User.objects.select_for_update().filter(email=email).first()
    if user is None:
        if not password:
            raise DomainError("PASSWORD_REQUIRED")
        user = create_account(email=email, password=password, display_name=display_name)
    require_active(user)
    confirm_email(user_id=user.id, expected_email=email)
    grant, created = RoleGrant.objects.get_or_create(
        user=user,
        role=Role.ADMIN,
        revoked_at__isnull=True,
        defaults={"grant_source": "internal_administration"},
    )
    if created:
        invalidate_sessions(user, "admin_granted")
        record_change(
            action="admin.bootstrapped",
            resource_type="user",
            resource_id=user.id,
            system_actor="bootstrap_command",
        )
    return user, grant
