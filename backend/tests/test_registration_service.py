import concurrent.futures
from unittest.mock import patch

import pytest
from django.core import mail
from django.core.exceptions import ValidationError
from django.db import connection
from django.utils import timezone

from identity.models import (
    EmailVerificationDelivery,
    EmailVerificationToken,
    Role,
    RoleGrant,
    RoleRequest,
    User,
    VerifiedEmail,
)
from identity.services.accounts import register_account
from identity.services.common import has_role
from platform_core.errors import DomainError
from platform_core.models import AuditEvent

VALID_STUDENT_EMAIL = "11240001@st.neu.edu.vn"
VALID_TEACHER_EMAIL = "giangvien.tran@neu.edu.vn"
VALID_PASSWORD = "B04-Registration-Pass123!"


@pytest.mark.django_db(transaction=True)
class TestEmailValidation:
    def test_registration_canonicalizes_email(self):
        user = register_account(
            email="  11240002@ST.NEU.EDU.VN  ",
            password=VALID_PASSWORD,
            display_name="Sinh Viên 2",
            requested_role=Role.STUDENT,
        )
        assert user.email == "11240002@st.neu.edu.vn"
        assert User.objects.filter(email="11240002@st.neu.edu.vn").exists()

    def test_registration_rejects_duplicate_email(self):
        register_account(
            email="11240003@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Sinh Viên 3",
            requested_role=Role.STUDENT,
        )
        with pytest.raises(DomainError, match="EMAIL_ALREADY_REGISTERED"):
            register_account(
                email="11240003@st.neu.edu.vn",
                password=VALID_PASSWORD,
                display_name="Sinh Viên Trùng",
                requested_role=Role.STUDENT,
            )

    def test_registration_rejects_duplicate_email_case_insensitive(self):
        register_account(
            email="11240004@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Sinh Viên 4",
            requested_role=Role.STUDENT,
        )
        with pytest.raises(DomainError, match="EMAIL_ALREADY_REGISTERED"):
            register_account(
                email="11240004@ST.NEU.EDU.VN",
                password=VALID_PASSWORD,
                display_name="Sinh Viên 4 Hoa",
                requested_role=Role.STUDENT,
            )

    @pytest.mark.parametrize(
        "invalid_email",
        ["", "not-an-email", "missing-at-sign.com", "@missing-local.com", "spaces in@email.com"],
    )
    def test_registration_rejects_invalid_email_format(self, invalid_email):
        with pytest.raises(ValidationError):
            register_account(
                email=invalid_email,
                password=VALID_PASSWORD,
                display_name="Invalid Email User",
                requested_role=Role.STUDENT,
            )

    def test_registration_creates_sole_unlinked_email_record(self):
        user = register_account(
            email="11240005@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Sinh Viên 5",
            requested_role=Role.STUDENT,
        )
        assert VerifiedEmail.objects.filter(user=user).count() == 1
        verif = VerifiedEmail.objects.get(user=user)
        assert verif.verified_at is None
        assert verif.email_digest == ""


