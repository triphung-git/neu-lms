from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions
from rest_framework.response import Response

from .common import LearningBase, course_access, field, require_manager
from .models import AppealPolicy, GroupGrade, GroupGradeAppeal, GroupSubmission, LearningNotice


class GroupAppealsView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, course_id):
        course, manager = course_access(request.user, course_id)
        qs = GroupGradeAppeal.objects.filter(
            grade__submission__group__policy__assignment__course=course
        )
        if not manager:
            qs = qs.filter(student=request.user)
        items = []
        for a in qs.select_related(
            "grade__submission__group__policy__assignment", "student", "resolved_grade"
        ):
            latest = a.grade.submission.grades.order_by("-version").first()

            def score(g, student_id=a.student_id):
                return (
                    g.adjustments.get(str(student_id), {}).get("score", str(g.score)) if g else None
                )

            items.append(
                {
                    "id": a.pk,
                    "student": a.student.display_name,
                    "assignment": a.grade.submission.group.policy.assignment.title,
                    "group": a.grade.submission.group.name,
                    "reason": a.reason,
                    "response": a.response,
                    "status": a.status,
                    "score": score(a.grade),
                    "resolved_score": score(a.resolved_grade),
                    "current_version": latest.version,
                }
            )
        return Response({"items": items})

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request, course_id):
        course, manager = course_access(request.user, course_id, write=True)
        d = request.data
        action = field(d, "action", "title")
        if action == "create":
            grade = get_object_or_404(
                GroupGrade,
                pk=field(d, "grade_id", "int"),
                published=True,
                submission__group__policy__assignment__course=course,
            )
            if str(request.user.pk) not in grade.submission.member_ids or manager:
                raise exceptions.PermissionDenied()
            if not AppealPolicy.objects.filter(
                assignment=grade.submission.group.policy.assignment, deadline__gte=timezone.now()
            ).exists():
                raise exceptions.ValidationError("Ngoài hạn phúc khảo / Appeal window closed.")
            if (
                grade.submission.grades.filter(published=True).order_by("-version").first().pk
                != grade.pk
            ):
                raise exceptions.ValidationError("Điểm đã thay đổi / Reload grades.")
            if GroupGradeAppeal.objects.filter(grade=grade, student=request.user).exists():
                raise exceptions.ValidationError("Đã gửi / Already submitted.")
            GroupGradeAppeal.objects.create(
                grade=grade, student=request.user, reason=field(d, "reason")
            )
            LearningNotice.objects.create(
                user=course.teacher, course=course, text="Phúc khảo điểm nhóm / Group grade appeal"
            )
        elif action in ["review", "resolve"]:
            require_manager(manager)
            appeal = get_object_or_404(
                GroupGradeAppeal.objects.select_for_update(),
                pk=field(d, "id", "int"),
                grade__submission__group__policy__assignment__course=course,
            )
            if appeal.status == "resolved":
                raise exceptions.ValidationError("Đã giải quyết / Already resolved.")
            if action == "review":
                appeal.status = "reviewing"
            else:
                sub = GroupSubmission.objects.select_for_update().get(pk=appeal.grade.submission_id)
                latest = sub.grades.order_by("-version").first()
                if latest.version != field(d, "expected_version", "int"):
                    raise exceptions.ValidationError("Điểm đã thay đổi / Reload grades.")
                published = sub.grades.filter(published=True).order_by("-version").first()
                response = field(d, "response")
                if d.get("score") not in (None, ""):
                    score = field(d, "score", "score")
                    if score > sub.group.policy.assignment.total_score:
                        raise exceptions.ValidationError(
                            "Điểm vượt tối đa / Score exceeds maximum."
                        )
                    # Copy the last PUBLISHED version, never accidentally publish a pending draft.
                    adjustments = dict(published.adjustments)
                    adjustments[str(appeal.student_id)] = {"score": str(score), "reason": response}
                    published = GroupGrade.objects.create(
                        submission=sub,
                        version=latest.version + 1,
                        score=published.score,
                        feedback=published.feedback,
                        adjustments=adjustments,
                        published=True,
                        teacher=request.user,
                    )
                appeal.resolved_grade = published
                appeal.response = response
                appeal.status = "resolved"
                appeal.reviewed_by = request.user
                appeal.reviewed_at = timezone.now()
                LearningNotice.objects.create(
                    user=appeal.student,
                    course=course,
                    text="Phúc khảo nhóm đã giải quyết / Group appeal resolved",
                )
            appeal.save()
        else:
            raise exceptions.ValidationError("Unknown action")
        return Response({"ok": True})
