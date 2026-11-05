import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .constants import (
    DEFAULT_ALLOWED_EXTENSIONS,
    DEFAULT_COURSE_QUOTA_BYTES,
    DEFAULT_MAX_FILE_SIZE_BYTES,
    DEFAULT_MAX_FILES_PER_ASSIGNMENT,
    SYSTEM_MAX_COURSE_QUOTA_BYTES,
    SYSTEM_MAX_FILE_SIZE_BYTES,
)


def upload_expiry():
    from datetime import timedelta

    return timezone.now() + timedelta(seconds=900)


def default_allowed_extensions() -> list[str]:
    return list(DEFAULT_ALLOWED_EXTENSIONS)


class CourseFilePolicy(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    course = models.OneToOneField(
        "courses.Course",
        on_delete=models.CASCADE,
        related_name="file_policy",
    )
    allowed_extensions = models.JSONField(
        default=default_allowed_extensions,
        blank=True,
    )
    max_file_size_bytes = models.BigIntegerField(
        default=DEFAULT_MAX_FILE_SIZE_BYTES,
    )
    max_files_per_assignment = models.IntegerField(
        default=DEFAULT_MAX_FILES_PER_ASSIGNMENT,
    )
    course_quota_bytes = models.BigIntegerField(
        default=DEFAULT_COURSE_QUOTA_BYTES,
    )
    used_quota_bytes = models.BigIntegerField(
        default=0,
    )
    reserved_quota_bytes = models.BigIntegerField(
        default=0,
    )
    version = models.PositiveIntegerField(default=1)
    preview_allowed = models.BooleanField(
        default=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["course_id"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(max_file_size_bytes__lte=SYSTEM_MAX_FILE_SIZE_BYTES)
                    & Q(course_quota_bytes__lte=SYSTEM_MAX_COURSE_QUOTA_BYTES)
                ),
                name="file_policy_limits_within_system_ceiling",
            ),
            models.CheckConstraint(
                condition=Q(max_file_size_bytes__gt=0),
                name="file_policy_max_file_size_positive",
            ),
            models.CheckConstraint(
                condition=Q(course_quota_bytes__gt=0),
                name="file_policy_course_quota_positive",
            ),
            models.CheckConstraint(
                condition=Q(used_quota_bytes__gte=0),
                name="file_policy_used_quota_non_negative",
            ),
            models.CheckConstraint(
                condition=Q(reserved_quota_bytes__gte=0),
                name="file_policy_reserved_quota_non_negative",
            ),
            models.CheckConstraint(
                condition=(
                    Q(max_files_per_assignment__gte=1) & Q(max_files_per_assignment__lte=10)
                ),
                name="file_policy_max_files_range",
            ),
        ]

    def clean(self):
        super().clean()
        if self.max_file_size_bytes > SYSTEM_MAX_FILE_SIZE_BYTES:
            raise ValidationError(
                {
                    "max_file_size_bytes": (
                        "Kích thước tối đa không được vượt quá trần hệ thống "
                        f"({SYSTEM_MAX_FILE_SIZE_BYTES} bytes)."
                    )
                }
            )
        if self.course_quota_bytes > SYSTEM_MAX_COURSE_QUOTA_BYTES:
            raise ValidationError(
                {
                    "course_quota_bytes": (
                        "Dung lượng môn học không được vượt quá trần hệ thống "
                        f"({SYSTEM_MAX_COURSE_QUOTA_BYTES} bytes)."
                    )
                }
            )
        if not (1 <= self.max_files_per_assignment <= 10):
            raise ValidationError(
                {"max_files_per_assignment": "Số lượng tệp tối đa phải nằm trong khoảng 1 đến 10."}
            )
        if not isinstance(self.allowed_extensions, list):
            raise ValidationError(
                {"allowed_extensions": "Danh sách phần mở rộng phải là một danh sách."}
            )
        cleaned_extensions = []
        for ext in self.allowed_extensions:
            if not isinstance(ext, str):
                raise ValidationError({"allowed_extensions": "Phần mở rộng phải là chuỗi ký tự."})
            cleaned = ext.strip().lower().lstrip(".")
            if cleaned and cleaned not in cleaned_extensions:
                cleaned_extensions.append(cleaned)
        self.allowed_extensions = cleaned_extensions


class FileStatus(models.TextChoices):
    QUARANTINE_PENDING = "quarantine_pending", "Chờ cách ly"
    SCANNING = "scanning", "Đang quét"
    CLEAN = "clean", "An toàn"
    INFECTED = "infected", "Nhiễm mã độc"
    DELETED = "deleted", "Đã xóa"


class FilePurpose(models.TextChoices):
    COURSE_MATERIAL = "course_material", "Học liệu môn học"
    ASSIGNMENT_ATTACHMENT = "assignment_attachment", "Đính kèm bài tập"
    ASSIGNMENT_SUBMISSION = "assignment_submission", "Bài nộp sinh viên"
    GENERAL = "general", "Tệp chung"


class StoredFile(models.Model):
    Status = FileStatus
    Purpose = FilePurpose

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    course = models.ForeignKey(
        "courses.Course",
        on_delete=models.PROTECT,
        related_name="files",
    )
    uploader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="uploaded_files",
    )
    file_name = models.CharField(max_length=255)
    file_size = models.BigIntegerField()
    mime_type = models.CharField(max_length=127)
    storage_path = models.CharField(max_length=512)
    expires_at = models.DateTimeField(default=upload_expiry, db_index=True)
    policy_snapshot = models.JSONField(default=dict)
    sha256_hash = models.CharField(max_length=64, blank=True)
    status = models.CharField(
        max_length=32,
        choices=FileStatus.choices,
        default=FileStatus.QUARANTINE_PENDING,
    )
    purpose = models.CharField(
        max_length=32,
        choices=FilePurpose.choices,
        default=FilePurpose.COURSE_MATERIAL,
    )
    is_published = models.BooleanField(
        default=False,
        help_text="Chỉ hiển thị cho sinh viên khi tệp clean và đã công bố",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "id"]
        indexes = [
            models.Index(fields=["course", "status"], name="files_stored_course_status_idx"),
            models.Index(fields=["sha256_hash"], name="files_stored_sha256_idx"),
            models.Index(fields=["uploader", "created_at"], name="files_stored_uploader_idx"),
            models.Index(fields=["course", "purpose", "is_published"], name="files_stored_pub_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=FileStatus.values),
                name="stored_file_status_valid",
            ),
            models.CheckConstraint(
                condition=Q(purpose__in=FilePurpose.values),
                name="stored_file_purpose_valid",
            ),
            models.CheckConstraint(
                condition=Q(file_size__gte=0),
                name="stored_file_size_non_negative",
            ),
        ]


class FileScanResult(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    file = models.ForeignKey(
        StoredFile,
        on_delete=models.CASCADE,
        related_name="scan_results",
    )
    scanned_at = models.DateTimeField(default=timezone.now)
    scan_engine = models.CharField(max_length=64)
    is_clean = models.BooleanField()
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-scanned_at", "id"]
        indexes = [
            models.Index(fields=["file", "scanned_at"], name="files_scan_file_scanned_idx"),
        ]