@pytest.mark.django_db(transaction=True)
class TestRoleValidationAndSecurity:
    @pytest.mark.parametrize(
        "valid_student_email",
        [
            "11240000@st.neu.edu.vn",
            "11241234@st.neu.edu.vn",
            "11249999@st.neu.edu.vn",
        ],
    )
    def test_student_email_strict_regex_valid(self, valid_student_email):
        user = register_account(
            email=valid_student_email,
            password=VALID_PASSWORD,
            display_name="Valid Student",
            requested_role=Role.STUDENT,
        )
        assert user.email == valid_student_email
        assert user.role_request.role == Role.STUDENT
        assert user.role_request.status == RoleRequest.Status.PENDING

    @pytest.mark.parametrize(
        "invalid_student_email",
        [
            "11230001@st.neu.edu.vn",  # wrong batch prefix (1123 instead of 1124)
            "11250001@st.neu.edu.vn",  # wrong batch prefix
            "1124001@st.neu.edu.vn",  # 3 digits
            "112400001@st.neu.edu.vn",  # 5 digits
            "student@st.neu.edu.vn",  # alphanumeric instead of digits
            "11240001@neu.edu.vn",  # teacher domain, not @st
            "11240001@gmail.com",  # public domain
        ],
    )
    def test_student_email_invalid_regex_rejected(self, invalid_student_email):
        with pytest.raises(DomainError, match="INVALID_STUDENT_EMAIL_DOMAIN"):
            register_account(
                email=invalid_student_email,
                password=VALID_PASSWORD,
                display_name="Student Invalid Regex",
                requested_role=Role.STUDENT,
            )

    @pytest.mark.parametrize(
        "teacher_email",
        [
            "gv.nguyen@neu.edu.vn",
            "lecturer.tran@gmail.com",
            "teacher.smith@external.org",
        ],
    )
    def test_teacher_email_accepts_any_valid_email(self, teacher_email):
        user = register_account(
            email=teacher_email,
            password=VALID_PASSWORD,
            display_name="Giảng Viên Hợp Lệ",
            requested_role=Role.TEACHER,
        )
        assert user.email == teacher_email
        assert user.role_request.role == Role.TEACHER
        assert user.role_request.status == RoleRequest.Status.PENDING

    @pytest.mark.parametrize("disallowed_role", ["admin", "superuser", "staff", "guest", ""])
    def test_disallowed_role_rejected(self, disallowed_role):
        with pytest.raises(DomainError, match="ROLE_NOT_REQUESTABLE"):
            register_account(
                email="11240010@st.neu.edu.vn",
                password=VALID_PASSWORD,
                display_name="Disallowed Role User",
                requested_role=disallowed_role,
            )

    def test_forbidden_fields_injection_rejected(self):
        # Attempt to inject self-asserted fields
        with pytest.raises(DomainError, match="FORBIDDEN_REGISTRATION_FIELDS"):
            register_account(
                email="11240011@st.neu.edu.vn",
                password=VALID_PASSWORD,
                display_name="Hacker",
                requested_role=Role.STUDENT,
                is_superuser=True,
            )

        with pytest.raises(DomainError, match="FORBIDDEN_REGISTRATION_FIELDS"):
            register_account(
                email="11240012@st.neu.edu.vn",
                password=VALID_PASSWORD,
                display_name="Hacker",
                requested_role=Role.STUDENT,
                actor="admin",
            )

        with pytest.raises(DomainError, match="FORBIDDEN_REGISTRATION_FIELDS"):
            register_account(
                email="11240013@st.neu.edu.vn",
                password=VALID_PASSWORD,
                display_name="Hacker",
                requested_role=Role.STUDENT,
                roles=["admin"],
            )


@pytest.mark.django_db(transaction=True)
class TestPasswordAndDisplayNameValidation:
    def test_password_empty_or_none_rejected(self):
        with pytest.raises(ValidationError):
            register_account(
                email=VALID_STUDENT_EMAIL,
                password="",
                display_name="No Pass User",
                requested_role=Role.STUDENT,
            )
        with pytest.raises(ValidationError):
            register_account(
                email=VALID_STUDENT_EMAIL,
                password=None,
                display_name="None Pass User",
                requested_role=Role.STUDENT,
            )

    @pytest.mark.parametrize("weak_password", ["123", "short", "12345678", "password"])
    def test_password_validation_fails_for_weak_password(self, weak_password):
        with pytest.raises(ValidationError):
            register_account(
                email="11240014@st.neu.edu.vn",
                password=weak_password,
                display_name="Weak Pass User",
                requested_role=Role.STUDENT,
            )

    def test_password_is_hashed_and_not_stored_plain(self):
        user = register_account(
            email="11240015@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Hashed Pass User",
            requested_role=Role.STUDENT,
        )
        assert user.password != VALID_PASSWORD
        assert user.password.startswith("pbkdf2_sha256$")
        assert user.check_password(VALID_PASSWORD)
        # Check audit events contain no password
        events = AuditEvent.objects.filter(resource_id=user.id)
        assert events.exists()
        for ev in events:
            assert VALID_PASSWORD not in str(ev.metadata)

    def test_display_name_length_validation(self):
        with pytest.raises(DomainError, match="INVALID_DISPLAY_NAME"):
            register_account(
                email="11240016@st.neu.edu.vn",
                password=VALID_PASSWORD,
                display_name="A" * 151,
                requested_role=Role.STUDENT,
            )

        user = register_account(
            email="11240016@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="A" * 150,
            requested_role=Role.STUDENT,
        )
        assert len(user.display_name) == 150


