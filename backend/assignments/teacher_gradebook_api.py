from django.db.models import OuterRef, Q, Subquery
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers

from courses.models import Membership
from platform_core.pagination import StandardPageNumberPagination

from .gradebook_csv import gradebook_csv_response
from .grading_api import GradeOutput
from .models import (
    Assignment,
    AssignmentStatus,
    SubmissionGradeEntry,
    SubmissionRevision,
)
from .serializers import PaginationMetaSerializer
from .services import _check_teacher_assignment_permission
from .views import AssignmentsBaseView


class GradebookAssignment(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField()


class GradebookRow(serializers.Serializer):
    student_id = serializers.UUIDField()
    name = serializers.CharField()
    email = serializers.EmailField()
    revision_number = serializers.IntegerField(allow_null=True)
    latest_grade = GradeOutput(allow_null=True)
    published_grade = GradeOutput(allow_null=True)


class TeacherGradebookResult(serializers.Serializer):
    course_name = serializers.CharField()
    assignments = GradebookAssignment(many=True)
    assignment_id = serializers.UUIDField(allow_null=True)
    total_score = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
        allow_null=True,
    )
    items = GradebookRow(many=True)
    pagination = PaginationMetaSerializer()


class GradebookQuery(serializers.Serializer):
    download = serializers.ChoiceField(choices=["csv"], required=False)
    assignment_id = serializers.UUIDField(required=False)
    search = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=120,
    )


class TeacherGradebookView(AssignmentsBaseView):
    @extend_schema(
        parameters=[
            OpenApiParameter("assignment_id", str),
            OpenApiParameter("search", str, description="Một phần tên hoặc email sinh viên"),
            OpenApiParameter("page", int),
            OpenApiParameter("download", str, enum=["csv"]),
        ],
        responses={
            (200, "application/json"): TeacherGradebookResult,
            (200, "text/csv"): str,
        },
    )
    def get(self, request, course_id):
        _, course = _check_teacher_assignment_permission(
            course_id,
            request.user,
        )

        query = GradebookQuery(data=request.query_params)
        query.is_valid(raise_exception=True)

        assignments = Assignment.objects.filter(
            course=course,
            published_at__isnull=False,
            status__in=[
                AssignmentStatus.PUBLISHED,
                AssignmentStatus.CLOSED,
                AssignmentStatus.ARCHIVED,
            ],
        ).order_by("-published_at", "pk")

        selected_id = query.validated_data.get("assignment_id")

        if selected_id:
            selected = get_object_or_404(assignments, pk=selected_id)
        else:
            selected = assignments.first()

        members = (
            Membership.objects.filter(
                course=course,
                status=Membership.Status.ACTIVE,
            )
            .select_related("student")
            .order_by("student__display_name", "pk")
        )

        search = query.validated_data.get("search", "")
        if search:
            members = members.filter(
                Q(student__display_name__icontains=search) | Q(student__email__icontains=search)
            )

        if selected:
            submissions = SubmissionRevision.objects.filter(
                assignment=selected,
                student_id=OuterRef("student_id"),
            ).order_by("-number")

            grades = SubmissionGradeEntry.objects.filter(
                submission_id=OuterRef("submission_pk"),
            ).order_by("-version")

            members = members.annotate(
                submission_pk=Subquery(submissions.values("pk")[:1]),
                revision_number=Subquery(submissions.values("number")[:1]),
            ).annotate(
                latest_grade_pk=Subquery(grades.values("pk")[:1]),
                published_grade_pk=Subquery(
                    grades.filter(status=SubmissionGradeEntry.Status.PUBLISHED).values("pk")[:1]
                ),
            )
        else:
            members = members.none()

        paginator = StandardPageNumberPagination()
        export_csv = query.validated_data.get("download") == "csv"

        if export_csv:
            if selected is None:
                raise serializers.ValidationError(
                    {"assignment_id": "Chưa có bài tập để xuất điểm."}
                )
            page = list(members)
        else:
            page = paginator.paginate_queryset(members, request)

        grade_ids = {
            pk
            for member in page
            for pk in (
                member.latest_grade_pk,
                member.published_grade_pk,
            )
            if pk
        }

        grade_map = SubmissionGradeEntry.objects.in_bulk(grade_ids)

        rows = [
            {
                "student_id": member.student_id,
                "name": member.student.display_name,
                "email": member.student.email,
                "revision_number": member.revision_number,
                "latest_grade": grade_map.get(member.latest_grade_pk),
                "published_grade": grade_map.get(member.published_grade_pk),
            }
            for member in page
        ]

        if export_csv:
            return gradebook_csv_response(course, selected, rows)

        response = paginator.get_paginated_response(GradebookRow(rows, many=True).data)

        response.data.update(
            course_name=course.name,
            assignments=GradebookAssignment(
                assignments,
                many=True,
            ).data,
            assignment_id=str(selected.pk) if selected else None,
            total_score=str(selected.total_score) if selected else None,
        )

        return response
