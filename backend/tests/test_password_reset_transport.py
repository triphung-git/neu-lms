import json
import logging
import os
import re
import smtplib
import urllib.error
import urllib.request
from unittest.mock import patch

import pytest
from django.conf import settings
from django.core import mail
from django.db import connection, transaction
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APIClient

from identity.models import PasswordResetDelivery, PasswordResetToken, User
from identity.services.common import digest, invalidate_sessions
from identity.services.passwords import (
    login_password,
    request_password_reset,
    reset_password,
)
from identity.transport import (
    deliver_password_reset,
    retry_pending_reset_deliveries,
)
from platform_core.models import AuditEvent, OutboxEvent


@pytest.fixture
def auth_user(db):
    user = User.objects.create(
        email="transport_student@neu.edu.vn",
        display_name="Transport Student",
        is_active=True,
    )
    user.set_password("CurrentPassword123!")
    user.save()
    user.refresh_from_db()
    return user


@pytest.fixture
def csrf_client(db):
    client = APIClient(enforce_csrf_checks=True)
    res = client.get("/api/v1/auth/csrf")
    csrftoken = res.cookies["csrftoken"].value
    return client, csrftoken


class TestPasswordResetPublicResponse:
    @pytest.mark.django_db(transaction=True)
    def test_unknown_inactive_known_account_public_response_is_identical(
        self, auth_user, csrf_client
    ):
        client, csrftoken = csrf_client
        inactive_user = User.objects.create(
            email="inactive_user@neu.edu.vn",
            is_active=False,
        )
        inactive_user.set_password("InactivePass123!")
        inactive_user.save()

        # 1. Known active account
        res_known = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": auth_user.email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        # 2. Inactive account
        res_inactive = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": inactive_user.email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )
        # 3. Unknown non-existent account
        res_unknown = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": "nonexistent_account@neu.edu.vn"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        # Status must all be 202 Accepted
        assert res_known.status_code == status.HTTP_202_ACCEPTED
        assert res_inactive.status_code == status.HTTP_202_ACCEPTED
        assert res_unknown.status_code == status.HTTP_202_ACCEPTED

        # Body must be identical (empty / 202 without account hints)
        assert res_known.content == res_inactive.content == res_unknown.content

        # Deliveries created only for the active user
        assert PasswordResetDelivery.objects.filter(user=auth_user).count() == 1
        assert PasswordResetDelivery.objects.filter(user=inactive_user).count() == 0
        assert (
            PasswordResetDelivery.objects.filter(email="nonexistent_account@neu.edu.vn").count()
            == 0
        )


