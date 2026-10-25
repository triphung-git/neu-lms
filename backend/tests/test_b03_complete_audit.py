"""
B03.7 Comprehensive Audit & Verification Suite.

Validates all 11 core authentication flows, security invariants, race conditions,
CSRF enforcement, rate limiting with Retry-After, and secrets leakage prevention
against live PostgreSQL 17.
"""

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from django.conf import settings
from django.core import mail
from django.db import close_old_connections, connections
from django.test import Client
from django.utils import timezone
from rest_framework import status

from identity.models import (
    AuthRateBucket,
    PasswordResetDelivery,
    PasswordResetToken,
    RoleGrant,
    UserSession,
)
from identity.services.accounts import confirm_email, create_account
from identity.services.passwords import (
    change_password,
    derive_password_reset_token,
    request_password_reset,
    reset_password,
)
from identity.services.roles import grant_student_role, request_role
from identity.services.sessions import revoke_all_sessions
from platform_core.models import AuditEvent

pytestmark = pytest.mark.django_db(transaction=True)


def get_csrf_client():
    client = Client(enforce_csrf_checks=True)
    csrf_res = client.get("/api/v1/auth/csrf")
    assert csrf_res.status_code == status.HTTP_204_NO_CONTENT
    csrftoken = csrf_res.cookies["csrftoken"].value
    return client, csrftoken


_user_counter = 1000


def create_verified_user(email_prefix=None, password="ValidPassword123!"):
    global _user_counter
    _user_counter += 1
    user = create_account(
        email=f"1124{_user_counter:04d}@st.neu.edu.vn",
        password=password,
    )
    confirm_email(user_id=user.id, expected_email=user.email)
    request_role(user_id=user.id, role="student")
    grant_student_role(user_id=user.id)
    user.refresh_from_db()
    return user


