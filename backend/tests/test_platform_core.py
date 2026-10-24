import uuid
from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
from django.db import transaction
from django.utils import timezone

from identity.models import User
from identity.services.accounts import create_account
from platform_core.errors import DomainError
from platform_core.events import append_audit, enqueue
from platform_core.idempotency import ResultReference, execute_once
from platform_core.models import AuditEvent, IdempotencyRecord, OutboxEvent

pytestmark = pytest.mark.django_db


def options():
    return dict(
        scope=f"operation:{uuid.uuid4()}",
        operation="account.create",
        key="client-key",
        payload={"email": "person@example.test"},
    )


def test_idempotency_replay_conflict_and_scope():
    args = options()
    callback = Mock(return_value=ResultReference("user", uuid.uuid4()))
    first = execute_once(**args, mutation=callback)
    assert execute_once(**args, mutation=callback) == first
    assert callback.call_count == 1
    with pytest.raises(DomainError, match="IDEMPOTENCY_CONFLICT"):
        execute_once(**{**args, "payload": {"email": "different@example.test"}}, mutation=callback)
    execute_once(**{**args, "scope": f"user:{uuid.uuid4()}"}, mutation=callback)
    execute_once(**{**args, "operation": "account.other"}, mutation=callback)
    assert callback.call_count == 3
    stored = str(list(IdempotencyRecord.objects.values()))
    assert "client-key" not in stored and "person@example.test" not in stored


def test_expired_idempotency_can_be_reused():
    args = options()
    callback = Mock(return_value=ResultReference("user", uuid.uuid4()))
    execute_once(**args, mutation=callback)
    future = timezone.now() + timedelta(hours=25)
    with patch("platform_core.idempotency.timezone.now", return_value=future):
        execute_once(**{**args, "payload": {}}, mutation=callback)
    assert callback.call_count == 2
    assert IdempotencyRecord.objects.count() == 1


def test_idempotency_rolls_back_claim_business_and_events():
    args = options()

    def fail():
        create_account(email="rollback@example.test")
        raise RuntimeError("failure after mutation")

    with pytest.raises(RuntimeError):
        execute_once(**args, mutation=fail)
    assert IdempotencyRecord.objects.count() == User.objects.count() == 0
    assert AuditEvent.objects.count() == OutboxEvent.objects.count() == 0
    execute_once(**args, mutation=lambda: ResultReference("user", uuid.uuid4()))


def test_invalid_result_rolls_back():
    with pytest.raises(DomainError, match="INVALID_IDEMPOTENCY_RESULT"):
        execute_once(**options(), mutation=lambda: {"password": "never-cache-this"})
    assert IdempotencyRecord.objects.count() == 0


def test_outbox_dedupe_and_conflict():
    resource = uuid.uuid4()
    args = dict(
        event_type="account.created",
        aggregate_id=resource,
        dedupe_key="stable-event",
        payload={"resource_id": str(resource)},
    )
    with transaction.atomic():
        first = enqueue(**args)
        assert enqueue(**args).id == first.id
    with pytest.raises(DomainError, match="DEDUPE_CONFLICT"):
        enqueue(**{**args, "aggregate_id": uuid.uuid4()})
    assert OutboxEvent.objects.count() == 1


@pytest.mark.parametrize("field", ["password", "email", "token", "session_key", "request_body"])
def test_events_reject_sensitive_fields(field):
    resource = uuid.uuid4()
    with pytest.raises(DomainError, match="INVALID_EVENT_METADATA"):
        append_audit(
            action="account.created",
            resource_type="user",
            resource_id=resource,
            system_actor="registration",
            metadata={field: "secret"},
        )
    with pytest.raises(DomainError, match="INVALID_EVENT_PAYLOAD"):
        enqueue(
            event_type="account.created",
            aggregate_id=resource,
            dedupe_key="event",
            payload={field: "secret"},
        )
    assert AuditEvent.objects.count() == OutboxEvent.objects.count() == 0


def test_audit_requires_actor():
    with pytest.raises(DomainError, match="AUDIT_ACTOR_REQUIRED"):
        append_audit(action="account.created", resource_type="user", resource_id=uuid.uuid4())


@pytest.mark.parametrize("scope", [None, "anonymous", "user:" + "-" * 36])
def test_invalid_idempotency_scope(scope):
    with pytest.raises(DomainError, match="INVALID_IDEMPOTENCY_SCOPE"):
        execute_once(**{**options(), "scope": scope}, mutation=Mock())


def test_idempotency_scope_uuid_canonicalization():
    args = options()
    callback = Mock(return_value=ResultReference("user", uuid.uuid4()))
    execute_once(**args, mutation=callback)
    prefix, identifier = args["scope"].split(":")
    execute_once(**{**args, "scope": f"{prefix}:{identifier.upper()}"}, mutation=callback)
    assert callback.call_count == 1
