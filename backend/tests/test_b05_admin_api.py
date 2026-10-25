import concurrent.futures
import itertools
import json
import uuid

import pytest
from django.conf import settings
from django.db import connection
from django.test import Client
from django.utils import timezone
from rest_framework import status

from identity.models import (
    PasswordResetDelivery,
    Role,
    RoleGrant,
    RoleRequest,
)
from identity.services.accounts import confirm_email, create_account
from identity.services.bootstrap import bootstrap_admin
from identity.services.roles import request_role
from identity.services.sessions import issue_session
from platform_core.models import AuditEvent

_counter = itertools.count(2000)


def gen_email(prefix="user"):
    return f"{prefix}_{next(_counter)}@example.edu.vn"


@pytest.fixture
def csrf_client():
    c = Client(enforce_csrf_checks=True)
    res = c.get("/api/v1/auth/csrf")
    assert res.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)
    c.csrf_token = c.cookies["csrftoken"].value
    return c


@pytest.fixture
def make_user():
    def _create(email=None, password="StrongPassword123!", role=None, verified=True):
        if not email:
            email = gen_email()
        user = create_account(email=email, password=password, display_name=f"User {email}")
        if verified:
            confirm_email(user_id=user.id, expected_email=email)
        if role == Role.ADMIN:
            bootstrap_admin(
                email=email,
                password=password,
                display_name=user.display_name,
                ownership_confirmed=True,
            )
        elif role == Role.TEACHER:
            req = RoleRequest.objects.create(
                user=user,
                role=Role.TEACHER,
                status=RoleRequest.Status.APPROVED,
                reviewed_by=user,
                reviewed_at=timezone.now(),
                review_reason="teacher_approval",
            )
            RoleGrant.objects.create(
                user=user,
                role=Role.TEACHER,
                grant_source="teacher_approval",
                source_request=req,
                granted_by=user,
            )
        elif role == Role.STUDENT:
            req = RoleRequest.objects.create(
                user=user,
                role=Role.STUDENT,
                status=RoleRequest.Status.APPROVED,
                reviewed_by=user,
                reviewed_at=timezone.now(),
                review_reason="verified_student_email",
            )
            RoleGrant.objects.create(
                user=user,
                role=Role.STUDENT,
                grant_source="verified_student_email",
                source_request=req,
            )
        return user

    return _create


@pytest.fixture
def auth_client():
    def _client(user):
        c = Client(enforce_csrf_checks=True)
        res = c.get("/api/v1/auth/csrf")
        assert res.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)
        csrf_token = c.cookies["csrftoken"].value
        raw_key, _ = issue_session(user_id=user.id)
        c.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        c.csrf_token = csrf_token
        c.user = user

        def post_api(url, data=None):
            kwargs = {"HTTP_X_CSRFTOKEN": c.csrf_token}
            if data is not None:
                return c.post(url, data=json.dumps(data), content_type="application/json", **kwargs)
            return c.post(url, **kwargs)

        c.post_api = post_api
        return c

    return _client


