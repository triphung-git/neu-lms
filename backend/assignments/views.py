import logging
import uuid

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.http import content_disposition_header
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from courses.models import Course
from platform_core.errors import DomainError
from platform_core.exceptions import format_error_envelope
from platform_core.idempotency import ResultReference, execute_once
from platform_core.pagination import StandardPageNumberPagination

from .exceptions import (
    AssignmentConflictError,
    AssignmentImmutableError,
    AssignmentNotFoundError,
    AssignmentPermissionDeniedError,
    AssignmentValidationError,
    CourseArchivedError,
)
from .models import (
    Assignment,
    AssignmentStatus,
    ReopenWindowScope,
    ReopenWindowTarget,
)
from .serializers import (
    AssignmentCloseRequestSerializer,
    AssignmentCreateRequestSerializer,
    AssignmentDetailSerializer,
    AssignmentPreviewSerializer,
    AssignmentPublishRequestSerializer,
    AssignmentReopenWindowSerializer,
    AssignmentSummaryItemSerializer,
    AssignmentUpdateRequestSerializer,
    CreateAssignmentReopenWindowSerializer,
    PaginatedAssignmentSummaryListSerializer,
    StudentAssignmentEligibilitySerializer,
)
from .services import (
    _check_assignment_read_permission,
    _check_course_published_assignments_access,
    _check_teacher_assignment_permission,
    archive_assignment,
    check_student_eligibility,
    close_assignment,
    create_assignment,
    create_reopen_window,
    get_assignment_attachment_for_delivery,
    publish_assignment,
    reopen_assignment,
    revoke_reopen_window,
    update_assignment,
)

logger = logging.getLogger(__name__)


def _validated_chapter_id(request):
    value = request.query_params.get("chapter_id")
    if not value:
        return None
    try:
        return uuid.UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise exceptions.ValidationError({"chapter_id": ["Mã chương không hợp lệ."]}) from exc


