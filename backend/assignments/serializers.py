from decimal import Decimal

from rest_framework import serializers

from files.constants import SYSTEM_MAX_FILE_SIZE_BYTES
from files.models import CourseFilePolicy

from .models import (
    Assignment,
    AssignmentAttachment,
    AssignmentFilePolicy,
    AssignmentReopenWindow,
    AssignmentRubricCriterion,
    ReopenWindowScope,
    ReopenWindowTarget,
)


class AssignmentRubricCriterionSerializer(serializers.ModelSerializer):
    """Serializer cho tiêu chí đánh giá rubric của bài tập."""

    class Meta:
        model = AssignmentRubricCriterion
        fields = [
            "id",
            "title",
            "description",
            "max_score",
            "position",
        ]
        read_only_fields = ["id"]


class AssignmentFilePolicySerializer(serializers.ModelSerializer):
    """Serializer cho chính sách tệp đính kèm khi nộp bài."""

    class Meta:
        model = AssignmentFilePolicy
        fields = [
            "id",
            "max_files_per_submission",
            "max_file_size_bytes",
            "allowed_extensions",
            "version",
        ]
        read_only_fields = ["id", "version"]


class AssignmentAttachmentSerializer(serializers.ModelSerializer):
    """Serializer cho tệp đính kèm tài liệu đề bài của giảng viên."""

    download_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()
    mime_type = serializers.CharField(source="file.mime_type", read_only=True)
    sha256_hash = serializers.CharField(source="file.sha256_hash", read_only=True)

    class Meta:
        model = AssignmentAttachment
        fields = [
            "id",
            "file_id",
            "name",
            "size_bytes",
            "mime_type",
            "sha256_hash",
            "download_url",
            "preview_url",
            "created_at",
        ]
        read_only_fields = [
            "id",
            "download_url",
            "preview_url",
            "mime_type",
            "sha256_hash",
            "created_at",
        ]

    def get_download_url(self, obj: AssignmentAttachment) -> str:
        course_id = obj.assignment.course_id
        return (
            f"/api/v1/courses/{course_id}/assignments/"
            f"{obj.assignment_id}/attachments/{obj.file_id}/download"
        )

    def get_preview_url(self, obj: AssignmentAttachment) -> str | None:
        policy = CourseFilePolicy.objects.filter(course_id=obj.assignment.course_id).first()
        if (policy and not policy.preview_allowed) or obj.name.rsplit(".", 1)[-1].lower() not in {
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
        }:
            return None
        course_id = obj.assignment.course_id
        return (
            f"/api/v1/courses/{course_id}/assignments/"
            f"{obj.assignment_id}/attachments/{obj.file_id}/preview"
        )


class AssignmentSummaryItemSerializer(serializers.ModelSerializer):
    """Serializer tóm tắt bài tập hiển thị trong danh sách môn học của giảng viên."""

    total_score = serializers.SerializerMethodField()
    rubric_count = serializers.SerializerMethodField()
    attachment_count = serializers.SerializerMethodField()
    submission_count = serializers.IntegerField(default=0, read_only=True)
    graded_count = serializers.IntegerField(default=0, read_only=True)

    class Meta:
        model = Assignment
        fields = [
            "id",
            "course_id",
            "chapter_id",
            "lesson_id",
            "title",
            "status",
            "due_at",
            "allow_late",
            "manually_closed_at",
            "total_score",
            "rubric_count",
            "attachment_count",
            "submission_count",
            "graded_count",
            "ai_grading_opt_in",
            "published_at",
            "created_at",
            "updated_at",
            "version",
        ]
        read_only_fields = fields

    def get_total_score(self, obj: Assignment) -> float:
        criteria = obj.rubric_criteria.all()
        if not criteria:
            return 10.0
        return float(sum(c.max_score for c in criteria))

    def get_rubric_count(self, obj: Assignment) -> int:
        return obj.rubric_criteria.count()

    def get_attachment_count(self, obj: Assignment) -> int:
        return obj.attachments.count()


