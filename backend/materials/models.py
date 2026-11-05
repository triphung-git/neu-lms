import hashlib
import uuid

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q

from files.models import FileStatus

from .statuses import ExtractionStatus


class MaterialType(models.TextChoices):
    DOCUMENT = "document", "Tài liệu"
    SLIDE = "slide", "Bài giảng/Slide"
    SYLLABUS = "syllabus", "Đề cương"
    REFERENCE = "reference", "Tài liệu tham khảo"
    EXERCISE = "exercise", "Bài tập rèn luyện"
    OTHER = "other", "Khác"


class MaterialVisibility(models.TextChoices):
    DRAFT = "draft", "Bản nháp"
    PUBLISHED = "published", "Đã công bố"
    HIDDEN = "hidden", "Ẩn"


class MaterialVersionStatus(models.TextChoices):
    DRAFT = "draft", "Đang soạn thảo"
    FINALIZED = "finalized", "Đã đóng băng"
    ARCHIVED = "archived", "Đã lưu trữ"


class ProcessingStatus(models.TextChoices):
    PENDING = "pending", "Chờ xử lý"
    PROCESSING = "processing", "Đang xử lý"
    READY = "ready", "Sẵn sàng"
    FAILED = "failed", "Thất bại"
    NO_TEXT = "no_text", "Không có văn bản"
    UNSUPPORTED = "unsupported", "Không hỗ trợ"


