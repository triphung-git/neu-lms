from django.db.models import OuterRef, Subquery
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from courses.models import Membership
from identity.models import Role, User
from identity.services.common import has_role, require_verified
from platform_core.pagination import StandardPageNumberPagination

from .grading_api import GradeOutput
from .models import (
    Assignment,
    AssignmentStatus,
    SubmissionGradeEntry,
    SubmissionRevision,
)
from .serializers import PaginationMetaSerializer
from .views import AssignmentsBaseView


class StudentGradeRow(serializers.Serializer):
    assignment_id = serializers.UUIDField()
    title = serializers.CharField()
    course_id = serializers.UUIDField()
    course_name = serializers.CharField()
    course_code = serializers.CharField()
    revision_number = serializers.IntegerField(allow_null=True)
    total_score = serializers.DecimalField(
        max_digits=10,
        decimal_places=2,
    )
    grade = GradeOutput(allow_null=True)


class StudentGradeList(serializers.Serializer):
    items = StudentGradeRow(many=True)
    pagination = PaginationMetaSerializer()


class StudentGradeQuery(serializers.Serializer):
    course_id = serializers.UUIDField(required=False)


class StudentGradesView(AssignmentsBaseView):
    @extend_schema(
        parameters=[
            OpenApiParameter("page", int),
            OpenApiParameter("course_id", str),
        ],
        responses={200: StudentGradeList},
    )
    def get(self, request):
        if not request.user.is_authenticated:
            raise PermissionDenied("Yêu cầu đăng nhập.")

        actor = User.objects.filter(
            pk=request.user.pk,
            is_active=True,
        ).first()

        if actor is None:
            raise PermissionDenied("Tài khoản không hoạt động.")

        require_verified(actor)

        if not has_role(actor, Role.STUDENT):
            raise PermissionDenied("Chức năng dành cho sinh viên.")

        query = StudentGradeQuery(data=request.query_params)
        query.is_valid(raise_exception=True)

        course_ids = Membership.objects.filter(
            student=actor,
            status=Membership.Status.ACTIVE,
        ).values("course_id")

        latest_submission = SubmissionRevision.objects.filter(
            assignment_id=OuterRef("pk"),
            student=actor,
        ).order_by("-number")

        published_grade = SubmissionGradeEntry.objects.filter(
            submission_id=OuterRef("latest_submission_id"),
            status=SubmissionGradeEntry.Status.PUBLISHED,
        ).order_by("-version")

        assignments = (
            Assignment.objects.filter(
                course_id__in=course_ids,
                published_at__isnull=False,
                status__in=[
                    AssignmentStatus.PUBLISHED,
                    AssignmentStatus.CLOSED,
                    AssignmentStatus.ARCHIVED,
                ],
            )
            .annotate(
                latest_submission_id=Subquery(latest_submission.values("pk")[:1]),
                revision_number=Subquery(latest_submission.values("number")[:1]),
            )
            .annotate(published_grade_id=Subquery(published_grade.values("pk")[:1]))
            .select_related("course")
            .prefetch_related("rubric_criteria")
            .order_by("course__code", "-published_at", "pk")
        )

        if "course_id" in query.validated_data:
            assignments = assignments.filter(
                course_id=query.validated_data["course_id"],
            )

        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(assignments, request)

        grades = SubmissionGradeEntry.objects.in_bulk(
            [item.published_grade_id for item in page if item.published_grade_id]
        )

        rows = [
            {
                "assignment_id": item.pk,
                "title": item.title,
                "course_id": item.course_id,
                "course_name": item.course.name,
                "course_code": item.course.code,
                "revision_number": item.revision_number,
                "total_score": item.total_score,
                "grade": grades.get(item.published_grade_id),
            }
            for item in page
        ]

        return paginator.get_paginated_response(StudentGradeRow(rows, many=True).data)
