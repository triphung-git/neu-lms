import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import Q
from django.utils import timezone

from files.constants import SYSTEM_MAX_FILE_SIZE_BYTES

from .constants import (
    DEFAULT_ASSIGNMENT_ALLOWED_EXTENSIONS,
    DEFAULT_MAX_FILE_SIZE_BYTES,
    DEFAULT_MAX_FILES_PER_SUBMISSION,
    MAX_FILES_PER_SUBMISSION,
    MIN_FILES_PER_SUBMISSION,
)
from .exceptions import AssignmentImmutableError


class AssignmentStatus(models.TextChoices):
    DRAFT = "draft", "Bản nháp"
    PUBLISHED = "published", "Đã công bố"
    CLOSED = "closed", "Đã đóng nhận bài"
    ARCHIVED = "archived", "Đã lưu trữ"


def default_allowed_extensions() -> list[str]:
    return list(DEFAULT_ASSIGNMENT_ALLOWED_EXTENSIONS)


class Assignment(models.Model):
    """Mô hình cốt lõi quản lý thông tin bài tập môn học."""

    Status = AssignmentStatus

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    course = models.ForeignKey(
        "courses.Course",
        on_delete=models.PROTECT,
        related_name="assignments",
        help_text="Môn học sở hữu bài tập (chặn xóa nếu còn bài tập)",
    )
    chapter = models.ForeignKey(
        "courses.Chapter",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assignments",
        help_text="Chương học chứa bài tập (xóa chương sẽ gán NULL)",
    )

    lesson = models.ForeignKey(
        "courses.Lesson",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="assignments",
        help_text="Bài học gắn với bài tập (xóa bài học sẽ gán NULL)",
    )

    title = models.CharField(max_length=200, help_text="Tiêu đề bài tập")
    instructions = models.TextField(blank=True, help_text="Nội dung yêu cầu, chỉ dẫn làm bài")

    status = models.CharField(
        max_length=16,
        choices=AssignmentStatus.choices,
        default=AssignmentStatus.DRAFT,
        db_index=True,
        help_text="Trạng thái vòng đời: draft -> published -> closed/archived",
    )

    due_at = models.DateTimeField(db_index=True, help_text="Hạn chót nộp bài")
    allow_late = models.BooleanField(
        default=False,
        help_text="Cho phép nộp muộn sau deadline hay không (đánh dấu nộp trễ)",
    )
    manually_closed_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Thời điểm giảng viên chủ động đóng thu nhận bài sớm",
    )

    version = models.PositiveIntegerField(
        default=1,
        help_text="Phiên bản tương tranh lạc quan (OCC)",
    )

    ai_grading_opt_in = models.BooleanField(
        default=False,
        help_text="Tùy chọn bật hỗ trợ chấm bài bằng AI (B24, mặc định tắt)",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_assignments",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="updated_assignments",
    )
    published_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "id"]
        indexes = [
            models.Index(
                fields=["course", "status", "due_at"],
                name="asg_crs_status_due_idx",
            ),
            models.Index(
                fields=["course", "created_at"],
                name="asg_crs_created_idx",
            ),
            models.Index(fields=["chapter"], name="asg_chapter_idx"),
            models.Index(fields=["lesson"], name="asg_lesson_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(status__in=AssignmentStatus.values),
                name="assignment_status_valid",
            ),
            models.CheckConstraint(
                condition=(
                    Q(status=AssignmentStatus.DRAFT, published_at__isnull=True)
                    | Q(
                        status__in=[
                            AssignmentStatus.PUBLISHED,
                            AssignmentStatus.CLOSED,
                            AssignmentStatus.ARCHIVED,
                        ]
                    )
                ),
                name="assignment_draft_published_at_consistent",
            ),
        ]

    def __str__(self) -> str:
        return f"[{self.course.code}] {self.title} ({self.get_status_display()})"

    @property
    def total_score(self) -> Decimal:
        """Tổng điểm tính theo các tiêu chí rubric (hoặc 10.00 nếu chưa có rubric)."""
        criteria = self.rubric_criteria.all()

        if not criteria:
            return Decimal("10.00")
        return sum((c.max_score for c in criteria), Decimal("0.00"))

    def is_submission_window_open(self, current_time=None) -> bool:
        """Kiểm tra cửa sổ nhận bài có đang mở tại thời điểm kiểm tra hay không.

        Phân biệt giữa 'đã công bố' (published) với 'cửa sổ nhận bài còn mở'.
        """
        if self.status not in [AssignmentStatus.PUBLISHED]:
            return False

        if self.manually_closed_at is not None:
            return False

        now = current_time or timezone.now()
        if now <= self.due_at:
            return True

        return self.allow_late

    def clean(self):
        super().clean()

        # 1. Kiểm tra cross-course references
        if self.chapter_id and self.chapter.course_id != self.course_id:
            raise ValidationError({"chapter": "Chương học phải thuộc cùng môn học với bài tập."})

        if self.lesson_id:
            if self.lesson.chapter.course_id != self.course_id:
                raise ValidationError({"lesson": "Bài học phải thuộc cùng môn học với bài tập."})
            if self.chapter_id and self.lesson.chapter_id != self.chapter_id:
                raise ValidationError({"lesson": "Bài học phải thuộc chương học đã chọn."})

        # 2. Kiểm tra bất biến khi đã công bố (Published Immutability)
        if self.pk:
            orig = (
                Assignment.objects.filter(pk=self.pk)
                .values("status", "title", "instructions")
                .first()
            )
            if orig and orig["status"] in [
                AssignmentStatus.PUBLISHED,
                AssignmentStatus.CLOSED,
                AssignmentStatus.ARCHIVED,
            ]:
                if self.status == AssignmentStatus.DRAFT or self.published_at is None:
                    raise AssignmentImmutableError("Publication cannot be reverted to a draft.")
                if self.title != orig["title"]:
                    raise AssignmentImmutableError(
                        "Không được phép sửa tiêu đề bài tập sau khi bài tập đã công bố."
                    )
                if self.instructions != orig["instructions"]:
                    raise AssignmentImmutableError(
                        "Không được phép sửa nội dung yêu cầu bài tập sau khi bài tập đã công bố."
                    )

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class AssignmentRubricCriterion(models.Model):
    """Tiêu chí đánh giá theo rubric của bài tập."""

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    assignment = models.ForeignKey(
        Assignment,
        on_delete=models.CASCADE,
        related_name="rubric_criteria",
    )
    title = models.CharField(max_length=200, help_text="Tên tiêu chí đánh giá")
    description = models.TextField(blank=True, help_text="Mô tả mức độ đạt và hướng dẫn chấm")
    max_score = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=Decimal("10.00"),
        help_text="Điểm tối đa của tiêu chí (phải > 0)",
    )
    position = models.PositiveIntegerField(
        default=1,
        help_text="Thứ tự hiển thị tiêu chí",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "id"]
        indexes = [
            models.Index(fields=["assignment", "position"], name="rubric_asg_pos_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=Q(max_score__gt=Decimal("0.00")),
                name="rubric_criterion_max_score_positive",
            ),
            models.UniqueConstraint(
                fields=["assignment", "position"],
                name="rubric_criterion_unique_position",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.position}. {self.title} ({self.max_score}đ)"

    def clean(self):
        super().clean()
        if self.max_score is not None and self.max_score <= Decimal("0.00"):
            raise ValidationError({"max_score": "Điểm tối đa của tiêu chí phải lớn hơn 0."})

        # Kiểm tra bất biến: không thêm/sửa rubric khi bài tập đã công bố
        if self.assignment_id:
            asg_status = (
                Assignment.objects.filter(pk=self.assignment_id)
                .values_list("status", flat=True)
                .first()
            )
            if asg_status in [
                AssignmentStatus.PUBLISHED,
                AssignmentStatus.CLOSED,
                AssignmentStatus.ARCHIVED,
            ]:
                raise AssignmentImmutableError(
                    "Không được phép thêm hoặc sửa tiêu chí rubric sau khi bài tập đã công bố."
                )

    def delete(self, *args, **kwargs):
        # Kiểm tra bất biến khi xóa rubric
        if self.assignment_id:
            asg_status = (
                Assignment.objects.filter(pk=self.assignment_id)
                .values_list("status", flat=True)
                .first()
            )
            if asg_status in [
                AssignmentStatus.PUBLISHED,
                AssignmentStatus.CLOSED,
                AssignmentStatus.ARCHIVED,
            ]:
                raise AssignmentImmutableError(
                    "Không được phép xóa tiêu chí rubric sau khi bài tập đã công bố."
                )
        return super().delete(*args, **kwargs)

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class AssignmentFilePolicy(models.Model):
    """Cấu hình chính sách tệp nộp bài cho sinh viên của bài tập."""

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    assignment = models.OneToOneField(
        Assignment,
        on_delete=models.CASCADE,
        related_name="file_policy",
    )
    max_files_per_submission = models.PositiveIntegerField(
        default=DEFAULT_MAX_FILES_PER_SUBMISSION,
        help_text="Số lượng tệp tối đa trong một lần nộp (1 đến 10)",
    )
    max_file_size_bytes = models.BigIntegerField(
        default=DEFAULT_MAX_FILE_SIZE_BYTES,
        help_text="Dung lượng tối đa mỗi tệp (bytes)",
    )
    allowed_extensions = models.JSONField(
        default=default_allowed_extensions,
        blank=True,
        help_text="Danh sách phần mở rộng hợp lệ (chữ thường, không chứa dấu chấm)",
    )
    version = models.PositiveIntegerField(
        default=1,
        help_text="Phiên bản chính sách tệp cho lần nộp tương lai",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["assignment_id"]
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(max_files_per_submission__gte=MIN_FILES_PER_SUBMISSION)
                    & Q(max_files_per_submission__lte=MAX_FILES_PER_SUBMISSION)
                ),
                name="assignment_file_policy_max_files_range",
            ),
            models.CheckConstraint(
                condition=Q(max_file_size_bytes__gt=0),
                name="assignment_file_policy_max_size_positive",
            ),
        ]

    def clean(self):
        super().clean()
        if not (
            MIN_FILES_PER_SUBMISSION <= self.max_files_per_submission <= MAX_FILES_PER_SUBMISSION
        ):
            raise ValidationError(
                {
                    "max_files_per_submission": (
                        f"Số lượng tệp tối đa phải nằm trong khoảng "
                        f"{MIN_FILES_PER_SUBMISSION} đến {MAX_FILES_PER_SUBMISSION}."
                    )
                }
            )

        if self.max_file_size_bytes <= 0:
            raise ValidationError({"max_file_size_bytes": "Kích thước tệp tối đa phải lớn hơn 0."})
        if self.max_file_size_bytes > SYSTEM_MAX_FILE_SIZE_BYTES:
            raise ValidationError({"max_file_size_bytes": "Vượt giới hạn dung lượng của hệ thống."})

        if not isinstance(self.allowed_extensions, list):
            raise ValidationError(
                {"allowed_extensions": "Danh sách phần mở rộng phải là một danh sách chuỗi."}
            )

        cleaned = []
        for ext in self.allowed_extensions:
            if not isinstance(ext, str):
                raise ValidationError({"allowed_extensions": "Phần mở rộng phải là chuỗi ký tự."})
            item = ext.strip().lower().lstrip(".")
            if item and item not in cleaned:
                cleaned.append(item)
        self.allowed_extensions = cleaned
        if not cleaned or any(not item.isalnum() for item in cleaned):
            raise ValidationError({"allowed_extensions": "Cần ít nhất một phần mở rộng hợp lệ."})

    def save(self, *args, **kwargs):
        self.full_clean()
        configuration = {
            "max_files_per_submission": self.max_files_per_submission,
            "max_file_size_bytes": self.max_file_size_bytes,
            "allowed_extensions": self.allowed_extensions,
        }
        with transaction.atomic():
            previous = AssignmentFilePolicyRevision.objects.filter(
                assignment_id=self.assignment_id, version=self.version
            ).first()
            if previous and previous.configuration != configuration:
                latest = (
                    AssignmentFilePolicyRevision.objects.filter(assignment_id=self.assignment_id)
                    .order_by("-version")
                    .first()
                )
                self.version = latest.version + 1
                if kwargs.get("update_fields") is not None:
                    kwargs["update_fields"] = set(kwargs["update_fields"]) | {"version"}
            super().save(*args, **kwargs)
            AssignmentFilePolicyRevision.objects.get_or_create(
                assignment_id=self.assignment_id,
                version=self.version,
                defaults={"configuration": configuration},
            )


