from datetime import timedelta
from io import StringIO
from unittest.mock import patch

import pytest
from django.contrib.sessions.models import Session
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import IntegrityError, transaction
from django.utils import timezone

from identity.models import RoleGrant, RoleRequest, User, UserSession, VerifiedEmail
from identity.services.accounts import confirm_email, create_account, set_account_active
from identity.services.bootstrap import bootstrap_admin
from identity.services.common import require_verified
from identity.services.roles import (
    approve_teacher_request,
    close_request,
    grant_student_role,
    request_role,
    revoke_role,
)
from identity.services.sessions import (
    issue_session,
    revoke_all_sessions,
    revoke_session,
    touch_session,
)
from platform_core.errors import DomainError
from platform_core.models import AuditEvent, OutboxEvent

pytestmark = pytest.mark.django_db


@pytest.fixture
def user():
    return create_account(email="11240001@st.neu.edu.vn")


@pytest.fixture
def admin():
    account = create_account(email="admin@example.test")
    return bootstrap_admin(email=account.email, ownership_confirmed=True)[0]


def verify(user):
    return confirm_email(user_id=user.id, expected_email=user.email)


def test_single_canonical_email_no_implicit_role():
    user = create_account(email="  Person@Example.TEST  ")
    assert user.email == "person@example.test"
    assert not user.has_usable_password()
    assert VerifiedEmail.objects.filter(user=user).count() == 1
    assert not RoleGrant.objects.filter(user=user).exists()
    with pytest.raises(DomainError, match="EMAIL_ALREADY_REGISTERED"):
        create_account(email="PERSON@example.test")
    with pytest.raises(IntegrityError), transaction.atomic():
        VerifiedEmail.objects.create(user=user)


@pytest.mark.parametrize("email", ["", "Mixed@example.test", " user@example.test "])
def test_database_rejects_noncanonical_email(user, email):
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.filter(pk=user.id).update(email=email)


def test_password_validation_and_hashing():
    with pytest.raises(ValidationError):
        create_account(email="person@example.test", password="123")
    password = "B01b-test-only!long-password-4827"
    user = create_account(email="person@example.test", password=password)
    assert user.password != password
    assert user.check_password(password)
    assert password not in str(list(AuditEvent.objects.values()))


def test_verification_cannot_attach_another_email(user):
    with pytest.raises(DomainError, match="EMAIL_MISMATCH"):
        confirm_email(user_id=user.id, expected_email="other@example.test")
    verify(user)
    count = AuditEvent.objects.count()
    verify(user)
    assert AuditEvent.objects.count() == count
    User.objects.filter(pk=user.pk).update(email="changed@example.test")
    user.refresh_from_db()
    with pytest.raises(DomainError, match="EMAIL_NOT_VERIFIED"):
        require_verified(user)


def test_one_email_multiple_roles_and_session_invalidation(user, admin):
    request_role(user_id=user.id, role="student")
    with pytest.raises(DomainError, match="EMAIL_NOT_VERIFIED"):
        grant_student_role(user_id=user.id)
    verify(user)
    student = grant_student_role(user_id=user.id)
    assert grant_student_role(user_id=user.id).id == student.id
    key, _ = issue_session(user_id=user.id)
    request = request_role(user_id=user.id, role="teacher")
    assert request_role(user_id=user.id, role="teacher").id == request.id
    with pytest.raises(DomainError, match="FORBIDDEN"):
        approve_teacher_request(actor_id=user.id, request_id=request.id)
    teacher = approve_teacher_request(actor_id=admin.id, request_id=request.id)
    assert approve_teacher_request(actor_id=admin.id, request_id=request.id).id == teacher.id
    assert set(user.role_grants.values_list("role", flat=True)) == {"student", "teacher"}
    assert VerifiedEmail.objects.filter(user=user).count() == 1
    with pytest.raises(DomainError, match="SESSION_REVOKED"):
        touch_session(session_key=key)
    revoke_role(actor_id=admin.id, grant_id=teacher.id)
    assert user.role_grants.filter(revoked_at__isnull=True).get().id == student.id
    # Replaying the approved request never resurrects a revoked grant.
    assert approve_teacher_request(actor_id=admin.id, request_id=request.id).revoked_at


