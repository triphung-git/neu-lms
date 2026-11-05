import random
import re
from datetime import timedelta

import pytest
from django.conf import settings
from django.core import mail
from django.test import Client
from django.utils import timezone
from rest_framework import status

from identity.models import PasswordResetToken, UserSession
from identity.services.accounts import confirm_email, create_account
from identity.services.common import digest
from identity.services.roles import grant_student_role, request_role
from platform_core.models import AuditEvent

pytestmark = pytest.mark.django_db


@pytest.fixture
def auth_user():
    unique_digits = f"{random.randint(1000, 9999)}"
    user = create_account(
        email=f"1124{unique_digits}@st.neu.edu.vn",
        password="ValidPassword123!",
    )
    confirm_email(user_id=user.id, expected_email=user.email)
    request_role(user_id=user.id, role="student")
    grant_student_role(user_id=user.id)
    user.refresh_from_db()
    return user


@pytest.fixture
def csrf_client():
    client = Client(enforce_csrf_checks=True)
    csrf_res = client.get("/api/v1/auth/csrf")
    assert csrf_res.status_code == status.HTTP_204_NO_CONTENT
    csrftoken = csrf_res.cookies["csrftoken"].value
    return client, csrftoken


class TestCsrfAndLogin:
    def test_csrf_token_endpoint_sets_cookie(self):
        client = Client(enforce_csrf_checks=True)
        response = client.get("/api/v1/auth/csrf")
        assert response.status_code == status.HTTP_204_NO_CONTENT
        assert "csrftoken" in response.cookies
        token = response.cookies["csrftoken"].value
        assert len(token) >= 32

    def test_login_success_sets_session_cookie_and_returns_session_info(
        self, auth_user, csrf_client
    ):
        client, csrftoken = csrf_client
        response = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert response.status_code == status.HTTP_200_OK
        data = response.json()

        assert data["id"] == str(auth_user.id)
        assert data["email"] == auth_user.email
        assert data["roles"] == ["student"]
        assert "idle_expires_at" in data
        assert "absolute_expires_at" in data
        assert response.headers["Cache-Control"] == "no-store"

        # Session cookie verification
        assert settings.SESSION_COOKIE_NAME in response.cookies
        cookie = response.cookies[settings.SESSION_COOKIE_NAME]
        assert cookie["httponly"] is True
        assert cookie["samesite"] == "Lax"
        assert cookie["max-age"] == 12 * 3600

        # Verify session saved in DB
        raw_key = cookie.value
        session_record = UserSession.objects.filter(key_digest=digest(raw_key)).first()
        assert session_record is not None
        assert session_record.user_id == auth_user.id
        assert session_record.revoked_at is None

    def test_login_fails_without_valid_csrf(self, auth_user):
        client = Client(enforce_csrf_checks=True)
        # Attempt login without CSRF token
        response = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN
        data = response.json()
        assert data["error"]["code"] == "csrf_failed"

    def test_login_invalid_password_returns_401(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        response = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "WrongPassword999!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error"]["code"] == "authentication_required"

    def test_login_non_existent_email_returns_401(self, csrf_client):
        client, csrftoken = csrf_client
        response = client.post(
            "/api/v1/auth/login",
            data={"email": "11249999@st.neu.edu.vn", "password": "AnyPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error"]["code"] == "authentication_required"

    def test_login_inactive_account_rejected(self, auth_user, csrf_client):
        auth_user.is_active = False
        auth_user.save(update_fields=["is_active"])

        client, csrftoken = csrf_client
        response = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error"]["code"] == "authentication_required"

    def test_login_revokes_previous_session(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        res1 = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        key1 = res1.cookies[settings.SESSION_COOKIE_NAME].value
        csrftoken2 = res1.cookies.get("csrftoken", client.cookies.get("csrftoken")).value

        # Login again with previous session cookie present
        res2 = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken2,
        )
        assert res2.status_code == status.HTTP_200_OK

        session1 = UserSession.objects.get(key_digest=digest(key1))
        assert session1.revoked_at is not None

    def test_login_rate_limiting_on_account(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        for _ in range(10):
            res = client.post(
                "/api/v1/auth/login",
                data={"email": auth_user.email, "password": "WrongPassword!"},
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrftoken,
            )
            assert res.status_code == status.HTTP_401_UNAUTHORIZED

        # 11th attempt triggers throttling
        throttled_res = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert throttled_res.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        assert throttled_res.json()["error"]["code"] == "throttled"
        assert "Retry-After" in throttled_res.headers


class TestSessionMeAndLogout:
    def test_me_authenticated_returns_session_and_touches_last_seen(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        login_res = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        raw_key = login_res.cookies[settings.SESSION_COOKIE_NAME].value
        initial_session = UserSession.objects.get(key_digest=digest(raw_key))

        me_res = client.get("/api/v1/auth/me")
        assert me_res.status_code == status.HTTP_200_OK
        data = me_res.json()
        assert data["id"] == str(auth_user.id)
        assert data["email"] == auth_user.email
        assert data["roles"] == ["student"]

        updated_session = UserSession.objects.get(key_digest=digest(raw_key))
        assert updated_session.last_seen_at >= initial_session.last_seen_at

    def test_me_unauthenticated_returns_401(self):
        client = Client()
        response = client.get("/api/v1/auth/me")
        assert response.status_code == status.HTTP_401_UNAUTHORIZED
        assert response.json()["error"]["code"] == "authentication_required"

    def test_logout_revokes_session_and_deletes_cookie(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        login_res = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        raw_key = login_res.cookies[settings.SESSION_COOKIE_NAME].value
        csrftoken2 = client.cookies["csrftoken"].value

        logout_res = client.post(
            "/api/v1/auth/logout",
            HTTP_X_CSRFTOKEN=csrftoken2,
        )
        assert logout_res.status_code == status.HTTP_204_NO_CONTENT

        # Cookie deleted
        assert logout_res.cookies[settings.SESSION_COOKIE_NAME].value == ""

        # Session revoked in DB
        db_session = UserSession.objects.get(key_digest=digest(raw_key))
        assert db_session.revoked_at is not None

        # Subsequent /me fails
        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        subsequent = client.get("/api/v1/auth/me")
        assert subsequent.status_code == status.HTTP_401_UNAUTHORIZED
        assert subsequent.json()["error"]["code"] == "session_revoked"

    def test_logout_all_invalidates_all_user_sessions(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        login_res = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        key1 = login_res.cookies[settings.SESSION_COOKIE_NAME].value
        csrftoken2 = client.cookies["csrftoken"].value

        # Simulate second device session
        from identity.services.sessions import issue_session

        key2, _ = issue_session(user_id=auth_user.id)

        logout_all_res = client.post(
            "/api/v1/auth/logout-all",
            HTTP_X_CSRFTOKEN=csrftoken2,
        )
        assert logout_all_res.status_code == status.HTTP_204_NO_CONTENT

        # Auth version increased
        auth_user.refresh_from_db()
        assert auth_user.auth_version > 1

        # Device 2 request now fails
        device2_client = Client()
        device2_client.cookies[settings.SESSION_COOKIE_NAME] = key2
        res2 = device2_client.get("/api/v1/auth/me")
        assert res2.status_code == status.HTTP_401_UNAUTHORIZED
        assert res2.json()["error"]["code"] == "session_revoked"

        # Device 1 request also fails
        device1_client = Client()
        device1_client.cookies[settings.SESSION_COOKIE_NAME] = key1
        res1 = device1_client.get("/api/v1/auth/me")
        assert res1.status_code == status.HTTP_401_UNAUTHORIZED
        assert res1.json()["error"]["code"] == "session_revoked"


class TestPasswordChangeAndReset:
    def test_password_change_success(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        login_res = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert login_res.status_code == status.HTTP_200_OK
        csrftoken2 = client.cookies["csrftoken"].value

        change_res = client.post(
            "/api/v1/auth/password/change",
            data={
                "current_password": "ValidPassword123!",
                "new_password": "BrandNewPassword456!",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken2,
        )
        assert change_res.status_code == status.HTTP_204_NO_CONTENT

        # Old password fails, new password succeeds
        auth_user.refresh_from_db()
        assert not auth_user.check_password("ValidPassword123!")
        assert auth_user.check_password("BrandNewPassword456!")

        # Audit recorded
        assert AuditEvent.objects.filter(
            action="password.changed", resource_id=auth_user.id
        ).exists()

    def test_password_change_wrong_current_password_returns_400(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        csrftoken2 = client.cookies["csrftoken"].value

        change_res = client.post(
            "/api/v1/auth/password/change",
            data={
                "current_password": "IncorrectPassword123!",
                "new_password": "BrandNewPassword456!",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken2,
        )
        assert change_res.status_code == status.HTTP_400_BAD_REQUEST
        data = change_res.json()
        assert data["error"]["code"] == "validation_error"

    def test_password_change_weak_password_returns_400(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        csrftoken2 = client.cookies["csrftoken"].value

        change_res = client.post(
            "/api/v1/auth/password/change",
            data={
                "current_password": "ValidPassword123!",
                "new_password": "short",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken2,
        )
        assert change_res.status_code == status.HTTP_400_BAD_REQUEST
        assert change_res.json()["error"]["code"] == "validation_error"

    def test_password_reset_request_silent_on_non_existent_email(self, csrf_client):
        client, csrftoken = csrf_client
        mail.outbox.clear()

        response = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": "nobody@neu.edu.vn"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert response.status_code == status.HTTP_202_ACCEPTED
        assert len(mail.outbox) == 0
        assert PasswordResetToken.objects.count() == 0

    @pytest.mark.django_db(transaction=True)
    def test_password_reset_flow_end_to_end(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        mail.outbox.clear()

        # Step 1: Request reset
        req_res = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": auth_user.email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert req_res.status_code == status.HTTP_202_ACCEPTED
        assert len(mail.outbox) == 0

        # Dispatch pending email out-of-request
        from identity.transport import dispatch_pending_auth_emails

        dispatch_pending_auth_emails()
        assert len(mail.outbox) == 1
        email_body = mail.outbox[0].body
        assert "Reset your password within 30 minutes" in email_body

        # Extract token from URL
        match = re.search(r"token=([A-Za-z0-9_-]+)", email_body)
        assert match is not None
        raw_token = match.group(1)

        # Token digest exists in DB
        token_record = PasswordResetToken.objects.filter(digest=digest(raw_token)).first()
        assert token_record is not None
        assert token_record.used_at is None
        assert token_record.expires_at > timezone.now()

        # Step 2: Confirm reset with new password
        confirm_res = client.post(
            "/api/v1/auth/password/reset",
            data={
                "token": raw_token,
                "new_password": "ResetPassword789!",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert confirm_res.status_code == status.HTTP_204_NO_CONTENT

        # Verify password changed
        auth_user.refresh_from_db()
        assert auth_user.check_password("ResetPassword789!")

        # Token is marked used
        token_record.refresh_from_db()
        assert token_record.used_at is not None

        # Audit event recorded
        assert AuditEvent.objects.filter(action="password.reset", resource_id=auth_user.id).exists()

        # Step 3: Single-use check — token reuse must fail
        reuse_res = client.post(
            "/api/v1/auth/password/reset",
            data={
                "token": raw_token,
                "new_password": "YetAnotherPassword123!",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert reuse_res.status_code == status.HTTP_400_BAD_REQUEST
        assert reuse_res.json()["error"]["code"] == "validation_error"

    def test_password_reset_confirm_expired_token_fails(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        token_str = "expired-token-raw-value-test-32b"
        PasswordResetToken.objects.create(
            user=auth_user,
            digest=digest(token_str),
            auth_version=auth_user.auth_version,
            expires_at=timezone.now() - timedelta(minutes=5),
        )

        response = client.post(
            "/api/v1/auth/password/reset",
            data={
                "token": token_str,
                "new_password": "NewValidPassword123!",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert response.json()["error"]["code"] == "validation_error"


class TestB032SecurityInvariants:
    def test_login_case_insensitivity_and_whitespace_trim(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        padded_upper_email = f"   {auth_user.email.upper()}   "
        response = client.post(
            "/api/v1/auth/login",
            data={"email": padded_upper_email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["email"] == auth_user.email

    def test_login_error_responses_are_identical_against_enumeration(self, auth_user, csrf_client):
        client, csrftoken = csrf_client

        # 1. Non-existent account
        res_nonexistent = client.post(
            "/api/v1/auth/login",
            data={"email": "nonexistent9999@st.neu.edu.vn", "password": "AnyPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        # 2. Existing account with wrong password
        res_wrong_pw = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "WrongPassword999!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        # 3. Existing account that is inactive
        auth_user.is_active = False
        auth_user.save(update_fields=["is_active"])
        res_inactive = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        for res in [res_nonexistent, res_wrong_pw, res_inactive]:
            assert res.status_code == status.HTTP_401_UNAUTHORIZED
            err = res.json()["error"]
            assert err["code"] == "authentication_required"
            assert err["message"] == "Email or password is incorrect."

    def test_password_reset_weak_password_does_not_consume_token(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        token_str = "valid-token-for-weak-password-test-32"
        token_record = PasswordResetToken.objects.create(
            user=auth_user,
            digest=digest(token_str),
            auth_version=auth_user.auth_version,
            expires_at=timezone.now() + timedelta(minutes=30),
        )

        # 1. Attempt reset with a password that is too short (< 12 chars per Django validator)
        weak_res = client.post(
            "/api/v1/auth/password/reset",
            data={"token": token_str, "new_password": "short"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert weak_res.status_code == status.HTTP_400_BAD_REQUEST
        assert weak_res.json()["error"]["code"] == "validation_error"

        # Verify token was NOT consumed by the failed attempt
        token_record.refresh_from_db()
        assert token_record.used_at is None

        # 2. Attempt reset again with the exact same token and a strong password
        strong_res = client.post(
            "/api/v1/auth/password/reset",
            data={"token": token_str, "new_password": "StrongReplacementPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert strong_res.status_code == status.HTTP_204_NO_CONTENT

        # Now the token must be consumed
        token_record.refresh_from_db()
        assert token_record.used_at is not None

        # Password must be updated
        auth_user.refresh_from_db()
        assert auth_user.check_password("StrongReplacementPassword123!")

    def test_password_reset_stale_token_after_auth_version_bump_fails(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        token_str = "token-before-auth-version-bump-32"
        PasswordResetToken.objects.create(
            user=auth_user,
            digest=digest(token_str),
            auth_version=auth_user.auth_version,
            expires_at=timezone.now() + timedelta(minutes=30),
        )

        # Bump user's auth_version (e.g. user logged out all or changed password)
        auth_user.auth_version += 1
        auth_user.save(update_fields=["auth_version"])

        # Attempt reset with previously generated token
        res = client.post(
            "/api/v1/auth/password/reset",
            data={"token": token_str, "new_password": "StrongReplacementPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "validation_error"

    def test_password_reset_inactive_account_fails(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        token_str = "token-for-inactive-user-test-32b"
        PasswordResetToken.objects.create(
            user=auth_user,
            digest=digest(token_str),
            auth_version=auth_user.auth_version,
            expires_at=timezone.now() + timedelta(minutes=30),
        )

        auth_user.is_active = False
        auth_user.save(update_fields=["is_active"])

        res = client.post(
            "/api/v1/auth/password/reset",
            data={"token": token_str, "new_password": "StrongReplacementPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "validation_error"

    def test_password_change_failure_rolls_back_atomically(self, auth_user, csrf_client):
        client, csrftoken = csrf_client
        login_res = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        raw_key = login_res.cookies[settings.SESSION_COOKIE_NAME].value
        csrftoken2 = client.cookies["csrftoken"].value

        initial_auth_version = auth_user.auth_version

        # Fail change password with invalid new password
        change_res = client.post(
            "/api/v1/auth/password/change",
            data={"current_password": "ValidPassword123!", "new_password": "short"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken2,
        )
        assert change_res.status_code == status.HTTP_400_BAD_REQUEST

        # Verify DB state: password unchanged, auth_version not incremented, session still active
        auth_user.refresh_from_db()
        assert auth_user.auth_version == initial_auth_version
        assert auth_user.check_password("ValidPassword123!")

        session = UserSession.objects.get(key_digest=digest(raw_key))
        assert session.revoked_at is None

        # No password.changed audit event created
        assert not AuditEvent.objects.filter(
            action="password.changed", resource_id=auth_user.id
        ).exists()

    @pytest.mark.django_db(transaction=True)
    def test_concurrent_password_reset_single_use(self, auth_user):
        import threading

        from identity.services.passwords import reset_password

        token_str = "concurrent-reset-test-token-32b"
        PasswordResetToken.objects.create(
            user=auth_user,
            digest=digest(token_str),
            auth_version=auth_user.auth_version,
            expires_at=timezone.now() + timedelta(minutes=30),
        )

        results = []
        errors = []

        def worker(pw):
            from django.db import connection

            connection.close()
            try:
                reset_password(token=token_str, new_password=pw)
                results.append("success")
            except Exception as e:
                errors.append(e)
            finally:
                connection.close()

        t1 = threading.Thread(target=worker, args=("StrongPasswordAlpha123!",))
        t2 = threading.Thread(target=worker, args=("StrongPasswordBeta456!",))

        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        # Exactly 1 must succeed and 1 must fail with validation error
        assert len(results) == 1
        assert len(errors) == 1
        from rest_framework.exceptions import ValidationError

        assert isinstance(errors[0], ValidationError)

        # Token is marked used
        token_record = PasswordResetToken.objects.get(digest=digest(token_str))
        assert token_record.used_at is not None

    def test_cleanup_expired_auth_data(self, auth_user):
        from identity.models import AuthRateBucket
        from identity.services.passwords import cleanup_expired_auth_data

        now = timezone.now()

        # 1. Buckets: 1 stale (> 24h), 1 recent
        stale_bucket = AuthRateBucket.objects.create(
            key="stale-bucket-key",
            starts_at=now - timedelta(hours=25),
            attempts=5,
        )
        fresh_bucket = AuthRateBucket.objects.create(
            key="fresh-bucket-key",
            starts_at=now - timedelta(minutes=5),
            attempts=2,
        )

        # 2. Tokens: 1 expired, 1 used 8 days ago, 1 active
        expired_token = PasswordResetToken.objects.create(
            user=auth_user,
            digest=digest("expired-token-val"),
            auth_version=auth_user.auth_version,
            expires_at=now - timedelta(minutes=10),
        )
        used_old_token = PasswordResetToken.objects.create(
            user=auth_user,
            digest=digest("used-old-token-val"),
            auth_version=auth_user.auth_version,
            expires_at=now + timedelta(minutes=10),
            used_at=now - timedelta(days=8),
        )
        active_token = PasswordResetToken.objects.create(
            user=auth_user,
            digest=digest("active-token-val"),
            auth_version=auth_user.auth_version,
            expires_at=now + timedelta(minutes=20),
        )

        # Run cleanup
        stats = cleanup_expired_auth_data(now=now)
        assert stats["buckets_deleted"] >= 1
        assert stats["tokens_deleted"] >= 2

        # Verify DB state
        assert not AuthRateBucket.objects.filter(pk=stale_bucket.key).exists()
        assert AuthRateBucket.objects.filter(pk=fresh_bucket.key).exists()

        assert not PasswordResetToken.objects.filter(pk=expired_token.id).exists()
        assert not PasswordResetToken.objects.filter(pk=used_old_token.id).exists()
        assert PasswordResetToken.objects.filter(pk=active_token.id).exists()

    def test_cleanup_expired_auth_management_command(self):
        from io import StringIO

        from django.core.management import call_command

        out = StringIO()
        call_command("cleanup_expired_auth", stdout=out)
        output = out.getvalue()
        assert "Successfully cleaned up auth data" in output


class TestB034HttpAuthContracts:
    def test_login_rotates_csrf_token_and_sets_host_only_cookie_flags(self, auth_user, csrf_client):
        client, initial_csrf = csrf_client
        res = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=initial_csrf,
        )
        assert res.status_code == status.HTTP_200_OK

        # 1. CSRF token rotated
        assert "csrftoken" in res.cookies
        rotated_csrf = res.cookies["csrftoken"].value
        assert rotated_csrf != initial_csrf
        assert len(rotated_csrf) >= 32

        # 2. Host-only session cookie flags
        assert settings.SESSION_COOKIE_NAME in res.cookies
        session_cookie = res.cookies[settings.SESSION_COOKIE_NAME]
        assert session_cookie["httponly"] is True
        assert session_cookie["samesite"] == "Lax"
        assert session_cookie["path"] == "/"
        assert session_cookie["domain"] == ""  # Host-only cookie in RFC 6265
        assert bool(session_cookie["secure"]) == bool(settings.SESSION_COOKIE_SECURE)
        assert session_cookie["max-age"] == 12 * 3600

        # 3. Cache-Control: no-store
        assert res.headers["Cache-Control"] == "no-store"

    def test_all_mutation_endpoints_enforce_csrf(self, auth_user, csrf_client):
        client, valid_csrf = csrf_client
        login_res = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=valid_csrf,
        )
        assert login_res.status_code == status.HTTP_200_OK

        # Separate client without CSRF headers
        raw_client = Client(enforce_csrf_checks=True)
        session_key = login_res.cookies[settings.SESSION_COOKIE_NAME].value
        raw_client.cookies[settings.SESSION_COOKIE_NAME] = session_key

        mutations = [
            (
                "/api/v1/auth/login",
                {"email": auth_user.email, "password": "ValidPassword123!"},
            ),
            (
                "/api/v1/auth/password/request-reset",
                {"email": auth_user.email},
            ),
            (
                "/api/v1/auth/password/reset",
                {"token": "dummy-token", "new_password": "NewPassword123!"},
            ),
            ("/api/v1/auth/logout", {}),
            ("/api/v1/auth/logout-all", {}),
            (
                "/api/v1/auth/password/change",
                {
                    "current_password": "ValidPassword123!",
                    "new_password": "NewPass123456!",
                },
            ),
        ]

        for endpoint, payload in mutations:
            resp = raw_client.post(endpoint, data=payload, content_type="application/json")
            assert resp.status_code == status.HTTP_403_FORBIDDEN, f"{endpoint} did not enforce CSRF"
            assert resp.json()["error"]["code"] == "csrf_failed"

    def test_all_auth_endpoints_set_no_store(self, auth_user, csrf_client):
        client, csrf = csrf_client

        # 1. GET /csrf
        r_csrf = client.get("/api/v1/auth/csrf")
        assert r_csrf.headers.get("Cache-Control") == "no-store"

        # 2. POST /login
        r_login = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        assert r_login.headers.get("Cache-Control") == "no-store"
        new_csrf = client.cookies["csrftoken"].value

        # 3. GET /me
        r_me = client.get("/api/v1/auth/me")
        assert r_me.headers.get("Cache-Control") == "no-store"

        # 4. POST /password/request-reset
        r_req = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": auth_user.email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=new_csrf,
        )
        assert r_req.headers.get("Cache-Control") == "no-store"

        # 5. POST /password/change
        r_chg = client.post(
            "/api/v1/auth/password/change",
            data={
                "current_password": "ValidPassword123!",
                "new_password": "NewPassChange123!",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=new_csrf,
        )
        assert r_chg.headers.get("Cache-Control") == "no-store"

        # Log back in with new password
        client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "NewPassChange123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=new_csrf,
        )
        new_csrf2 = client.cookies["csrftoken"].value

        # 6. POST /logout-all
        r_logout_all = client.post(
            "/api/v1/auth/logout-all",
            HTTP_X_CSRFTOKEN=new_csrf2,
        )
        assert r_logout_all.headers.get("Cache-Control") == "no-store"

        # Log back in
        client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "NewPassChange123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=new_csrf2,
        )
        new_csrf3 = client.cookies["csrftoken"].value

        # 7. POST /logout
        r_logout = client.post(
            "/api/v1/auth/logout",
            HTTP_X_CSRFTOKEN=new_csrf3,
        )
        assert r_logout.headers.get("Cache-Control") == "no-store"

    def test_me_lifecycle_and_race_conditions(self, auth_user, csrf_client):
        client, csrf = csrf_client
        login_res = client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        raw_key = login_res.cookies[settings.SESSION_COOKIE_NAME].value
        session = UserSession.objects.get(key_digest=digest(raw_key))

        # 1. Normal active /me
        res_me = client.get("/api/v1/auth/me")
        assert res_me.status_code == status.HTTP_200_OK
        data = res_me.json()
        assert data["id"] == str(auth_user.id)
        assert data["roles"] == ["student"]

        # 2. Race: user disabled while session is active
        auth_user.is_active = False
        auth_user.save(update_fields=["is_active"])
        res_disabled = client.get("/api/v1/auth/me")
        assert res_disabled.status_code == status.HTTP_401_UNAUTHORIZED
        assert res_disabled.json()["error"]["code"] == "account_inactive"

        # Re-activate
        auth_user.is_active = True
        auth_user.save(update_fields=["is_active"])

        # 3. Race: session revoked in background
        session.revoked_at = timezone.now()
        session.save(update_fields=["revoked_at"])
        res_revoked = client.get("/api/v1/auth/me")
        assert res_revoked.status_code == status.HTTP_401_UNAUTHORIZED
        assert res_revoked.json()["error"]["code"] == "session_revoked"

        # 4. Expired: idle timeout (simulate past idle_expires_at within model constraints)
        past_idle = timezone.now() - timedelta(minutes=45)
        session.created_at = past_idle - timedelta(minutes=5)
        session.last_seen_at = past_idle
        session.idle_expires_at = past_idle + timedelta(minutes=20)
        session.absolute_expires_at = session.created_at + timedelta(hours=12)
        session.revoked_at = None
        session.save(
            update_fields=[
                "created_at",
                "last_seen_at",
                "idle_expires_at",
                "absolute_expires_at",
                "revoked_at",
            ]
        )
        res_expired = client.get("/api/v1/auth/me")
        assert res_expired.status_code == status.HTTP_401_UNAUTHORIZED
        assert res_expired.json()["error"]["code"] == "session_expired"

        # 5. Expired: absolute timeout (simulate past absolute_expires_at within model constraints)
        past_abs = timezone.now() - timedelta(hours=13)
        session.created_at = past_abs
        session.last_seen_at = past_abs + timedelta(minutes=10)
        session.idle_expires_at = past_abs + timedelta(minutes=20)
        session.absolute_expires_at = past_abs + timedelta(hours=12)
        session.revoked_at = None
        session.save(
            update_fields=[
                "created_at",
                "last_seen_at",
                "idle_expires_at",
                "absolute_expires_at",
                "revoked_at",
            ]
        )
        res_abs_expired = client.get("/api/v1/auth/me")
        assert res_abs_expired.status_code == status.HTTP_401_UNAUTHORIZED
        assert res_abs_expired.json()["error"]["code"] == "session_expired"

    def test_actor_spoofing_in_body_is_ignored(self, auth_user, csrf_client):
        client, csrf = csrf_client
        login_res = client.post(
            "/api/v1/auth/login",
            data={
                "email": auth_user.email,
                "password": "ValidPassword123!",
                "roles": ["admin"],
                "is_superuser": True,
                "user_id": "00000000-0000-0000-0000-000000000001",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        assert login_res.status_code == status.HTTP_200_OK
        data = login_res.json()
        assert data["roles"] == ["student"]
        assert data["id"] == str(auth_user.id)

        new_csrf = client.cookies["csrftoken"].value
        # Attempt to spoof actor in password change
        change_res = client.post(
            "/api/v1/auth/password/change",
            data={
                "current_password": "ValidPassword123!",
                "new_password": "NewStrongPassword789!",
                "user_id": "00000000-0000-0000-0000-000000000001",
                "actor_id": "00000000-0000-0000-0000-000000000001",
                "role": "admin",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=new_csrf,
        )
        assert change_res.status_code == status.HTTP_204_NO_CONTENT
        auth_user.refresh_from_db()
        assert auth_user.check_password("NewStrongPassword789!")

    def test_cookie_deletion_attributes_on_logout(self, auth_user, csrf_client):
        client, csrf = csrf_client
        client.post(
            "/api/v1/auth/login",
            data={"email": auth_user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        new_csrf = client.cookies["csrftoken"].value
        logout_res = client.post(
            "/api/v1/auth/logout",
            HTTP_X_CSRFTOKEN=new_csrf,
        )
        assert logout_res.status_code == status.HTTP_204_NO_CONTENT
        deleted_cookie = logout_res.cookies[settings.SESSION_COOKIE_NAME]
        assert deleted_cookie.value == ""
        assert deleted_cookie["path"] == settings.SESSION_COOKIE_PATH
        assert deleted_cookie["samesite"] == settings.SESSION_COOKIE_SAMESITE
        assert deleted_cookie["max-age"] == 0
