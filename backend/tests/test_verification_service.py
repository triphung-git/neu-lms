"""Comprehensive test suite for Task T04 — Email Verification Services.

Covers:
1. Verify student email: grants student role via grant_student_role,
   updates VerifiedEmail atomically.
2. Verify teacher email: updates VerifiedEmail, but RoleRequest remains
   PENDING awaiting admin approval.
3. Resend verification: invalidates prior tokens (used_at set) and marks
   uncompleted deliveries superseded.
4. Token reuse and expiration: single-use enforcement, 24h expiration, and safe error handling.
5. Account and email binding: token bound to account, sole email, auth_version, and purpose prefix.
6. Negative security tests: inactive accounts, stale auth_version, email mismatch, malformed tokens.
7. Concurrency: concurrent verification with the same token results in exactly one winner.
8. Rollback atomicity: failure during verification/grant rolls back all mutations.
9. No self-grant / No un-revocation: revoked grants are NEVER restored by automated verification.
10. Resend safety: non-existent email, inactive accounts, already verified accounts, and rate limit.
"""

import concurrent.futures
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core import mail
from django.db import connection
from django.utils import timezone
from rest_framework.exceptions import Throttled

from identity.models import (
    EmailVerificationDelivery,
    EmailVerificationToken,
    Role,
    RoleGrant,
    RoleRequest,
)
from identity.services.accounts import create_account, register_account
from identity.services.common import digest, has_role
from identity.services.roles import request_role, revoke_role
from identity.services.verification import (
    issue_verification_token,
    resend_email_verification,
    verify_email,
)
from identity.transport import derive_email_verification_token, dispatch_pending_auth_emails
from platform_core.errors import DomainError
from platform_core.models import AuditEvent

VALID_PASSWORD = "StrongPassword123!"


def create_admin_user(email="admin@neu.edu.vn"):
    admin = create_account(email=email, password=VALID_PASSWORD, display_name="LMS Admin")
    RoleGrant.objects.create(
        user=admin,
        role=Role.ADMIN,
        grant_source="internal_administration",
    )
    return admin


@pytest.mark.django_db(transaction=True)
class TestVerifyStudentAndTeacher:
    def test_verify_student_email_automatically_grants_student_role(self):
        user = register_account(
            email="11241001@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Student One",
            requested_role=Role.STUDENT,
        )
        token_obj = EmailVerificationToken.objects.get(user=user)
        raw_token = derive_email_verification_token(token_obj)

        result = verify_email(token=raw_token)

        assert result["verified"] is True
        assert result["email"] == user.email
        assert result["granted_roles"] == [Role.STUDENT]

        # 1. VerifiedEmail updated
        user.refresh_from_db()
        assert user.verifiedemail.verified_at is not None
        assert user.verifiedemail.email_digest == digest(user.email)

        # 2. Token marked used
        token_obj.refresh_from_db()
        assert token_obj.used_at is not None

        # 3. RoleRequest approved
        role_req = RoleRequest.objects.get(user=user, role=Role.STUDENT)
        assert role_req.status == RoleRequest.Status.APPROVED
        assert role_req.reviewed_by == user
        assert role_req.review_reason == "verified_student_email"

        # 4. RoleGrant created
        assert has_role(user, Role.STUDENT)
        grant = RoleGrant.objects.get(user=user, role=Role.STUDENT)
        assert grant.grant_source == "verified_student_email"
        assert grant.revoked_at is None

        # 5. Audit events recorded
        assert AuditEvent.objects.filter(action="email.verified", resource_id=user.id).exists()
        assert AuditEvent.objects.filter(action="role.reviewed", resource_id=role_req.id).exists()
        assert AuditEvent.objects.filter(action="role.granted", resource_id=grant.id).exists()

    def test_verify_teacher_email_marks_verified_but_keeps_request_pending(self):
        user = register_account(
            email="teacher1001@neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Teacher One",
            requested_role=Role.TEACHER,
        )
        token_obj = EmailVerificationToken.objects.get(user=user)
        raw_token = derive_email_verification_token(token_obj)

        result = verify_email(token=raw_token)

        assert result["verified"] is True
        assert result["email"] == user.email
        assert result["granted_roles"] == []

        # 1. VerifiedEmail updated
        user.refresh_from_db()
        assert user.verifiedemail.verified_at is not None
        assert user.verifiedemail.email_digest == digest(user.email)

        # 2. Token marked used
        token_obj.refresh_from_db()
        assert token_obj.used_at is not None

        # 3. RoleRequest remains PENDING (never self-grant!)
        role_req = RoleRequest.objects.get(user=user, role=Role.TEACHER)
        assert role_req.status == RoleRequest.Status.PENDING
        assert role_req.reviewed_at is None
        assert role_req.reviewed_by is None

        # 4. Absolutely NO RoleGrant created
        assert not has_role(user, Role.TEACHER)
        assert not has_role(user, Role.ADMIN)
        assert RoleGrant.objects.filter(user=user).count() == 0

        # 5. Audit event recorded for email verification only
        assert AuditEvent.objects.filter(action="email.verified", resource_id=user.id).exists()
        assert not AuditEvent.objects.filter(action="role.granted", actor=user).exists()

    def test_verify_account_without_pending_role_request(self):
        user = create_account(
            email="11241002@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Direct Account",
        )
        raw_token, token_obj, _ = issue_verification_token(user=user)

        result = verify_email(token=raw_token)

        assert result["verified"] is True
        assert result["granted_roles"] == []
        user.refresh_from_db()
        assert user.verifiedemail.verified_at is not None


