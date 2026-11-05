from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from identity.models import Role
from identity.services.common import has_role
from platform_core.pagination import StandardPageNumberPagination

from .grading_api import GradeOutput
from .models import SubmissionGradeEntry, SubmissionRevision
from .serializers import PaginationMetaSerializer
from .services import _check_assignment_read_permission
from .views import AssignmentsBaseView


class GradeHistoryResult(serializers.Serializer):
    items = GradeOutput(many=True)
    pagination = PaginationMetaSerializer()


class SubmissionGradeHistoryView(AssignmentsBaseView):
    @extend_schema(
        parameters=[OpenApiParameter("page", int)],
        responses={200: GradeHistoryResult},
    )
    def get(self, request, id):
        submission = get_object_or_404(
            SubmissionRevision.objects.select_related("assignment"),
            pk=id,
        )

        actor, course, _ = _check_assignment_read_permission(
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

        entries = entries.order_by("-version")

        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(entries, request)

        return paginator.get_paginated_response(GradeOutput(page, many=True).data)