class Material(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    course = models.ForeignKey(
        "courses.Course",
        on_delete=models.PROTECT,
        related_name="materials",
    )
    chapter = models.ForeignKey(
        "courses.Chapter",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="materials",
    )
    lesson = models.ForeignKey(
        "courses.Lesson",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="materials",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    tags = models.JSONField(default=list, blank=True)
    material_type = models.CharField(
        max_length=32,
        choices=MaterialType.choices,
        default=MaterialType.DOCUMENT,
    )
    published_version = models.ForeignKey(
        "MaterialVersion",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="published_for_materials",
        help_text="Trỏ tới phiên bản học liệu đang được công bố hợp lệ",
    )
    is_hidden = models.BooleanField(
        default=False,
        help_text="Khi bật, ẩn học liệu khỏi danh sách hiển thị của sinh viên",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_materials",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="updated_materials",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    search_vector = SearchVectorField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "id"]
        indexes = [
            models.Index(fields=["course", "created_at"], name="materials_course_created_idx"),
            models.Index(fields=["course", "is_hidden"], name="materials_course_hidden_idx"),
            models.Index(fields=["course", "material_type"], name="materials_course_type_idx"),
            models.Index(fields=["chapter"], name="materials_chapter_idx"),
            models.Index(fields=["lesson"], name="materials_lesson_idx"),
            GinIndex(fields=["search_vector"], name="materials_mat_search_vec_gin"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(material_type__in=MaterialType.values),
                name="material_type_valid",
            ),
        ]

    def clean(self):
        super().clean()
        if self.chapter_id and self.chapter.course_id != self.course_id:
            raise ValidationError({"chapter": "Chương học phải thuộc cùng môn học với học liệu."})
        if self.lesson_id:
            if self.lesson.chapter.course_id != self.course_id:
                raise ValidationError({"lesson": "Bài học phải thuộc cùng môn học với học liệu."})
            if self.chapter_id and self.lesson.chapter_id != self.chapter_id:
                raise ValidationError({"lesson": "Bài học phải thuộc chương học đã chọn."})
        if self.published_version_id:
            if self.published_version.material_id != self.id:
                raise ValidationError(
                    {"published_version": "Phiên bản công bố phải thuộc về chính học liệu này."}
                )
            if self.published_version.lifecycle_status not in [
                MaterialVersionStatus.FINALIZED,
                MaterialVersionStatus.ARCHIVED,
            ]:
                raise ValidationError(
                    {
                        "published_version": (
                            "Chỉ phiên bản đã đóng băng (finalized) mới được công bố."
                        )
                    }
                )

    def __str__(self):
        return f"{self.title} ({self.course.code})"


class MaterialVersion(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    material = models.ForeignKey(
        Material,
        on_delete=models.CASCADE,
        related_name="versions",
    )
    version_number = models.PositiveIntegerField()
    title = models.CharField(max_length=200, blank=True)
    description = models.TextField(blank=True)
    changelog = models.TextField(
        blank=True,
        help_text="Ghi chú thay đổi nội dung ở phiên bản này",
    )
    lifecycle_status = models.CharField(
        max_length=32,
        choices=MaterialVersionStatus.choices,
        default=MaterialVersionStatus.DRAFT,
    )
    processing_status = models.CharField(
        max_length=32,
        choices=ProcessingStatus.choices,
        default=ProcessingStatus.PENDING,
    )
    is_published = models.BooleanField(
        default=False,
        help_text="Đánh dấu phiên bản này đã từng hoặc đang được công bố",
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    manifest_hash = models.CharField(
        max_length=64,
        blank=True,
        help_text="SHA-256 hash của manifest đóng băng",
    )
    total_size_bytes = models.BigIntegerField(
        default=0,
        help_text="Tổng kích thước bytes của tất cả tệp trong manifest",
    )
    file_count = models.PositiveIntegerField(
        default=0,
        help_text="Số lượng tệp trong manifest",
    )
    policy_snapshot = models.JSONField(
        default=dict,
        blank=True,
        help_text="Snapshot của CourseFilePolicy áp dụng tại thời điểm đóng băng",
    )
    summary = models.TextField(
        blank=True,
        help_text="Tóm tắt nội dung đã được xác nhận của phiên bản học liệu",
    )
    summary_confirmed_at = models.DateTimeField(null=True, blank=True)
    extraction_attempts = models.PositiveIntegerField(default=0)
    extraction_started_at = models.DateTimeField(null=True, blank=True)
    extraction_dispatched_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_material_versions",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-version_number", "id"]
        indexes = [
            models.Index(fields=["material", "version_number"], name="materials_ver_mat_num_idx"),
            models.Index(
                fields=["material", "lifecycle_status"], name="materials_ver_mat_status_idx"
            ),
            models.Index(fields=["manifest_hash"], name="materials_ver_mf_hash_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["material", "version_number"],
                name="materials_version_unique_number",
            ),
            models.CheckConstraint(
                condition=Q(version_number__gt=0),
                name="materials_version_number_positive",
            ),
            models.CheckConstraint(
                condition=Q(lifecycle_status__in=MaterialVersionStatus.values),
                name="materials_version_lifecycle_valid",
            ),
            models.CheckConstraint(
                condition=Q(processing_status__in=ProcessingStatus.values),
                name="materials_version_processing_valid",
            ),
            models.CheckConstraint(
                condition=Q(total_size_bytes__gte=0),
                name="materials_version_size_non_negative",
            ),
            models.CheckConstraint(
                condition=(
                    Q(lifecycle_status="draft", finalized_at__isnull=True)
                    | Q(
                        lifecycle_status__in=["finalized", "archived"],
                        finalized_at__isnull=False,
                    )
                ),
                name="materials_version_finalized_timestamp_consistent",
            ),
        ]

    def compute_manifest_hash(self) -> str:
        """
        Tính toán chuỗi băm xác định SHA-256 từ danh sách các tệp đã liên kết,
        sắp xếp theo position tăng dần.
        """
        mfiles = self.material_files.select_related("file").order_by("position", "id")
        hasher = hashlib.sha256()
        for mf in mfiles:
            file_hash = mf.sha256_hash or mf.file.sha256_hash
            file_size = mf.file_size or mf.file.file_size
            line = f"{mf.position}:{mf.file_id}:{file_hash}:{file_size}\n"
            hasher.update(line.encode("utf-8"))
        return hasher.hexdigest()

    def clean(self):
        super().clean()
        if self.lifecycle_status == MaterialVersionStatus.DRAFT and self.finalized_at:
            raise ValidationError(
                {"finalized_at": "Bản nháp không được có thời điểm đóng băng (finalized_at)."}
            )
        if self.lifecycle_status in [
            MaterialVersionStatus.FINALIZED,
            MaterialVersionStatus.ARCHIVED,
        ]:
            if not self.finalized_at:
                raise ValidationError(
                    {"finalized_at": "Phiên bản đã đóng băng bắt buộc phải có finalized_at."}
                )

    def __str__(self):
        return f"{self.material.title} v{self.version_number} ({self.lifecycle_status})"


class MaterialFile(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    material_version = models.ForeignKey(
        MaterialVersion,
        on_delete=models.CASCADE,
        related_name="material_files",
    )
    file = models.ForeignKey(
        "files.StoredFile",
        on_delete=models.PROTECT,
        related_name="material_links",
    )
    position = models.PositiveIntegerField(
        default=1,
        help_text="Thứ tự hiển thị tệp trong manifest của phiên bản (1, 2, ...)",
    )
    label = models.CharField(
        max_length=255,
        blank=True,
        help_text="Nhãn hoặc tiêu đề tùy chọn cho tệp trong manifest",
    )
    file_name = models.CharField(max_length=255, blank=True)
    file_size = models.BigIntegerField(default=0)
    mime_type = models.CharField(max_length=127, blank=True)
    sha256_hash = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]
        indexes = [
            models.Index(
                fields=["material_version", "position"], name="materials_file_ver_pos_idx"
            ),
            models.Index(fields=["file"], name="materials_file_stored_file_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["material_version", "file"],
                name="materials_file_unique_version_file",
            ),
            models.UniqueConstraint(
                fields=["material_version", "position"],
                name="materials_file_unique_version_position",
            ),
            models.CheckConstraint(
                condition=Q(position__gt=0),
                name="materials_file_position_positive",
            ),
            models.CheckConstraint(
                condition=Q(file_size__gte=0),
                name="materials_file_size_non_negative",
            ),
        ]

    def clean(self):
        super().clean()
        if hasattr(self, "material_version") and hasattr(self, "file"):
            # Check course consistency
            if self.material_version.material.course_id != self.file.course_id:
                raise ValidationError({"file": "Tệp tin phải thuộc cùng môn học với học liệu."})
            # Check file clean status
            if self.file.status != FileStatus.CLEAN:
                raise ValidationError(
                    {"file": "Chỉ tệp tin đã quét an toàn (clean) mới được gắn vào học liệu."}
                )
            # Check version is draft
            if (
                MaterialVersion.objects.get(pk=self.material_version_id).lifecycle_status
                != MaterialVersionStatus.DRAFT
            ):
                raise ValidationError(
                    {"material_version": "Không thể sửa đổi tệp trong phiên bản đã đóng băng."}
                )

    def save(self, *args, **kwargs):
        # Freeze metadata snapshot from StoredFile upon save
        if self.file_id:
            if not self.file_name:
                self.file_name = self.file.file_name
            if not self.file_size:
                self.file_size = self.file.file_size
            if not self.mime_type:
                self.mime_type = self.file.mime_type
            if not self.sha256_hash:
                self.sha256_hash = self.file.sha256_hash
        # Enforce frozen manifest on save
        if (
            MaterialVersion.objects.get(pk=self.material_version_id).lifecycle_status
            != MaterialVersionStatus.DRAFT
        ):
            raise ValidationError(
                "Manifest của phiên bản học liệu đã đóng băng, không được thêm hoặc sửa tệp."
            )
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        # Enforce frozen manifest on delete
        if (
            MaterialVersion.objects.get(pk=self.material_version_id).lifecycle_status
            != MaterialVersionStatus.DRAFT
        ):
            raise ValidationError(
                "Manifest của phiên bản học liệu đã đóng băng, không được xóa tệp."
            )
        return super().delete(*args, **kwargs)

    def __str__(self):
        return f"{self.material_version} - #{self.position} {self.file_name}"


class MaterialFileExtraction(models.Model):
    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    material_version = models.ForeignKey(
        MaterialVersion,
        on_delete=models.CASCADE,
        related_name="extractions",
    )
    material_file = models.ForeignKey(
        MaterialFile,
        on_delete=models.CASCADE,
        related_name="extractions",
    )
    stored_file = models.ForeignKey(
        "files.StoredFile",
        on_delete=models.PROTECT,
        related_name="material_extractions",
    )
    status = models.CharField(
        max_length=32,
        choices=ExtractionStatus.choices,
        default=ExtractionStatus.PENDING,
    )
    file_hash = models.CharField(max_length=64, blank=True)
    extracted_text = models.TextField(blank=True)
    page_count = models.PositiveIntegerField(default=0)
    metadata = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    search_vector = SearchVectorField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "id"]
        indexes = [
            models.Index(
                fields=["material_version", "status"], name="materials_ext_ver_status_idx"
            ),
            models.Index(fields=["stored_file", "file_hash"], name="materials_ext_file_hash_idx"),
            GinIndex(fields=["search_vector"], name="materials_ext_search_vec_gin"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["material_version", "material_file"],
                name="materials_extraction_unique_file",
            ),
            models.CheckConstraint(
                condition=Q(status__in=ExtractionStatus.values),
                name="materials_ext_status_valid",
            ),
        ]

    def __str__(self):
        return f"Extraction {self.stored_file_id} ({self.status})"
