from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from identity.models import Role
from identity.services.common import has_role
from platform_core.pagination import StandardPageNumberPagination

from .models import SubmissionRevision
from .serializers import LatestSubmissionSerializer, PaginationMetaSerializer
from .services import _check_assignment_read_permission
from .views import AssignmentsBaseView


class SubmissionHistoryRow(LatestSubmissionSerializer):
    file_id = serializers.UUIDField()


class SubmissionHistoryResult(serializers.Serializer):
    items = SubmissionHistoryRow(many=True)
    pagination = PaginationMetaSerializer()


class SubmissionHistoryQuery(serializers.Serializer):
    student_id = serializers.UUIDField(required=False)


class SubmissionHistoryView(AssignmentsBaseView):
    @extend_schema(
        parameters=[
            OpenApiParameter("student_id", str),
            OpenApiParameter("page", int),
        ],
        responses={200: SubmissionHistoryResult},
    )
    def get(self, request, course_id, id):
        actor, course, assignment = _check_assignment_read_permission(course_id, id, request.user)

        query = SubmissionHistoryQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        student_id = query.validated_data.get("student_id")

        is_teacher = course.teacher_id == actor.id and has_role(actor, Role.TEACHER)

        if is_teacher:
            if student_id is None:
                raise serializers.ValidationError({"student_id": "Cần chọn sinh viên."})
        else:
            if student_id is not None and student_id != actor.pk:
                raise PermissionDenied("Không được xem bài nộp của sinh viên khác.")
            student_id = actor.pk

        revisions = (
            SubmissionRevision.objects.filter(
                assignment=assignment,
                student_id=student_id,
            )
            .select_related("file")
            .order_by("-number")
        )

        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(revisions, request)
        return paginator.get_paginated_response(SubmissionHistoryRow(page, many=True).data)