@pytest.mark.django_db(transaction=True)
class TestResendAndTokenInvalidation:
    def test_resend_verification_invalidates_prior_tokens(self):
        user = register_account(
            email="11241003@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Resend User",
            requested_role=Role.STUDENT,
        )
        token_1 = EmailVerificationToken.objects.get(user=user)
        raw_token_1 = derive_email_verification_token(token_1)
        delivery_1 = EmailVerificationDelivery.objects.get(token=token_1)

        # Resend email verification
        new_delivery = resend_email_verification(email=user.email)
        assert new_delivery is not None
        assert hasattr(new_delivery, "raw_token")
        raw_token_2 = new_delivery.raw_token
        token_2 = new_delivery.token

        # 1. Prior token invalidated (used_at set to non-null)
        token_1.refresh_from_db()
        assert token_1.used_at is not None
        assert token_1.id != token_2.id

        # 2. Prior delivery superseded
        delivery_1.refresh_from_db()
        assert delivery_1.status == EmailVerificationDelivery.Status.FAILED
        assert delivery_1.last_error_code == "superseded_by_resend"

        # 3. New token is unconsumed
        assert token_2.used_at is None
        assert new_delivery.status == EmailVerificationDelivery.Status.PENDING

        # 4. Old token REJECTED
        with pytest.raises(DomainError, match="TOKEN_INVALID_OR_EXPIRED"):
            verify_email(token=raw_token_1)

        # 5. New token SUCCEEDS
        result = verify_email(token=raw_token_2)
        assert result["verified"] is True
        assert result["granted_roles"] == [Role.STUDENT]

    def test_multiple_resends_only_latest_token_is_valid(self):
        user = register_account(
            email="11241004@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Multi Resend User",
            requested_role=Role.STUDENT,
        )
        token_1 = EmailVerificationToken.objects.get(user=user)
        raw_token_1 = derive_email_verification_token(token_1)

        delivery_2 = resend_email_verification(email=user.email)
        raw_token_2 = delivery_2.raw_token

        delivery_3 = resend_email_verification(email=user.email)
        raw_token_3 = delivery_3.raw_token

        # Token 1 and 2 are invalid
        with pytest.raises(DomainError, match="TOKEN_INVALID_OR_EXPIRED"):
            verify_email(token=raw_token_1)

        with pytest.raises(DomainError, match="TOKEN_INVALID_OR_EXPIRED"):
            verify_email(token=raw_token_2)

        # Token 3 is valid
        result = verify_email(token=raw_token_3)
        assert result["verified"] is True
        assert result["granted_roles"] == [Role.STUDENT]

    def test_resend_does_not_call_smtp_in_transaction(self):
        user = register_account(
            email="11241005@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="No SMTP Resend",
            requested_role=Role.STUDENT,
        )
        mail.outbox.clear()

        delivery = resend_email_verification(email=user.email)
        assert delivery is not None
        assert delivery.status == EmailVerificationDelivery.Status.PENDING

        # Zero network/SMTP I/O in transaction
        assert len(mail.outbox) == 0

    def test_resend_delivery_via_t02_dispatcher(self):
        user = register_account(
            email="11241006@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Dispatcher Resend",
            requested_role=Role.STUDENT,
        )
        mail.outbox.clear()

        resend_email_verification(email=user.email)
        assert len(mail.outbox) == 0

        # Run out-of-request dispatcher
        dispatch_results = dispatch_pending_auth_emails()
        assert len(dispatch_results["email_verification"]) > 0
        assert len(mail.outbox) == 1

        email_message = mail.outbox[0]
        assert user.email in email_message.to
        assert "#token=" in email_message.body

        # Extract fragment token and verify
        import re

        match = re.search(r"#token=([a-f0-9]+)", email_message.body)
        assert match is not None
        extracted_token = match.group(1)

        result = verify_email(token=extracted_token)
        assert result["verified"] is True
        assert result["granted_roles"] == [Role.STUDENT]


