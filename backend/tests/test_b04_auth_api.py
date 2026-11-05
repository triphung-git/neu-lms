import concurrent.futures
import itertools
import uuid

import pytest
from django.conf import settings
from django.db import connection
from django.test import Client
from rest_framework import status

from identity.models import EmailVerificationDelivery, Role, RoleRequest, User
from identity.services.accounts import (
    create_account,
    register_account,
)
from identity.services.sessions import issue_session
from identity.transport import derive_email_verification_token, dispatch_pending_auth_emails

_email_counter = itertools.count(1000)


def get_student_email():
    return f"1124{next(_email_counter):04d}@st.neu.edu.vn"


@pytest.fixture
def csrf_client():
    """Client with CSRF enforcement and helper methods."""
    c = Client(enforce_csrf_checks=True)
    csrf_res = c.get("/api/v1/auth/csrf")
    assert csrf_res.status_code == status.HTTP_204_NO_CONTENT
    c.csrf_token = c.cookies["csrftoken"].value
    return c


@pytest.fixture
def auth_client_factory(csrf_client):
    """Create an authenticated client with active session and CSRF for a given user."""

    def _factory(user):
        raw_key, session_meta = issue_session(user_id=user.id)
        csrf_client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        csrf_client.user = user
        csrf_client.session_meta = session_meta
        return csrf_client

    return _factory