class TestPasswordResetDeliveryAndRetries:
    @pytest.mark.django_db(transaction=True)
    def test_delivery_success_and_state_tracking(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)

        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        assert delivery is not None
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert delivery.attempts == 0
        assert len(mail.outbox) == 0

        # Deliver out-of-request
        deliver_password_reset(delivery.id)
        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.SENT
        assert delivery.attempts == 1
        assert delivery.sent_at is not None
        assert delivery.last_error_code == ""

        # Mail delivered to outbox
        assert len(mail.outbox) == 1
        sent_email = mail.outbox[0]
        assert sent_email.to == [auth_user.email]
        assert "Reset your password within 30 minutes" in sent_email.body

        # Link uses PUBLIC_APP_ORIGIN and fragment #token=...
        prefix = f"Reset your password within 30 minutes: {settings.PUBLIC_APP_ORIGIN}"
        assert sent_email.body.startswith(f"{prefix}/reset-password#token=")

        match = re.search(r"#token=([A-Fa-f0-9]+)", sent_email.body)
        assert match is not None
        raw_token = match.group(1)

        # Token can reset password successfully
        reset_password(token=raw_token, new_password="BrandNewPassword456!")
        auth_user.refresh_from_db()
        user_after, session = login_password(email=auth_user.email, password="BrandNewPassword456!")
        assert user_after.id == auth_user.id
        assert session is not None

    @pytest.mark.django_db(transaction=True)
    def test_delivery_provider_error_and_retry(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert delivery.attempts == 0

        # Simulate SMTP network outage on dispatch
        with patch(
            "identity.transport.send_mail",
            side_effect=smtplib.SMTPConnectError(421, b"Service unavailable"),
        ):
            deliver_password_reset(delivery.id)

        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert delivery.attempts == 1
        assert delivery.last_error_code == "smtp_connection_error"
        assert delivery.sent_at is None
        assert len(mail.outbox) == 0

        # Now simulate network recovery and run retry_pending_reset_deliveries
        retried = retry_pending_reset_deliveries(max_batch=10)
        assert len(retried) == 1
        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.SENT
        assert delivery.attempts == 2
        assert delivery.sent_at is not None
        assert delivery.last_error_code == ""
        assert len(mail.outbox) == 1

    @pytest.mark.django_db(transaction=True)
    def test_delivery_max_attempts_exhaustion(self, auth_user):
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert delivery.attempts == 0

        # First failure
        with patch(
            "identity.transport.send_mail",
            side_effect=TimeoutError("Connection timed out"),
        ):
            deliver_password_reset(delivery.id)

        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert delivery.attempts == 1
        assert delivery.last_error_code == "smtp_timeout"

        # Second failure
        with patch(
            "identity.transport.send_mail",
            side_effect=TimeoutError("Connection timed out"),
        ):
            deliver_password_reset(delivery.id)
        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert delivery.attempts == 2

        # Third failure: should transition to terminal FAILED status
        with patch(
            "identity.transport.send_mail",
            side_effect=TimeoutError("Connection timed out"),
        ):
            deliver_password_reset(delivery.id)
        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.FAILED
        assert delivery.attempts == 3
        assert delivery.last_error_code == "smtp_timeout"

        # Subsequent retry run ignores exhausted delivery
        retried = retry_pending_reset_deliveries()
        assert len(retried) == 0

    @pytest.mark.django_db(transaction=True)
    def test_duplicate_dispatch_is_idempotent(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        deliver_password_reset(delivery.id)
        assert len(mail.outbox) == 1

        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.SENT

        # Calling deliver_password_reset a second time on already sent delivery
        deliver_password_reset(delivery.id)
        # No duplicate mail sent
        assert len(mail.outbox) == 1

    @pytest.mark.django_db(transaction=True)
    def test_stale_token_after_auth_version_bump_fails_delivery(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        assert delivery.status == PasswordResetDelivery.Status.PENDING

        # User changes password or invalidates sessions, bumping auth_version
        invalidate_sessions(auth_user, "password_changed")
        auth_user.refresh_from_db()

        # Retry delivery now detects stale token auth_version
        deliver_password_reset(delivery.id)
        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.FAILED
        assert delivery.last_error_code == "stale_auth_version"
        assert len(mail.outbox) == 0


class TestSecurityInvariantsNoTokenLeakage:
    @pytest.mark.django_db(transaction=True)
    def test_no_raw_token_in_audit_outbox_or_database(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)

        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        deliver_password_reset(delivery.id)
        token_record = delivery.token

        match = re.search(r"#token=([A-Fa-f0-9]+)", mail.outbox[0].body)
        raw_token = match.group(1)

        # 1. Database table PasswordResetToken does NOT store raw_token
        assert token_record.digest == digest(raw_token)
        assert raw_token != token_record.digest

        # Check DB columns directly via raw SQL
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT digest FROM identity_passwordresettoken WHERE id = %s",
                [str(token_record.id)],
            )
            stored_digest = cursor.fetchone()[0]
            assert stored_digest == token_record.digest
            assert raw_token not in stored_digest

        # 2. Database table PasswordResetDelivery does NOT store raw_token
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT email, status, last_error_code "
                "FROM identity_passwordresetdelivery WHERE id = %s",
                [str(delivery.id)],
            )
            row = cursor.fetchone()
            assert raw_token not in str(row)

        # 3. AuditEvent and OutboxEvent do NOT store raw_token
        assert not AuditEvent.objects.filter(metadata__icontains=raw_token).exists()
        assert not OutboxEvent.objects.filter(payload__icontains=raw_token).exists()

    @pytest.mark.django_db(transaction=True)
    def test_no_token_or_email_in_logs_on_delivery_failure(self, auth_user, caplog):
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        with caplog.at_level(logging.ERROR):
            with patch(
                "identity.transport.send_mail",
                side_effect=smtplib.SMTPConnectError(554, b"Host connection failed"),
            ):
                deliver_password_reset(delivery.id)

        # Check log output: must not contain token, email, or password
        log_text = caplog.text
        assert "Password reset delivery attempt failed" in log_text
        assert "smtp_connection_error" in log_text
        assert auth_user.email not in log_text
        assert "CurrentPassword123!" not in log_text

    @pytest.mark.django_db(transaction=True)
    def test_rollback_does_not_send_email_before_commit(self, auth_user):
        mail.outbox.clear()
        try:
            with transaction.atomic():
                request_password_reset(email=auth_user.email)
                raise RuntimeError("Simulated mid-transaction failure")
        except RuntimeError:
            pass

        # Verification: No delivery record, no mail sent
        assert PasswordResetDelivery.objects.filter(user=auth_user).count() == 0
        assert PasswordResetToken.objects.filter(user=auth_user).count() == 0
        assert len(mail.outbox) == 0


class TestMailpitRealSmtpIntegration:
    @pytest.mark.django_db(transaction=True)
    def test_real_mailpit_smtp_and_rest_api_verification(self, auth_user):
        """End-to-end integration test with real Mailpit container on 11025/18025."""
        mailpit_origin = os.environ.get("MAILPIT_HTTP_ORIGIN", "http://127.0.0.1:18025")
        mailpit_api = mailpit_origin + "/api/v1/messages"
        # 1. Clear messages in Mailpit
        req = urllib.request.Request(mailpit_api, method="DELETE")
        try:
            with urllib.request.urlopen(req, timeout=3) as resp:
                response_status = resp.status
        except (urllib.error.URLError, TimeoutError) as exc:
            if os.environ.get("GITHUB_ACTIONS") == "true":
                pytest.fail("Mailpit service is required on GitHub Actions", pytrace=False)
            pytest.skip(f"Mailpit service not reachable: {exc}")
        assert response_status == 200

        # 2. Request reset (leaves delivery in PENDING without calling SMTP)
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        assert delivery is not None
        assert delivery.status == PasswordResetDelivery.Status.PENDING

        # 3. Dispatch reset out-of-request using real SMTP backend pointing to Mailpit
        with override_settings(
            EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
            EMAIL_HOST="127.0.0.1",
            EMAIL_PORT=int(os.environ.get("MAILPIT_SMTP_PORT", "11025")),
            EMAIL_TIMEOUT=5,
        ):
            deliver_password_reset(delivery.id)

        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.SENT

        # 3. Query Mailpit REST API to verify received email
        req_get = urllib.request.Request(mailpit_api, method="GET")
        with urllib.request.urlopen(req_get, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        assert data["total"] >= 1
        msg = data["messages"][0]
        assert msg["Subject"] == "NEU LMS: password reset"
        assert any(auth_user.email in recipient["Address"] for recipient in msg["To"])

        # 4. Fetch full message body from Mailpit
        msg_id = msg["ID"]
        msg_detail_url = f"{mailpit_origin}/api/v1/message/{msg_id}"
        with urllib.request.urlopen(msg_detail_url, timeout=3) as resp:
            msg_detail = json.loads(resp.read().decode("utf-8"))

        body_text = msg_detail.get("Text", "")
        assert f"{settings.PUBLIC_APP_ORIGIN}/reset-password#token=" in body_text

        match = re.search(r"#token=([A-Fa-f0-9]+)", body_text)
        assert match is not None
        token_from_mailpit = match.group(1)

        # 5. Confirm password reset using the token delivered via real Mailpit SMTP
        reset_password(token=token_from_mailpit, new_password="MailpitVerifiedPassword789!")

        # 6. Verify user can log in with the new password
        user_auth, session = login_password(
            email=auth_user.email, password="MailpitVerifiedPassword789!"
        )
        assert user_auth.id == auth_user.id
        assert session is not None