@pytest.mark.django_db
class TestAdminAccessControl:
    def test_unauthenticated_blocked(self, csrf_client):
        res = csrf_client.get("/api/v1/admin/accounts")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert res.json()["error"]["code"] == "authentication_required"

    def test_student_blocked(self, auth_client, make_user):
        student = make_user(role=Role.STUDENT)
        client = auth_client(student)
        res = client.get("/api/v1/admin/accounts")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["error"]["code"] == "permission_denied"

    def test_teacher_blocked(self, auth_client, make_user):
        teacher = make_user(role=Role.TEACHER)
        client = auth_client(teacher)
        res = client.get("/api/v1/admin/accounts")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["error"]["code"] == "permission_denied"

    def test_active_admin_allowed(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        client = auth_client(admin)
        res = client.get("/api/v1/admin/accounts")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert "items" in data
        assert "pagination" in data

    def test_admin_has_no_automatic_student_or_teacher_role(self, make_user):
        from identity.services.common import has_role

        admin = make_user(role=Role.ADMIN)
        assert has_role(admin, Role.ADMIN) is True
        assert has_role(admin, Role.STUDENT) is False
        assert has_role(admin, Role.TEACHER) is False


@pytest.mark.django_db
class TestAdminAccountsListingAndDetail:
    def test_accounts_pagination_and_envelope(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        for _ in range(5):
            make_user()
        client = auth_client(admin)
        res = client.get("/api/v1/admin/accounts?page=1&page_size=3")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert len(data["items"]) == 3
        pagination = data["pagination"]
        assert pagination["page"] == 1
        assert pagination["page_size"] == 3
        assert pagination["total_items"] >= 6
        assert pagination["has_next"] is True

    def test_accounts_filter_by_search_email_and_name(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        u1 = make_user(email="alice_search_test@example.edu.vn")
        make_user(email="bob_other@example.edu.vn")
        client = auth_client(admin)

        res = client.get("/api/v1/admin/accounts?search=alice_search_test")
        assert res.status_code == status.HTTP_200_OK
        items = res.json()["items"]
        assert len(items) == 1
        assert items[0]["id"] == str(u1.id)

    def test_accounts_filter_by_role(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        student = make_user(role=Role.STUDENT)
        teacher = make_user(role=Role.TEACHER)
        client = auth_client(admin)

        res = client.get("/api/v1/admin/accounts?role=student")
        assert res.status_code == status.HTTP_200_OK
        ids = [item["id"] for item in res.json()["items"]]
        assert str(student.id) in ids
        assert str(teacher.id) not in ids

    def test_accounts_filter_by_active_and_verified(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        inactive_u = make_user(verified=True)
        inactive_u.is_active = False
        inactive_u.save()

        client = auth_client(admin)
        res_active = client.get("/api/v1/admin/accounts?is_active=false")
        assert res_active.status_code == status.HTTP_200_OK
        ids = [item["id"] for item in res_active.json()["items"]]
        assert str(inactive_u.id) in ids

    def test_account_detail_success_and_404(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        target = make_user(role=Role.TEACHER)
        client = auth_client(admin)

        res = client.get(f"/api/v1/admin/accounts/{target.id}")
        assert res.status_code == status.HTTP_200_OK
        detail = res.json()
        assert detail["id"] == str(target.id)
        assert detail["email"] == target.email
        assert len(detail["roles"]) >= 1
        assert detail["roles"][0]["role"] == "teacher"

        res_404 = client.get(f"/api/v1/admin/accounts/{uuid.uuid4()}")
        assert res_404.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestAdminTeacherRequestsQueue:
    def test_teacher_requests_list_and_filter(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        t_user = make_user(verified=True)
        req = request_role(user_id=t_user.id, role=Role.TEACHER)

        client = auth_client(admin)
        res = client.get("/api/v1/admin/teacher-requests?status=pending")
        assert res.status_code == status.HTTP_200_OK
        items = res.json()["items"]
        assert any(item["id"] == str(req.id) for item in items)

    def test_teacher_request_approve_lifecycle_and_session_invalidation(
        self, auth_client, make_user
    ):
        admin = make_user(role=Role.ADMIN)
        t_user = make_user(verified=True)
        req = request_role(user_id=t_user.id, role=Role.TEACHER)

        # Create active session for t_user
        raw_key, _ = issue_session(user_id=t_user.id)
        u_client = Client()
        u_client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        # Verify session active before approval
        me_before = u_client.get("/api/v1/auth/me")
        assert me_before.status_code == status.HTTP_200_OK

        admin_client = auth_client(admin)
        res = admin_client.post_api(f"/api/v1/admin/teacher-requests/{req.id}/approve")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["role"] == "teacher"
        assert data["status"] == "approved"

        # Verify old session invalidated due to role change
        me_after = u_client.get("/api/v1/auth/me")
        assert me_after.status_code == status.HTTP_401_UNAUTHORIZED

        # Verify idempotent approval replay
        res_replay = admin_client.post_api(f"/api/v1/admin/teacher-requests/{req.id}/approve")
        assert res_replay.status_code == status.HTTP_200_OK
        assert res_replay.json()["id"] == data["id"]

        # Verify audit events emitted
        assert AuditEvent.objects.filter(action="role.reviewed", resource_id=str(req.id)).exists()
        assert AuditEvent.objects.filter(action="role.granted", resource_id=data["id"]).exists()

    def test_teacher_request_reject(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        t_user = make_user(verified=True)
        req = request_role(user_id=t_user.id, role=Role.TEACHER)

        admin_client = auth_client(admin)
        res = admin_client.post_api(f"/api/v1/admin/teacher-requests/{req.id}/reject")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["status"] == "rejected"

        req.refresh_from_db()
        assert req.status == "rejected"
        assert req.review_reason == "admin_rejected"

        # Trying to approve rejected request fails
        res_approve = admin_client.post_api(f"/api/v1/admin/teacher-requests/{req.id}/approve")
        assert res_approve.status_code == status.HTTP_400_BAD_REQUEST

    def test_teacher_request_approve_unverified_user_fails(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        unverified_u = make_user(verified=False)
        req = RoleRequest.objects.create(
            user=unverified_u, role=Role.TEACHER, status=RoleRequest.Status.PENDING
        )

        admin_client = auth_client(admin)
        res = admin_client.post_api(f"/api/v1/admin/teacher-requests/{req.id}/approve")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "email_not_verified"


@pytest.mark.django_db(transaction=True)
class TestAdminConcurrentTeacherApproval:
    def test_concurrent_approval_creates_single_grant(self, make_user):
        admin1 = make_user(role=Role.ADMIN)
        admin2 = make_user(role=Role.ADMIN)
        t_user = make_user(verified=True)
        req = request_role(user_id=t_user.id, role=Role.TEACHER)

        def approve(admin_id):
            connection.close()
            from identity.services.roles import approve_teacher_request

            return approve_teacher_request(actor_id=admin_id, request_id=req.id).id

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(approve, admin1.id)
            f2 = executor.submit(approve, admin2.id)
            id1 = f1.result()
            id2 = f2.result()

        assert id1 == id2
        assert (
            RoleGrant.objects.filter(
                user=t_user, role=Role.TEACHER, revoked_at__isnull=True
            ).count()
            == 1
        )


@pytest.mark.django_db
class TestAdminRoleGrantAndRevocationWithD02Reauth:
    def test_grant_admin_role_requires_reauth(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN, password="CorrectPassword123!")
        target = make_user()
        client = auth_client(admin)

        # Missing current_password
        res_no_pw = client.post_api(
            f"/api/v1/admin/accounts/{target.id}/roles",
            data={"role": "admin"},
        )
        assert res_no_pw.status_code == status.HTTP_400_BAD_REQUEST
        assert res_no_pw.json()["error"]["code"] == "reauth_required"

        # Wrong current_password
        res_wrong_pw = client.post_api(
            f"/api/v1/admin/accounts/{target.id}/roles",
            data={"role": "admin", "current_password": "WrongPassword999!"},
        )
        assert res_wrong_pw.status_code == status.HTTP_400_BAD_REQUEST
        assert res_wrong_pw.json()["error"]["code"] == "invalid_credentials"

        # Correct password
        res_ok = client.post_api(
            f"/api/v1/admin/accounts/{target.id}/roles",
            data={"role": "admin", "current_password": "CorrectPassword123!"},
        )
        assert res_ok.status_code == status.HTTP_200_OK
        assert res_ok.json()["role"] == "admin"
        assert RoleGrant.objects.filter(
            user=target, role=Role.ADMIN, revoked_at__isnull=True
        ).exists()

    def test_revoke_admin_role_requires_reauth(self, auth_client, make_user):
        admin1 = make_user(role=Role.ADMIN, password="AdminPassword123!")
        admin2 = make_user(role=Role.ADMIN)
        grant2 = RoleGrant.objects.get(user=admin2, role=Role.ADMIN, revoked_at__isnull=True)
        client = auth_client(admin1)

        # Missing password
        res_no_pw = client.post_api(
            f"/api/v1/admin/accounts/{admin2.id}/roles/{grant2.id}/revoke",
            data={},
        )
        assert res_no_pw.status_code == status.HTTP_400_BAD_REQUEST
        assert res_no_pw.json()["error"]["code"] == "reauth_required"

        # Wrong password
        res_wrong_pw = client.post_api(
            f"/api/v1/admin/accounts/{admin2.id}/roles/{grant2.id}/revoke",
            data={"current_password": "IncorrectPassword!"},
        )
        assert res_wrong_pw.status_code == status.HTTP_400_BAD_REQUEST
        assert res_wrong_pw.json()["error"]["code"] == "invalid_credentials"

        # Correct password
        res_ok = client.post_api(
            f"/api/v1/admin/accounts/{admin2.id}/roles/{grant2.id}/revoke",
            data={"current_password": "AdminPassword123!"},
        )
        assert res_ok.status_code == status.HTTP_200_OK
        assert res_ok.json()["role"] == "admin"
        grant2.refresh_from_db()
        assert grant2.revoked_at is not None

    def test_revoke_non_admin_role_does_not_require_password(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        teacher = make_user(role=Role.TEACHER)
        grant = RoleGrant.objects.get(user=teacher, role=Role.TEACHER, revoked_at__isnull=True)
        client = auth_client(admin)

        res = client.post_api(
            f"/api/v1/admin/accounts/{teacher.id}/roles/{grant.id}/revoke",
            data={},
        )
        assert res.status_code == status.HTTP_200_OK
        grant.refresh_from_db()
        assert grant.revoked_at is not None

    def test_revocation_invalidates_target_user_session(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        teacher = make_user(role=Role.TEACHER)
        grant = RoleGrant.objects.get(user=teacher, role=Role.TEACHER, revoked_at__isnull=True)

        raw_key, _ = issue_session(user_id=teacher.id)
        t_client = Client()
        t_client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        assert t_client.get("/api/v1/auth/me").status_code == status.HTTP_200_OK

        admin_client = auth_client(admin)
        res = admin_client.post_api(
            f"/api/v1/admin/accounts/{teacher.id}/roles/{grant.id}/revoke",
        )
        assert res.status_code == status.HTTP_200_OK

        # Teacher session is immediately invalid
        assert t_client.get("/api/v1/auth/me").status_code == status.HTTP_401_UNAUTHORIZED

    def test_cannot_revoke_last_active_admin(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN, password="AdminPassword123!")
        grant = RoleGrant.objects.get(user=admin, role=Role.ADMIN, revoked_at__isnull=True)
        # Ensure admin is the only active admin
        RoleGrant.objects.filter(role=Role.ADMIN).exclude(id=grant.id).update(
            revoked_at=timezone.now()
        )

        client = auth_client(admin)
        res = client.post_api(
            f"/api/v1/admin/accounts/{admin.id}/roles/{grant.id}/revoke",
            data={"current_password": "AdminPassword123!"},
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "last_active_admin"
        grant.refresh_from_db()
        assert grant.revoked_at is None


@pytest.mark.django_db
class TestAdminAccountLockUnlock:
    def test_lock_and_unlock_student_account(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        student = make_user(role=Role.STUDENT)

        raw_key, _ = issue_session(user_id=student.id)
        s_client = Client()
        s_client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
        assert s_client.get("/api/v1/auth/me").status_code == status.HTTP_200_OK

        admin_client = auth_client(admin)
        # Lock account
        res_lock = admin_client.post_api(f"/api/v1/admin/accounts/{student.id}/lock")
        assert res_lock.status_code == status.HTTP_200_OK
        assert res_lock.json()["is_active"] is False

        student.refresh_from_db()
        assert student.is_active is False

        # Session invalidated
        assert s_client.get("/api/v1/auth/me").status_code == status.HTTP_401_UNAUTHORIZED

        # Unlock account
        res_unlock = admin_client.post_api(f"/api/v1/admin/accounts/{student.id}/unlock")
        assert res_unlock.status_code == status.HTTP_200_OK
        assert res_unlock.json()["is_active"] is True

        student.refresh_from_db()
        assert student.is_active is True

    def test_lock_admin_account_requires_reauth(self, auth_client, make_user):
        admin1 = make_user(role=Role.ADMIN, password="Admin1Password123!")
        admin2 = make_user(role=Role.ADMIN)
        client = auth_client(admin1)

        # Missing password
        res_no_pw = client.post_api(
            f"/api/v1/admin/accounts/{admin2.id}/lock",
            data={},
        )
        assert res_no_pw.status_code == status.HTTP_400_BAD_REQUEST
        assert res_no_pw.json()["error"]["code"] == "reauth_required"

        # Wrong password
        res_wrong_pw = client.post_api(
            f"/api/v1/admin/accounts/{admin2.id}/lock",
            data={"current_password": "WrongPassword123!"},
        )
        assert res_wrong_pw.status_code == status.HTTP_400_BAD_REQUEST
        assert res_wrong_pw.json()["error"]["code"] == "invalid_credentials"

        # Correct password
        res_ok = client.post_api(
            f"/api/v1/admin/accounts/{admin2.id}/lock",
            data={"current_password": "Admin1Password123!"},
        )
        assert res_ok.status_code == status.HTTP_200_OK
        admin2.refresh_from_db()
        assert admin2.is_active is False

    def test_cannot_lock_last_active_admin(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN, password="AdminPassword123!")
        grant = RoleGrant.objects.get(user=admin, role=Role.ADMIN, revoked_at__isnull=True)
        # Ensure admin is the only active admin
        RoleGrant.objects.filter(role=Role.ADMIN).exclude(id=grant.id).update(
            revoked_at=timezone.now()
        )

        client = auth_client(admin)
        res = client.post_api(
            f"/api/v1/admin/accounts/{admin.id}/lock",
            data={"current_password": "AdminPassword123!"},
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "last_active_admin"
        admin.refresh_from_db()
        assert admin.is_active is True


@pytest.mark.django_db(transaction=True)
class TestAdminLastAdminConcurrentRace:
    def test_concurrent_deactivation_protects_last_admin(self, make_user):
        admin1 = make_user(role=Role.ADMIN, password="AdminOnePassword123!")
        admin2 = make_user(role=Role.ADMIN, password="AdminTwoPassword123!")
        # Ensure only these two admins are active
        RoleGrant.objects.filter(role=Role.ADMIN).exclude(
            user_id__in=[admin1.id, admin2.id]
        ).update(revoked_at=timezone.now())

        def deactivate(actor_id, target_id, pw):
            connection.close()
            from identity.services.accounts import set_account_active
            from platform_core.errors import DomainError

            try:
                set_account_active(
                    actor_id=actor_id,
                    user_id=target_id,
                    active=False,
                    current_password=pw,
                    enforce_reauth=True,
                )
                return "SUCCESS"
            except DomainError as err:
                return err.code

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            f1 = executor.submit(deactivate, admin1.id, admin1.id, "AdminOnePassword123!")
            f2 = executor.submit(deactivate, admin2.id, admin2.id, "AdminTwoPassword123!")
            r1 = f1.result()
            r2 = f2.result()

        results = [r1, r2]
        assert results.count("SUCCESS") == 1
        assert results.count("LAST_ACTIVE_ADMIN") == 1
        assert (
            RoleGrant.objects.filter(
                role=Role.ADMIN, revoked_at__isnull=True, user__is_active=True
            ).count()
            == 1
        )


@pytest.mark.django_db
class TestAdminPasswordResetInitiation:
    def test_admin_request_password_reset_returns_202_no_secret(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        target = make_user()
        client = auth_client(admin)

        res = client.post_api(f"/api/v1/admin/accounts/{target.id}/request-reset")
        assert res.status_code == status.HTTP_202_ACCEPTED
        data = res.json()
        assert "message" in data
        # Invariant: NO token, secret, or digest returned to caller
        forbidden_keys = {"token", "secret", "digest", "key", "password"}
        assert not any(k in data for k in forbidden_keys)

        # Verify delivery created in pending state
        delivery = PasswordResetDelivery.objects.filter(user=target).first()
        assert delivery is not None
        assert delivery.status == PasswordResetDelivery.Status.PENDING

        # Verify audit event recorded
        assert AuditEvent.objects.filter(
            action="account.password_reset_initiated", resource_id=str(target.id)
        ).exists()


@pytest.mark.django_db
class TestAdminAuditRollbackAndIDOR:
    def test_failed_mutation_rolls_back_audit_event(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN, password="CorrectPassword123!")
        target = make_user()
        client = auth_client(admin)

        audit_count_before = AuditEvent.objects.count()

        # Wrong password causes transaction failure
        res = client.post_api(
            f"/api/v1/admin/accounts/{target.id}/roles",
            data={"role": "admin", "current_password": "WrongPassword123!"},
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert AuditEvent.objects.count() == audit_count_before

    def test_cross_account_grant_revocation_idor_blocked(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        user1 = make_user(role=Role.TEACHER)
        user2 = make_user(role=Role.STUDENT)
        grant2 = RoleGrant.objects.get(user=user2, role=Role.STUDENT, revoked_at__isnull=True)

        client = auth_client(admin)
        # Attempting to revoke user2's grant under user1's URL path
        res = client.post_api(
            f"/api/v1/admin/accounts/{user1.id}/roles/{grant2.id}/revoke",
            data={},
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
        grant2.refresh_from_db()
        assert grant2.revoked_at is None


@pytest.mark.django_db
class TestAcceptanceRegressions:
    def test_admin_responses_are_not_cacheable(self, auth_client, make_user, csrf_client):
        assert csrf_client.get("/api/v1/admin/accounts")["Cache-Control"] == "no-store"
        admin = make_user(role=Role.ADMIN)
        client = auth_client(admin)
        assert client.get("/api/v1/admin/accounts")["Cache-Control"] == "no-store"
        assert client.get(f"/api/v1/admin/accounts/{admin.id}")["Cache-Control"] == "no-store"

    def test_teacher_reject_endpoint_cannot_change_student_request(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        user = make_user(email="11249998@st.neu.edu.vn")
        req = request_role(user_id=user.id, role=Role.STUDENT)
        response = auth_client(admin).post_api(f"/api/v1/admin/teacher-requests/{req.id}/reject")
        assert response.status_code == 400
        req.refresh_from_db()
        assert req.status == "pending"

    def test_reauth_failures_are_rate_limited_across_aliases(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        target = make_user()
        client = auth_client(admin)
        for _ in range(10):
            res = client.post_api(
                f"/api/v1/admin/accounts/{target.id}/roles",
                {"role": "admin", "current_password": "wrong-password"},
            )
            assert res.status_code == 400
        res = client.post_api(
            f"/api/v1/admin/accounts/{admin.id}/lock",
            {"current_password": "StrongPassword123!"},
        )
        assert res.status_code == 429
        assert not RoleGrant.objects.filter(user=target, role=Role.ADMIN).exists()

    def test_invalid_student_request_does_not_persist_side_effects(self, auth_client, make_user):
        user = make_user(email="teacher@example.org")
        client = auth_client(user)
        before = AuditEvent.objects.count()
        res = client.post_api("/api/v1/auth/role-requests", {"role": "student"})
        assert res.status_code == 400
        assert not RoleRequest.objects.filter(user=user).exists()
        assert AuditEvent.objects.count() == before

    def test_revoked_student_cannot_self_restore_via_new_request(self, auth_client, make_user):
        from identity.services.roles import revoke_role

        admin = make_user(role=Role.ADMIN)
        student = make_user(email="11249997@st.neu.edu.vn", role=Role.STUDENT)
        grant = student.role_grants.get(role=Role.STUDENT)
        revoke_role(actor_id=admin.id, grant_id=grant.id)
        client = auth_client(student)
        before = AuditEvent.objects.count()
        res = client.post_api("/api/v1/auth/role-requests", {"role": "student"})
        assert res.status_code == 400
        assert not RoleGrant.objects.filter(user=student, revoked_at__isnull=True).exists()
        assert not RoleRequest.objects.filter(user=student, status="pending").exists()
        assert AuditEvent.objects.count() == before

    def test_verification_status_is_bound_to_registered_email(self, auth_client, make_user):
        from identity.models import VerifiedEmail

        admin = make_user(role=Role.ADMIN)
        target = make_user()
        VerifiedEmail.objects.filter(user=target).update(email_digest="a" * 64)
        user_client = auth_client(target)
        assert user_client.get("/api/v1/auth/me").json()["email_verified"] is False
        assert user_client.get("/api/v1/auth/verification").json()["verified"] is False
        admin_client = auth_client(admin)
        assert (
            admin_client.get(f"/api/v1/admin/accounts/{target.id}").json()["email_verified"]
            is False
        )

    def test_all_teacher_requests_includes_closed_requests(self, auth_client, make_user):
        admin = make_user(role=Role.ADMIN)
        target = make_user()
        req = request_role(user_id=target.id, role=Role.TEACHER)
        client = auth_client(admin)
        assert client.post_api(f"/api/v1/admin/teacher-requests/{req.id}/reject").status_code == 200
        assert client.get("/api/v1/admin/teacher-requests").json()["items"] == []
        items = client.get("/api/v1/admin/teacher-requests?status=all").json()["items"]
        assert [item["id"] for item in items] == [str(req.id)]