@pytest.mark.django_db
class TestRegistrationAPI:
    def test_register_student_success(self, csrf_client):
        email = get_student_email()
        payload = {
            "email": email,
            "password": "StrongPassword123!",
            "display_name": "Nguyen Van A",
            "requested_role": "student",
        }
        res = csrf_client.post(
            "/api/v1/auth/register",
            data=payload,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        assert data["email"] == email.lower()
        assert data["display_name"] == "Nguyen Van A"
        assert data["requested_role"] == "student"
        assert data["email_verified"] is False
        assert "password" not in data
        assert "token" not in data

        user = User.objects.get(id=data["id"])
        assert user.email == email.lower()
        assert not user.role_grants.filter(revoked_at__isnull=True).exists()
        assert user.rolerequest_set.filter(
            role=Role.STUDENT, status=RoleRequest.Status.PENDING
        ).exists()
        assert EmailVerificationDelivery.objects.filter(user=user, status="pending").exists()

    def test_register_teacher_success(self, csrf_client):
        unique = uuid.uuid4().hex[:6]
        email = f"gv.{unique}@neu.edu.vn"
        payload = {
            "email": email,
            "password": "StrongPassword123!",
            "display_name": "Thầy Giáo B",
            "requested_role": "teacher",
        }
        res = csrf_client.post(
            "/api/v1/auth/register",
            data=payload,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        assert data["requested_role"] == "teacher"
        assert data["email_verified"] is False

        user = User.objects.get(id=data["id"])
        assert user.rolerequest_set.filter(
            role=Role.TEACHER, status=RoleRequest.Status.PENDING
        ).exists()

    def test_register_student_invalid_email_regex_rejected(self, csrf_client):
        invalid_emails = [
            "student@gmail.com",
            "gv.tran@neu.edu.vn",
            "11239999@st.neu.edu.vn",  # starts with 1123 instead of 1124
            "1124abc@st.neu.edu.vn",
            "112412345@st.neu.edu.vn",  # 5 digits instead of 4
        ]
        for bad_email in invalid_emails:
            res = csrf_client.post(
                "/api/v1/auth/register",
                data={
                    "email": bad_email,
                    "password": "StrongPassword123!",
                    "display_name": "Test",
                    "requested_role": "student",
                },
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
            )
            assert res.status_code == status.HTTP_400_BAD_REQUEST
            data = res.json()
            assert data["error"]["code"] == "invalid_student_email_domain"

    def test_register_duplicate_email_rejected(self, csrf_client):
        email = get_student_email()
        payload = {
            "email": email,
            "password": "StrongPassword123!",
            "display_name": "First User",
            "requested_role": "student",
        }
        res1 = csrf_client.post(
            "/api/v1/auth/register",
            data=payload,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res1.status_code == status.HTTP_201_CREATED

        # Duplicate attempt with uppercase
        payload["email"] = email.upper()
        res2 = csrf_client.post(
            "/api/v1/auth/register",
            data=payload,
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res2.status_code == status.HTTP_400_BAD_REQUEST
        data2 = res2.json()
        assert data2["error"]["code"] == "email_already_registered"

    def test_register_forbidden_fields_rejected(self, csrf_client):
        forbidden_payloads = [
            {"is_superuser": True},
            {"is_staff": True},
            {"role_grant": "admin"},
            {"roles": ["admin"]},
            {"admin": True},
            {"user_id": str(uuid.uuid4())},
        ]
        for forbidden in forbidden_payloads:
            payload = {
                "email": get_student_email(),
                "password": "StrongPassword123!",
                "requested_role": "student",
                **forbidden,
            }
            res = csrf_client.post(
                "/api/v1/auth/register",
                data=payload,
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
            )
            assert res.status_code == status.HTTP_400_BAD_REQUEST
            data = res.json()
            assert data["error"]["code"] == "forbidden_registration_fields"

    def test_register_weak_password_rejected(self, csrf_client):
        res = csrf_client.post(
            "/api/v1/auth/register",
            data={
                "email": get_student_email(),
                "password": "123",
                "requested_role": "student",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        data = res.json()
        assert data["error"]["code"] == "validation_error"

    def test_register_missing_csrf_rejected(self, client):
        client_csrf = Client(enforce_csrf_checks=True)
        res = client_csrf.post(
            "/api/v1/auth/register",
            data={
                "email": "11240001@st.neu.edu.vn",
                "password": "StrongPassword123!",
                "requested_role": "student",
            },
            content_type="application/json",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["error"]["code"] == "csrf_failed"

    def test_register_rate_limit(self, csrf_client):
        for _ in range(30):
            res = csrf_client.post(
                "/api/v1/auth/register",
                data={
                    "email": get_student_email(),
                    "password": "StrongPassword123!",
                    "requested_role": "student",
                },
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
                REMOTE_ADDR="198.51.100.10",
            )
            assert res.status_code in (status.HTTP_201_CREATED, status.HTTP_400_BAD_REQUEST)

        # 31st request from same IP should be throttled
        res_throttled = csrf_client.post(
            "/api/v1/auth/register",
            data={
                "email": get_student_email(),
                "password": "StrongPassword123!",
                "requested_role": "student",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
            REMOTE_ADDR="198.51.100.10",
        )
        assert res_throttled.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        data = res_throttled.json()
        assert data["error"]["code"] == "throttled"
        assert "Retry-After" in res_throttled.headers


@pytest.mark.django_db
class TestEmailVerificationAPI:
    def test_verify_student_auto_grants_student_role(self, csrf_client):
        email = get_student_email()
        user = register_account(
            email=email,
            password="StrongPassword123!",
            requested_role="student",
        )
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        raw_token = derive_email_verification_token(delivery.token)

        res = csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": raw_token},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["email"] == email.lower()
        assert data["verified"] is True
        assert data["granted_roles"] == ["student"]

        # Confirm DB state
        user.refresh_from_db()
        assert user.role_grants.filter(role=Role.STUDENT, revoked_at__isnull=True).exists()
        assert user.rolerequest_set.filter(
            role=Role.STUDENT, status=RoleRequest.Status.APPROVED
        ).exists()

    def test_verify_teacher_remains_pending_admin_approval(self, csrf_client):
        unique = uuid.uuid4().hex[:6]
        email = f"gv.{unique}@neu.edu.vn"
        user = register_account(
            email=email,
            password="StrongPassword123!",
            requested_role="teacher",
        )
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        raw_token = derive_email_verification_token(delivery.token)

        res = csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": raw_token},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["email"] == email.lower()
        assert data["verified"] is True
        assert data["granted_roles"] == []

        # Confirm DB state: verified email, BUT request is still PENDING and 0 grants!
        user.refresh_from_db()
        assert user.verifiedemail.verified_at is not None
        assert not user.role_grants.filter(revoked_at__isnull=True).exists()
        assert user.rolerequest_set.filter(
            role=Role.TEACHER, status=RoleRequest.Status.PENDING
        ).exists()

    def test_verify_invalid_token_rejected(self, csrf_client):
        res = csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": "invalid" * 16},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "token_invalid_or_expired"

    def test_verify_reused_token_rejected(self, csrf_client):
        user = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        raw_token = derive_email_verification_token(delivery.token)

        # First use
        res1 = csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": raw_token},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res1.status_code == status.HTTP_200_OK

        # Second use (replay)
        res2 = csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": raw_token},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res2.status_code == status.HTTP_400_BAD_REQUEST
        assert res2.json()["error"]["code"] == "token_invalid_or_expired"

    def test_verify_inactive_user_rejected(self, csrf_client):
        user = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        raw_token = derive_email_verification_token(delivery.token)

        user.is_active = False
        user.save(update_fields=["is_active"])

        res = csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": raw_token},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert res.json()["error"]["code"] == "account_inactive"


@pytest.mark.django_db
class TestResendVerificationAPI:
    def test_resend_verification_valid_account_invalidates_old_token(self, csrf_client):
        email = get_student_email()
        user = register_account(
            email=email,
            password="StrongPassword123!",
            requested_role="student",
        )
        old_delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        old_token = derive_email_verification_token(old_delivery.token)

        res = csrf_client.post(
            "/api/v1/auth/resend-verification",
            data={"email": email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_202_ACCEPTED

        # Old token is invalidated
        old_delivery.token.refresh_from_db()
        assert old_delivery.token.used_at is not None

        # Old token fails verify
        res_old = csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": old_token},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res_old.status_code == status.HTTP_400_BAD_REQUEST

        # New token succeeds
        new_delivery = (
            EmailVerificationDelivery.objects.filter(user=user).exclude(id=old_delivery.id).first()
        )
        assert new_delivery is not None
        new_token = derive_email_verification_token(new_delivery.token)
        res_new = csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": new_token},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res_new.status_code == status.HTTP_200_OK
        assert res_new.json()["verified"] is True

    def test_resend_verification_unknown_account_uniform_202(self, csrf_client):
        res = csrf_client.post(
            "/api/v1/auth/resend-verification",
            data={"email": "nonexistent.account@st.neu.edu.vn"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_202_ACCEPTED

    def test_resend_verification_already_verified_account_uniform_202(self, csrf_client):
        user = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        raw_token = derive_email_verification_token(delivery.token)
        csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": raw_token},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )

        initial_count = EmailVerificationDelivery.objects.filter(user=user).count()
        res = csrf_client.post(
            "/api/v1/auth/resend-verification",
            data={"email": user.email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.csrf_token,
        )
        assert res.status_code == status.HTTP_202_ACCEPTED
        assert EmailVerificationDelivery.objects.filter(user=user).count() == initial_count


@pytest.mark.django_db
class TestRoleRequestsAndCurrentAccountAPI:
    def test_unauthenticated_role_requests_rejected(self, client):
        res = client.get("/api/v1/auth/role-requests")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert res.json()["error"]["code"] == "authentication_required"

    def test_get_role_requests_returns_own_requests_only(self, auth_client_factory):
        user_a = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        unique = uuid.uuid4().hex[:6]
        user_b = register_account(
            email=f"gv.{unique}@neu.edu.vn",
            password="StrongPassword123!",
            requested_role="teacher",
        )

        client_a = auth_client_factory(user_a)
        res_a = client_a.get("/api/v1/auth/role-requests")
        assert res_a.status_code == status.HTTP_200_OK
        items_a = res_a.json()
        assert len(items_a) == 1
        assert items_a[0]["role"] == "student"

        # Cannot see user_b request
        assert not any(item["id"] == str(user_b.rolerequest_set.first().id) for item in items_a)

    def test_create_role_request_teacher_pending(self, auth_client_factory):
        user = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        client = auth_client_factory(user)

        res = client.post(
            "/api/v1/auth/role-requests",
            data={"role": "teacher"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.csrf_token,
        )
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        assert data["role"] == "teacher"
        assert data["status"] == "pending"

    def test_create_role_request_auto_grants_student_when_email_verified(self, auth_client_factory):
        email = get_student_email()
        user = create_account(email=email, password="StrongPassword123!")
        from identity.services.accounts import confirm_email

        confirm_email(user_id=user.id, expected_email=email)

        client = auth_client_factory(user)
        res = client.post(
            "/api/v1/auth/role-requests",
            data={"role": "student"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.csrf_token,
        )
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        assert data["role"] == "student"
        assert data["status"] == "approved"

        # Confirm grant was created
        user.refresh_from_db()
        assert user.role_grants.filter(role=Role.STUDENT, revoked_at__isnull=True).exists()

    def test_create_role_request_already_granted_rejected(self, auth_client_factory):
        user = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        raw_token = derive_email_verification_token(delivery.token)
        from identity.services.verification import verify_email

        verify_email(token=raw_token)

        client = auth_client_factory(user)
        res = client.post(
            "/api/v1/auth/role-requests",
            data={"role": "student"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.csrf_token,
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "role_already_granted"

    def test_create_role_request_already_pending_rejected(self, auth_client_factory):
        unique = uuid.uuid4().hex[:6]
        user = register_account(
            email=f"gv.{unique}@neu.edu.vn",
            password="StrongPassword123!",
            requested_role="teacher",
        )
        client = auth_client_factory(user)

        res = client.post(
            "/api/v1/auth/role-requests",
            data={"role": "teacher"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.csrf_token,
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "one_pending_role_request"

    def test_create_role_request_actor_spoofing_prevented(self, auth_client_factory):
        user_a = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        unique_b = uuid.uuid4().hex[:6]
        user_b = register_account(
            email=f"gv.{unique_b}@neu.edu.vn",
            password="StrongPassword123!",
            requested_role="teacher",
        )

        client_a = auth_client_factory(user_a)
        # Attempt to create request on behalf of user_b
        res = client_a.post(
            "/api/v1/auth/role-requests",
            data={"role": "teacher", "user_id": str(user_b.id)},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client_a.csrf_token,
        )
        assert res.status_code == status.HTTP_201_CREATED

        # Created for user_a, NOT user_b!
        req_id = res.json()["id"]
        created_req = RoleRequest.objects.get(id=req_id)
        assert created_req.user_id == user_a.id
        assert created_req.user_id != user_b.id

    def test_cancel_own_pending_role_request(self, auth_client_factory):
        unique = uuid.uuid4().hex[:6]
        user = register_account(
            email=f"gv.{unique}@neu.edu.vn",
            password="StrongPassword123!",
            requested_role="teacher",
        )
        req = user.rolerequest_set.first()
        client = auth_client_factory(user)

        res = client.post(
            f"/api/v1/auth/role-requests/{req.id}/cancel",
            data={},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.csrf_token,
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["status"] == "cancelled"

        req.refresh_from_db()
        assert req.status == RoleRequest.Status.CANCELLED

    def test_cancel_other_users_role_request_forbidden(self, auth_client_factory):
        user_a = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        unique_b = uuid.uuid4().hex[:6]
        user_b = register_account(
            email=f"gv.{unique_b}@neu.edu.vn",
            password="StrongPassword123!",
            requested_role="teacher",
        )
        req_b = user_b.rolerequest_set.first()

        client_a = auth_client_factory(user_a)
        res = client_a.post(
            f"/api/v1/auth/role-requests/{req_b.id}/cancel",
            data={},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client_a.csrf_token,
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["error"]["code"] == "permission_denied"

        req_b.refresh_from_db()
        assert req_b.status == RoleRequest.Status.PENDING

    def test_cancel_non_existent_role_request_returns_404(self, auth_client_factory):
        user = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        client = auth_client_factory(user)
        random_id = uuid.uuid4()
        res = client.post(
            f"/api/v1/auth/role-requests/{random_id}/cancel",
            data={},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.csrf_token,
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
        assert res.json()["error"]["code"] == "not_found"


@pytest.mark.django_db
class TestMeAndStatusEndpoints:
    def test_me_returns_status_and_pending_roles(self, auth_client_factory):
        unique = uuid.uuid4().hex[:6]
        user = register_account(
            email=f"gv.{unique}@neu.edu.vn",
            password="StrongPassword123!",
            requested_role="teacher",
        )
        client = auth_client_factory(user)

        res = client.get("/api/v1/auth/me")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["email"] == user.email
        assert data["roles"] == []
        assert data["email_verified"] is False
        assert data["pending_roles"] == ["teacher"]

        # Now verify email
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        raw_token = derive_email_verification_token(delivery.token)
        from identity.services.verification import verify_email

        verify_email(token=raw_token)

        res_after = client.get("/api/v1/auth/me")
        data_after = res_after.json()
        assert data_after["email_verified"] is True
        assert data_after["pending_roles"] == ["teacher"]
        assert data_after["roles"] == []  # Teacher is still pending approval!

    def test_get_grants_and_verification_endpoints(self, auth_client_factory):
        user = register_account(
            email=get_student_email(),
            password="StrongPassword123!",
            requested_role="student",
        )
        client = auth_client_factory(user)

        # Before verify
        v_res = client.get("/api/v1/auth/verification")
        assert v_res.status_code == status.HTTP_200_OK
        assert v_res.json()["verified"] is False
        assert v_res.json()["verified_at"] is None

        g_res = client.get("/api/v1/auth/grants")
        assert g_res.status_code == status.HTTP_200_OK
        assert g_res.json() == []

        # After verify
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        raw_token = derive_email_verification_token(delivery.token)
        from identity.services.verification import verify_email

        verify_email(token=raw_token)

        # Student role grant invalidates previous sessions; re-authenticate client
        client = auth_client_factory(user)

        v_res2 = client.get("/api/v1/auth/verification")
        assert v_res2.json()["verified"] is True
        assert v_res2.json()["verified_at"] is not None

        g_res2 = client.get("/api/v1/auth/grants")
        assert len(g_res2.json()) == 1
        assert g_res2.json()[0]["role"] == "student"
        assert g_res2.json()[0]["grant_source"] == "verified_student_email"


@pytest.mark.django_db
class TestEndToEndRegistrationVerifyAndLoginJourney:
    def test_full_student_journey(self, client):
        csrf_client = Client(enforce_csrf_checks=True)

        # 1. Fetch CSRF
        csrf_res = csrf_client.get("/api/v1/auth/csrf")
        assert csrf_res.status_code == status.HTTP_204_NO_CONTENT
        csrf_token = csrf_client.cookies["csrftoken"].value

        # 2. Register student
        email = get_student_email()
        password = "SecurePassword123!"
        reg_res = csrf_client.post(
            "/api/v1/auth/register",
            data={
                "email": email,
                "password": password,
                "display_name": "Sinh Vien E2E",
                "requested_role": "student",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        assert reg_res.status_code == status.HTTP_201_CREATED

        # 3. Dispatch auth email (out-of-request dispatcher)
        dispatch_res = dispatch_pending_auth_emails()
        assert len(dispatch_res["email_verification"]) >= 1

        # 4. Extract token from DB
        user = User.objects.get(email=email.lower())
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        assert delivery.status == "sent"
        raw_token = derive_email_verification_token(delivery.token)

        # 5. Verify email
        verify_res = csrf_client.post(
            "/api/v1/auth/verify-email",
            data={"token": raw_token},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        assert verify_res.status_code == status.HTTP_200_OK
        assert verify_res.json()["granted_roles"] == ["student"]

        # 6. Login
        login_res = csrf_client.post(
            "/api/v1/auth/login",
            data={"email": email, "password": password},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_client.cookies["csrftoken"].value,
        )
        assert login_res.status_code == status.HTTP_200_OK
        session_info = login_res.json()
        assert session_info["roles"] == ["student"]
        assert session_info["email_verified"] is True
        assert session_info["pending_roles"] == []

        # 7. Access /me with session
        me_res = csrf_client.get("/api/v1/auth/me")
        assert me_res.status_code == status.HTTP_200_OK
        assert me_res.json()["roles"] == ["student"]
        assert me_res.json()["email_verified"] is True


@pytest.mark.django_db(transaction=True)
class TestConcurrencyAndRaceConditions:
    def test_concurrent_registration_same_email(self):
        email = get_student_email()

        def _do_reg(idx):
            connection.close()
            c = Client(enforce_csrf_checks=True)
            c.get("/api/v1/auth/csrf")
            csrf = c.cookies["csrftoken"].value
            return c.post(
                "/api/v1/auth/register",
                data={
                    "email": email,
                    "password": "StrongPassword123!",
                    "display_name": f"Concurrent {idx}",
                    "requested_role": "student",
                },
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf,
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            fut1 = executor.submit(_do_reg, 1)
            fut2 = executor.submit(_do_reg, 2)
            res1 = fut1.result()
            res2 = fut2.result()

        statuses = {res1.status_code, res2.status_code}
        assert status.HTTP_201_CREATED in statuses
        assert status.HTTP_400_BAD_REQUEST in statuses

    def test_concurrent_verification_same_token(self):
        email = get_student_email()
        user = register_account(
            email=email,
            password="StrongPassword123!",
            requested_role="student",
        )
        delivery = EmailVerificationDelivery.objects.filter(user=user).first()
        raw_token = derive_email_verification_token(delivery.token)

        def _do_verify():
            connection.close()
            c = Client(enforce_csrf_checks=True)
            c.get("/api/v1/auth/csrf")
            csrf = c.cookies["csrftoken"].value
            return c.post(
                "/api/v1/auth/verify-email",
                data={"token": raw_token},
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrf,
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            fut1 = executor.submit(_do_verify)
            fut2 = executor.submit(_do_verify)
            res1 = fut1.result()
            res2 = fut2.result()

        statuses = {res1.status_code, res2.status_code}
        assert status.HTTP_200_OK in statuses
        assert status.HTTP_400_BAD_REQUEST in statuses
