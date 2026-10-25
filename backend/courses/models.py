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

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "id"]

        constraints = [
            models.UniqueConstraint(
                Lower("code"),
                name="courses_code_case_insensitive_unique",
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
        on_delete=models.CASCADE,
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

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["course", "student"],
                name="courses_membership_unique",
            ),
        ]