@pytest.mark.parametrize(
    "email", ["11240001@example.test", "1124000@st.neu.edu.vn", "12240001@st.neu.edu.vn"]
)
def test_student_email_rule(email):
    user = create_account(email=email)
    verify(user)
    request_role(user_id=user.id, role="student")
    with pytest.raises(DomainError, match="STUDENT_EMAIL_REQUIRED"):
        grant_student_role(user_id=user.id)


def test_requests_do_not_grant_access_and_admin_not_self_requestable(user, admin):
    with pytest.raises(DomainError, match="ROLE_NOT_REQUESTABLE"):
        request_role(user_id=user.id, role="admin")
    request = request_role(user_id=user.id, role="teacher")
    assert not user.role_grants.exists()
    close_request(actor_id=admin.id, request_id=request.id, decision="rejected")
    verify(user)
    with pytest.raises(DomainError, match="INVALID_ROLE_TRANSITION"):
        approve_teacher_request(actor_id=admin.id, request_id=request.id)
    replacement = request_role(user_id=user.id, role="teacher")
    with pytest.raises(DomainError, match="FORBIDDEN"):
        close_request(actor_id=admin.id, request_id=replacement.id, decision="cancelled")
    close_request(actor_id=user.id, request_id=replacement.id, decision="cancelled")


def test_last_admin_cannot_be_revoked_or_disabled(admin):
    grant = admin.role_grants.get(role="admin")
    with pytest.raises(DomainError, match="LAST_ACTIVE_ADMIN"):
        revoke_role(actor_id=admin.id, grant_id=grant.id)
    with pytest.raises(DomainError, match="LAST_ACTIVE_ADMIN"):
        set_account_active(actor_id=admin.id, user_id=admin.id, active=False)
    assert admin.role_grants.filter(revoked_at__isnull=True).count() == 1


def test_disable_invalidates_sessions_and_blocks_roles(user, admin):
    key, _ = issue_session(user_id=user.id)
    set_account_active(actor_id=admin.id, user_id=user.id, active=False)
    with pytest.raises(DomainError, match="SESSION_REVOKED"):
        touch_session(session_key=key)
    with pytest.raises(DomainError, match="ACCOUNT_INACTIVE"):
        request_role(user_id=user.id, role="teacher")
    with pytest.raises(DomainError, match="ACCOUNT_INACTIVE"):
        issue_session(user_id=user.id)


def test_session_idle_boundary_and_storage(user):
    key, session = issue_session(user_id=user.id)
    assert session.key_digest != key
    assert session.idle_expires_at - session.last_seen_at == timedelta(minutes=30)
    assert session.absolute_expires_at - session.created_at == timedelta(hours=12)
    with patch("identity.services.sessions.timezone.now", return_value=session.idle_expires_at):
        with pytest.raises(DomainError, match="SESSION_EXPIRED"):
            touch_session(session_key=key)


def test_activity_extends_idle_but_never_absolute(user):
    key, session = issue_session(user_id=user.id)
    start = session.created_at
    for minute in range(20, 720, 20):
        with patch(
            "identity.services.sessions.timezone.now",
            return_value=start + timedelta(minutes=minute),
        ):
            updated = touch_session(session_key=key)
            assert updated.absolute_expires_at == session.absolute_expires_at
            assert updated.idle_expires_at <= updated.absolute_expires_at
            assert Session.objects.get(pk=key).expire_date == updated.idle_expires_at
    assert updated.idle_expires_at == session.absolute_expires_at
    with patch("identity.services.sessions.timezone.now", return_value=session.absolute_expires_at):
        with pytest.raises(DomainError, match="SESSION_EXPIRED"):
            touch_session(session_key=key)


@pytest.mark.parametrize(
    "field,delta",
    [("idle_expires_at", timedelta(minutes=31)), ("absolute_expires_at", timedelta(hours=13))],
)
def test_database_enforces_session_caps(user, field, delta):
    _, session = issue_session(user_id=user.id)
    with pytest.raises(IntegrityError), transaction.atomic():
        UserSession.objects.filter(pk=session.pk).update(**{field: session.created_at + delta})


