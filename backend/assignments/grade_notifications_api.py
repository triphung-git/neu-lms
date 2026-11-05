from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from courses.models import Membership
from identity.models import Role
from identity.services.common import has_role, require_verified
from platform_core.pagination import StandardPageNumberPagination

from .models import AssignmentStatus, SubmissionGradeEntry
from .serializers import PaginationMetaSerializer
from .views import AssignmentsBaseView


class GradeNotice(serializers.Serializer):
    id = serializers.IntegerField()
    read_at = serializers.DateTimeField(
        source="notice_read_at",
        allow_null=True,
        read_only=True,
    )
    course_id = serializers.UUIDField(source="submission.assignment.course_id")
    course_name = serializers.CharField(source="submission.assignment.course.name")
    assignment_id = serializers.UUIDField(source="submission.assignment_id")
    title = serializers.CharField(source="submission.assignment.title")
    revision = serializers.IntegerField(source="submission.number")
    score = serializers.DecimalField(max_digits=10, decimal_places=2)
    published_at = serializers.DateTimeField(source="created_at")


class GradeNoticeList(serializers.Serializer):
    items = GradeNotice(many=True)
    pagination = PaginationMetaSerializer()


class UnreadGradeCount(serializers.Serializer):
    unread_count = serializers.IntegerField()


def visible_notices(actor):
    if not actor.is_active or not has_role(actor, Role.STUDENT):
        raise PermissionDenied("Chức năng dành cho sinh viên đang hoạt động.")

    require_verified(actor)

    courses = Membership.objects.filter(
        student=actor,
        status=Membership.Status.ACTIVE,
    ).values("course_id")

    return (
        SubmissionGradeEntry.objects.filter(
            status=SubmissionGradeEntry.Status.PUBLISHED,
            submission__student=actor,
            submission__assignment__course_id__in=courses,
            submission__assignment__published_at__isnull=False,
            submission__assignment__status__in=[
                AssignmentStatus.PUBLISHED,
                AssignmentStatus.CLOSED,
                AssignmentStatus.ARCHIVED,
            ],
        )
        .select_related("submission__assignment__course")
        .order_by("-created_at", "-pk")
    )


class GradeNoticeView(AssignmentsBaseView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[OpenApiParameter("page", int)],
        responses={200: GradeNoticeList},
    )
    def get(self, request):
        entries = visible_notices(request.user)
        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(entries, request)
        return paginator.get_paginated_response(GradeNotice(page, many=True).data)


class GradeUnreadView(AssignmentsBaseView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: UnreadGradeCount})
    def get(self, request):
        count = (
            visible_notices(request.user)
            .filter(
                notice_read_at__isnull=True,
            )
            .count()
        )
        return Response({"unread_count": count})


class GradeNoticeReadView(AssignmentsBaseView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={204: None})
    def post(self, request, id):
        visible = visible_notices(request.user)
        get_object_or_404(visible.select_related(None).only("pk"), pk=id)

        visible.filter(
            pk=id,
            notice_read_at__isnull=True,
        ).update(notice_read_at=timezone.now())

        return Response(status=204)


class GradeReadAllResult(serializers.Serializer):
    updated_count = serializers.IntegerField()


class GradeNoticeReadAllView(AssignmentsBaseView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses={200: GradeReadAllResult})
    def post(self, request):
        updated = (
            visible_notices(request.user)
            .filter(
                notice_read_at__isnull=True,
            )
            .update(notice_read_at=timezone.now())
        )

        return Response({"updated_count": updated})
