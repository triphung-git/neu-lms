from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from files.constants import (
    DEFAULT_ALLOWED_EXTENSIONS,
    DEFAULT_COURSE_QUOTA_BYTES,
    DEFAULT_MAX_FILE_SIZE_BYTES,
    SYSTEM_MAX_COURSE_QUOTA_BYTES,
    SYSTEM_MAX_FILE_SIZE_BYTES,
)

from .admin_views import AdminBaseView


class AdminFileLimits(serializers.Serializer):
    max_file_bytes = serializers.IntegerField()
    max_course_quota_bytes = serializers.IntegerField()
    default_file_bytes = serializers.IntegerField()
    default_course_quota_bytes = serializers.IntegerField()
    default_extensions = serializers.ListField(child=serializers.CharField())


class AdminFileLimitsView(AdminBaseView):
    @extend_schema(responses={200: AdminFileLimits})
    def get(self, request):
        return Response(
            {
                "max_file_bytes": SYSTEM_MAX_FILE_SIZE_BYTES,
                "max_course_quota_bytes": SYSTEM_MAX_COURSE_QUOTA_BYTES,
                "default_file_bytes": DEFAULT_MAX_FILE_SIZE_BYTES,
                "default_course_quota_bytes": DEFAULT_COURSE_QUOTA_BYTES,
                "default_extensions": list(DEFAULT_ALLOWED_EXTENSIONS),
            }
        )
