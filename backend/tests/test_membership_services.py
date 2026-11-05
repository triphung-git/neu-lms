from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from courses.models import Course, Membership
from courses.services import (
    add_course_member,
    archive_course,
    get_course_membership,
    re_enroll_course_member,
    require_course_member_or_owner,
    withdraw_course_member,
)
from courses.views import visible_course_queryset
from identity.models import Role, RoleGrant, RoleRequest, VerifiedEmail
from identity.services.common import digest
from platform_core.models import AuditEvent

User = get_user_model()


def make_test_user(email: str, role: str | None = None, verified: bool = True):
    now = timezone.now()
    user = User.objects.create_user(
        email=email,
        password="ValidPassword123!",
        display_name=f"User {email}",
    )
    if verified:
        VerifiedEmail.objects.create(
            user=user,
            email_digest=digest(user.email),
            verified_at=now,
        )
    else:
        VerifiedEmail.objects.create(
            user=user,
            email_digest="",
            verified_at=None,
        )

    if role == Role.ADMIN:
        RoleGrant.objects.create(
            user=user,
            role=role,
            grant_source="internal_administration",
        )
    elif role:
        req = RoleRequest.objects.create(
            user=user,
            role=role,
            status="approved",
            reviewed_by=user,
            reviewed_at=now,
            review_reason="test_setup",
        )
        RoleGrant.objects.create(
            user=user,
            role=role,
            grant_source="teacher_approval" if role == Role.TEACHER else "verified_student_email",
            source_request=req,
            granted_by=user if role == Role.TEACHER else None,
        )
    return user


@pytest.fixture
def test_setup(db):
    student = make_test_user("sv1@neu.edu.vn", role=Role.STUDENT)
    student2 = make_test_user("sv2@neu.edu.vn", role=Role.STUDENT)
    teacher = make_test_user("gv1@neu.edu.vn", role=Role.TEACHER)
    teacher2 = make_test_user("gv2@neu.edu.vn", role=Role.TEACHER)
    admin_user = make_test_user("admin1@neu.edu.vn", role=Role.ADMIN)

    course = Course.objects.create(
        code="CS101",
        name="Lập trình Cơ bản",
        term="HK1-2026",
        teacher=teacher,
        enrollment_open=True,
    )
    return {
        "student": student,
        "student2": student2,
        "teacher": teacher,
        "teacher2": teacher2,
        "admin": admin_user,
        "course": course,
    }


