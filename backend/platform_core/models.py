import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


class AuditEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    occurred_at = models.DateTimeField(default=timezone.now)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True)
    system_actor = models.CharField(max_length=32, blank=True)
    action = models.CharField(max_length=64)
    resource_type = models.CharField(max_length=32)
    resource_id = models.UUIDField()
    correlation_id = models.UUIDField(default=uuid.uuid4)
    metadata = models.JSONField(default=dict)

    class Meta:
        indexes = [
            models.Index(
                fields=["resource_type", "resource_id", "occurred_at"],
                name="audit_resource_time_idx",
            )
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(actor__isnull=False, system_actor="")
                | (Q(actor__isnull=True) & ~Q(system_actor="")),
                name="audit_actor_required",
            )
        ]


class OutboxEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=64)
    schema_version = models.PositiveIntegerField(default=1)
    aggregate_id = models.UUIDField()
    dedupe_key = models.CharField(max_length=128, unique=True)
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=timezone.now)
    available_at = models.DateTimeField(default=timezone.now)
    status = models.CharField(max_length=16, default="pending")
    attempts = models.PositiveIntegerField(default=0)
    last_error_code = models.CharField(max_length=64, blank=True)

    class Meta:
        indexes = [models.Index(fields=["status", "available_at"], name="outbox_dispatch_idx")]
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=["pending", "processing", "sent", "failed"]),
                name="outbox_status_valid",
            )
        ]


class IdempotencyRecord(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    scope = models.CharField(max_length=128)
    operation = models.CharField(max_length=64)
    key_digest = models.CharField(max_length=64)
    request_digest = models.CharField(max_length=64)
    status = models.CharField(max_length=16, default="processing")
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(db_index=True)
    completed_at = models.DateTimeField(null=True)
    result_type = models.CharField(max_length=32, blank=True)
    result_id = models.UUIDField(null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["scope", "operation", "key_digest"], name="idempotency_scope_key_unique"
            ),
            models.CheckConstraint(
                condition=~Q(scope="") & ~Q(operation=""), name="idempotency_scope_required"
            ),
            models.CheckConstraint(
                condition=Q(
                    status="processing",
                    completed_at__isnull=True,
                    result_id__isnull=True,
                    result_type="",
                )
                | (
                    Q(status="completed", completed_at__isnull=False, result_id__isnull=False)
                    & ~Q(result_type="")
                ),
                name="idempotency_result_complete",
            ),
            models.CheckConstraint(
                condition=Q(expires_at__gt=models.F("created_at")), name="idempotency_expiry_valid"
            ),
        ]
