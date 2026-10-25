from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from identity.models import Role, User
from identity.services.common import has_role, require_verified
from platform_core.errors import DomainError

from .models import Chapter, Course, Lesson


@transaction.atomic
def archive_course(user, course_id):
    course = Course.objects.select_for_update().get(pk=course_id)
    if not (has_role(user, Role.ADMIN) or teacher_can_manage_course(user, course)):
        raise PermissionDenied("Bạn không có quyền lưu trữ môn học này.")
    if course.status == Course.Status.ARCHIVED:
        return course

    course.status = Course.Status.ARCHIVED
    course.enrollment_open = False
    course.archived_at = timezone.now()
    course.save(update_fields=["status", "enrollment_open", "archived_at", "updated_at"])
    return course


@transaction.atomic
def transfer_course(course_id, teacher_id):
    course = Course.objects.select_for_update().get(pk=course_id)
    if course.status == Course.Status.ARCHIVED:
        raise ValidationError("Không thể chuyển giảng viên cho môn học đã lưu trữ.")

    try:
        teacher = User.objects.get(pk=teacher_id, is_active=True)
    except User.DoesNotExist as exc:
        raise ValidationError(
            {"teacher_id": ["Không tìm thấy giảng viên đang hoạt động."]}
        ) from exc

    if not has_role(teacher, Role.TEACHER):
        raise ValidationError({"teacher_id": ["Tài khoản chưa được cấp vai trò giảng viên."]})

    try:
        require_verified(teacher)
    except DomainError as exc:
        if exc.code != "EMAIL_NOT_VERIFIED":
            raise
        raise ValidationError({"teacher_id": ["Email giảng viên chưa được xác minh."]}) from exc

    course.teacher = teacher
    course.save(update_fields=["teacher", "updated_at"])
    return course


@transaction.atomic
def reorder_chapters(user, course_id, chapter_ids):
    course = Course.objects.select_for_update().get(pk=course_id)
    require_course_manager(user, course)

    chapters = list(Chapter.objects.filter(course=course).order_by("position", "id"))
    by_id = {chapter.id: chapter for chapter in chapters}
    if set(chapter_ids) != set(by_id) or len(chapter_ids) != len(by_id):
        raise ValidationError({"ids": ["Phải cung cấp đúng danh sách chương của môn học."]})

    for position, chapter_id in enumerate(chapter_ids, start=1):
        by_id[chapter_id].position = position
    Chapter.objects.bulk_update(chapters, ["position"])
    return list(Chapter.objects.filter(course=course).order_by("position", "id"))


@transaction.atomic
def reorder_lessons(user, chapter_id, lesson_ids):
    chapter = Chapter.objects.select_related("course").get(pk=chapter_id)
    course = Course.objects.select_for_update().get(pk=chapter.course_id)
    require_course_manager(user, course)

    lessons = list(Lesson.objects.filter(chapter=chapter).order_by("position", "id"))
    by_id = {lesson.id: lesson for lesson in lessons}
    if set(lesson_ids) != set(by_id) or len(lesson_ids) != len(by_id):
        raise ValidationError({"ids": ["Phải cung cấp đúng danh sách bài học của chương."]})

    for position, lesson_id in enumerate(lesson_ids, start=1):
        by_id[lesson_id].position = position
    Lesson.objects.bulk_update(lessons, ["position"])
    return list(Lesson.objects.filter(chapter=chapter).order_by("position", "id"))


def teacher_can_manage_course(user, course):
    return has_role(user, Role.TEACHER) and course.teacher_id == user.id


def require_course_manager(user, course):
    if not teacher_can_manage_course(user, course):
        raise PermissionDenied("Bạn không có quyền quản lý môn học này.")
    if course.status == Course.Status.ARCHIVED:
        raise PermissionDenied("Môn học đã lưu trữ và chỉ được xem.")


def require_active_teacher(user):
    if not user or not user.is_active or not has_role(user, Role.TEACHER):
        raise PermissionDenied("Bạn cần vai trò giảng viên đang hoạt động.")
    try:
        require_verified(user)
    except DomainError as exc:
        if exc.code != "EMAIL_NOT_VERIFIED":
            raise
        raise PermissionDenied("Email giảng viên cần được xác minh.") from exc