@pytest.mark.django_db
class TestMembershipServices:
    def test_add_course_member_success(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        membership = add_course_member(teacher, course.id, student.email)
        assert membership.status == Membership.Status.ACTIVE
        assert membership.student_id == student.id
        assert membership.course_id == course.id

        # Verify audit event
        audit = AuditEvent.objects.filter(
            action="courses.member_added",
            resource_id=course.id,
            actor=teacher,
        ).first()
        assert audit is not None
        assert audit.metadata["student_id"] == str(student.id)

    def test_add_course_member_re_enrolls_existing_withdrawn_record(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        # Initial membership that was later withdrawn
        m_initial = Membership.objects.create(
            course=course,
            student=student,
            status=Membership.Status.WITHDRAWN,
        )
        initial_id = m_initial.id
        initial_added_at = m_initial.added_at

        # Teacher adds student back
        m_restored = add_course_member(teacher, course.id, student.email)
        assert m_restored.id == initial_id
        assert m_restored.status == Membership.Status.ACTIVE
        assert m_restored.added_at == initial_added_at
        assert Membership.objects.filter(course=course, student=student).count() == 1

    def test_add_course_member_idempotent_when_already_active(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        m1 = add_course_member(teacher, course.id, student.email)
        m2 = add_course_member(teacher, course.id, student.email)
        assert m1.id == m2.id
        assert Membership.objects.filter(course=course, student=student).count() == 1

    def test_add_course_member_fails_when_user_not_found(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        with pytest.raises(ValidationError) as exc_info:
            add_course_member(teacher, course.id, "nonexistent@neu.edu.vn")
        assert "student_email" in exc_info.value.detail

        # Assert no user or membership created
        assert not User.objects.filter(email="nonexistent@neu.edu.vn").exists()

    def test_add_course_member_fails_when_not_student(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        teacher2 = test_setup["teacher2"]

        with pytest.raises(PermissionDenied):
            add_course_member(teacher, course.id, teacher2.email)

    def test_add_course_member_fails_when_unverified_or_inactive(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        unverified_student = make_test_user(
            "unverified@neu.edu.vn", role=Role.STUDENT, verified=False
        )
        with pytest.raises(PermissionDenied):
            add_course_member(teacher, course.id, unverified_student.email)

        # Inactive student
        inactive_student = make_test_user("inactive@neu.edu.vn", role=Role.STUDENT, verified=True)
        inactive_student.is_active = False
        inactive_student.save(update_fields=["is_active"])

        with pytest.raises(PermissionDenied):
            add_course_member(teacher, course.id, inactive_student.email)

    def test_add_course_member_denied_for_foreign_teacher_or_admin(self, test_setup):
        teacher2 = test_setup["teacher2"]
        admin_user = test_setup["admin"]
        course = test_setup["course"]
        student = test_setup["student"]

        with pytest.raises(PermissionDenied):
            add_course_member(teacher2, course.id, student.email)

        with pytest.raises(PermissionDenied):
            add_course_member(admin_user, course.id, student.email)

    def test_add_course_member_blocked_on_archived_course(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        archive_course(teacher, course.id)

        with pytest.raises(ValidationError) as exc_info:
            add_course_member(teacher, course.id, student.email)
        assert "course" in exc_info.value.detail

    def test_withdraw_course_member_by_student_self(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        m = add_course_member(teacher, course.id, student.email)
        assert m.status == Membership.Status.ACTIVE

        # Student self-withdraws
        m_withdrawn = withdraw_course_member(student, course.id, student.id)
        assert m_withdrawn.id == m.id
        assert m_withdrawn.status == Membership.Status.WITHDRAWN

        # Verify audit event
        audit = AuditEvent.objects.filter(
            action="courses.member_withdrawn",
            resource_id=course.id,
            actor=student,
        ).first()
        assert audit is not None
        assert audit.metadata["membership_id"] == str(m.id)

    def test_withdraw_course_member_by_owner_teacher(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        m = add_course_member(teacher, course.id, student.email)
        m_removed = withdraw_course_member(teacher, course.id, student.id)
        assert m_removed.id == m.id
        assert m_removed.status == Membership.Status.WITHDRAWN

        audit = AuditEvent.objects.filter(
            action="courses.member_removed",
            resource_id=course.id,
            actor=teacher,
        ).first()
        assert audit is not None
        assert audit.metadata["membership_id"] == str(m.id)

    def test_withdraw_course_member_idempotent(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        add_course_member(teacher, course.id, student.email)
        m1 = withdraw_course_member(teacher, course.id, student.id)
        m2 = withdraw_course_member(teacher, course.id, student.id)
        assert m1.id == m2.id
        assert m2.status == Membership.Status.WITHDRAWN

    def test_withdraw_denied_for_foreign_users_and_admin(self, test_setup):
        teacher = test_setup["teacher"]
        teacher2 = test_setup["teacher2"]
        admin_user = test_setup["admin"]
        course = test_setup["course"]
        student = test_setup["student"]
        student2 = test_setup["student2"]

        add_course_member(teacher, course.id, student.email)

        # Another student cannot withdraw student 1
        with pytest.raises(PermissionDenied):
            withdraw_course_member(student2, course.id, student.id)

        # Foreign teacher cannot withdraw student
        with pytest.raises(PermissionDenied):
            withdraw_course_member(teacher2, course.id, student.id)

        # Admin cannot withdraw student
        with pytest.raises(PermissionDenied):
            withdraw_course_member(admin_user, course.id, student.id)

    def test_withdraw_blocked_on_archived_course(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        add_course_member(teacher, course.id, student.email)

        archive_course(teacher, course.id)

        with pytest.raises(ValidationError) as exc_info:
            withdraw_course_member(teacher, course.id, student.id)
        assert "course" in exc_info.value.detail

    def test_re_enroll_course_member_success(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        m = add_course_member(teacher, course.id, student.email)
        initial_id = m.id
        initial_added_at = m.added_at

        # Withdraw
        withdraw_course_member(teacher, course.id, student.id)

        # Re-enroll
        m_re = re_enroll_course_member(teacher, course.id, student.id)
        assert m_re.id == initial_id
        assert m_re.status == Membership.Status.ACTIVE
        assert m_re.added_at == initial_added_at

        # Verify audit event
        audit = AuditEvent.objects.filter(
            action="courses.member_re_enrolled",
            resource_id=course.id,
            actor=teacher,
        ).first()
        assert audit is not None
        assert audit.metadata["membership_id"] == str(initial_id)

    def test_re_enroll_course_member_idempotent(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        add_course_member(teacher, course.id, student.email)
        m1 = re_enroll_course_member(teacher, course.id, student.id)
        m2 = re_enroll_course_member(teacher, course.id, student.id)
        assert m1.id == m2.id
        assert m2.status == Membership.Status.ACTIVE

    def test_re_enroll_course_member_denied_for_foreign_teacher(self, test_setup):
        teacher = test_setup["teacher"]
        teacher2 = test_setup["teacher2"]
        course = test_setup["course"]
        student = test_setup["student"]

        add_course_member(teacher, course.id, student.email)
        withdraw_course_member(teacher, course.id, student.id)

        with pytest.raises(PermissionDenied):
            re_enroll_course_member(teacher2, course.id, student.id)

    def test_re_enroll_denied_if_student_role_revoked(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        add_course_member(teacher, course.id, student.email)
        withdraw_course_member(teacher, course.id, student.id)

        # Revoke student role
        RoleGrant.objects.filter(user=student, role=Role.STUDENT).update(
            revoked_at=timezone.now(),
            revoke_reason="disciplinary",
            revoked_by=test_setup["admin"],
        )

        with pytest.raises(PermissionDenied):
            re_enroll_course_member(teacher, course.id, student.id)

    def test_withdrawn_member_loses_course_access_immediately(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        student = test_setup["student"]

        # Student is active member
        add_course_member(teacher, course.id, student.email)
        assert visible_course_queryset(student).filter(pk=course.id).exists()
        assert get_course_membership(student, course.id) is not None

        c, mem, is_teacher = require_course_member_or_owner(student, course.id)
        assert c.id == course.id
        assert mem is not None
        assert is_teacher is False

        # Student withdraws
        withdraw_course_member(student, course.id, student.id)

        # Must immediately lose access in queryset and authorization checks
        assert not visible_course_queryset(student).filter(pk=course.id).exists()
        assert get_course_membership(student, course.id) is None

        with pytest.raises(PermissionDenied):
            require_course_member_or_owner(student, course.id)


@pytest.mark.django_db(transaction=True)
class TestMembershipConcurrency:
    def test_concurrent_add_member_race(self):
        teacher = make_test_user("gv_race@neu.edu.vn", role=Role.TEACHER)
        student = make_test_user("sv_race@neu.edu.vn", role=Role.STUDENT)
        course = Course.objects.create(
            code="RACE101",
            name="Race Concurrency Course",
            term="HK1-2026",
            teacher=teacher,
            enrollment_open=True,
        )

        barrier = Barrier(2)
        results = []

        def worker():
            connection.close()
            barrier.wait()
            try:
                m = add_course_member(teacher, course.id, student.email)
                results.append(("success", m.id))
            except Exception as e:
                results.append(("error", type(e).__name__))
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(worker), executor.submit(worker)]
            for f in futures:
                f.result()

        # Both workers should complete cleanly and result in exactly one Membership
        assert len(results) == 2
        success_results = [r for r in results if r[0] == "success"]
        assert len(success_results) == 2
        # Both must refer to the exact same membership ID
        assert success_results[0][1] == success_results[1][1]
        assert Membership.objects.filter(course=course, student=student).count() == 1
