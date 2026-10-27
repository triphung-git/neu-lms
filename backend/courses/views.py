from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.admin_views import AdminBaseView
from identity.models import Role
from identity.services.common import has_role
from platform_core.pagination import StandardPageNumberPagination

from .models import Chapter, Course, EnrollmentRequest, Lesson, Membership
from .serializers import (
    AddMemberSerializer,
    ChapterSerializer,
    CourseCatalogItemSerializer,
    CourseMemberSerializer,
    CourseSerializer,
    CourseSummaryResponseSerializer,
    CourseTransferSerializer,
    LessonSerializer,
    RejectEnrollmentRequestSerializer,
    ReorderSerializer,
    StudentEnrollmentRequestSerializer,
    TeacherEnrollmentRequestSerializer,
)
from .services import (
    add_course_member,
    approve_enrollment_request,
    archive_course,
    cancel_enrollment_request,
    get_courses_summary,
    re_enroll_course_member,
    reject_enrollment_request,
    reorder_chapters,
    reorder_lessons,
    request_enrollment,
    require_active_student,
    require_active_teacher,
    require_course_manager,
    transfer_course,
    withdraw_course_member,
)


def visible_course_queryset(user):
    queryset = Course.objects.select_related("teacher").annotate(
        active_member_count=Count(
            "memberships",
            filter=Q(memberships__status=Membership.Status.ACTIVE),
            distinct=True,
        )
    )

    if has_role(user, Role.ADMIN):
        return queryset

    visibility = Q(pk__in=[])
    if has_role(user, Role.TEACHER):
        visibility |= Q(teacher=user)
    if has_role(user, Role.STUDENT):
        visibility |= Q(
            memberships__student=user,
            memberships__status=Membership.Status.ACTIVE,
        )
    return queryset.filter(visibility).distinct()


def get_visible_course(course_id, user):
    course = get_object_or_404(visible_course_queryset(user), pk=course_id)
    return course


def get_chapter(course, chapter_id):
    return get_object_or_404(Chapter.objects.filter(course=course), pk=chapter_id)


def get_lesson(chapter, lesson_id):
    return get_object_or_404(Lesson.objects.filter(chapter=chapter), pk=lesson_id)