class AssignmentFilePolicyRevision(models.Model):
    assignment = models.ForeignKey(
        Assignment, on_delete=models.PROTECT, related_name="file_policy_revisions"
    )
    version = models.PositiveIntegerField()
    configuration = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["assignment", "version"], name="asg_policy_revision_unique"
            )
        ]

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            raise AssignmentImmutableError("Không thể sửa phiên bản chính sách đã lưu.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AssignmentImmutableError("Không thể xóa phiên bản chính sách đã lưu.")


class AssignmentAttachment(models.Model):
    """Tệp đính kèm tài liệu đề bài do giảng viên cung cấp."""

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    assignment = models.ForeignKey(
        Assignment,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.ForeignKey(
        "files.StoredFile",
        on_delete=models.PROTECT,
        related_name="assignment_attachments",
    )
    name = models.CharField(max_length=255)
    size_bytes = models.BigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["assignment", "created_at"], name="asg_attach_created_idx"),
        ]

    def clean(self):
        super().clean()
        if self.file_id and self.assignment_id:
            if self.file.course_id != self.assignment.course_id:
                raise ValidationError(
                    {"file": "Tệp đính kèm đề bài phải thuộc cùng môn học với bài tập."}
                )

        # Kiểm tra bất biến: không thay đổi tệp đề sau khi đã công bố
        if self.assignment_id:
            asg_status = (
                Assignment.objects.filter(pk=self.assignment_id)
                .values_list("status", flat=True)
                .first()
            )
            if asg_status in [
                AssignmentStatus.PUBLISHED,
                AssignmentStatus.CLOSED,
                AssignmentStatus.ARCHIVED,
            ]:
                raise AssignmentImmutableError(
                    "Không được phép thêm hoặc thay đổi tệp đính kèm đề bài sau khi đã công bố."
                )

    def delete(self, *args, **kwargs):
        if self.assignment_id:
            asg_status = (
                Assignment.objects.filter(pk=self.assignment_id)
                .values_list("status", flat=True)
                .first()
            )
            if asg_status in [
                AssignmentStatus.PUBLISHED,
                AssignmentStatus.CLOSED,
                AssignmentStatus.ARCHIVED,
            ]:
                raise AssignmentImmutableError(
                    "Không được phép xóa tệp đính kèm đề bài sau khi đã công bố."
                )
        return super().delete(*args, **kwargs)

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class AssignmentPublicationSnapshot(models.Model):
    """Bản lưu trữ bất biến (Snapshot) tại thời điểm công bố bài tập.

    Đảm bảo bằng chứng dữ liệu đề bài, rubric và tệp đính kèm ban đầu
    không bao giờ bị thay đổi hoặc giả mạo.
    """

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    assignment = models.ForeignKey(
        Assignment,
        on_delete=models.CASCADE,
        related_name="publication_snapshots",
    )
    snapshot_version = models.PositiveIntegerField(
        help_text="Phiên bản công bố của bài tập tại thời điểm snapshot",
    )
    snapshot_title = models.CharField(max_length=200)
    snapshot_instructions = models.TextField(blank=True)
    snapshot_rubric = models.JSONField(
        default=list,
        help_text="Danh sách tiêu chí rubric nguyên vẹn tại thời điểm công bố",
    )
    snapshot_file_policy = models.JSONField(
        default=dict,
        help_text="Chính sách tệp tại thời điểm công bố ban đầu",
    )
    snapshot_attachments = models.JSONField(
        default=list,
        help_text="Danh sách tệp đính kèm tại thời điểm công bố ban đầu",
    )

    published_at = models.DateTimeField()
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="assignment_snapshots_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-snapshot_version", "-created_at"]
        indexes = [
            models.Index(fields=["assignment", "snapshot_version"], name="asg_snap_ver_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["assignment", "snapshot_version"],
                name="asg_snapshot_unique_version",
            ),
        ]

    def __str__(self) -> str:
        return f"Snapshot v{self.snapshot_version} for {self.assignment_id} ({self.snapshot_title})"

    def save(self, *args, **kwargs):
        if type(self).objects.filter(pk=self.pk).exists():
            raise AssignmentImmutableError("Không thể thay đổi bản công bố đã lưu.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AssignmentImmutableError("Không thể xóa bản công bố đã lưu.")


class ReopenWindowTarget(models.TextChoices):
    ALL = "all", "Toàn bộ lớp"
    STUDENT = "student", "Sinh viên cụ thể"


class ReopenWindowScope(models.TextChoices):
    ALL_ACTIONS = "all_actions", "Cho phép nộp mới và nộp lại"
    FIRST_ONLY = "first_only", "Chỉ cho phép nộp lần đầu"


class AssignmentReopenWindow(models.Model):
    """Cửa sổ mở lại / ngoại lệ nộp bài do giảng viên chủ động cấp quyền."""

    Target = ReopenWindowTarget
    Scope = ReopenWindowScope

    id = models.UUIDField(
        primary_key=True,
        default=uuid.uuid4,
        editable=False,
    )
    assignment = models.ForeignKey(
        Assignment,
        on_delete=models.CASCADE,
        related_name="reopen_windows",
        help_text="Bài tập được áp dụng cửa sổ mở lại",
    )
    target_type = models.CharField(
        max_length=16,
        choices=ReopenWindowTarget.choices,
        default=ReopenWindowTarget.ALL,
        help_text="Đối tượng áp dụng: all (toàn bộ lớp) hoặc student (sinh viên cụ thể)",
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="assignment_reopen_windows",
        help_text="Sinh viên cụ thể nếu target_type='student'",
    )
    start_at = models.DateTimeField(
        default=timezone.now,
        help_text="Thời điểm bắt đầu hiệu lực của cửa sổ",
    )
    end_at = models.DateTimeField(
        help_text="Thời điểm kết thúc của cửa sổ mở lại",
    )
    scope = models.CharField(
        max_length=20,
        choices=ReopenWindowScope.choices,
        default=ReopenWindowScope.ALL_ACTIONS,
        help_text=("Phạm vi: all_actions (nộp mới và thay thế) hoặc first_only (chỉ lần đầu)"),
    )
    reason = models.TextField(
        blank=True,
        default="",
        help_text="Lý do giảng viên cấp cửa sổ mở lại / ngoại lệ",
    )
    is_active = models.BooleanField(
        default=True,
        help_text="Cờ kích hoạt của cửa sổ mở lại",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["assignment", "is_active", "end_at"], name="asg_reopen_act_end_idx"
            ),
            models.Index(
                fields=["assignment", "student", "is_active"], name="asg_reopen_std_act_idx"
            ),
        ]

    def clean(self):
        super().clean()
        if self.target_type == ReopenWindowTarget.STUDENT and not self.student_id:
            raise ValidationError(
                {"student": "Yêu cầu chọn sinh viên cụ thể khi target_type là student."}
            )
        if self.end_at and self.start_at and self.end_at <= self.start_at:
            raise ValidationError({"end_at": "Thời điểm kết thúc phải sau thời điểm bắt đầu."})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def is_currently_open(self, current_time=None) -> bool:
        if not self.is_active:
            return False
        now = current_time or timezone.now()
        return self.start_at <= now <= self.end_at
