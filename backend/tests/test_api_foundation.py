import uuid
from datetime import timedelta

import pytest
from django.conf import settings
from django.db import transaction
from django.urls import path
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import Throttled
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from health.views import LivenessView, ReadinessView
from identity.services.accounts import create_account
from identity.services.sessions import issue_session, revoke_all_sessions, revoke_session
from platform_core.errors import DomainError
from platform_core.exceptions import ConflictError
from platform_core.pagination import StandardPageNumberPagination


# Test serializers & views for testing foundation behaviors
class ExampleInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=50)
    email = serializers.EmailField()


class ProtectedEchoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"user_id": str(request.user.id), "session_id": str(request.auth.id)})

    def post(self, request):
        serializer = ExampleInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response({"echo": serializer.validated_data})


class PaginatedTestView(APIView):
    permission_classes = [AllowAny]
    pagination_class = StandardPageNumberPagination

    def get(self, request):
        paginator = self.pagination_class()
        items = [{"id": i, "name": f"Item {i}"} for i in range(1, 55)]
        page = paginator.paginate_queryset(items, request, view=self)
        return paginator.get_paginated_response(page)


class ExplodingErrorView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        error_type = request.query_params.get("type", "unhandled")
        if error_type == "unhandled":
            raise RuntimeError(
                "Database connection string: postgres://secret_admin:pass123@internal:5432/db"
            )
        elif error_type == "throttled":
            raise Throttled(wait=45)
        elif error_type == "conflict":
            raise ConflictError("Tài nguyên đang bị khóa bởi tiến trình khác.")
        elif error_type == "idempotency_conflict":
            raise DomainError("IDEMPOTENCY_CONFLICT")
        elif error_type == "custom_domain":
            raise DomainError("ROLE_ALREADY_GRANTED")
        return Response({"status": "ok"})


urlpatterns = [
    path("api/v1/health/live", LivenessView.as_view(), name="health-live"),
    path("api/v1/health/ready", ReadinessView.as_view(), name="health-ready"),
    path("api/v1/test/echo", ProtectedEchoView.as_view(), name="test-echo"),
    path("api/v1/test/paginated", PaginatedTestView.as_view(), name="test-paginated"),
    path("api/v1/test/error", ExplodingErrorView.as_view(), name="test-error"),
]

handler404 = "platform_core.views.not_found_view"
handler500 = "platform_core.views.server_error_view"


@pytest.fixture
def auth_user(db):
    unique_suffix = uuid.uuid4().hex[:6]
    with transaction.atomic():
        return create_account(
            email=f"sv-{unique_suffix}@st.neu.edu.vn",
            password="StrongPassword123!",
        )


@pytest.fixture
def active_session(db, auth_user):
    raw_key, metadata = issue_session(user_id=auth_user.id)
    return raw_key, metadata