@extend_schema_view(
    list=extend_schema(
        parameters=[
            OpenApiParameter(
                "search",
                str,
                description="Search by course code, name, term or teacher",
            ),
            OpenApiParameter("term", str, description="Filter by academic term"),
            OpenApiParameter("status", str, description="Filter by open or archived status"),
            OpenApiParameter("enrollment_open", bool, description="Filter enrollment availability"),
            OpenApiParameter(
                "role",
                str,
                enum=["teacher", "student"],
                description="Narrow to owned or enrolled courses",
            ),
        ],
        tags=["courses"],
    ),
    retrieve=extend_schema(tags=["courses"]),
    create=extend_schema(tags=["courses"]),
    update=extend_schema(tags=["courses"]),
    partial_update=extend_schema(tags=["courses"]),
    destroy=extend_schema(tags=["courses"]),
)
class CourseViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    mixins.UpdateModelMixin,
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = CourseSerializer
    permission_classes = [IsAuthenticated]
    lookup_value_regex = (
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    )
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Course.objects.none()

        queryset = visible_course_queryset(self.request.user).order_by("-created_at", "id")
        params = self.request.query_params
        role = params.get("role")
        if role == "student":
            require_active_student(self.request.user)
            queryset = queryset.filter(
                memberships__student=self.request.user,
                memberships__status=Membership.Status.ACTIVE,
            )
        elif role == "teacher":
            require_active_teacher(self.request.user)
            queryset = queryset.filter(teacher=self.request.user)
        elif role is not None:
            raise ValidationError({"role": ["Invalid course workspace role."]})

        search = params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(code__icontains=search)
                | Q(name__icontains=search)
                | Q(term__icontains=search)
                | Q(teacher__display_name__icontains=search)
            )

        term = params.get("term", "").strip()
        if term:
            queryset = queryset.filter(term=term)

        course_status = params.get("status", "").strip()
        if course_status:
            if course_status not in Course.Status.values:
                raise ValidationError({"status": ["Trạng thái môn học không hợp lệ."]})
            queryset = queryset.filter(status=course_status)

        enrollment_open = params.get("enrollment_open")
        if enrollment_open is not None:
            if enrollment_open.lower() not in ("true", "false", "1", "0"):
                raise ValidationError({"enrollment_open": ["Giá trị phải là true hoặc false."]})
            queryset = queryset.filter(enrollment_open=enrollment_open.lower() in ("true", "1"))

        return queryset

    def perform_create(self, serializer):
        require_active_teacher(self.request.user)
        try:
            with transaction.atomic():
                serializer.save(teacher=self.request.user)
        except IntegrityError as exc:
            raise ValidationError(
                {"code": ["Không thể tạo môn học với mã này. Hãy kiểm tra mã môn đã tồn tại."]}
            ) from exc

    def perform_update(self, serializer):
        with transaction.atomic():
            course = Course.objects.select_for_update().get(pk=self.get_object().pk)
            require_course_manager(self.request.user, course)
            serializer.instance = course
            try:
                serializer.save()
            except IntegrityError as exc:
                raise ValidationError(
                    {"code": ["Không thể lưu mã môn học này vì đã được sử dụng."]}
                ) from exc

    def perform_destroy(self, instance):
        with transaction.atomic():
            course = Course.objects.select_for_update().get(pk=instance.pk)
            require_course_manager(self.request.user, course)
            if course.memberships.exists() or course.chapters.exists():
                raise ValidationError("Chỉ có thể xóa môn học chưa có thành viên hoặc nội dung.")
            try:
                course.delete()
            except ProtectedError as exc:
                raise ValidationError(
                    "Môn học đang được dữ liệu khác sử dụng và không thể xóa."
                ) from exc

    @extend_schema(
        request=None,
        responses={status.HTTP_200_OK: CourseSerializer},
        tags=["courses"],
    )
    @action(detail=True, methods=["post"], url_path="archive")
    def archive(self, request, pk=None):
        course = self.get_object()
        course = archive_course(request.user, course.id)
        course = visible_course_queryset(request.user).get(pk=course.id)
        return Response(self.get_serializer(course).data)


class AdminCourseTransferView(AdminBaseView):
    @extend_schema(
        request=CourseTransferSerializer,
        responses={status.HTTP_200_OK: CourseSerializer},
        tags=["courses"],
    )
    def post(self, request, course_id):
        serializer = CourseTransferSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            course = transfer_course(course_id, serializer.validated_data["teacher_id"])
        except Course.DoesNotExist as exc:
            raise NotFound("Không tìm thấy môn học.") from exc
        course = visible_course_queryset(request.user).get(pk=course.id)
        return Response(CourseSerializer(course).data, status=status.HTTP_200_OK)


class CourseChaptersView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={status.HTTP_200_OK: ChapterSerializer(many=True)},
        tags=["courses"],
    )
    def get(self, request, course_id):
        course = get_visible_course(course_id, request.user)
        chapters = Chapter.objects.filter(course=course)
        return Response(ChapterSerializer(chapters, many=True).data)

    @extend_schema(
        request=ChapterSerializer,
        responses={status.HTTP_201_CREATED: ChapterSerializer},
        tags=["courses"],
    )
    def post(self, request, course_id):
        with transaction.atomic():
            course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
            require_course_manager(request.user, course)
            serializer = ChapterSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            position = (
                course.chapters.aggregate(max_position=Max("position"))["max_position"] or 0
            ) + 1
            chapter = serializer.save(course=course, position=position)
        return Response(
            ChapterSerializer(chapter).data,
            status=status.HTTP_201_CREATED,
        )


class CourseChapterDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=ChapterSerializer,
        responses={status.HTTP_200_OK: ChapterSerializer},
        tags=["courses"],
    )
    def patch(self, request, course_id, chapter_id):
        with transaction.atomic():
            course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
            require_course_manager(request.user, course)
            chapter = get_chapter(course, chapter_id)
            serializer = ChapterSerializer(chapter, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            chapter = serializer.save()
        return Response(ChapterSerializer(chapter).data)

    @extend_schema(
        request=None,
        responses={status.HTTP_204_NO_CONTENT: None},
        tags=["courses"],
    )
    def delete(self, request, course_id, chapter_id):
        with transaction.atomic():
            course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
            require_course_manager(request.user, course)
            chapter = get_chapter(course, chapter_id)
            if chapter.lessons.exists():
                raise ValidationError("Không thể xóa chương đang chứa bài học.")
            try:
                chapter.delete()
            except ProtectedError as exc:
                raise ValidationError("Chương đang được dữ liệu khác sử dụng.") from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class CourseChapterReorderView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=ReorderSerializer,
        responses={status.HTTP_200_OK: ChapterSerializer(many=True)},
        tags=["courses"],
    )
    def post(self, request, course_id):
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        course = get_object_or_404(Course, pk=course_id)
        require_course_manager(request.user, course)
        chapters = reorder_chapters(request.user, course_id, serializer.validated_data["ids"])
        return Response(ChapterSerializer(chapters, many=True).data)


class CourseLessonsView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={status.HTTP_200_OK: LessonSerializer(many=True)},
        tags=["courses"],
    )
    def get(self, request, course_id, chapter_id):
        course = get_visible_course(course_id, request.user)
        chapter = get_chapter(course, chapter_id)
        lessons = Lesson.objects.filter(chapter=chapter)
        return Response(LessonSerializer(lessons, many=True).data)

    @extend_schema(
        request=LessonSerializer,
        responses={status.HTTP_201_CREATED: LessonSerializer},
        tags=["courses"],
    )
    def post(self, request, course_id, chapter_id):
        with transaction.atomic():
            course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
            require_course_manager(request.user, course)
            chapter = get_chapter(course, chapter_id)
            serializer = LessonSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            position = (
                chapter.lessons.aggregate(max_position=Max("position"))["max_position"] or 0
            ) + 1
            lesson = serializer.save(chapter=chapter, position=position)
        return Response(
            LessonSerializer(lesson).data,
            status=status.HTTP_201_CREATED,
        )


class CourseLessonDetailView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=LessonSerializer,
        responses={status.HTTP_200_OK: LessonSerializer},
        tags=["courses"],
    )
    def patch(self, request, course_id, chapter_id, lesson_id):
        with transaction.atomic():
            course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
            require_course_manager(request.user, course)
            chapter = get_chapter(course, chapter_id)
            lesson = get_lesson(chapter, lesson_id)
            serializer = LessonSerializer(lesson, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            lesson = serializer.save()
        return Response(LessonSerializer(lesson).data)

    @extend_schema(
        request=None,
        responses={status.HTTP_204_NO_CONTENT: None},
        tags=["courses"],
    )
    def delete(self, request, course_id, chapter_id, lesson_id):
        with transaction.atomic():
            course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
            require_course_manager(request.user, course)
            chapter = get_chapter(course, chapter_id)
            lesson = get_lesson(chapter, lesson_id)
            try:
                lesson.delete()
            except ProtectedError as exc:
                raise ValidationError(
                    "Bài học đang được học liệu hoặc dữ liệu khác sử dụng."
                ) from exc
        return Response(status=status.HTTP_204_NO_CONTENT)


class CourseLessonReorderView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=ReorderSerializer,
        responses={status.HTTP_200_OK: LessonSerializer(many=True)},
        tags=["courses"],
    )
    def post(self, request, course_id, chapter_id):
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        course = get_object_or_404(Course, pk=course_id)
        require_course_manager(request.user, course)
        chapter = get_chapter(course, chapter_id)
        lessons = reorder_lessons(request.user, chapter.id, serializer.validated_data["ids"])
        return Response(LessonSerializer(lessons, many=True).data)


class CourseSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["courses"],
        summary="Lấy tổng quan môn học theo vai trò cá nhân",
        description=(
            "Trả về các chỉ số thống kê môn học thực tế "
            "cho giảng viên phụ trách hoặc sinh viên đang tham gia."
        ),
        parameters=[
            OpenApiParameter(
                name="role",
                type=str,
                enum=["teacher", "student"],
                required=False,
                description="Vai trò workspace cần lấy summary ('teacher' hoặc 'student').",
            ),
            OpenApiParameter(
                name="workspace",
                type=str,
                enum=["teacher", "student"],
                required=False,
                description="Alias cho tham số role.",
            ),
        ],
        responses={
            status.HTTP_200_OK: CourseSummaryResponseSerializer,
        },
    )
    def get(self, request):
        role_param = request.query_params.get("role") or request.query_params.get("workspace")
        data = get_courses_summary(request.user, role_param=role_param)
        serializer = CourseSummaryResponseSerializer(data)
        return Response(serializer.data, status=status.HTTP_200_OK)


class CourseCatalogView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPageNumberPagination

    @extend_schema(
        tags=["courses"],
        summary="Danh mục môn học đang mở nhận ghi danh",
        description=(
            "Tra cứu danh mục môn học đang mở nhận ghi danh kèm trạng thái đăng ký của sinh viên."
        ),
        parameters=[
            OpenApiParameter(
                "search",
                str,
                required=False,
                description="Tìm kiếm theo mã, tên môn, học kỳ, giảng viên",
            ),
            OpenApiParameter("term", str, required=False, description="Lọc theo học kỳ"),
            OpenApiParameter("page", int, required=False, description="Số trang (bắt đầu từ 1)"),
            OpenApiParameter(
                "page_size", int, required=False, description="Số lượng mỗi trang (tối đa 100)"
            ),
        ],
        responses={
            status.HTTP_200_OK: CourseCatalogItemSerializer(many=True),
        },
    )
    def get(self, request):
        require_active_student(request.user)
        queryset = (
            Course.objects.filter(status=Course.Status.OPEN, enrollment_open=True)
            .select_related("teacher")
            .annotate(
                active_member_count=Count(
                    "memberships",
                    filter=Q(memberships__status=Membership.Status.ACTIVE),
                    distinct=True,
                )
            )
            .order_by("-created_at", "id")
        )

        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(code__icontains=search)
                | Q(name__icontains=search)
                | Q(term__icontains=search)
                | Q(teacher__display_name__icontains=search)
            )

        term = request.query_params.get("term", "").strip()
        if term:
            queryset = queryset.filter(term=term)

        paginator = StandardPageNumberPagination()
        page_courses = paginator.paginate_queryset(queryset, request, view=self)

        course_ids = [c.id for c in page_courses]
        user_memberships = {
            m.course_id: m.status
            for m in Membership.objects.filter(student=request.user, course_id__in=course_ids)
        }
        user_pending_requests = {
            r.course_id: r.id
            for r in EnrollmentRequest.objects.filter(
                student=request.user,
                course_id__in=course_ids,
                status=EnrollmentRequest.Status.PENDING,
            )
        }

        items = []
        for c in page_courses:
            m_status = user_memberships.get(c.id)
            pending_req_id = user_pending_requests.get(c.id)

            if m_status == Membership.Status.ACTIVE:
                enrollment_status = "enrolled"
            elif pending_req_id is not None:
                enrollment_status = "pending"
            elif m_status == Membership.Status.WITHDRAWN:
                enrollment_status = "withdrawn"
            else:
                enrollment_status = "not_enrolled"

            items.append(
                {
                    "id": c.id,
                    "code": c.code,
                    "name": c.name,
                    "term": c.term,
                    "description": c.description,
                    "teacher_name": c.teacher.display_name if c.teacher else "",
                    "enrollment_open": c.enrollment_open,
                    "active_member_count": getattr(c, "active_member_count", 0),
                    "my_enrollment_status": enrollment_status,
                    "pending_request_id": pending_req_id,
                    "created_at": c.created_at,
                }
            )

        serializer = CourseCatalogItemSerializer(items, many=True)
        return paginator.get_paginated_response(serializer.data)


