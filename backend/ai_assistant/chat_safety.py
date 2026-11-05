"""Authorization and grounding shared by live answers and saved conversations."""

import re

from django.shortcuts import get_object_or_404
from rest_framework import exceptions

from courses.models import Course, Membership
from files.models import CourseFilePolicy
from identity.models import Role, User
from identity.services.common import has_role, require_verified

ABSTENTION = (
    "Mình chưa tìm thấy đủ bằng chứng trong học liệu để trả lời câu hỏi này. "
    "Bạn hãy hỏi cụ thể hơn hoặc trao đổi với giảng viên."
)
CITATION = re.compile(r"\[S([1-9]\d*)\]")


def require_chat_access(user, course_id):
    if not user.is_authenticated or not user.is_active:
        raise exceptions.PermissionDenied("Tài khoản không được phép sử dụng trợ lý AI.")
    user = get_object_or_404(User, pk=user.pk)
    if not user.is_active:
        raise exceptions.PermissionDenied("Tài khoản đã bị vô hiệu hóa.")
    require_verified(user)
    course = get_object_or_404(Course, pk=course_id)
    teacher = has_role(user, Role.TEACHER) and course.teacher_id == user.id
    student = (
        has_role(user, Role.STUDENT)
        and Membership.objects.filter(
            course=course, student=user, status=Membership.Status.ACTIVE
        ).exists()
    )
    if not (teacher or student):
        raise exceptions.PermissionDenied("Bạn không có quyền truy cập học phần này.")
    if (
        not teacher
        and CourseFilePolicy.objects.filter(course=course, preview_allowed=False).exists()
    ):
        raise exceptions.PermissionDenied(
            "Học phần đã tắt xem nội dung trực tuyến; trợ lý AI tạm không khả dụng."
        )
    return course


def grounded_answer(raw_answer, chunks):
    """Fail closed on missing/unknown references. This is not semantic verification."""
    answer = raw_answer.strip()
    if answer.startswith("NO_SUPPORT:"):
        return ABSTENTION, []
    referenced = {f"S{x}" for x in CITATION.findall(answer)}
    sources = {chunk.citation_id: chunk.to_source_dict() for chunk in chunks}
    # Reject malformed/unbracketed source identifiers as well as unknown citations.
    identifiers = set(re.findall(r"\bS\d+\b", answer))
    if not referenced or not referenced.issubset(sources) or identifiers != referenced:
        return ABSTENTION, []
    return answer, [source for key, source in sources.items() if key in referenced]