@pytest.mark.django_db(transaction=True)
class TestTokenValidationAndSecurityNegatives:
    def test_expired_token_rejected(self):
        user = register_account(
            email="11241007@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Expired User",
            requested_role=Role.STUDENT,
        )
        token_obj = EmailVerificationToken.objects.get(user=user)
        raw_token = derive_email_verification_token(token_obj)

        # Fast forward expiration to 1 second ago (TTL 24 hours exceeded)
        token_obj.expires_at = timezone.now() - timedelta(seconds=1)
        token_obj.save(update_fields=["expires_at"])

        with pytest.raises(DomainError, match="TOKEN_INVALID_OR_EXPIRED"):
            verify_email(token=raw_token)

        # Invariants: token unconsumed, email unverified, no role granted
        token_obj.refresh_from_db()
        assert token_obj.used_at is None
        user.refresh_from_db()
        assert user.verifiedemail.verified_at is None
        assert not has_role(user, Role.STUDENT)

    def test_reused_token_rejected(self):
        user = register_account(
            email="11241008@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Reused User",
            requested_role=Role.STUDENT,
        )
        token_obj = EmailVerificationToken.objects.get(user=user)
        raw_token = derive_email_verification_token(token_obj)

        # First verification succeeds
        result = verify_email(token=raw_token)
        assert result["verified"] is True

        # Second verification with the exact same token MUST be rejected
        with pytest.raises(DomainError, match="TOKEN_INVALID_OR_EXPIRED"):
            verify_email(token=raw_token)

    @pytest.mark.parametrize(
        "invalid_token",
        [
            "",
            "   ",
            "not-a-valid-token",
            "12345",
            "0" * 64,
            "f" * 64,
        ],
    )
    def test_invalid_or_malformed_tokens_rejected_safely(self, invalid_token):
        with pytest.raises(DomainError, match="TOKEN_INVALID_OR_EXPIRED"):
            verify_email(token=invalid_token)

    def test_inactive_account_rejected(self):
        user = register_account(
            email="11241009@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Inactive User",
            requested_role=Role.STUDENT,
        )
        token_obj = EmailVerificationToken.objects.get(user=user)
        raw_token = derive_email_verification_token(token_obj)

        # Deactivate user account
        user.is_active = False
        user.save(update_fields=["is_active"])

        with pytest.raises(DomainError, match="ACCOUNT_INACTIVE"):
            verify_email(token=raw_token)

        # Invariants: token not consumed, email unverified
        token_obj.refresh_from_db()
        assert token_obj.used_at is None
        user.refresh_from_db()
        assert user.verifiedemail.verified_at is None

    def test_stale_auth_version_rejected(self):
        user = register_account(
            email="11241010@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Stale Auth Ver User",
            requested_role=Role.STUDENT,
        )
        token_obj = EmailVerificationToken.objects.get(user=user)
        raw_token = derive_email_verification_token(token_obj)

        # Bump auth_version (e.g. from password reset or security revocation)
        user.auth_version += 1
        user.save(update_fields=["auth_version"])

        with pytest.raises(DomainError, match="TOKEN_INVALID_OR_EXPIRED"):
            verify_email(token=raw_token)

    def test_wrong_account_or_email_mismatch_rejected(self):
        user_a = register_account(
            email="11241011@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="User A",
            requested_role=Role.STUDENT,
        )
        token_a = EmailVerificationToken.objects.get(user=user_a)
        raw_token_a = derive_email_verification_token(token_a)

        # Tamper with token's recorded email
        token_a.email = "different@st.neu.edu.vn"
        token_a.save(update_fields=["email"])

        with pytest.raises(DomainError, match="EMAIL_MISMATCH"):
            verify_email(token=raw_token_a)

    def test_resend_for_nonexistent_email_returns_none_safely(self):
        delivery = resend_email_verification(email="nonexistent@st.neu.edu.vn")
        assert delivery is None

    def test_resend_for_inactive_account_returns_none_safely(self):
        user = register_account(
            email="11241012@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Inactive Resend User",
            requested_role=Role.STUDENT,
        )
        user.is_active = False
        user.save(update_fields=["is_active"])

        delivery = resend_email_verification(email=user.email)
        assert delivery is None

    def test_resend_for_already_verified_account_returns_none(self):
        user = register_account(
            email="11241013@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Already Verified User",
            requested_role=Role.STUDENT,
        )
        token_obj = EmailVerificationToken.objects.get(user=user)
        verify_email(token=derive_email_verification_token(token_obj))

        initial_delivery_count = EmailVerificationDelivery.objects.filter(user=user).count()

        delivery = resend_email_verification(email=user.email)
        assert delivery is None

        # No new delivery or token issued
        assert EmailVerificationDelivery.objects.filter(user=user).count() == initial_delivery_count

    def test_resend_rate_limit(self):
        user = register_account(
            email="11241014@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Rate Limit User",
            requested_role=Role.STUDENT,
        )

        # 5 resends within 15 minutes are allowed
        for _ in range(5):
            delivery = resend_email_verification(email=user.email)
            assert delivery is not None

        # 6th attempt is throttled
        with pytest.raises(Throttled) as exc_info:
            resend_email_verification(email=user.email)

        assert exc_info.value.wait > 0


