from django.db.models import F, Q
from django.db.models.functions import Coalesce
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from platform_core.models import AuditEvent
from platform_core.pagination import StandardPageNumberPagination

from .admin_views import AdminBaseView


class AdminRecentEvent(serializers.Serializer):
    id = serializers.UUIDField()
    occurred_at = serializers.DateTimeField()
    actor_name = serializers.CharField()
    action = serializers.CharField()
    resource_type = serializers.CharField()


def ordered_events():
    return AuditEvent.objects.annotate(
        actor_name=Coalesce(
            F("actor__display_name"),
            F("system_actor"),
        ),
    ).order_by("-occurred_at", "-id")


class AdminRecentActivityView(AdminBaseView):
    @extend_schema(responses={200: AdminRecentEvent(many=True)})
    def get(self, request):
        return Response(AdminRecentEvent(ordered_events()[:6], many=True).data)


class AuditRow(AdminRecentEvent):
    resource_id = serializers.UUIDField()
    correlation_id = serializers.UUIDField()


class AuditQuery(serializers.Serializer):
    search = serializers.CharField(
        required=False,
        max_length=120,
        allow_blank=True,
    )
    start = serializers.DateField(required=False)
    end = serializers.DateField(required=False)

    def validate(self, attrs):
        if "start" in attrs and "end" in attrs and attrs["start"] > attrs["end"]:
            raise serializers.ValidationError("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.")
        return attrs


class AuditListResult(serializers.Serializer):
    items = AuditRow(many=True)
    pagination = serializers.DictField()


class AdminAuditListView(AdminBaseView):
    @extend_schema(
        parameters=[AuditQuery, OpenApiParameter("page", int)],
        responses={200: AuditListResult},
    )
    def get(self, request):
        query = AuditQuery(data=request.query_params)
        query.is_valid(raise_exception=True)
        filters = query.validated_data

        events = ordered_events()
        term = filters.get("search")

        if term:
            events = events.filter(
                Q(actor_name__icontains=term)
                | Q(action__icontains=term)
                | Q(resource_type__icontains=term)
            )

        if "start" in filters:
            events = events.filter(occurred_at__date__gte=filters["start"])

        if "end" in filters:
            events = events.filter(occurred_at__date__lte=filters["end"])

        pager = StandardPageNumberPagination()
        page = pager.paginate_queryset(events, request)
        return pager.get_paginated_response(AuditRow(page, many=True).data)