@pytest.mark.urls(__name__)
@pytest.mark.django_db
class TestApiErrorEnvelopeAndMappings:
    def test_unauthenticated_request_returns_standard_envelope(self, client):
        response = client.get("/api/v1/test/echo")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        data = response.json()
        assert "error" in data
        assert data["error"]["code"] == "authentication_required"
        assert "Yêu cầu xác thực" in data["error"]["message"]
        assert uuid.UUID(data["error"]["request_id"])
        assert data["error"]["correlation_id"] == data["error"]["request_id"]
        assert response.headers["X-Request-ID"] == data["error"]["request_id"]

    def test_validation_error_returns_structured_field_details(self, client, active_session):
        raw_key, _ = active_session
        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        # enforce_csrf is triggered on POST; fetch cookie first for csrf
        csrf_client = client
        response = csrf_client.post(
            "/api/v1/test/echo",
            data={"name": "", "email": "invalid-email"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN="mock-csrf-passed-or-test",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        data = response.json()
        assert data["error"]["code"] == "validation_error"
        assert isinstance(data["error"]["details"], list)
        fields = [d["field"] for d in data["error"]["details"]]
        assert "name" in fields
        assert "email" in fields

    def test_malformed_json_returns_malformed_request_code(self, client, active_session):
        raw_key, _ = active_session
        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        response = client.post(
            "/api/v1/test/echo",
            data="not-a-json{invalid",
            content_type="application/json",
            HTTP_X_CSRFTOKEN="mock-csrf-passed-or-test",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        data = response.json()
        assert data["error"]["code"] == "malformed_request"

    def test_not_found_returns_standard_envelope(self, client):
        response = client.get("/api/v1/non-existent-route")
        assert response.status_code == status.HTTP_404_NOT_FOUND
        data = response.json()
        assert data["error"]["code"] == "not_found"
        assert "Không tìm thấy" in data["error"]["message"]

    def test_method_not_allowed_returns_standard_envelope(self, client):
        response = client.delete("/api/v1/health/live")
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        data = response.json()
        assert data["error"]["code"] == "method_not_allowed"

    def test_throttled_error_includes_retry_after_header(self, client):
        response = client.get("/api/v1/test/error?type=throttled")
        assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        data = response.json()
        assert data["error"]["code"] == "throttled"
        assert "Retry-After" in response.headers
        assert response.headers["Retry-After"] == "45"

    def test_conflict_and_idempotency_conflict_mapping(self, client):
        res1 = client.get("/api/v1/test/error?type=conflict")
        assert res1.status_code == status.HTTP_409_CONFLICT
        assert res1.json()["error"]["code"] == "conflict"

        res2 = client.get("/api/v1/test/error?type=idempotency_conflict")
        assert res2.status_code == status.HTTP_409_CONFLICT
        assert res2.json()["error"]["code"] == "idempotency_conflict"

    def test_custom_domain_error_mapped_to_bad_request(self, client):
        res = client.get("/api/v1/test/error?type=custom_domain")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "role_already_granted"

    def test_unhandled_server_error_masks_secrets_and_tracebacks(self, client):
        response = client.get("/api/v1/test/error?type=unhandled")
        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        data = response.json()
        assert data["error"]["code"] == "internal_server_error"
        assert "Đã xảy ra lỗi hệ thống" in data["error"]["message"]
        # CRITICAL SECURITY CHECK: Never leak secrets, database connection string, or tracebacks
        raw_text = response.content.decode("utf-8")
        assert "pass123" not in raw_text
        assert "secret_admin" not in raw_text
        assert "Traceback" not in raw_text
        assert "RuntimeError" not in raw_text
        assert uuid.UUID(data["error"]["request_id"])


@pytest.mark.urls(__name__)
@pytest.mark.django_db
class TestCorrelationIdSecurity:
    def test_correlation_id_generated_when_absent(self, client):
        response = client.get("/api/v1/health/live")
        req_id = response.headers.get("X-Request-ID")
        assert req_id is not None
        assert uuid.UUID(req_id)

    def test_correlation_id_preserved_when_valid_uuid(self, client):
        valid_id = "12345678-1234-5678-1234-567812345678"
        response = client.get("/api/v1/health/live", HTTP_X_REQUEST_ID=valid_id)
        assert response.headers.get("X-Request-ID") == valid_id

    def test_correlation_id_replaced_when_unsafe_or_non_uuid(self, client):
        unsafe_inputs = [
            "<script>alert(1)</script>",
            "1234'; DROP TABLE users; --",
            "non-uuid-string-with-extra-long-characters" * 3,
            "12345678-invalid-uuid-too-short",
        ]
        for malicious_val in unsafe_inputs:
            response = client.get("/api/v1/health/live", HTTP_X_REQUEST_ID=malicious_val)
            header_val = response.headers.get("X-Request-ID")
            assert header_val != malicious_val
            assert "<script>" not in header_val
            assert uuid.UUID(header_val)


@pytest.mark.urls(__name__)
@pytest.mark.django_db
class TestUserSessionAuthenticationAdapter:
    def test_active_session_authenticates_and_touches_expiry(self, client, active_session):
        raw_key, metadata = active_session
        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        initial_last_seen = metadata.last_seen_at

        response = client.get("/api/v1/test/echo")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert data["user_id"] == str(metadata.user_id)
        assert data["session_id"] == str(metadata.id)

        metadata.refresh_from_db()
        assert metadata.last_seen_at >= initial_last_seen

    def test_session_idle_timeout_rejected_with_session_expired(self, client, active_session):
        raw_key, metadata = active_session
        past_35m = timezone.now() - timedelta(minutes=35)
        metadata.created_at = past_35m
        metadata.last_seen_at = past_35m
        metadata.idle_expires_at = past_35m + timedelta(minutes=30)
        metadata.absolute_expires_at = past_35m + timedelta(hours=12)
        metadata.save(
            update_fields=["created_at", "last_seen_at", "idle_expires_at", "absolute_expires_at"]
        )

        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        response = client.get("/api/v1/test/echo")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error"]["code"] == "session_expired"

    def test_session_absolute_timeout_rejected_with_session_expired(self, client, active_session):
        raw_key, metadata = active_session
        past_13h = timezone.now() - timedelta(hours=13)
        metadata.created_at = past_13h
        metadata.last_seen_at = past_13h + timedelta(hours=11)
        metadata.idle_expires_at = past_13h + timedelta(hours=11, minutes=20)
        metadata.absolute_expires_at = past_13h + timedelta(hours=12)
        metadata.save(
            update_fields=["created_at", "last_seen_at", "idle_expires_at", "absolute_expires_at"]
        )

        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        response = client.get("/api/v1/test/echo")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error"]["code"] == "session_expired"

    def test_revoked_session_rejected_with_session_revoked(self, client, auth_user, active_session):
        raw_key, metadata = active_session
        revoke_session(actor_id=auth_user.id, session_id=metadata.id)

        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        response = client.get("/api/v1/test/echo")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error"]["code"] == "session_revoked"

    def test_stale_auth_version_rejected_with_session_revoked(
        self, client, auth_user, active_session
    ):
        raw_key, _ = active_session
        revoke_all_sessions(actor_id=auth_user.id, user_id=auth_user.id)

        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        response = client.get("/api/v1/test/echo")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error"]["code"] == "session_revoked"

    def test_inactive_user_rejected_with_account_inactive(self, client, auth_user, active_session):
        raw_key, _ = active_session
        auth_user.is_active = False
        auth_user.save(update_fields=["is_active"])

        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        response = client.get("/api/v1/test/echo")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error"]["code"] == "account_inactive"

    def test_csrf_failure_distinguished_from_permission_denied(self, active_session):
        raw_key, _ = active_session
        from django.test import Client

        csrf_client = Client(enforce_csrf_checks=True)
        csrf_client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        csrf_client.cookies["csrftoken"] = "server-expected-csrf"
        response = csrf_client.post(
            "/api/v1/test/echo",
            data={"name": "test", "email": "test@neu.edu.vn"},
            HTTP_X_CSRFTOKEN="invalid-csrf-token",
            content_type="application/json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        data = response.json()
        assert data["error"]["code"] == "csrf_failed"
        assert "CSRF" in data["error"]["message"]


@pytest.mark.urls(__name__)
@pytest.mark.django_db
class TestPaginationFoundation:
    def test_pagination_default_page_and_page_size(self, client):
        response = client.get("/api/v1/test/paginated")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert "items" in data
        assert "pagination" in data
        assert len(data["items"]) == 20
        assert data["pagination"]["page"] == 1
        assert data["pagination"]["page_size"] == 20
        assert data["pagination"]["total_items"] == 54
        assert data["pagination"]["total_pages"] == 3
        assert data["pagination"]["has_next"] is True
        assert data["pagination"]["has_previous"] is False

    def test_pagination_custom_page_size_clamped_to_max(self, client):
        response = client.get("/api/v1/test/paginated?page_size=50")
        assert response.status_code == status.HTTP_200_OK
        data = response.json()
        assert len(data["items"]) == 50
        assert data["pagination"]["page_size"] == 50

        # page_size > max_page_size (100)
        response_large = client.get("/api/v1/test/paginated?page_size=500")
        assert response_large.status_code == status.HTTP_200_OK
        assert response_large.json()["pagination"]["page_size"] == 100

    def test_pagination_invalid_page_raises_validation_error(self, client):
        response = client.get("/api/v1/test/paginated?page=-1")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        data = response.json()
        assert data["error"]["code"] == "validation_error"

        response_abc = client.get("/api/v1/test/paginated?page=abc")
        assert response_abc.status_code == status.HTTP_400_BAD_REQUEST
        assert response_abc.json()["error"]["code"] == "validation_error"

    def test_pagination_invalid_page_size_raises_validation_error(self, client):
        response = client.get("/api/v1/test/paginated?page_size=invalid")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["error"]["code"] == "validation_error"


@pytest.mark.django_db
class TestSchemaGenerationAndDrift:
    def test_openapi_schema_endpoint_returns_valid_json(self, client):
        response = client.get("/api/v1/schema")
        assert response.status_code == status.HTTP_200_OK
        schema = response.json()
        assert schema["openapi"].startswith("3.0")
        assert schema["info"]["title"] == "NEU LMS API"
        assert "/api/v1/health/live" in schema["paths"]
        assert "/api/v1/health/ready" in schema["paths"]
        assert "SessionCookieAuth" in schema["components"]["securitySchemes"]
        assert "CSRFToken" in schema["components"]["securitySchemes"]
        assert "ErrorEnvelope" in schema["components"]["schemas"]
