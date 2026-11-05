import re
import smtplib
from unittest.mock import patch

import pytest
from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from identity.models import (
    EmailVerificationDelivery,
    EmailVerificationToken,
    PasswordResetDelivery,
    User,
)
from identity.services.common import digest, invalidate_sessions
from identity.services.passwords import (
    cleanup_expired_auth_data,
    request_password_reset,
)
from identity.transport import (
    derive_email_verification_token,
    dispatch_pending_auth_emails,
)


@pytest.fixture
def auth_user(db):
    user = User.objects.create(
        email="dispatcher_test@neu.edu.vn",
        display_name="Dispatcher User",
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


class TestHttpDoesNotCallSmtp:
    @pytest.mark.django_db(transaction=True)
    def test_http_request_reset_does_not_call_smtp_and_leaves_delivery_pending(
        self, auth_user, csrf_client
    ):
        client, csrftoken = csrf_client
        mail.outbox.clear()

        # Execute HTTP request
        res = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": auth_user.email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        # 1. HTTP returns 202 Accepted
        assert res.status_code == status.HTTP_202_ACCEPTED
        assert res.content == b""

        # 2. SMTP was NOT called in the HTTP request path
        assert len(mail.outbox) == 0

        # 3. Delivery record created in database with status PENDING, attempts 0
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        assert delivery is not None
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert delivery.attempts == 0
        assert delivery.sent_at is None

    @pytest.mark.django_db(transaction=True)
    def test_known_and_unknown_accounts_have_identical_public_status_and_body(
        self, auth_user, csrf_client
    ):
        client, csrftoken = csrf_client
        mail.outbox.clear()

        # Known account
        res_known = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": auth_user.email},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        # Unknown account
        res_unknown = client.post(
            "/api/v1/auth/password/request-reset",
            data={"email": "nonexistent@neu.edu.vn"},
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrftoken,
        )

        assert res_known.status_code == status.HTTP_202_ACCEPTED
        assert res_unknown.status_code == status.HTTP_202_ACCEPTED
        assert res_known.content == res_unknown.content == b""
        assert len(mail.outbox) == 0


class TestAuthEmailDispatcher:
    @pytest.mark.django_db(transaction=True)
    def test_dispatch_processes_pending_password_reset(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)

        # Before dispatch: pending, 0 mails sent
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert len(mail.outbox) == 0

        # Run dispatcher
        results = dispatch_pending_auth_emails(max_batch=10)
        assert len(results["password_reset"]) == 1

        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.SENT
        assert delivery.attempts == 1
        assert delivery.sent_at is not None
        assert delivery.last_error_code == ""

        # Mail delivered to outbox
        assert len(mail.outbox) == 1
        sent_mail = mail.outbox[0]
        assert sent_mail.to == [auth_user.email]
        assert "reset-password#token=" in sent_mail.body

    @pytest.mark.django_db(transaction=True)
    def test_dispatch_processes_pending_email_verification(self, auth_user):
        mail.outbox.clear()
        now = timezone.now().replace(microsecond=0)
        token = EmailVerificationToken(
            user=auth_user,
            email=auth_user.email,
            auth_version=auth_user.auth_version,
            created_at=now,
            expires_at=now + timezone.timedelta(hours=24),
        )
        raw_token = derive_email_verification_token(token)
        token.digest = digest(raw_token)
        token.save()

        delivery = EmailVerificationDelivery.objects.create(
            token=token,
            user=auth_user,
            email=auth_user.email,
            status=EmailVerificationDelivery.Status.PENDING,
            attempts=0,
            max_attempts=3,
        )

        assert len(mail.outbox) == 0

        # Dispatch
        results = dispatch_pending_auth_emails(max_batch=10)
        assert len(results["email_verification"]) == 1

        delivery.refresh_from_db()
        assert delivery.status == EmailVerificationDelivery.Status.SENT
        assert delivery.attempts == 1
        assert delivery.sent_at is not None

        assert len(mail.outbox) == 1
        sent_mail = mail.outbox[0]
        assert sent_mail.to == [auth_user.email]
        assert "verify-email#token=" in sent_mail.body
        match = re.search(r"#token=([A-Fa-f0-9]+)", sent_mail.body)
        assert match is not None
        assert match.group(1) == raw_token

    @pytest.mark.django_db(transaction=True)
    def test_dispatcher_bounded_retry_and_terminal_failed(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()

        # Attempt 1 fails
        with patch(
            "identity.transport.send_mail",
            side_effect=smtplib.SMTPConnectError(421, b"Connection refused"),
        ):
            dispatch_pending_auth_emails()
        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert delivery.attempts == 1
        assert delivery.last_error_code == "smtp_connection_error"

        # Attempt 2 fails
        with patch(
            "identity.transport.send_mail",
            side_effect=TimeoutError("Timed out"),
        ):
            dispatch_pending_auth_emails()
        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.PENDING
        assert delivery.attempts == 2
        assert delivery.last_error_code == "smtp_timeout"

        # Attempt 3 fails -> reaches max_attempts (3) -> terminal FAILED
        with patch(
            "identity.transport.send_mail",
            side_effect=TimeoutError("Timed out"),
        ):
            dispatch_pending_auth_emails()
        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.FAILED
        assert delivery.attempts == 3

        # Subsequent dispatch run ignores terminal failed delivery
        results = dispatch_pending_auth_emails()
        assert len(results["password_reset"]) == 0
        assert len(mail.outbox) == 0

    @pytest.mark.django_db(transaction=True)
    def test_dispatcher_stale_processing_recovery(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()

        # Simulate stuck worker in PROCESSING 10 minutes ago
        delivery.status = PasswordResetDelivery.Status.PROCESSING
        delivery.last_attempt_at = timezone.now() - timezone.timedelta(minutes=10)
        delivery.attempts = 1
        delivery.save()

        # Dispatcher should recover and deliver
        results = dispatch_pending_auth_emails()
        assert len(results["password_reset"]) == 1

        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.SENT
        assert delivery.attempts == 2
        assert len(mail.outbox) == 1

    @pytest.mark.django_db(transaction=True)
    def test_dispatcher_recent_processing_is_skipped(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()

        # Simulate currently active worker in PROCESSING 1 minute ago
        delivery.status = PasswordResetDelivery.Status.PROCESSING
        delivery.last_attempt_at = timezone.now() - timezone.timedelta(minutes=1)
        delivery.attempts = 1
        delivery.save()

        # Dispatcher should skip it to avoid concurrent conflict
        results = dispatch_pending_auth_emails()
        assert len(results["password_reset"]) == 0
        assert len(mail.outbox) == 0

        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.PROCESSING

    @pytest.mark.django_db(transaction=True)
    def test_secret_key_rotation_fails_delivery_gracefully(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()

        # Secret key rotated before email is dispatched
        with override_settings(SECRET_KEY="new-rotated-secret-key-that-does-not-match"):
            dispatch_pending_auth_emails()

        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.FAILED
        assert delivery.last_error_code == "token_derivation_mismatch"
        assert len(mail.outbox) == 0

    @pytest.mark.django_db(transaction=True)
    def test_token_expired_or_user_auth_version_bumped_before_dispatch(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)
        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()

        # Bump user auth version (e.g. admin revoked session or password changed)
        invalidate_sessions(auth_user, "admin_revocation")
        auth_user.refresh_from_db()

        dispatch_pending_auth_emails()
        delivery.refresh_from_db()
        assert delivery.status == PasswordResetDelivery.Status.FAILED
        assert delivery.last_error_code == "stale_auth_version"
        assert len(mail.outbox) == 0


class TestManagementCommandsAndCleanup:
    @pytest.mark.django_db(transaction=True)
    def test_dispatch_auth_emails_command(self, auth_user):
        mail.outbox.clear()
        request_password_reset(email=auth_user.email)

        # Run management command
        call_command("dispatch_auth_emails", batch_size=10)

        delivery = PasswordResetDelivery.objects.filter(user=auth_user).first()
        assert delivery.status == PasswordResetDelivery.Status.SENT
        assert len(mail.outbox) == 1

    @pytest.mark.django_db(transaction=True)
    def test_cleanup_expired_auth_cleans_verification_tokens(self, auth_user):
        now = timezone.now()
        # Expired verification token
        expired_token = EmailVerificationToken.objects.create(
            user=auth_user,
            email=auth_user.email,
            digest="a" * 64,
            auth_version=1,
            created_at=now - timezone.timedelta(days=2),
            expires_at=now - timezone.timedelta(days=1),
        )
        EmailVerificationDelivery.objects.create(
            token=expired_token,
            user=auth_user,
            email=auth_user.email,
            status=EmailVerificationDelivery.Status.FAILED,
        )

        stats = cleanup_expired_auth_data(now=now)
        assert stats["verification_tokens_deleted"] >= 1
        assert not EmailVerificationToken.objects.filter(pk=expired_token.pk).exists()