class AssignmentsBaseView(APIView):
    """Lớp view cơ sở cho phân hệ Bài tập.

    Đảm bảo giao dịch atomic cho mọi mutation và chuyển đổi exception chuẩn hóa theo
    error envelope thống nhất của hệ thống NEU LMS.
    """

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if (
            request.method not in {"GET", "HEAD", "OPTIONS"}
            and "id" in kwargs
            and "course_id" in kwargs
        ):
            get_object_or_404(Assignment, pk=kwargs["id"], course_id=kwargs["course_id"])

    def dispatch(self, request, *args, **kwargs):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            with transaction.atomic():
                return super().dispatch(request, *args, **kwargs)
        return super().dispatch(request, *args, **kwargs)

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, DjangoValidationError):
            detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
            exc = exceptions.ValidationError(detail)
        elif isinstance(exc, DjangoPermissionDenied):
            exc = exceptions.PermissionDenied(str(exc))
        elif isinstance(exc, AssignmentImmutableError):
            return Response(
                format_error_envelope(
                    code="immutable_after_publish",
                    message=exc.message,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        elif isinstance(exc, AssignmentConflictError):
            return Response(
                format_error_envelope(
                    code="conflict",
                    message=exc.message,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        elif isinstance(exc, AssignmentValidationError):
            return Response(
                format_error_envelope(
                    code="validation_error",
                    message=exc.message,
                    details=exc.field_errors,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        elif isinstance(exc, CourseArchivedError):
            return Response(
                format_error_envelope(
                    code="course_archived",
                    message=exc.message,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        elif isinstance(exc, AssignmentNotFoundError):
            return Response(
                format_error_envelope(
                    code="not_found",
                    message=exc.message,
                ),
                status=status.HTTP_404_NOT_FOUND,
            )
        elif isinstance(exc, AssignmentPermissionDeniedError):
            return Response(
                format_error_envelope(
                    code="permission_denied",
                    message=exc.message,
                ),
                status=status.HTTP_403_FORBIDDEN,
            )
        elif isinstance(exc, DomainError):
            if exc.code in {"IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_IN_PROGRESS"}:
                return super().handle_exception(exc)
            if exc.code == "COURSE_ARCHIVED":
                return Response(
                    format_error_envelope(
                        code="course_archived",
                        message="Môn học đã lưu trữ, không thể thực hiện thay đổi.",
                    ),
                    status=status.HTTP_400_BAD_REQUEST,
                )

        return super().handle_exception(exc)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store, private"
        response["X-Content-Type-Options"] = "nosniff"
        return response


class TeacherAssignmentListView(AssignmentsBaseView):
    """Danh sách bài tập và tạo mới bài tập cho giảng viên phụ trách môn học."""

    pagination_class = StandardPageNumberPagination

    @extend_schema(
        operation_id="teacher_assignments_list",
        parameters=[
            OpenApiParameter("status", str, description="Lọc theo trạng thái bài tập hoặc 'all'"),
            OpenApiParameter("chapter_id", uuid.UUID, description="Lọc theo chương học"),
            OpenApiParameter("search", str, description="Tìm kiếm theo tiêu đề bài tập"),
            OpenApiParameter("page", int, description="Số trang hiển thị"),
            OpenApiParameter("page_size", int, description="Kích thước mỗi trang"),
        ],
        responses={200: PaginatedAssignmentSummaryListSerializer},
    )
    def get(self, request, course_id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=False
        )

        queryset = (
            Assignment.objects.filter(course=course)
            .select_related("chapter", "lesson")
            .prefetch_related("rubric_criteria", "attachments")
            .order_by("-created_at")
        )

        status_param = request.query_params.get("status")
        if status_param and status_param != "all":
            if status_param not in AssignmentStatus.values:
                raise exceptions.ValidationError({"status": ["Trạng thái không hợp lệ."]})
            queryset = queryset.filter(status=status_param)

        chapter_param = _validated_chapter_id(request)
        if chapter_param:
            queryset = queryset.filter(chapter_id=chapter_param)

        search_param = request.query_params.get("search")
        if search_param:
            queryset = queryset.filter(title__icontains=search_param.strip())

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = AssignmentSummaryItemSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    @extend_schema(
        operation_id="teacher_assignments_create",
        request=AssignmentCreateRequestSerializer,
        responses={201: AssignmentDetailSerializer},
    )
    def post(self, request, course_id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=True
        )

        serializer = AssignmentCreateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        def mutate() -> ResultReference:
            assignment = create_assignment(
                course_id=course.id,
                title=data["title"],
                instructions=data.get("instructions", ""),
                due_at=data["due_at"],
                allow_late=data.get("allow_late", False),
                chapter_id=data.get("chapter_id"),
                lesson_id=data.get("lesson_id"),
                ai_grading_opt_in=data.get("ai_grading_opt_in", False),
                rubric_criteria_data=data.get("rubric_criteria"),
                file_policy_data=data.get("file_policy"),
                attachment_file_ids=data.get("attachment_file_ids"),
                publish_immediately=data.get("publish_immediately", False),
                created_by=actor,
            )
            return ResultReference("assignment", assignment.id)

        key = request.headers.get("Idempotency-Key")
        if key:
            ref = execute_once(
                scope=f"user:{actor.id}",
                operation="assignments.create",
                key=key,
                payload={
                    "course_id": str(course_id),
                    "data": {
                        k: [str(v) for v in value] if isinstance(value, list) else str(value)
                        for k, value in data.items()
                    },
                },
                mutation=mutate,
            )
            assignment = get_object_or_404(Assignment, pk=ref.resource_id, course=course)
        else:
            assignment = get_object_or_404(Assignment, pk=mutate().resource_id, course=course)

        return Response(
            AssignmentDetailSerializer(assignment).data,
            status=status.HTTP_201_CREATED,
        )


class TeacherAssignmentDetailView(AssignmentsBaseView):
    """Xem chi tiết và chỉnh sửa bài tập của giảng viên phụ trách môn học."""

    @extend_schema(
        operation_id="teacher_assignments_retrieve",
        responses={200: AssignmentDetailSerializer},
    )
    def get(self, request, course_id: uuid.UUID, id: uuid.UUID):
        actor, course, assignment = _check_assignment_read_permission(course_id, id, request.user)
        return Response(AssignmentDetailSerializer(assignment).data)

    @extend_schema(
        operation_id="teacher_assignments_partial_update",
        request=AssignmentUpdateRequestSerializer,
        responses={200: AssignmentDetailSerializer},
    )
    def patch(self, request, course_id: uuid.UUID, id: uuid.UUID):
        return self._update(request, course_id, id)

    @extend_schema(
        operation_id="teacher_assignments_update",
        request=AssignmentUpdateRequestSerializer,
        responses={200: AssignmentDetailSerializer},
    )
    def put(self, request, course_id: uuid.UUID, id: uuid.UUID):
        return self._update(request, course_id, id)

    def _update(self, request, course_id: uuid.UUID, id: uuid.UUID) -> Response:
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=True
        )

        serializer = AssignmentUpdateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Xác định expected_version từ payload hoặc If-Match header
        expected_version = data.get("expected_version")
        if_match = request.headers.get("If-Match")
        if if_match and expected_version is None:
            try:
                expected_version = int(if_match.strip('"'))
            except ValueError:
                pass

        def mutate() -> ResultReference:
            assignment = update_assignment(
                assignment_id=id,
                actor=actor,
                expected_version=expected_version,
                title=data.get("title"),
                instructions=data.get("instructions"),
                due_at=data.get("due_at"),
                allow_late=data.get("allow_late"),
                chapter_id=data.get("chapter_id", ...),
                lesson_id=data.get("lesson_id", ...),
                ai_grading_opt_in=data.get("ai_grading_opt_in"),
                rubric_criteria_data=data.get("rubric_criteria"),
                file_policy_data=data.get("file_policy"),
                attachment_file_ids=data.get("attachment_file_ids"),
            )
            return ResultReference("assignment", assignment.id)

        key = request.headers.get("Idempotency-Key")
        if key:
            ref = execute_once(
                scope=f"user:{actor.id}",
                operation="assignments.update",
                key=key,
                payload={
                    "course_id": str(course_id),
                    "assignment_id": str(id),
                    "expected_version": str(expected_version)
                    if expected_version is not None
                    else "",
                    "data": {
                        k: [str(v) for v in value] if isinstance(value, list) else str(value)
                        for k, value in data.items()
                    },
                },
                mutation=mutate,
            )
            assignment = get_object_or_404(Assignment, pk=ref.resource_id, course=course)
        else:
            assignment = get_object_or_404(Assignment, pk=mutate().resource_id, course=course)

        return Response(AssignmentDetailSerializer(assignment).data)


class TeacherAssignmentPublishView(AssignmentsBaseView):
    """Công bố bài tập cho sinh viên và đóng băng đề bài cùng rubric."""

    @extend_schema(
        operation_id="teacher_assignments_publish",
        request=AssignmentPublishRequestSerializer,
        responses={200: AssignmentDetailSerializer},
    )
    def post(self, request, course_id: uuid.UUID, id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=True
        )

        serializer = AssignmentPublishRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        expected_version = data.get("expected_version")

        assignment = get_object_or_404(Assignment, pk=id, course=course)

        def mutate() -> ResultReference:
            current = get_object_or_404(Assignment, pk=id, course=course)
            if expected_version is not None and current.version != expected_version:
                raise AssignmentConflictError()
            published = publish_assignment(assignment_id=id, actor=actor)
            return ResultReference("assignment", published.id)

        key = request.headers.get("Idempotency-Key")
        if key:
            ref = execute_once(
                scope=f"user:{actor.id}",
                operation="assignments.publish",
                key=key,
                payload={
                    "course_id": str(course_id),
                    "assignment_id": str(id),
                    "expected_version": expected_version,
                },
                mutation=mutate,
            )
            assignment = get_object_or_404(Assignment, pk=ref.resource_id, course=course)
        else:
            assignment = get_object_or_404(Assignment, pk=mutate().resource_id, course=course)

        return Response(AssignmentDetailSerializer(assignment).data)


class TeacherAssignmentCloseView(AssignmentsBaseView):
    """Đóng nhận bài sớm thủ công hoặc mở lại bài tập kèm gia hạn thời hạn nộp bài."""

    @extend_schema(
        operation_id="teacher_assignments_close",
        request=AssignmentCloseRequestSerializer,
        responses={200: AssignmentDetailSerializer},
    )
    def post(self, request, course_id: uuid.UUID, id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=True
        )

        serializer = AssignmentCloseRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        close_type = data.get("close_type", "manual_close")
        reopen_until = data.get("reopen_until")
        reason = data.get("reason", "")

        def mutate() -> ResultReference:
            if close_type == "reopen":
                res = reopen_assignment(
                    assignment_id=id,
                    actor=actor,
                    reopen_until=reopen_until,
                    reason=reason,
                )
            else:
                res = close_assignment(
                    assignment_id=id,
                    actor=actor,
                    reason=reason,
                )
            return ResultReference("assignment", res.id)

        key = request.headers.get("Idempotency-Key")
        if key:
            ref = execute_once(
                scope=f"user:{actor.id}",
                operation=f"assignments.{close_type}",
                key=key,
                payload={
                    "course_id": str(course_id),
                    "assignment_id": str(id),
                    "close_type": close_type,
                    "reopen_until": str(reopen_until) if reopen_until else "",
                    "reason": reason,
                },
                mutation=mutate,
            )
            assignment = get_object_or_404(Assignment, pk=ref.resource_id, course=course)
        else:
            assignment = get_object_or_404(Assignment, pk=mutate().resource_id, course=course)

        return Response(AssignmentDetailSerializer(assignment).data)


class TeacherAssignmentReopenView(AssignmentsBaseView):
    """Endpoint mở lại bài tập đã đóng nhận bài."""

    @extend_schema(
        operation_id="teacher_assignments_reopen",
        request=AssignmentCloseRequestSerializer,
        responses={200: AssignmentDetailSerializer},
    )
    def post(self, request, course_id: uuid.UUID, id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=True
        )

        serializer = AssignmentCloseRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        reopen_until = data.get("reopen_until")
        reason = data.get("reason", "")

        def mutate() -> ResultReference:
            res = reopen_assignment(
                assignment_id=id,
                actor=actor,
                reopen_until=reopen_until,
                reason=reason,
            )
            return ResultReference("assignment", res.id)

        key = request.headers.get("Idempotency-Key")
        if key:
            ref = execute_once(
                scope=f"user:{actor.id}",
                operation="assignments.reopen",
                key=key,
                payload={
                    "course_id": str(course_id),
                    "assignment_id": str(id),
                    "reopen_until": str(reopen_until) if reopen_until else "",
                    "reason": reason,
                },
                mutation=mutate,
            )
            assignment = get_object_or_404(Assignment, pk=ref.resource_id, course=course)
        else:
            assignment = get_object_or_404(Assignment, pk=mutate().resource_id, course=course)

        return Response(AssignmentDetailSerializer(assignment).data)


class TeacherAssignmentArchiveView(AssignmentsBaseView):
    """Lưu trữ bài tập."""

    @extend_schema(
        operation_id="teacher_assignments_archive",
        request=None,
        responses={200: AssignmentDetailSerializer},
    )
    def post(self, request, course_id: uuid.UUID, id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=True
        )

        def mutate() -> ResultReference:
            res = archive_assignment(assignment_id=id, actor=actor)
            return ResultReference("assignment", res.id)

        key = request.headers.get("Idempotency-Key")
        if key:
            ref = execute_once(
                scope=f"user:{actor.id}",
                operation="assignments.archive",
                key=key,
                payload={"course_id": str(course_id), "assignment_id": str(id)},
                mutation=mutate,
            )
            assignment = get_object_or_404(Assignment, pk=ref.resource_id, course=course)
        else:
            assignment = get_object_or_404(Assignment, pk=mutate().resource_id, course=course)

        return Response(AssignmentDetailSerializer(assignment).data)


class TeacherAssignmentPreviewView(AssignmentsBaseView):
    """Xem trước bài tập dưới góc nhìn sinh viên."""

    @extend_schema(
        operation_id="teacher_assignments_preview",
        responses={200: AssignmentPreviewSerializer},
    )
    def get(self, request, course_id: uuid.UUID, id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=False
        )
        assignment = get_object_or_404(
            Assignment.objects.select_related("chapter", "lesson").prefetch_related(
                "rubric_criteria", "attachments"
            ),
            pk=id,
            course=course,
        )
        return Response(
            {
                "assignment": AssignmentDetailSerializer(assignment).data,
                "preview_mode": True,
            }
        )


class CourseAssignmentAttachmentDownloadView(AssignmentsBaseView):
    """Tải xuống tệp đính kèm tài liệu đề bài của bài tập."""

    preview = False

    @extend_schema(
        operation_id="assignments_attachment_download",
        responses={200: bytes},
    )
    def get(self, request, course_id: uuid.UUID, id: uuid.UUID, file_id: uuid.UUID):
        attachment, content = get_assignment_attachment_for_delivery(
            actor=request.user,
            course_id=course_id,
            assignment_id=id,
            file_id=file_id,
            is_preview=self.preview,
        )

        media_types = {
            "pdf": "application/pdf",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "gif": "image/gif",
            "webp": "image/webp",
        }
        ext = attachment.name.rsplit(".", 1)[-1].lower()
        content_type = media_types.get(ext, "application/octet-stream")

        response = HttpResponse(content, content_type=content_type)
        response["Content-Disposition"] = content_disposition_header(
            not self.preview, attachment.name
        )
        response["Content-Security-Policy"] = "sandbox; default-src 'none'"
        return response


class CourseAssignmentAttachmentPreviewView(CourseAssignmentAttachmentDownloadView):
    """Xem trước trực tuyến tệp đính kèm tài liệu đề bài của bài tập."""

    preview = True

    @extend_schema(
        operation_id="assignments_attachment_preview",
        responses={200: bytes},
    )
    def get(self, request, course_id: uuid.UUID, id: uuid.UUID, file_id: uuid.UUID):
        return super().get(request, course_id, id, file_id)


class StudentAssignmentEligibilityView(AssignmentsBaseView):
    """Thẩm định tính hợp lệ nộp bài của sinh viên theo Thẩm quyền Máy chủ.

    Không dùng ClockContext hay client timestamp làm authority.
    """

    @extend_schema(
        operation_id="assignments_eligibility_check",
        responses={200: StudentAssignmentEligibilitySerializer},
    )
    def get(self, request, course_id: uuid.UUID, id: uuid.UUID):
        if not request.user or not request.user.is_authenticated:
            return Response(
                {
                    "error": {
                        "code": "unauthenticated",
                        "message": "Yêu cầu đăng nhập để kiểm tra hợp lệ nộp bài.",
                    }
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )

        course = get_object_or_404(Course, pk=course_id)
        assignment = get_object_or_404(Assignment, pk=id, course=course)

        if "has_existing_submission" in request.query_params:
            raise AssignmentValidationError(
                "Trạng thái bài nộp phải được xác định từ dữ liệu máy chủ."
            )

        eligibility = check_student_eligibility(
            assignment=assignment,
            student=request.user,
            has_existing_submission=False,
        )
        return Response(StudentAssignmentEligibilitySerializer(eligibility).data)


class TeacherAssignmentReopenWindowListView(AssignmentsBaseView):
    """Quản lý các cửa sổ mở lại / ngoại lệ nộp bài do giảng viên chủ động cấp."""

    @extend_schema(
        operation_id="teacher_assignments_reopen_windows_list",
        responses={200: AssignmentReopenWindowSerializer(many=True)},
    )
    def get(self, request, course_id: uuid.UUID, id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(course_id, request.user)
        assignment = get_object_or_404(Assignment, pk=id, course=course)
        windows = assignment.reopen_windows.select_related("student").all()
        return Response(AssignmentReopenWindowSerializer(windows, many=True).data)

    @extend_schema(
        operation_id="teacher_assignments_reopen_windows_create",
        request=CreateAssignmentReopenWindowSerializer,
        responses={201: AssignmentReopenWindowSerializer},
    )
    def post(self, request, course_id: uuid.UUID, id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=True
        )
        assignment = get_object_or_404(Assignment, pk=id, course=course)

        serializer = CreateAssignmentReopenWindowSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        window = create_reopen_window(
            assignment_id=assignment.id,
            actor=actor,
            end_at=data["end_at"],
            target_type=data.get("target_type", ReopenWindowTarget.ALL),
            student_id=data.get("student_id"),
            start_at=data.get("start_at"),
            scope=data.get("scope", ReopenWindowScope.ALL_ACTIONS),
            reason=data.get("reason", ""),
        )
        return Response(
            AssignmentReopenWindowSerializer(window).data, status=status.HTTP_201_CREATED
        )


class TeacherAssignmentReopenWindowDetailView(AssignmentsBaseView):
    """Thu hồi / hủy hiệu lực một cửa sổ mở lại."""

    @extend_schema(
        operation_id="teacher_assignments_reopen_windows_revoke",
        responses={200: AssignmentReopenWindowSerializer},
    )
    def delete(self, request, course_id: uuid.UUID, id: uuid.UUID, window_id: uuid.UUID):
        actor, course = _check_teacher_assignment_permission(
            course_id, request.user, for_update=True
        )
        get_object_or_404(Assignment, pk=id, course=course)
        window = revoke_reopen_window(window_id=window_id, actor=actor)
        return Response(AssignmentReopenWindowSerializer(window).data)


class AssignmentDirectDetailView(AssignmentsBaseView):
    """Xem chi tiết bài tập trực tiếp qua assignment ID."""

    @extend_schema(
        operation_id="assignments_direct_retrieve",
        responses={200: AssignmentDetailSerializer},
    )
    def get(self, request, id: uuid.UUID):
        try:
            assignment = Assignment.objects.select_related("course").get(pk=id)
        except Assignment.DoesNotExist as err:
            raise AssignmentNotFoundError("Bài tập không tồn tại.") from err

        actor, course, assignment = _check_assignment_read_permission(
            assignment.course_id, assignment.id, request.user
        )
        return Response(AssignmentDetailSerializer(assignment).data)


class StudentCourseAssignmentListView(AssignmentsBaseView):
    """Danh sách bài tập đã công bố của môn học dành cho sinh viên và giảng viên."""

    pagination_class = StandardPageNumberPagination

    @extend_schema(
        operation_id="courses_published_assignments_list",
        parameters=[
            OpenApiParameter("chapter_id", uuid.UUID, description="Lọc theo chương học"),
            OpenApiParameter("search", str, description="Tìm kiếm theo tiêu đề bài tập"),
            OpenApiParameter("page", int, description="Số trang hiển thị"),
            OpenApiParameter("page_size", int, description="Kích thước mỗi trang"),
        ],
        responses={200: PaginatedAssignmentSummaryListSerializer},
    )
    def get(self, request, course_id: uuid.UUID):
        actor, course = _check_course_published_assignments_access(course_id, request.user)

        queryset = (
            Assignment.objects.filter(
                course=course,
                published_at__isnull=False,
                status__in=[
                    AssignmentStatus.PUBLISHED,
                    AssignmentStatus.CLOSED,
                    AssignmentStatus.ARCHIVED,
                ],
            )
            .select_related("chapter", "lesson")
            .prefetch_related("rubric_criteria", "attachments")
            .order_by("due_at", "-created_at")
        )

        chapter_param = _validated_chapter_id(request)
        if chapter_param:
            queryset = queryset.filter(chapter_id=chapter_param)

        search_param = request.query_params.get("search")
        if search_param:
            queryset = queryset.filter(title__icontains=search_param.strip())

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = AssignmentSummaryItemSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class StudentAssignmentEligibilityDirectView(AssignmentsBaseView):
    """Thẩm định tính hợp lệ nộp bài trực tiếp qua assignment ID."""

    @extend_schema(
        operation_id="assignments_direct_eligibility_check",
        responses={200: StudentAssignmentEligibilitySerializer},
    )
    def get(self, request, id: uuid.UUID):
        try:
            assignment = Assignment.objects.select_related("course").get(pk=id)
        except Assignment.DoesNotExist as err:
            raise AssignmentNotFoundError("Bài tập không tồn tại.") from err

        view = StudentAssignmentEligibilityView()
        return view.get(request, course_id=assignment.course_id, id=assignment.id)


class CourseAssignmentAttachmentDownloadDirectView(CourseAssignmentAttachmentDownloadView):
    """Tải xuống tệp đính kèm tài liệu đề bài trực tiếp qua assignment ID."""

    @extend_schema(
        operation_id="assignments_direct_attachment_download",
        responses={200: bytes},
    )
    def get(self, request, id: uuid.UUID, file_id: uuid.UUID):
        try:
            assignment = Assignment.objects.select_related("course").get(pk=id)
        except Assignment.DoesNotExist as err:
            raise AssignmentNotFoundError("Bài tập không tồn tại.") from err
        return super().get(
            request, course_id=assignment.course_id, id=assignment.id, file_id=file_id
        )


class CourseAssignmentAttachmentPreviewDirectView(CourseAssignmentAttachmentPreviewView):
    """Xem trước trực tuyến tệp đính kèm tài liệu đề bài trực tiếp qua assignment ID."""

    @extend_schema(
        operation_id="assignments_direct_attachment_preview",
        responses={200: bytes},
    )
    def get(self, request, id: uuid.UUID, file_id: uuid.UUID):
        try:
            assignment = Assignment.objects.select_related("course").get(pk=id)
        except Assignment.DoesNotExist as err:
            raise AssignmentNotFoundError("Bài tập không tồn tại.") from err
        return super().get(
            request, course_id=assignment.course_id, id=assignment.id, file_id=file_id
        )
