from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q
from django.db.models.deletion import ProtectedError
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.admin_views import AdminBaseView
from identity.models import Role
from identity.services.common import has_role

from .models import Chapter, Course, Lesson, Membership
from .serializers import (
    ChapterSerializer,
    CourseSerializer,
    CourseTransferSerializer,
    LessonSerializer,
    ReorderSerializer,
)
from .services import (
    archive_course,
    reorder_chapters,
    reorder_lessons,
    require_active_teacher,
    require_course_manager,
    transfer_course,
)


def visible_course_queryset(user):
    queryset = Course.objects.select_related("teacher").annotate(
        active_member_count=Count(
            "memberships",
            filter=Q(memberships__status=Membership.Status.ACTIVE),
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
    http_method_names = ["get", "post", "put", "patch", "delete", "head", "options"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Course.objects.none()

        queryset = visible_course_queryset(self.request.user).order_by("-created_at", "id")
        params = self.request.query_params

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
