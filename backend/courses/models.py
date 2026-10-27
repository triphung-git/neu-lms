import uuid

from django.conf import settings
from django.db import models
from django.db.models.functions import Lower


class Course(models.Model):
    class Status(models.TextChoices):
        OPEN = "open", "Đang mở"
        ARCHIVED = "archived", "Đã lưu trữ"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    code = models.CharField(max_length=40, unique=True)
    name = models.CharField(max_length=200)
    term = models.CharField(max_length=80)
    description = models.TextField(blank=True)

    teacher = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="owned_courses",
    )

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.OPEN,
    )
    enrollment_open = models.BooleanField(default=False)
    archived_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "id"]

        constraints = [
            models.UniqueConstraint(
                Lower("code"),
                name="courses_code_case_insensitive_unique",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(status="open", archived_at__isnull=True)
                    | models.Q(status="archived", archived_at__isnull=False)
                ),
                name="courses_archive_timestamp_consistent",
            ),
        ]


class Membership(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Đang tham gia"
        WITHDRAWN = "withdrawn", "Đã rút"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    course = models.ForeignKey(
        Course,
        on_delete=models.PROTECT,
        related_name="memberships",
    )

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="course_memberships",
    )

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.ACTIVE,
    )

    added_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["course", "student"],
                name="courses_membership_unique",
            ),
        ]


class EnrollmentRequest(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Đang chờ duyệt"
        APPROVED = "approved", "Đã duyệt"
        REJECTED = "rejected", "Đã từ chối"
        CANCELLED = "cancelled", "Đã hủy"

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )

    course = models.ForeignKey(
        Course,
        on_delete=models.PROTECT,
        related_name="enrollment_requests",
    )

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="course_enrollment_requests",
    )

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
    )

    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="reviewed_enrollment_requests",
    )

    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "id"]
        indexes = [
            models.Index(fields=["course", "status", "created_at"]),
            models.Index(fields=["student", "status", "created_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["course", "student"],
                condition=models.Q(status="pending"),
                name="courses_enrollment_request_single_pending",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(status="pending", reviewed_at__isnull=True, reviewed_by__isnull=True)
                    | models.Q(
                        status="cancelled",
                        reviewed_at__isnull=True,
                        reviewed_by__isnull=True,
                    )
                    | models.Q(
                        status__in=["approved", "rejected"],
                        reviewed_at__isnull=False,
                        reviewed_by__isnull=False,
                    )
                ),
                name="courses_enrollment_request_review_consistent",
            ),
        ]


class Chapter(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    course = models.ForeignKey(
        Course,
        on_delete=models.PROTECT,
        related_name="chapters",
    )
    title = models.CharField(max_length=200)
    position = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]
        indexes = [models.Index(fields=["course", "position"])]


class Lesson(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    chapter = models.ForeignKey(
        Chapter,
        on_delete=models.PROTECT,
        related_name="lessons",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    position = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]
        indexes = [models.Index(fields=["chapter", "position"])]
