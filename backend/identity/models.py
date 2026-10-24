import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser
from django.db import models
from django.db.models import F, Q
from django.db.models.functions import Lower, Trim
from django.utils import timezone

from .managers import UserManager


class User(AbstractBaseUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(max_length=254, unique=True)
    display_name = models.CharField(max_length=150, blank=True)
    is_active = models.BooleanField(default=True)
    auth_version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []
    objects = UserManager()

    class Meta:
        constraints = [
            models.CheckConstraint(condition=~Q(email=""), name="user_email_not_empty"),
            models.CheckConstraint(
                condition=Q(email=Lower(Trim(F("email")))), name="user_email_canonical"
            ),
            models.CheckConstraint(
                condition=Q(auth_version__gte=1), name="user_auth_version_valid"
            ),
        ]


class VerifiedEmail(models.Model):
    """Verification metadata for the user's sole email, not an additional address."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, primary_key=True
    )
    email_digest = models.CharField(max_length=64, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(Q(verified_at__isnull=True, email_digest=""))
                | (Q(verified_at__isnull=False) & ~Q(email_digest="")),
                name="email_verification_complete",
            ),
        ]


class Role(models.TextChoices):
    STUDENT = "student"
    TEACHER = "teacher"
    ADMIN = "admin"


class RoleRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending"
        APPROVED = "approved"
        REJECTED = "rejected"
        CANCELLED = "cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    role = models.CharField(max_length=16, choices=Role.choices)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    requested_at = models.DateTimeField(default=timezone.now)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="role_reviews"
    )
    reviewed_at = models.DateTimeField(null=True)
    review_reason = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(role__in=["student", "teacher"]), name="request_role_valid"
            ),
            models.CheckConstraint(
                condition=Q(status__in=["pending", "approved", "rejected", "cancelled"]),
                name="request_status_valid",
            ),
            models.UniqueConstraint(
                fields=["user", "role"],
                condition=Q(status="pending"),
                name="one_pending_role_request",
            ),
            models.CheckConstraint(
                condition=Q(status="pending", reviewed_at__isnull=True, reviewed_by__isnull=True)
                | (~Q(status="pending") & Q(reviewed_at__isnull=False, reviewed_by__isnull=False)),
                name="request_review_complete",
            ),
        ]


class RoleGrant(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="role_grants"
    )
    role = models.CharField(max_length=16, choices=Role.choices)
    granted_at = models.DateTimeField(default=timezone.now)
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="issued_grants"
    )
    grant_source = models.CharField(max_length=32)
    source_request = models.OneToOneField(RoleRequest, on_delete=models.PROTECT, null=True)
    revoked_at = models.DateTimeField(null=True)
    revoked_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, related_name="revoked_grants"
    )
    revoke_reason = models.CharField(max_length=64, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=Q(role__in=Role.values), name="grant_role_valid"),
            models.UniqueConstraint(
                fields=["user", "role"],
                condition=Q(revoked_at__isnull=True),
                name="one_active_role_grant",
            ),
            models.CheckConstraint(
                condition=Q(revoked_at__isnull=True, revoked_by__isnull=True)
                | Q(revoked_at__isnull=False, revoked_by__isnull=False),
                name="grant_revocation_complete",
            ),
            models.CheckConstraint(
                condition=Q(
                    role="student",
                    grant_source="verified_student_email",
                    source_request__isnull=False,
                )
                | Q(
                    role="teacher",
                    grant_source="teacher_approval",
                    source_request__isnull=False,
                    granted_by__isnull=False,
                )
                | Q(
                    role="admin",
                    grant_source="internal_administration",
                    source_request__isnull=True,
                ),
                name="grant_source_valid",
            ),
        ]


class UserSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    key_digest = models.CharField(max_length=64, unique=True)
    auth_version_at_issue = models.PositiveIntegerField()
    created_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField()
    idle_expires_at = models.DateTimeField()
    absolute_expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True)
    revoke_reason = models.CharField(max_length=64, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "revoked_at"], name="session_user_revoked_idx")]
        constraints = [
            models.CheckConstraint(
                condition=Q(last_seen_at__gte=F("created_at")), name="session_seen_after_created"
            ),
            models.CheckConstraint(
                condition=Q(idle_expires_at__gt=F("last_seen_at"))
                & Q(idle_expires_at__lte=F("last_seen_at") + timedelta(minutes=30)),
                name="session_idle_max_30m",
            ),
            models.CheckConstraint(
                condition=Q(idle_expires_at__lte=F("absolute_expires_at")),
                name="session_idle_within_absolute",
            ),
            models.CheckConstraint(
                condition=Q(absolute_expires_at__gt=F("created_at"))
                & Q(absolute_expires_at__lte=F("created_at") + timedelta(hours=12)),
                name="session_absolute_max_12h",
            ),
        ]


class PasswordResetToken(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    digest = models.CharField(max_length=64, unique=True)
    auth_version = models.PositiveIntegerField()
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True)


class AuthRateBucket(models.Model):
    key = models.CharField(max_length=64, primary_key=True)
    starts_at = models.DateTimeField(default=timezone.now)
    attempts = models.PositiveIntegerField(default=0)


class PasswordResetDelivery(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending"
        PROCESSING = "processing"
        SENT = "sent"
        FAILED = "failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    token = models.OneToOneField(
        PasswordResetToken, on_delete=models.CASCADE, related_name="delivery"
    )
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    email = models.EmailField(max_length=254)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=3)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    last_error_code = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["status", "created_at"], name="pwd_delivery_status_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=["pending", "processing", "sent", "failed"]),
                name="pwd_delivery_status_valid",
            ),
            models.CheckConstraint(
                condition=Q(attempts__gte=0),
                name="pwd_delivery_attempts_valid",
            ),
            models.CheckConstraint(
                condition=Q(max_attempts__gte=1),
                name="pwd_delivery_max_attempts_valid",
            ),
        ]