class StudentMyEnrollmentRequestsView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPageNumberPagination

    @extend_schema(
        tags=["courses"],
        summary="Danh sách yêu cầu ghi danh của sinh viên",
        description="Lấy danh sách các yêu cầu ghi danh của chính sinh viên đang đăng nhập.",
        parameters=[
            OpenApiParameter(
                "status",
                str,
                required=False,
                enum=["pending", "approved", "rejected", "cancelled"],
                description="Lọc theo trạng thái yêu cầu",
            ),
            OpenApiParameter("page", int, required=False, description="Số trang"),
            OpenApiParameter("page_size", int, required=False, description="Số lượng mỗi trang"),
        ],
        responses={
            status.HTTP_200_OK: StudentEnrollmentRequestSerializer(many=True),
        },
    )
    def get(self, request):
        require_active_student(request.user)

        queryset = (
            EnrollmentRequest.objects.filter(student=request.user)
            .select_related("course", "course__teacher")
            .order_by("-created_at", "id")
        )

        req_status = request.query_params.get("status", "").strip()
        if req_status:
            if req_status not in EnrollmentRequest.Status.values:
                raise ValidationError({"status": ["Trạng thái yêu cầu không hợp lệ."]})
            queryset = queryset.filter(status=req_status)

        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = StudentEnrollmentRequestSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class CourseEnrollView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["courses"],
        summary="Gửi yêu cầu ghi danh môn học",
        description="Sinh viên gửi yêu cầu ghi danh vào môn học đang mở nhận đăng ký.",
        request=None,
        responses={
            status.HTTP_201_CREATED: StudentEnrollmentRequestSerializer,
        },
    )
    def post(self, request, course_id):
        req = request_enrollment(request.user, course_id)
        serializer = StudentEnrollmentRequestSerializer(req)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class CourseEnrollmentRequestCancelView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["courses"],
        summary="Hủy yêu cầu ghi danh",
        description="Sinh viên hủy yêu cầu ghi danh đang ở trạng thái pending của chính mình.",
        request=None,
        responses={
            status.HTTP_200_OK: StudentEnrollmentRequestSerializer,
        },
    )
    def post(self, request, request_id):
        req = cancel_enrollment_request(request.user, request_id)
        serializer = StudentEnrollmentRequestSerializer(req)
        return Response(serializer.data, status=status.HTTP_200_OK)


class TeacherCourseEnrollmentRequestsView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPageNumberPagination

    @extend_schema(
        tags=["courses"],
        summary="Danh sách yêu cầu ghi danh của môn học (Giảng viên)",
        description="Giảng viên phụ trách xem hàng đợi yêu cầu ghi danh của môn học.",
        parameters=[
            OpenApiParameter(
                "status",
                str,
                required=False,
                enum=["pending", "approved", "rejected", "cancelled"],
                description="Lọc theo trạng thái yêu cầu",
            ),
            OpenApiParameter("page", int, required=False, description="Số trang"),
            OpenApiParameter("page_size", int, required=False, description="Số lượng mỗi trang"),
        ],
        responses={
            status.HTTP_200_OK: TeacherEnrollmentRequestSerializer(many=True),
        },
    )
    def get(self, request, course_id):
        require_active_teacher(request.user)
        course = get_object_or_404(Course, pk=course_id)
        if course.teacher_id != request.user.id:
            raise PermissionDenied(
                "Chỉ giảng viên phụ trách môn học mới có quyền xem danh sách yêu cầu ghi danh."
            )

        queryset = (
            EnrollmentRequest.objects.filter(course=course)
            .select_related("student", "reviewed_by")
            .order_by("-created_at", "id")
        )

        req_status = request.query_params.get("status", "").strip()
        if req_status:
            if req_status not in EnrollmentRequest.Status.values:
                raise ValidationError({"status": ["Trạng thái yêu cầu không hợp lệ."]})
            queryset = queryset.filter(status=req_status)

        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(student__display_name__icontains=search) | Q(student__email__icontains=search)
            )

        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = TeacherEnrollmentRequestSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class TeacherEnrollmentRequestApproveView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["courses"],
        summary="Duyệt yêu cầu ghi danh",
        description="Giảng viên phụ trách duyệt yêu cầu ghi danh vào môn học.",
        request=None,
        responses={
            status.HTTP_200_OK: TeacherEnrollmentRequestSerializer,
        },
    )
    def post(self, request, request_id):
        req, _ = approve_enrollment_request(request.user, request_id)
        serializer = TeacherEnrollmentRequestSerializer(req)
        return Response(serializer.data, status=status.HTTP_200_OK)


