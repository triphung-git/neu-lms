from django.db import transaction
from django.db.models import OuterRef, Subquery
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions
from rest_framework.response import Response

from assignments.models import Assignment, SubmissionGradeEntry, SubmissionRevision

from .common import LearningBase, course_access, field, require_manager
from .models import AppealPolicy, GradeAppeal, LearningNotice


class AppealsView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, course_id):
        course, manager = course_access(request.user, course_id)
        qs = GradeAppeal.objects.filter(grade__submission__assignment__course=course)
        grades = SubmissionGradeEntry.objects.filter(
            submission__assignment__course=course, status="published"
        )
        grades = grades.filter(
            pk=Subquery(
                SubmissionGradeEntry.objects.filter(
                    submission_id=OuterRef("submission_id"), status="published"
                )
                .order_by("-version")
                .values("pk")[:1]
            )
        )
        if not manager:
            qs = qs.filter(grade__submission__student=request.user)
            grades = grades.filter(submission__student=request.user)
        qs = qs.annotate(
            current_version=Subquery(
                SubmissionGradeEntry.objects.filter(submission_id=OuterRef("grade__submission_id"))
                .order_by("-version")
                .values("version")[:1]
            )
        )
        return Response(
            {
                "items": list(
                    qs.values(
                        "id",
                        "grade_id",
                        "current_version",
                        "reason",
                        "status",
                        "response",
                        "created_at",
                        "reviewed_at",
                        "grade__score",
                        "resolved_grade__score",
                        "grade__submission__student__display_name",
                        "grade__submission__assignment__title",
                    )
                ),
                "grades": list(
                    grades.values(
                        "id",
                        "score",
                        "submission__assignment__title",
                        "submission__assignment_id",
                        "submission__student__display_name",
                    )
                ),
                "policies": list(
                    AppealPolicy.objects.filter(assignment__course=course).values(
                        "assignment_id", "deadline"
                    )
                ),
            }
        )

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request, course_id):
        course, manager = course_access(request.user, course_id, write=True)
        d = request.data
        action = field(d, "action", "title")
        if action == "policy":
            require_manager(manager)
            assignment = get_object_or_404(
                Assignment, course=course, pk=field(d, "assignment_id", "uuid")
            )
            deadline = field(d, "deadline", "time")
            if deadline <= timezone.now():
                raise exceptions.ValidationError(
                    "Hạn phải ở tương lai / Deadline must be in the future."
                )
            AppealPolicy.objects.update_or_create(
                assignment=assignment, defaults={"deadline": deadline}
            )
        elif action == "create":
            grade = get_object_or_404(
                SubmissionGradeEntry,
                pk=field(d, "grade_id", "int"),
                submission__assignment__course=course,
                submission__student=request.user,
                status="published",
            )
            if not AppealPolicy.objects.filter(
                assignment=grade.submission.assignment, deadline__gte=timezone.now()
            ).exists():
                raise exceptions.ValidationError("Ngoài hạn phúc khảo / Appeal window closed.")
            latest = (
                grade.submission.grade_entries.filter(status="published")
                .order_by("-version")
                .first()
            )
            if latest.pk != grade.pk:
                raise exceptions.ValidationError("Điểm đã thay đổi / Grade changed. Reload.")
            if GradeAppeal.objects.filter(grade=grade).exists():
                raise exceptions.ValidationError("Đã gửi yêu cầu / Appeal already submitted.")
            GradeAppeal.objects.create(grade=grade, reason=field(d, "reason"))
            LearningNotice.objects.create(
                user=course.teacher, course=course, text="Có yêu cầu phúc khảo / New grade appeal"
            )
        elif action in ["review", "resolve"]:
            require_manager(manager)
            appeal = get_object_or_404(
                GradeAppeal.objects.select_for_update(),
                pk=field(d, "id", "int"),
                grade__submission__assignment__course=course,
            )
            if appeal.status == "resolved":
                raise exceptions.ValidationError("Đã giải quyết / Already resolved.")
            appeal.status = "reviewing" if action == "review" else "resolved"
            if action == "resolve":
                feedback = field(d, "response")
                submission = SubmissionRevision.objects.select_for_update().get(
                    pk=appeal.grade.submission_id
                )
                latest = submission.grade_entries.order_by("-version").first()
                expected = field(d, "expected_version", "int")
                if latest.version != expected:
                    raise exceptions.ValidationError("Điểm đã thay đổi / Grade changed. Reload.")
                if d.get("score") not in (None, ""):
                    score = field(d, "score", "score")
                    if score > submission.assignment.total_score:
                        raise exceptions.ValidationError(
                            "Điểm vượt tối đa / Score exceeds maximum."
                        )
                    appeal.resolved_grade = SubmissionGradeEntry.objects.create(
                        submission=submission,
                        version=latest.version + 1,
                        score=score,
                        feedback=feedback,
                        rubric_breakdown=[],
                        status="published",
                        graded_by=request.user,
                    )
                else:
                    appeal.resolved_grade = (
                        submission.grade_entries.filter(status="published")
                        .order_by("-version")
                        .first()
                    )
                appeal.response = feedback
                appeal.reviewed_at = timezone.now()
                appeal.reviewed_by = request.user
                LearningNotice.objects.create(
                    user=submission.student,
                    course=course,
                    text="Phúc khảo đã giải quyết / Appeal resolved",
                )
            appeal.save()
        else:
            raise exceptions.ValidationError("Unknown action")
        return Response({"ok": True})
