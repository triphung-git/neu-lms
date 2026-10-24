from datetime import timedelta

from django.contrib.sessions.backends.db import SessionStore
from django.contrib.sessions.models import Session
from django.db import transaction
from django.utils import timezone

from identity.models import UserSession
from identity.services.common import (
    digest,
    invalidate_sessions,
    locked_user,
    require_active,
    require_admin,
)
from platform_core.errors import DomainError
from platform_core.events import record_change

IDLE_TIMEOUT = timedelta(minutes=30)
ABSOLUTE_TIMEOUT = timedelta(hours=12)


@transaction.atomic
def issue_session(*, user_id):
    user = locked_user(user_id)
    require_active(user)
    now = timezone.now()
    store = SessionStore()
    # B03 will create the Django authentication payload and enforce metadata on
    # every request. These foundation sessions do not authenticate HTTP requests.
    store["user_id"] = str(user.id)
    store["auth_version"] = user.auth_version
    store.set_expiry(now + IDLE_TIMEOUT)
    store.create()
    metadata = UserSession.objects.create(
        user=user,
        key_digest=digest(store.session_key),
        auth_version_at_issue=user.auth_version,
        created_at=now,
        last_seen_at=now,
        idle_expires_at=now + IDLE_TIMEOUT,
        absolute_expires_at=now + ABSOLUTE_TIMEOUT,
    )
    # Only this result carries the raw key; never persist it in metadata/audit.
    return store.session_key, metadata


@transaction.atomic
def touch_session(*, session_key):
    metadata = UserSession.objects.filter(key_digest=digest(session_key)).first()
    if metadata is None:
        raise DomainError("SESSION_INVALID")
    user = locked_user(metadata.user_id)
    metadata = UserSession.objects.select_for_update().get(pk=metadata.pk)
    now = timezone.now()
    if metadata.revoked_at or metadata.auth_version_at_issue != user.auth_version:
        raise DomainError("SESSION_REVOKED")
    if not user.is_active:
        raise DomainError("ACCOUNT_INACTIVE")
    if now >= metadata.idle_expires_at or now >= metadata.absolute_expires_at:
        raise DomainError("SESSION_EXPIRED")
    session = Session.objects.select_for_update().filter(session_key=session_key).first()
    if session is None or session.expire_date <= now:
        raise DomainError("SESSION_EXPIRED")
    data = session.get_decoded()
    if data.get("user_id") != str(user.id) or data.get("auth_version") != user.auth_version:
        raise DomainError("SESSION_INVALID")
    metadata.last_seen_at = now
    metadata.idle_expires_at = min(now + IDLE_TIMEOUT, metadata.absolute_expires_at)
    metadata.save(update_fields=["last_seen_at", "idle_expires_at"])
    session.expire_date = metadata.idle_expires_at
    # Keep signed payload's stored absolute expiry consistent with database expiry.
    data["_session_expiry"] = metadata.idle_expires_at.isoformat()
    session.session_data = SessionStore().encode(data)
    session.save(update_fields=["expire_date", "session_data"])
    return metadata


def _authorize(actor_id, user):
    actor = locked_user(actor_id)
    require_active(actor)
    if actor.id != user.id:
        require_admin(actor.id)
    return actor


@transaction.atomic
def revoke_session(*, actor_id, session_id):
    # Policy lock serializes cross-account administrative changes before user locks.
    from identity.services.common import lock_role_policy

    lock_role_policy()
    metadata = UserSession.objects.get(pk=session_id)
    user = locked_user(metadata.user_id)
    actor = _authorize(actor_id, user)
    metadata = UserSession.objects.select_for_update().get(pk=session_id)
    if metadata.revoked_at is None:
        metadata.revoked_at = timezone.now()
        metadata.revoke_reason = "explicit_logout"
        metadata.save(update_fields=["revoked_at", "revoke_reason"])
        record_change(
            action="session.revoked", resource_type="session", resource_id=metadata.id, actor=actor
        )
    return metadata


@transaction.atomic
def revoke_all_sessions(*, actor_id, user_id):
    from identity.services.common import lock_role_policy

    lock_role_policy()
    user = locked_user(user_id)
    actor = _authorize(actor_id, user)
    invalidate_sessions(user, "logout_all")
    record_change(
        action="session.all_revoked", resource_type="user", resource_id=user.id, actor=actor
    )
