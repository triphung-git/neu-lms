"""Read-only runtime configuration diagnostics for administrators.

Secret values are deliberately never returned to the browser. This endpoint only
reports whether the required configuration pieces are present; it does not make
network calls and must not be treated as a health check for external services.
"""

import os

from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from .admin_views import AdminBaseView


class AdminRuntimeSettingsSerializer(serializers.Serializer):
    ai_auto_index_enabled = serializers.BooleanField()
    ai_index_failed = serializers.IntegerField()
    ai_index_ready = serializers.IntegerField()
    notification_email_enabled = serializers.BooleanField()
    notification_email_failed = serializers.IntegerField()
    notification_email_pending = serializers.IntegerField()

    ai_chat_configured = serializers.BooleanField()
    ai_chat_model = serializers.CharField(allow_blank=True)
    ai_embedding_configured = serializers.BooleanField()
    ai_embedding_model = serializers.CharField(allow_blank=True)
    email_backend = serializers.CharField()
    email_host_configured = serializers.BooleanField()
    email_auth_configured = serializers.BooleanField()
    email_sender_configured = serializers.BooleanField()
    file_storage_backend = serializers.CharField()
    s3_storage_configured = serializers.BooleanField()
    clamav_configured = serializers.BooleanField()
    celery_broker_configured = serializers.BooleanField()


class AdminRuntimeSettingsView(AdminBaseView):
    """Expose non-secret configuration flags so the admin UI cannot fake settings."""

    @extend_schema(
        operation_id="admin_runtime_settings_retrieve",
        responses={200: AdminRuntimeSettingsSerializer},
        tags=["admin"],
    )
    def get(self, request):
        ai_key_present = bool(getattr(settings, "AI_API_KEY", "").strip())
        ai_chat_model = getattr(settings, "AI_CHAT_MODEL", "").strip()
        ai_embedding_model = getattr(settings, "AI_EMBEDDING_MODEL", "").strip()

        storage_backend = getattr(settings, "FILES_STORAGE_BACKEND", "local").strip().lower()
        s3_storage_configured = all(
            bool(value)
            for value in (
                getattr(settings, "FILES_S3_BUCKET", ""),
                getattr(settings, "FILES_S3_ENDPOINT", ""),
                os.environ.get("AWS_ACCESS_KEY_ID", ""),
                os.environ.get("AWS_SECRET_ACCESS_KEY", ""),
            )
        )

        from ai_assistant.models import EmbeddingIndexState
        from platform_core.models import NotificationEmailDelivery

        data = {
            "ai_auto_index_enabled": settings.AI_AUTO_INDEX_ENABLED,
            "ai_index_failed": EmbeddingIndexState.objects.filter(status="failed").count(),
            "ai_index_ready": EmbeddingIndexState.objects.filter(status="ready").count(),
            "notification_email_enabled": settings.NOTIFICATION_EMAIL_ENABLED,
            "notification_email_failed": NotificationEmailDelivery.objects.filter(
                status="failed"
            ).count(),
            "notification_email_pending": NotificationEmailDelivery.objects.filter(
                status__in=["pending", "processing"]
            ).count(),
            "ai_chat_configured": ai_key_present and bool(ai_chat_model),
            "ai_chat_model": ai_chat_model,
            "ai_embedding_configured": ai_key_present and bool(ai_embedding_model),
            "ai_embedding_model": ai_embedding_model,
            "email_backend": str(getattr(settings, "EMAIL_BACKEND", "")),
            "email_host_configured": bool(getattr(settings, "EMAIL_HOST", "")),
            "email_auth_configured": bool(
                getattr(settings, "EMAIL_HOST_USER", "")
                and getattr(settings, "EMAIL_HOST_PASSWORD", "")
            ),
            "email_sender_configured": bool(getattr(settings, "DEFAULT_FROM_EMAIL", "")),
            "file_storage_backend": storage_backend,
            "s3_storage_configured": s3_storage_configured,
            "clamav_configured": bool(
                getattr(settings, "CLAMAV_HOST", "") and getattr(settings, "CLAMAV_PORT", 0)
            ),
            "celery_broker_configured": bool(
                os.environ.get("CELERY_BROKER_URL", "") or os.environ.get("REDIS_URL", "")
            ),
        }
        serializer = AdminRuntimeSettingsSerializer(data)
        return Response(serializer.data)
