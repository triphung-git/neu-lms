import logging

from django.db import DatabaseError, connection
from drf_spectacular.utils import OpenApiResponse, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


class HealthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    http_method_names = ["get", "head", "options"]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response


class LivenessView(HealthView):
    @extend_schema(
        operation_id="get_health_live",
        summary="Kiểm tra trạng thái hoạt động (Liveness)",
        description="Trả về 200 khi container API đang chạy, không kiểm tra phụ thuộc bên ngoài.",
        responses={
            200: OpenApiResponse(
                response=inline_serializer(
                    name="LivenessResponse",
                    fields={"status": serializers.CharField(default="ok")},
                ),
                description="API container đang hoạt động.",
            )
        },
    )
    def get(self, request):
        return Response({"status": "ok"})


class ReadinessView(HealthView):
    @extend_schema(
        operation_id="get_health_ready",
        summary="Kiểm tra trạng thái sẵn sàng (Readiness)",
        description=(
            "Kiểm tra kết nối cơ sở dữ liệu PostgreSQL. "
            "Trả về 200 nếu sẵn sàng, 503 nếu DB gián đoạn."
        ),
        responses={
            200: OpenApiResponse(
                response=inline_serializer(
                    name="ReadinessSuccessResponse",
                    fields={
                        "status": serializers.CharField(default="ok"),
                        "checks": serializers.DictField(child=serializers.CharField()),
                    },
                ),
                description="Hệ thống sẵn sàng phục vụ yêu cầu.",
            ),
            503: OpenApiResponse(
                response=inline_serializer(
                    name="ReadinessUnavailableResponse",
                    fields={
                        "status": serializers.CharField(default="unavailable"),
                        "checks": serializers.DictField(child=serializers.CharField()),
                    },
                ),
                description="Cơ sở dữ liệu không khả dụng.",
            ),
        },
    )
    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except DatabaseError:
            # Database exception text can include hosts, credentials and SQL.
            logger.warning("Readiness check: database unavailable")
            return Response(
                {"status": "unavailable", "checks": {"database": "unavailable"}},
                status=503,
            )
        return Response({"status": "ok", "checks": {"database": "ok"}})