class AssignmentDetailSerializer(serializers.ModelSerializer):
    """Serializer đầy đủ thông tin bài tập phục vụ xem chi tiết và biên soạn."""

    rubric_criteria = AssignmentRubricCriterionSerializer(many=True, read_only=True)
    file_policy = AssignmentFilePolicySerializer(read_only=True)
    attachments = AssignmentAttachmentSerializer(many=True, read_only=True)
    total_score = serializers.SerializerMethodField()
    is_submission_window_open = serializers.SerializerMethodField()

    class Meta:
        model = Assignment
        fields = [
            "id",
            "course_id",
            "chapter_id",
            "lesson_id",
            "title",
            "instructions",
            "status",
            "due_at",
            "allow_late",
            "manually_closed_at",
            "rubric_criteria",
            "total_score",
            "file_policy",
            "attachments",
            "ai_grading_opt_in",
            "published_at",
            "created_at",
            "updated_at",
            "version",
            "is_submission_window_open",
        ]
        read_only_fields = fields

    def get_total_score(self, obj: Assignment) -> float:
        criteria = obj.rubric_criteria.all()
        if not criteria:
            return 10.0
        return float(sum(c.max_score for c in criteria))

    def get_is_submission_window_open(self, obj: Assignment) -> bool:
        return obj.is_submission_window_open()


class RubricCriterionInputSerializer(serializers.Serializer):
    """Schema dữ liệu đầu vào cho một tiêu chí rubric."""

    id = serializers.UUIDField(required=False, allow_null=True)
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    max_score = serializers.DecimalField(
        max_digits=5, decimal_places=2, min_value=Decimal("0.01"), default=Decimal("10.00")
    )
    position = serializers.IntegerField(required=False, min_value=1)


class FilePolicyInputSerializer(serializers.Serializer):
    """Schema dữ liệu đầu vào cho chính sách tệp nộp bài."""

    max_files_per_submission = serializers.IntegerField(required=False, min_value=1, max_value=10)
    max_file_size_bytes = serializers.IntegerField(
        required=False, min_value=1, max_value=SYSTEM_MAX_FILE_SIZE_BYTES
    )
    allowed_extensions = serializers.ListField(
        child=serializers.CharField(),
        required=False,
    )


class AssignmentCreateRequestSerializer(serializers.Serializer):
    """Schema dữ liệu yêu cầu tạo bài tập mới từ giảng viên."""

    title = serializers.CharField(max_length=200)
    instructions = serializers.CharField(required=False, allow_blank=True, default="")
    due_at = serializers.DateTimeField()
    allow_late = serializers.BooleanField(required=False, default=False)
    chapter_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    lesson_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    ai_grading_opt_in = serializers.BooleanField(required=False, default=False)
    rubric_criteria = RubricCriterionInputSerializer(many=True, required=False)
    file_policy = FilePolicyInputSerializer(required=False)
    attachment_file_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )
    publish_immediately = serializers.BooleanField(required=False, default=False)


class AssignmentUpdateRequestSerializer(serializers.Serializer):
    """Schema dữ liệu yêu cầu cập nhật bài tập có kiểm soát tương tranh lạc quan."""

    title = serializers.CharField(max_length=255, required=False)
    instructions = serializers.CharField(required=False, allow_blank=True)
    due_at = serializers.DateTimeField(required=False)
    allow_late = serializers.BooleanField(required=False)
    chapter_id = serializers.UUIDField(required=False, allow_null=True)
    lesson_id = serializers.UUIDField(required=False, allow_null=True)
    ai_grading_opt_in = serializers.BooleanField(required=False)
    rubric_criteria = RubricCriterionInputSerializer(many=True, required=False)
    file_policy = FilePolicyInputSerializer(required=False)
    attachment_file_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    expected_version = serializers.IntegerField(required=False, min_value=1)


class AssignmentPublishRequestSerializer(serializers.Serializer):
    """Schema dữ liệu yêu cầu công bố bài tập."""

    expected_version = serializers.IntegerField(required=False, min_value=1)