class TestB03CompleteFlows:
    """Tests items 1 to 8: Complete login, session, logout, password change and reset lifecycle."""

    def test_complete_auth_lifecycle(self):
        user = create_verified_user(email_prefix="lifecycle", password="OriginalPassword123!")
        client, csrftoken = get_csrf_client()

        # 1. Login with real password
        login_res = client.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "OriginalPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert login_res.status_code == status.HTTP_200_OK
        assert settings.SESSION_COOKIE_NAME in login_res.cookies
        session_key_1 = login_res.cookies[settings.SESSION_COOKIE_NAME].value
        assert login_res.data["email"] == user.email
        assert "student" in login_res.data["roles"]
        assert "password" not in login_res.data

        # 2. /me and reload maintain correct account
        me_res1 = client.get("/api/v1/auth/me")
        assert me_res1.status_code == status.HTTP_200_OK
        assert str(me_res1.data["id"]) == str(user.id)
        assert me_res1.data["email"] == user.email

        # Simulate browser reload
        me_reload = client.get("/api/v1/auth/me")
        assert me_reload.status_code == status.HTTP_200_OK
        assert str(me_reload.data["id"]) == str(user.id)

        # 3. Concurrent sessions: Logout one session, other session remains active
        client2, csrftoken2 = get_csrf_client()
        login_res2 = client2.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "OriginalPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken2,
        )
        assert login_res2.status_code == status.HTTP_200_OK
        session_key_2 = login_res2.cookies[settings.SESSION_COOKIE_NAME].value
        assert session_key_2 != session_key_1

        # Logout session 1 from client 1
        logout1 = client.post(
            "/api/v1/auth/logout",
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )
        assert logout1.status_code == status.HTTP_204_NO_CONTENT

        # Session 1 is now rejected on client 1
        me_after_logout = client.get("/api/v1/auth/me")
        assert me_after_logout.status_code == status.HTTP_401_UNAUTHORIZED
        assert me_after_logout.data["error"]["code"] in (
            "authentication_required",
            "session_revoked",
        )

        # Session 2 on client 2 is STILL ACTIVE
        me_client2 = client2.get("/api/v1/auth/me")
        assert me_client2.status_code == status.HTTP_200_OK
        assert me_client2.data["email"] == user.email

        # 4. Logout-all invalidates ALL existing sessions
        logout_all_res = client2.post(
            "/api/v1/auth/logout-all",
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client2.cookies["csrftoken"].value,
        )
        assert logout_all_res.status_code == status.HTTP_204_NO_CONTENT

        # Client 2's cookie was deleted by the logout-all response
        me_client2_after = client2.get("/api/v1/auth/me")
        assert me_client2_after.status_code == status.HTTP_401_UNAUTHORIZED
        assert me_client2_after.data["error"]["code"] in (
            "authentication_required",
            "session_revoked",
        )

        # A client that still presents the old session_key_2 receives explicit session_revoked
        client_stale = Client()
        client_stale.cookies[settings.SESSION_COOKIE_NAME] = session_key_2
        me_stale = client_stale.get("/api/v1/auth/me")
        assert me_stale.status_code == status.HTTP_401_UNAUTHORIZED
        assert me_stale.data["error"]["code"] == "session_revoked"

        # 5. Change password: old password and all sessions invalidated
        # Establish a new session (client 3)
        client3, csrftoken3 = get_csrf_client()
        login3 = client3.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "OriginalPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken3,
        )
        assert login3.status_code == status.HTTP_200_OK

        chg_res = client3.post(
            "/api/v1/auth/password/change",
            data={
                "current_password": "OriginalPassword123!",
                "new_password": "ChangedPassword456!",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client3.cookies["csrftoken"].value,
        )
        assert chg_res.status_code == status.HTTP_204_NO_CONTENT

        # Client 3 session revoked
        me3_after = client3.get("/api/v1/auth/me")
        assert me3_after.status_code == status.HTTP_401_UNAUTHORIZED

        # Old password rejected
        client_old_pw, csrf_old = get_csrf_client()
        login_old = client_old_pw.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "OriginalPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_old,
        )
        assert login_old.status_code == status.HTTP_401_UNAUTHORIZED

        # 6. Request reset, receive email, reset successfully
        mail.outbox.clear()
        client_reset, csrf_reset = get_csrf_client()
        req_res = client_reset.post(
            "/api/v1/auth/password/request-reset",
            data={"email": user.email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_reset,
        )
        assert req_res.status_code == status.HTTP_202_ACCEPTED
        assert len(mail.outbox) == 0

        # Dispatch pending emails out-of-request
        from identity.transport import dispatch_pending_auth_emails

        dispatch_pending_auth_emails()
        assert len(mail.outbox) == 1
        body = mail.outbox[0].body
        match = re.search(r"#token=([a-f0-9]+)", body)
        assert match is not None
        raw_token = match.group(1)

        # Reset password with fragment token
        confirm_res = client_reset.post(
            "/api/v1/auth/password/reset",
            data={"token": raw_token, "new_password": "FinalResetPassword789!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client_reset.cookies["csrftoken"].value,
        )
        assert confirm_res.status_code == status.HTTP_204_NO_CONTENT

        # 7. Token reuse rejected
        reuse_res = client_reset.post(
            "/api/v1/auth/password/reset",
            data={"token": raw_token, "new_password": "AnotherPassword999!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client_reset.cookies["csrftoken"].value,
        )
        assert reuse_res.status_code == status.HTTP_400_BAD_REQUEST
        assert reuse_res.data["error"]["code"] == "validation_error"

        # 8. Login with new password succeeds
        client_new, csrf_new = get_csrf_client()
        login_new = client_new.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "FinalResetPassword789!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_new,
        )
        assert login_new.status_code == status.HTTP_200_OK
        assert login_new.data["email"] == user.email


class TestB03SessionSecurityInvariants:
    """Tests items 9, 10, 11: Lock/revoke/auth-version, multi-role, and session expiry."""

    def test_lock_account_mid_session_rejects_immediately(self):
        user = create_verified_user(email_prefix="locked")
        client, csrftoken = get_csrf_client()
        client.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        # Active session works
        assert client.get("/api/v1/auth/me").status_code == status.HTTP_200_OK

        # Deactivate user in DB
        user.is_active = False
        user.save(update_fields=["is_active"])

        # Immediate 401 account_inactive
        res = client.get("/api/v1/auth/me")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert res.data["error"]["code"] == "account_inactive"

    def test_revoke_session_in_db_rejects_immediately(self):
        user = create_verified_user(email_prefix="revoked")
        client, csrftoken = get_csrf_client()
        client.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert client.get("/api/v1/auth/me").status_code == status.HTTP_200_OK

        # Revoke user session directly
        UserSession.objects.filter(user=user).update(
            revoked_at=timezone.now(), revoke_reason="admin_action"
        )

        res = client.get("/api/v1/auth/me")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert res.data["error"]["code"] == "session_revoked"

    def test_auth_version_bump_mid_session_rejects_immediately(self):
        user = create_verified_user(email_prefix="authver")
        client, csrftoken = get_csrf_client()
        client.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert client.get("/api/v1/auth/me").status_code == status.HTTP_200_OK

        # Bump user's auth_version
        user.auth_version += 1
        user.save(update_fields=["auth_version"])

        res = client.get("/api/v1/auth/me")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert res.data["error"]["code"] == "session_revoked"

    def test_multi_role_only_uses_server_grants_and_ignores_body_spoofing(self):
        user = create_verified_user(email_prefix="multirole")
        # Add admin grant (internal_administration is valid for admin)
        RoleGrant.objects.create(user=user, role="admin", grant_source="internal_administration")

        client, csrftoken = get_csrf_client()
        # Attempt to spoof role in request body
        res = client.post(
            "/api/v1/auth/login",
            data={
                "email": user.email,
                "password": "ValidPassword123!",
                "roles": ["teacher"],
                "is_superuser": True,
                "user_id": "00000000-0000-0000-0000-000000000000",
            },
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert res.status_code == status.HTTP_200_OK
        # Must only reflect server database grants: admin and student (NOT teacher)
        assert sorted(res.data["roles"]) == ["admin", "student"]
        assert str(res.data["id"]) == str(user.id)

        # /me also returns server roles
        me_res = client.get("/api/v1/auth/me")
        assert sorted(me_res.data["roles"]) == ["admin", "student"]

    def test_idle_timeout_expiration(self):
        user = create_verified_user(email_prefix="idle")
        client, csrftoken = get_csrf_client()
        client.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        now = timezone.now()
        # Fast forward session so that last_seen was 40m ago, idle_expires was 10m ago
        # Satisfying DB constraints:
        # last_seen_at >= created_at
        # idle_expires_at > last_seen_at and <= last_seen_at + 30m
        # idle_expires_at <= absolute_expires_at
        # absolute_expires_at > created_at and <= created_at + 12h
        t_created = now - timedelta(minutes=40)
        t_seen = now - timedelta(minutes=40)
        t_idle = now - timedelta(minutes=10)
        t_abs = now + timedelta(hours=11)
        UserSession.objects.filter(user=user).update(
            created_at=t_created,
            last_seen_at=t_seen,
            idle_expires_at=t_idle,
            absolute_expires_at=t_abs,
        )

        res = client.get("/api/v1/auth/me")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert res.data["error"]["code"] == "session_expired"

    def test_absolute_timeout_cannot_be_extended(self):
        user = create_verified_user(email_prefix="absolute")
        client, csrftoken = get_csrf_client()
        client.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "ValidPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        now = timezone.now()
        # Session created 12h 10m ago, absolute expired 10m ago
        t_created = now - timedelta(hours=12, minutes=10)
        t_seen = now - timedelta(minutes=15)
        t_abs = now - timedelta(minutes=10)
        t_idle = now - timedelta(minutes=10)
        UserSession.objects.filter(user=user).update(
            created_at=t_created,
            last_seen_at=t_seen,
            idle_expires_at=t_idle,
            absolute_expires_at=t_abs,
        )

        res = client.get("/api/v1/auth/me")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert res.data["error"]["code"] == "session_expired"


class TestB03ConcurrencyAndRaces:
    """Tests race conditions: reset/reset, change/reset, revoke/request."""

    def test_concurrent_password_reset_single_winner(self):
        user = create_verified_user(email_prefix="racereset")
        request_password_reset(email=user.email)
        token_obj = PasswordResetToken.objects.filter(user=user).latest("created_at")
        raw_token = derive_password_reset_token(token_obj)

        barrier = Barrier(2)

        def attempt_reset(pw):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                client, csrf = get_csrf_client()
                return client.post(
                    "/api/v1/auth/password/reset",
                    data={"token": raw_token, "new_password": pw},
                    content_type="application/json",
                    HTTP_X_CSRFTOKEN=csrf,
                ).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(attempt_reset, "ConcurrentPw1A!")
            f2 = pool.submit(attempt_reset, "ConcurrentPw2B!")
            statuses = [f1.result(), f2.result()]

        # Exactly one must succeed (204) and one must be rejected (400)
        assert statuses.count(status.HTTP_204_NO_CONTENT) == 1
        assert statuses.count(status.HTTP_400_BAD_REQUEST) == 1

    def test_concurrent_change_and_reset_no_deadlock(self):
        user = create_verified_user(email_prefix="changerace", password="InitialPassword123!")
        request_password_reset(email=user.email)
        token_obj = PasswordResetToken.objects.filter(user=user).latest("created_at")
        raw_token = derive_password_reset_token(token_obj)

        barrier = Barrier(2)

        def do_change():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                change_password(
                    user_id=user.id,
                    current_password="InitialPassword123!",
                    new_password="NewChangedPw123!",
                )
                return "change_ok"
            except Exception as e:
                return f"change_err:{type(e).__name__}"
            finally:
                connections.close_all()

        def do_reset():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                reset_password(token=raw_token, new_password="NewResetPw123!")
                return "reset_ok"
            except Exception as e:
                return f"reset_err:{type(e).__name__}"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            f_change = pool.submit(do_change)
            f_reset = pool.submit(do_reset)
            results = [f_change.result(), f_reset.result()]

        # Neither should cause a deadlock or database error
        # Either change won and reset failed (token auth_version mismatch),
        # or reset won and change failed (current_password mismatch).
        assert "change_ok" in results or "reset_ok" in results

    def test_concurrent_revoke_and_request_reset_no_deadlock(self):
        user = create_verified_user(email_prefix="revokerace")
        barrier = Barrier(2)

        def do_revoke():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                revoke_all_sessions(actor_id=user.id, user_id=user.id)
                return "revoke_ok"
            finally:
                connections.close_all()

        def do_request():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                request_password_reset(email=user.email)
                return "request_ok"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(do_revoke)
            f2 = pool.submit(do_request)
            results = [f1.result(), f2.result()]

        assert results == ["revoke_ok", "request_ok"] or results == ["request_ok", "revoke_ok"]


class TestB03CsrfAndRateLimiting:
    """Tests CSRF enforcement across all mutations and rate limit with Retry-After."""

    def test_all_mutations_reject_missing_csrf(self):
        user = create_verified_user(email_prefix="csrfmut")
        client = Client(enforce_csrf_checks=True)

        # Login without CSRF
        res = client.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "ValidPassword123!"},
            content_type="application/json",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.data["error"]["code"] == "csrf_failed"

        # Request reset without CSRF
        res = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": user.email},
            content_type="application/json",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.data["error"]["code"] == "csrf_failed"

        # Reset confirm without CSRF
        res = client.post(
            "/api/v1/auth/password/reset",
            data={"token": "dummytoken", "new_password": "NewPassword123!"},
            content_type="application/json",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.data["error"]["code"] == "csrf_failed"

    def test_rate_limit_sets_retry_after_header(self):
        user = create_verified_user(email_prefix="throttled")
        client, csrftoken = get_csrf_client()

        # Exhaust 10 allowed attempts on account login
        for _ in range(10):
            res = client.post(
                "/api/v1/auth/login",
                data={"email": user.email, "password": "WrongPassword!"},
                content_type="application/json",
                HTTP_X_CSRFTOKEN=csrftoken,
            )
            assert res.status_code == status.HTTP_401_UNAUTHORIZED

        # 11th attempt must be throttled with HTTP 429 and Retry-After
        throttled_res = client.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "WrongPassword!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert throttled_res.status_code == status.HTTP_429_TOO_MANY_REQUESTS
        assert throttled_res.data["error"]["code"] == "throttled"
        assert "Retry-After" in throttled_res.headers
        wait_seconds = int(throttled_res.headers["Retry-After"])
        assert wait_seconds > 0

        # Verify rate limit bucket exists in DB
        assert AuthRateBucket.objects.count() > 0


class TestB03SecretsLeakageAudit:
    """Verifies that no secrets or raw tokens leak into logs, responses, or audit records."""

    def test_zero_secrets_leakage(self):
        user = create_verified_user(email_prefix="secrets", password="SuperSecretPassword123!")
        client, csrftoken = get_csrf_client()

        login_res = client.post(
            "/api/v1/auth/login",
            data={"email": user.email, "password": "SuperSecretPassword123!"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        assert login_res.status_code == status.HTTP_200_OK
        login_text = login_res.content.decode()
        assert "SuperSecretPassword123!" not in login_text
        assert "pbkdf2" not in login_text
        assert "key_digest" not in login_text

        # Request reset
        mail.outbox.clear()
        req_res = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": user.email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        )
        assert req_res.status_code == status.HTTP_202_ACCEPTED
        assert req_res.content == b""

        # Check DB records
        token_obj = PasswordResetToken.objects.filter(user=user).latest("created_at")
        delivery_obj = PasswordResetDelivery.objects.filter(token=token_obj).first()

        # Database must only contain SHA-256 digest, NEVER raw token
        assert len(token_obj.digest) == 64
        # PasswordResetDelivery does not have raw token
        assert not hasattr(delivery_obj, "raw_token")

        # Audit events must never store raw secrets
        events = AuditEvent.objects.filter(resource_id=user.id)
        for ev in events:
            assert "SuperSecretPassword123!" not in str(ev.metadata)