class TeacherEnrollmentRequestRejectView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["courses"],
        summary="Từ chối yêu cầu ghi danh",
        description="Giảng viên phụ trách từ chối yêu cầu ghi danh vào môn học kèm lý do.",
        request=RejectEnrollmentRequestSerializer,
        responses={
            status.HTTP_200_OK: TeacherEnrollmentRequestSerializer,
        },
    )
    def post(self, request, request_id):
        serializer = RejectEnrollmentRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data.get("reason", "")
        req = reject_enrollment_request(request.user, request_id, reason=reason)
        out_serializer = TeacherEnrollmentRequestSerializer(req)
        return Response(out_serializer.data, status=status.HTTP_200_OK)


class CourseMembersView(APIView):
    permission_classes = [IsAuthenticated]
    pagination_class = StandardPageNumberPagination

    @extend_schema(
        tags=["courses"],
        summary="Danh sách thành viên môn học",
        description="Giảng viên phụ trách xem danh sách thành viên của môn học.",
        parameters=[
            OpenApiParameter(
                "status",
                str,
                required=False,
                enum=["active", "withdrawn"],
                description="Lọc theo trạng thái thành viên ('active' hoặc 'withdrawn')",
            ),
            OpenApiParameter("page", int, required=False, description="Số trang"),
            OpenApiParameter("page_size", int, required=False, description="Số lượng mỗi trang"),
        ],
        responses={
            status.HTTP_200_OK: CourseMemberSerializer(many=True),
        },
    )
    def get(self, request, course_id):
        require_active_teacher(request.user)
        course = get_object_or_404(Course, pk=course_id)
        if course.teacher_id != request.user.id:
            raise PermissionDenied(
                "Chỉ giảng viên phụ trách môn học mới có quyền xem danh sách thành viên."
            )

        queryset = (
            Membership.objects.filter(course=course)
            .select_related("student")
            .order_by("-added_at", "id")
        )

        member_status = request.query_params.get("status", "").strip()
        if member_status:
            if member_status not in Membership.Status.values:
                raise ValidationError({"status": ["Trạng thái thành viên không hợp lệ."]})
            queryset = queryset.filter(status=member_status)

        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(student__display_name__icontains=search) | Q(student__email__icontains=search)
            )

        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = CourseMemberSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    @extend_schema(
        tags=["courses"],
        summary="Thêm thành viên vào môn học",
        description="Giảng viên phụ trách thêm sinh viên vào môn học bằng email.",
        request=AddMemberSerializer,
        responses={
            status.HTTP_201_CREATED: CourseMemberSerializer,
        },
    )
    def post(self, request, course_id):
        serializer = AddMemberSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = add_course_member(
            request.user, course_id, serializer.validated_data["student_email"]
        )
        out_serializer = CourseMemberSerializer(membership)
        return Response(out_serializer.data, status=status.HTTP_201_CREATED)


class CourseMemberWithdrawView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["courses"],
        summary="Rút thành viên khỏi môn học",
        description="Sinh viên tự rút lui hoặc giảng viên phụ trách gỡ thành viên khỏi môn học.",
        request=None,
        responses={
            status.HTTP_200_OK: CourseMemberSerializer,
        },
    )
    def post(self, request, course_id, student_id):
        membership = withdraw_course_member(request.user, course_id, student_id)
        serializer = CourseMemberSerializer(membership)
        return Response(serializer.data, status=status.HTTP_200_OK)


class CourseMemberReEnrollView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        tags=["courses"],
        summary="Khôi phục thành viên môn học",
        description="Giảng viên phụ trách khôi phục thành viên đã rút lui.",
        request=None,
        responses={
            status.HTTP_200_OK: CourseMemberSerializer,
        },
    )
    def post(self, request, course_id, student_id):
        membership = re_enroll_course_member(request.user, course_id, student_id)
        serializer = CourseMemberSerializer(membership)
        return Response(serializer.data, status=status.HTTP_200_OK)
