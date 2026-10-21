import logging

from django.db import DatabaseError, connection
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
    def get(self, request):
        return Response({"status": "ok"})


class ReadinessView(HealthView):
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
