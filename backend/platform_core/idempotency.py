import hashlib
import json
import re
import uuid
from dataclasses import dataclass
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from platform_core.errors import DomainError
from platform_core.models import IdempotencyRecord


@dataclass(frozen=True)
class ResultReference:
    resource_type: str
    resource_id: uuid.UUID


def execute_once(*, scope, operation, key, payload, mutation):
    """Internal service; caller must authorize before invocation, including replay.

    scope must bind a trusted principal or a unique pre-auth operation. No anonymous
    global scope. Only a resource reference is persisted, never a raw HTTP response.
    """
    if not isinstance(scope, str) or not re.fullmatch(r"(user|operation):[0-9a-fA-F-]{36}", scope):
        raise DomainError("INVALID_IDEMPOTENCY_SCOPE")
    prefix, identifier = scope.split(":", 1)
    try:
        scope = f"{prefix}:{uuid.UUID(identifier)}"
    except ValueError:
        raise DomainError("INVALID_IDEMPOTENCY_SCOPE") from None
    if (
        not isinstance(operation, str)
        or not re.fullmatch(r"[a-z][a-z0-9_.]{0,63}", operation)
        or not isinstance(key, str)
        or not key
        or len(key) > 256
    ):
        raise DomainError("INVALID_IDEMPOTENCY_KEY")
    digest = hashlib.sha256(key.encode()).hexdigest()
    fingerprint = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    with transaction.atomic():
        now = timezone.now()
        try:
            with transaction.atomic():
                record = IdempotencyRecord.objects.create(
                    scope=scope,
                    operation=operation,
                    key_digest=digest,
                    request_digest=fingerprint,
                    created_at=now,
                    expires_at=now + timedelta(hours=24),
                )
        except IntegrityError as error:
            if (
                getattr(getattr(error.__cause__, "diag", None), "constraint_name", None)
                != "idempotency_scope_key_unique"
            ):
                raise
            record = IdempotencyRecord.objects.select_for_update().get(
                scope=scope, operation=operation, key_digest=digest
            )
            now = timezone.now()
            if record.expires_at > now:
                if record.request_digest != fingerprint:
                    raise DomainError("IDEMPOTENCY_CONFLICT") from None
                if record.status != "completed":
                    raise DomainError("IDEMPOTENCY_IN_PROGRESS") from None
                return ResultReference(record.result_type, record.result_id)
            record.request_digest = fingerprint
            record.created_at = now
            record.expires_at = now + timedelta(hours=24)
        result = mutation()
        if not isinstance(result, ResultReference) or result.resource_type not in {
            "user",
            "role_request",
            "role_grant",
            "session",
            "material",
            "material_version",
        }:
            raise DomainError("INVALID_IDEMPOTENCY_RESULT")
        record.result_type = result.resource_type
        record.result_id = uuid.UUID(str(result.resource_id))
        record.status = "completed"
        record.completed_at = timezone.now()
        record.save()
        return result