def test_logout_ownership_one_and_all(user):
    other = create_account(email="other@example.test")
    key1, session1 = issue_session(user_id=user.id)
    key2, _ = issue_session(user_id=user.id)
    with pytest.raises(DomainError, match="FORBIDDEN"):
        revoke_session(actor_id=other.id, session_id=session1.id)
    revoke_session(actor_id=user.id, session_id=session1.id)
    with pytest.raises(DomainError, match="SESSION_REVOKED"):
        touch_session(session_key=key1)
    touch_session(session_key=key2)
    revoke_all_sessions(actor_id=user.id, user_id=user.id)
    with pytest.raises(DomainError, match="SESSION_REVOKED"):
        touch_session(session_key=key2)


@pytest.mark.parametrize("tamper", ["missing", "payload", "expired", "version"])
def test_session_rejects_missing_tampered_or_stale_state(user, tamper):
    key, _ = issue_session(user_id=user.id)
    if tamper == "missing":
        Session.objects.filter(pk=key).delete()
    elif tamper == "payload":
        Session.objects.filter(pk=key).update(session_data="invalid-signature")
    elif tamper == "expired":
        Session.objects.filter(pk=key).update(expire_date=timezone.now())
    else:
        User.objects.filter(pk=user.id).update(auth_version=100)
    with pytest.raises(DomainError, match="SESSION_"):
        touch_session(session_key=key)


def test_bootstrap_requires_ownership_and_is_idempotent(user):
    with pytest.raises(DomainError, match="EMAIL_OWNERSHIP_CONFIRMATION_REQUIRED"):
        bootstrap_admin(email=user.email)
    _, grant = bootstrap_admin(email=user.email, ownership_confirmed=True)
    before = AuditEvent.objects.count()
    assert bootstrap_admin(email=user.email, ownership_confirmed=True)[1].id == grant.id
    assert AuditEvent.objects.count() == before
    with pytest.raises(ValueError):
        User.objects.create_superuser(email="unsafe@example.test", password="anything")


def test_bootstrap_command_no_password_argument_or_secret_output():
    with pytest.raises(CommandError):
        call_command("bootstrap_lms_admin", email="ops@example.test")
    output = StringIO()
    password = "B01b-command-only!strong-4257"
    with patch("identity.management.commands.bootstrap_lms_admin.getpass", return_value=password):
        call_command(
            "bootstrap_lms_admin",
            email="ops@example.test",
            confirm_email_ownership=True,
            stdout=output,
        )
    assert User.objects.get(email="ops@example.test").check_password(password)
    assert password not in output.getvalue()


def test_account_audit_and_outbox_rollback_together():
    with patch("platform_core.events.enqueue", side_effect=RuntimeError("outbox failed")):
        with pytest.raises(RuntimeError):
            create_account(email="rollback@example.test")
    assert User.objects.count() == VerifiedEmail.objects.count() == 0
    assert AuditEvent.objects.count() == OutboxEvent.objects.count() == 0


def test_database_rejects_duplicate_pending_and_active_grants(user, admin):
    request_role(user_id=user.id, role="teacher")
    with pytest.raises(IntegrityError), transaction.atomic():
        RoleRequest.objects.create(user=user, role="teacher")
    with pytest.raises(IntegrityError), transaction.atomic():
        RoleGrant.objects.create(user=admin, role="admin", grant_source="internal_administration")


def test_approval_rollback_restores_role_request_and_sessions(user, admin):
    verify(user)
    request = request_role(user_id=user.id, role="teacher")
    key, session = issue_session(user_id=user.id)
    user.refresh_from_db()
    version = user.auth_version
    before = (AuditEvent.objects.count(), OutboxEvent.objects.count())
    with patch("platform_core.events.enqueue", side_effect=RuntimeError("delivery table failure")):
        with pytest.raises(RuntimeError):
            approve_teacher_request(actor_id=admin.id, request_id=request.id)
    request.refresh_from_db()
    user.refresh_from_db()
    session.refresh_from_db()
    assert request.status == "pending" and request.reviewed_at is None
    assert user.auth_version == version and session.revoked_at is None
    assert not user.role_grants.exists()
    assert before == (AuditEvent.objects.count(), OutboxEvent.objects.count())
    touch_session(session_key=key)