@pytest.mark.django_db(transaction=True)
class TestRevocationAndNoSelfGrant:
    def test_verify_never_restores_revoked_grant(self):
        admin = create_admin_user()
        user = register_account(
            email="11241015@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Revoked Student",
            requested_role=Role.STUDENT,
        )
        raw_token = derive_email_verification_token(EmailVerificationToken.objects.get(user=user))
        verify_email(token=raw_token)
        assert has_role(user, Role.STUDENT)

        # Admin revokes the student role
        grant = RoleGrant.objects.get(user=user, role=Role.STUDENT)
        revoke_role(actor_id=admin.id, grant_id=grant.id)
        assert not has_role(user, Role.STUDENT)
        grant.refresh_from_db()
        assert grant.revoked_at is not None
        user.refresh_from_db()

        # User attempts to verify again with a new token
        raw_token_2, _, _ = issue_verification_token(user=user)

        # Verification must NOT restore the revoked grant!
        result = verify_email(token=raw_token_2)
        assert result["verified"] is True
        assert result["granted_roles"] == []
        assert not has_role(user, Role.STUDENT)

        # Grant remains revoked
        grant.refresh_from_db()
        assert grant.revoked_at is not None
        assert RoleGrant.objects.filter(user=user, revoked_at__isnull=True).count() == 0

    def test_cannot_self_grant_teacher_or_admin(self):
        teacher = register_account(
            email="teacher1002@neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Teacher No Grant",
            requested_role=Role.TEACHER,
        )
        raw_token = derive_email_verification_token(
            EmailVerificationToken.objects.get(user=teacher)
        )

        result = verify_email(token=raw_token)
        assert result["granted_roles"] == []
        assert not has_role(teacher, Role.TEACHER)
        assert not has_role(teacher, Role.ADMIN)

        # Attempt to request admin via request_role fails
        with pytest.raises(DomainError, match="ROLE_NOT_REQUESTABLE"):
            request_role(user_id=teacher.id, role=Role.ADMIN)


@pytest.mark.django_db(transaction=True)
class TestConcurrencyAndRollback:
    def test_concurrent_verification_single_winner(self):
        user = register_account(
            email="11241016@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Concurrent Verif User",
            requested_role=Role.STUDENT,
        )
        raw_token = derive_email_verification_token(EmailVerificationToken.objects.get(user=user))

        def attempt_verify():
            connection.close()
            try:
                res = verify_email(token=raw_token)
                return True, res
            except DomainError as err:
                return False, str(err)
            finally:
                connection.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(attempt_verify) for _ in range(2)]
            results = [f.result() for f in futures]

        successes = [r for r in results if r[0] is True]
        failures = [r for r in results if r[0] is False]

        # Invariant: Exactly one winner!
        assert len(successes) == 1
        assert len(failures) == 1
        assert "TOKEN_INVALID_OR_EXPIRED" in failures[0][1]

        # Exactly 1 active RoleGrant and 1 email.verified event in DB
        assert RoleGrant.objects.filter(user=user, role=Role.STUDENT).count() == 1
        assert AuditEvent.objects.filter(action="email.verified", resource_id=user.id).count() == 1

    def test_atomic_rollback_on_verification_failure(self):
        user = register_account(
            email="11241017@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Rollback Verif User",
            requested_role=Role.STUDENT,
        )
        token_obj = EmailVerificationToken.objects.get(user=user)
        raw_token = derive_email_verification_token(token_obj)

        # Simulate unexpected failure during role grant
        with (
            patch(
                "identity.services.verification.grant_student_role",
                side_effect=RuntimeError("Simulated grant failure"),
            ),
            pytest.raises(RuntimeError, match="Simulated grant failure"),
        ):
            verify_email(token=raw_token)

        # Entire transaction rolled back: token unconsumed, email unverified, no grant
        token_obj.refresh_from_db()
        assert token_obj.used_at is None

        user.refresh_from_db()
        assert user.verifiedemail.verified_at is None

        role_req = RoleRequest.objects.get(user=user, role=Role.STUDENT)
        assert role_req.status == RoleRequest.Status.PENDING

        assert RoleGrant.objects.filter(user=user).count() == 0
        assert not AuditEvent.objects.filter(action="email.verified", resource_id=user.id).exists()
