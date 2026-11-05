from django.db import transaction
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from identity.models import Role
from identity.services.common import has_role

from .exceptions import AssignmentConflictError
from .models import Assignment, SubmissionGradeEntry, SubmissionRevision
from .rubric_grading import CriterionScoreInput, CriterionScoreOutput, resolve_grade
from .services import (
    _check_assignment_read_permission,
    _check_teacher_assignment_permission,
)
from .views import AssignmentsBaseView


class GradeInput(serializers.Serializer):
    score = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        min_value=0,
        required=False,
    )
    rubric_scores = CriterionScoreInput(
        many=True,
        required=False,
        allow_empty=False,
    )
    feedback = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=10000,
    )
    status = serializers.ChoiceField(
        choices=SubmissionGradeEntry.Status.choices,
    )
    expected_version = serializers.IntegerField(min_value=0)

    def validate(self, attrs):
        has_total = "score" in attrs
        has_rubric = "rubric_scores" in attrs

        if has_total == has_rubric:
            raise serializers.ValidationError(
                "Gửi điểm tổng hoặc điểm theo rubric, chỉ chọn một cách."
            )
        return attrs


class GradeOutput(serializers.ModelSerializer):
    rubric_breakdown = CriterionScoreOutput(many=True, read_only=True)

    class Meta:
        model = SubmissionGradeEntry
        fields = [
            "version",
            "score",
            "feedback",
            "status",
            "created_at",
            "rubric_breakdown",
        ]


class GradeCriterion(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField()
    max_score = serializers.DecimalField(max_digits=5, decimal_places=2)


class GradeDetail(serializers.Serializer):
    total_score = serializers.DecimalField(max_digits=10, decimal_places=2)
    rubric = GradeCriterion(many=True)
    grade = GradeOutput(allow_null=True)


class SubmissionGradeView(AssignmentsBaseView):
    @extend_schema(responses={200: GradeDetail})
    def get(self, request, id):
        submission = get_object_or_404(
            SubmissionRevision.objects.select_related("assignment"),
            pk=id,
        )

        actor, course, assignment = _check_assignment_read_permission(
            submission.assignment.course_id,
            submission.assignment_id,
            request.user,
        )

        is_teacher = course.teacher_id == actor.id and has_role(actor, Role.TEACHER)

        entries = submission.grade_entries.all()

        if not is_teacher:
            if submission.student_id != actor.id:
                raise PermissionDenied("Không được xem điểm của sinh viên khác.")

            entries = entries.filter(
                status=SubmissionGradeEntry.Status.PUBLISHED,
            )

        latest = entries.order_by("-version").first()

        return Response(
            GradeDetail(
                {
                    "total_score": assignment.total_score,
                    "rubric": assignment.rubric_criteria.all(),
                    "grade": latest,
                }
            ).data
        )

    @extend_schema(request=GradeInput, responses={201: GradeOutput})
    @transaction.atomic
    def post(self, request, id):
        data = GradeInput(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data

        submission = get_object_or_404(
            SubmissionRevision.objects.select_related("assignment"),
            pk=id,
        )

        actor, _ = _check_teacher_assignment_permission(
            submission.assignment.course_id,
            request.user,
            for_update=True,
        )

        assignment = get_object_or_404(
            Assignment.objects.select_for_update(),
            pk=submission.assignment_id,
        )
        submission = get_object_or_404(
            SubmissionRevision.objects.select_for_update(),
            pk=id,
        )

        latest = submission.grade_entries.order_by("-version").first()
        version = latest.version if latest else 0

        if values["expected_version"] != version:
            raise AssignmentConflictError("Điểm đã thay đổi. Hãy tải lại trước khi lưu.")

        score, breakdown = resolve_grade(assignment, values)

        grade = SubmissionGradeEntry.objects.create(
            submission=submission,
            version=version + 1,
            score=score,
            rubric_breakdown=breakdown,
            feedback=values.get("feedback", ""),
            status=values["status"],
            graded_by=actor,
        )

        return Response(GradeOutput(grade).data, status=201)
