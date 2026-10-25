import uuid

from platform_core.errors import DomainError
from platform_core.models import AuditEvent, OutboxEvent

# No free-form request bodies, reasons, credentials or personally identifying fields.
EVENTS = {
    "password.changed": set(),
    "password.reset": set(),
    "account.password_reset_initiated": set(),
    "account.created": set(),
    "email.verified": set(),
    "role.requested": {"role"},
    "role.reviewed": {"role", "status"},
    "role.granted": {"role"},
    "role.revoked": {"role"},
    "account.active_changed": {"active"},
    "session.revoked": set(),
    "session.all_revoked": set(),
    "admin.bootstrapped": set(),
}


def _metadata(action, metadata):
    allowed = EVENTS.get(action)
    if allowed is None or set(metadata) != allowed:
        raise DomainError("INVALID_EVENT_METADATA")
    if "role" in metadata and metadata["role"] not in {"student", "teacher", "admin"}:
        raise DomainError("INVALID_EVENT_METADATA")
    if "status" in metadata and metadata["status"] not in {"approved", "rejected", "cancelled"}:
        raise DomainError("INVALID_EVENT_METADATA")
    if "active" in metadata and type(metadata["active"]) is not bool:
        raise DomainError("INVALID_EVENT_METADATA")
    return metadata.copy()


def append_audit(*, action, resource_type, resource_id, actor=None, system_actor="", metadata=None):
    if resource_type not in {"user", "role_request", "role_grant", "session"}:
        raise DomainError("INVALID_RESOURCE_TYPE")
    if (actor is None) == (not system_actor):
        raise DomainError("AUDIT_ACTOR_REQUIRED")
    if system_actor and system_actor not in {"registration", "email_verifier", "bootstrap_command"}:
        raise DomainError("INVALID_SYSTEM_ACTOR")
    return AuditEvent.objects.create(
        actor=actor,
        system_actor=system_actor,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        metadata=_metadata(action, metadata or {}),
    )


def enqueue(*, event_type, aggregate_id, dedupe_key, payload):
    if event_type not in EVENTS or set(payload) != {"resource_id"}:
        raise DomainError("INVALID_EVENT_PAYLOAD")
    payload = {"resource_id": str(uuid.UUID(str(payload["resource_id"])))}
    if not dedupe_key or len(dedupe_key) > 128:
        raise DomainError("INVALID_DEDUPE_KEY")
    event, created = OutboxEvent.objects.get_or_create(
        dedupe_key=dedupe_key,
        defaults={"event_type": event_type, "aggregate_id": aggregate_id, "payload": payload},
    )
    if not created and (
        event.event_type != event_type
        or str(event.aggregate_id) != str(aggregate_id)
        or event.payload != payload
    ):
        raise DomainError("DEDUPE_CONFLICT")
    return event


def record_change(
    *, action, resource_type, resource_id, actor=None, system_actor="", metadata=None
):
    # Call inside the business transaction; no network or callback performs delivery.
    from django.db import connection

    if not connection.in_atomic_block:
        raise RuntimeError("record_change requires a business transaction")
    audit = append_audit(
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        actor=actor,
        system_actor=system_actor,
        metadata=metadata,
    )
    enqueue(
        event_type=action,
        aggregate_id=resource_id,
        dedupe_key=str(audit.id),
        payload={"resource_id": str(resource_id)},
    )
    return audit