class AssignmentCloseRequestSerializer(serializers.Serializer):
    """Schema dữ liệu yêu cầu đóng hoặc mở lại cửa sổ nhận bài."""

    close_type = serializers.ChoiceField(
        choices=["manual_close", "reopen"],
        default="manual_close",
    )
    reopen_until = serializers.DateTimeField(required=False, allow_null=True)
    target_type = serializers.CharField(required=False, default="all")
    reopen_student_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
    )
    scope = serializers.CharField(required=False, default="all_actions")
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class AssignmentPreviewSerializer(serializers.Serializer):
    """Schema phản hồi cho chức năng xem trước bài tập dưới góc nhìn sinh viên."""

    assignment = AssignmentDetailSerializer()
    preview_mode = serializers.BooleanField(default=True)


class PaginationMetaSerializer(serializers.Serializer):
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    total_items = serializers.IntegerField()
    total_pages = serializers.IntegerField()
    has_next = serializers.BooleanField()
    has_previous = serializers.BooleanField()


class PaginatedAssignmentSummaryListSerializer(serializers.Serializer):
    """Serializer phân trang cho danh sách bài tập của môn học."""

    items = AssignmentSummaryItemSerializer(many=True)
    pagination = PaginationMetaSerializer()


class ApplicableFilePolicySerializer(serializers.Serializer):
    """Serializer cho chính sách tệp áp dụng cho lần nộp tiếp theo."""

    version = serializers.IntegerField()
    max_files = serializers.IntegerField()
    max_file_size_bytes = serializers.IntegerField()
    allowed_extensions = serializers.ListField(child=serializers.CharField())


class StudentAssignmentEligibilitySerializer(serializers.Serializer):
    """Serializer cho kết quả thẩm định hợp lệ nộp bài theo Thẩm quyền Máy chủ."""

    can_submit = serializers.BooleanField()
    can_replace = serializers.BooleanField()
    is_late = serializers.BooleanField()
    reason = serializers.CharField(allow_null=True)
    server_time = serializers.DateTimeField()
    deadline = serializers.DateTimeField()
    effective_deadline = serializers.DateTimeField()
    allow_late = serializers.BooleanField()
    manually_closed = serializers.BooleanField()
    in_reopen_window = serializers.BooleanField()
    reopen_window_id = serializers.CharField(allow_null=True)
    reopen_window_scope = serializers.CharField(allow_null=True)
    reopen_window_end = serializers.DateTimeField(allow_null=True)
    has_existing_submission = serializers.BooleanField()
    applicable_file_policy = ApplicableFilePolicySerializer()
    contract_version = serializers.CharField()


class AssignmentReopenWindowSerializer(serializers.ModelSerializer):
    """Serializer cho chi tiết cửa sổ mở lại do giảng viên chủ động cấp."""

    student_display_name = serializers.CharField(source="student.display_name", read_only=True)
    student_email = serializers.CharField(source="student.email", read_only=True)

    class Meta:
        model = AssignmentReopenWindow
        fields = [
            "id",
            "assignment_id",
            "target_type",
            "student_id",
            "student_display_name",
            "student_email",
            "start_at",
            "end_at",
            "scope",
            "reason",
            "is_active",
            "created_at",
        ]
        read_only_fields = ["id", "is_active", "created_at"]


class CreateAssignmentReopenWindowSerializer(serializers.Serializer):
    """Serializer cho yêu cầu tạo cửa sổ mở lại nộp bài."""

    target_type = serializers.ChoiceField(
        choices=ReopenWindowTarget.choices,
        default=ReopenWindowTarget.ALL,
    )
    student_id = serializers.UUIDField(required=False, allow_null=True)
    start_at = serializers.DateTimeField(required=False, allow_null=True)
    end_at = serializers.DateTimeField(required=True)
    scope = serializers.ChoiceField(
        choices=ReopenWindowScope.choices,
        default=ReopenWindowScope.ALL_ACTIONS,
    )
    reason = serializers.CharField(required=False, allow_blank=True, default="")