@pytest.mark.django_db(transaction=True)
class TestPendingStateAndNoPrematureGrants:
    def test_unverified_account_has_no_role_grants_or_learning_permissions(self):
        user = register_account(
            email="11240020@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Unverified Student",
            requested_role=Role.STUDENT,
        )
        # 1. User is active but email is unverified
        assert user.is_active is True
        assert user.verifiedemail.verified_at is None

        # 2. Absolutely no RoleGrant issued
        assert RoleGrant.objects.filter(user=user).count() == 0
        assert not has_role(user, Role.STUDENT)
        assert not has_role(user, Role.TEACHER)
        assert not has_role(user, Role.ADMIN)

    def test_role_request_is_created_with_pending_status(self):
        user = register_account(
            email="11240021@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Pending Request Student",
            requested_role=Role.STUDENT,
        )
        req = RoleRequest.objects.get(user=user)
        assert req.role == Role.STUDENT
        assert req.status == RoleRequest.Status.PENDING
        assert req.reviewed_at is None
        assert req.reviewed_by is None

    def test_verification_token_and_delivery_created_atomically(self):
        user = register_account(
            email="11240022@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="Delivery Intent Student",
            requested_role=Role.STUDENT,
        )
        # Verification Token created with 24h validity
        token = EmailVerificationToken.objects.get(user=user)
        assert token.email == user.email
        assert token.used_at is None
        assert token.auth_version == user.auth_version
        assert token.expires_at > timezone.now()
        assert token.expires_at <= timezone.now() + timezone.timedelta(hours=24, seconds=5)

        # Verification Delivery created with PENDING status
        delivery = EmailVerificationDelivery.objects.get(token=token)
        assert delivery.user == user
        assert delivery.email == user.email
        assert delivery.status == EmailVerificationDelivery.Status.PENDING
        assert delivery.attempts == 0
        assert delivery.max_attempts == 3
        assert delivery.sent_at is None

    def test_registration_does_not_call_smtp_or_network(self):
        mail.outbox.clear()
        register_account(
            email="11240023@st.neu.edu.vn",
            password=VALID_PASSWORD,
            display_name="No SMTP User",
            requested_role=Role.STUDENT,
        )
        # Verify no mail was sent during registration transaction
        assert len(mail.outbox) == 0


@pytest.mark.django_db(transaction=True)
class TestConcurrencyAndRollback:
    def test_concurrent_registration_single_winner(self):
        target_email = "11240030@st.neu.edu.vn"

        def attempt_register():
            connection.close()
            try:
                user = register_account(
                    email=target_email,
                    password=VALID_PASSWORD,
                    display_name="Concurrent Candidate",
                    requested_role=Role.STUDENT,
                )
                return True, user.id
            except DomainError as err:
                return False, str(err)
            finally:
                connection.close()

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(attempt_register) for _ in range(2)]
            results = [f.result() for f in futures]

        successes = [r for r in results if r[0] is True]
        failures = [r for r in results if r[0] is False]

        assert len(successes) == 1
        assert len(failures) == 1
        assert "EMAIL_ALREADY_REGISTERED" in failures[0][1]

        # Verify exact single row in database
        assert User.objects.filter(email=target_email).count() == 1
        assert RoleRequest.objects.filter(user__email=target_email).count() == 1
        assert EmailVerificationToken.objects.filter(email=target_email).count() == 1
        assert EmailVerificationDelivery.objects.filter(email=target_email).count() == 1

    def test_atomic_rollback_on_failure(self):
        fail_email = "11240031@st.neu.edu.vn"

        # Simulate unexpected failure during verification delivery creation
        with (
            patch(
                "identity.models.EmailVerificationDelivery.objects.create",
                side_effect=RuntimeError("Simulated unexpected delivery failure"),
            ),
            pytest.raises(RuntimeError, match="Simulated unexpected delivery failure"),
        ):
            register_account(
                email=fail_email,
                password=VALID_PASSWORD,
                display_name="Rollback User",
                requested_role=Role.STUDENT,
            )

        # Invariant: Entire atomic transaction rolled back; no orphaned records exist
        assert not User.objects.filter(email=fail_email).exists()
        assert not VerifiedEmail.objects.filter(user__email=fail_email).exists()
        assert not RoleRequest.objects.filter(user__email=fail_email).exists()
        assert not EmailVerificationToken.objects.filter(email=fail_email).exists()
        assert not EmailVerificationDelivery.objects.filter(email=fail_email).exists()
        assert not AuditEvent.objects.filter(
            action="account.created", actor__email=fail_email
        ).exists()
