from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from courses.models import Course, EnrollmentRequest, Membership
from courses.services import (
    approve_enrollment_request,
    cancel_enrollment_request,
    reject_enrollment_request,
    request_enrollment,
    transfer_course,
)
from identity.models import Role, RoleGrant, RoleRequest, VerifiedEmail
from identity.services.common import digest

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
        status=Course.Status.OPEN,
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
class TestEnrollmentServices:
    def test_request_enrollment_success(self, test_setup):
        student = test_setup["student"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        assert req.status == EnrollmentRequest.Status.PENDING
        assert req.course == course
        assert req.student == student
        assert req.reviewed_by is None

        # Does not create active membership yet
        assert not Membership.objects.filter(course=course, student=student).exists()

    def test_request_enrollment_duplicate_pending_blocked(self, test_setup):
        student = test_setup["student"]
        course = test_setup["course"]

        request_enrollment(student, course.id)
        with pytest.raises(ValidationError) as exc:
            request_enrollment(student, course.id)
        assert "chờ duyệt" in str(exc.value)

    def test_request_enrollment_already_enrolled_blocked(self, test_setup):
        student = test_setup["student"]
        course = test_setup["course"]

        Membership.objects.create(course=course, student=student, status=Membership.Status.ACTIVE)
        with pytest.raises(ValidationError) as exc:
            request_enrollment(student, course.id)
        assert "đã là thành viên" in str(exc.value)

    def test_request_enrollment_closed_blocked(self, test_setup):
        student = test_setup["student"]
        course = test_setup["course"]
        course.enrollment_open = False
        course.save()

        with pytest.raises(ValidationError) as exc:
            request_enrollment(student, course.id)
        assert "đang đóng nhận ghi danh" in str(exc.value)

    def test_request_enrollment_archived_blocked(self, test_setup):
        student = test_setup["student"]
        course = test_setup["course"]
        course.status = Course.Status.ARCHIVED
        course.archived_at = timezone.now()
        course.save()

        with pytest.raises(ValidationError) as exc:
            request_enrollment(student, course.id)
        assert "đã lưu trữ" in str(exc.value)

    def test_request_enrollment_requires_active_student_and_verified_email(self, test_setup):
        course = test_setup["course"]

        # User without student role
        other_user = make_test_user("other@neu.edu.vn", role=None)
        with pytest.raises(PermissionDenied):
            request_enrollment(other_user, course.id)

        # Unverified student
        unverified = make_test_user("unverified@neu.edu.vn", role=Role.STUDENT, verified=False)
        with pytest.raises(PermissionDenied) as exc:
            request_enrollment(unverified, course.id)
        assert "xác minh" in str(exc.value)

    def test_cancel_enrollment_request_success(self, test_setup):
        student = test_setup["student"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        cancelled = cancel_enrollment_request(student, req.id)
        assert cancelled.status == EnrollmentRequest.Status.CANCELLED

        # Student can re-request after cancellation
        req2 = request_enrollment(student, course.id)
        assert req2.status == EnrollmentRequest.Status.PENDING
        assert req2.id != req.id

    def test_cancel_enrollment_request_permission_denied_for_other_student(self, test_setup):
        student = test_setup["student"]
        student2 = test_setup["student2"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        with pytest.raises(PermissionDenied):
            cancel_enrollment_request(student2, req.id)

    def test_cancel_non_pending_request_blocked(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        approve_enrollment_request(teacher, req.id)

        with pytest.raises(ValidationError):
            cancel_enrollment_request(student, req.id)

    def test_approve_enrollment_request_creates_membership(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        approved_req, membership = approve_enrollment_request(teacher, req.id)

        assert approved_req.status == EnrollmentRequest.Status.APPROVED
        assert approved_req.reviewed_by == teacher
        assert approved_req.reviewed_at is not None
        assert membership.status == Membership.Status.ACTIVE
        assert membership.course == course
        assert membership.student == student

    def test_approve_enrollment_request_idempotent_replay(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        req1, m1 = approve_enrollment_request(teacher, req.id)
        # Re-calling approve with same teacher does not error and returns same result
        req2, m2 = approve_enrollment_request(teacher, req.id)

        assert req1.id == req2.id
        assert m1.id == m2.id

    def test_approve_restores_withdrawn_membership_without_creating_second_row(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        # Initially withdrawn
        old_m = Membership.objects.create(
            course=course,
            student=student,
            status=Membership.Status.WITHDRAWN,
        )

        req = request_enrollment(student, course.id)
        approved_req, new_m = approve_enrollment_request(teacher, req.id)

        assert approved_req.status == EnrollmentRequest.Status.APPROVED
        assert new_m.id == old_m.id  # Same record reused
        assert new_m.status == Membership.Status.ACTIVE
        assert Membership.objects.filter(course=course, student=student).count() == 1

    def test_approve_works_even_when_enrollment_is_closed_for_existing_pending(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)

        # Teacher closes enrollment
        course.enrollment_open = False
        course.save()

        # Existing pending request can still be approved
        approved_req, membership = approve_enrollment_request(teacher, req.id)
        assert approved_req.status == EnrollmentRequest.Status.APPROVED
        assert membership.status == Membership.Status.ACTIVE

    def test_approve_denied_for_non_owner_and_admin(self, test_setup):
        student = test_setup["student"]
        teacher2 = test_setup["teacher2"]
        admin_user = test_setup["admin"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)

        # Other teacher cannot approve
        with pytest.raises(PermissionDenied):
            approve_enrollment_request(teacher2, req.id)

        # Admin without ownership cannot approve
        with pytest.raises(PermissionDenied):
            approve_enrollment_request(admin_user, req.id)

    def test_reject_enrollment_request_success(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        rejected = reject_enrollment_request(teacher, req.id, reason="Lớp đã hết chỗ")

        assert rejected.status == EnrollmentRequest.Status.REJECTED
        assert rejected.reviewed_by == teacher
        assert rejected.rejection_reason == "Lớp đã hết chỗ"
        assert not Membership.objects.filter(course=course, student=student).exists()

        # Replay is idempotent
        rejected2 = reject_enrollment_request(teacher, req.id, reason="Lớp đã hết chỗ")
        assert rejected2.id == rejected.id

    def test_cannot_approve_already_rejected_or_cancelled_request(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        reject_enrollment_request(teacher, req.id, reason="Từ chối")

        # Cannot approve rejected request
        with pytest.raises(ValidationError):
            approve_enrollment_request(teacher, req.id)

    def test_transfer_course_changes_approval_authority(self, test_setup):
        student = test_setup["student"]
        old_teacher = test_setup["teacher"]
        new_teacher = test_setup["teacher2"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)

        # Transfer course to new_teacher
        transfer_course(course.id, str(new_teacher.id))

        # Old teacher is now denied
        with pytest.raises(PermissionDenied):
            approve_enrollment_request(old_teacher, req.id)

        # New teacher can approve
        approved_req, _ = approve_enrollment_request(new_teacher, req.id)
        assert approved_req.status == EnrollmentRequest.Status.APPROVED
        assert approved_req.reviewed_by == new_teacher

    def test_archive_course_blocks_approval(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)

        course.status = Course.Status.ARCHIVED
        course.archived_at = timezone.now()
        course.save()

        with pytest.raises(ValidationError) as exc:
            approve_enrollment_request(teacher, req.id)
        assert "đã lưu trữ" in str(exc.value)


@pytest.mark.django_db(transaction=True)
class TestEnrollmentConcurrency:
    def test_cancel_vs_approve_race(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        req_id = req.id

        barrier = Barrier(2)
        results = []

        def student_cancel():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                cancel_enrollment_request(student, req_id)
                return "cancelled"
            except Exception as e:
                return f"cancel_err: {type(e).__name__}"
            finally:
                connections.close_all()

        def teacher_approve():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                approve_enrollment_request(teacher, req_id)
                return "approved"
            except Exception as e:
                return f"approve_err: {type(e).__name__}"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(student_cancel)
            f2 = pool.submit(teacher_approve)
            results = [f1.result(), f2.result()]

        # Exactly one transaction wins, and the other is safely rejected with validation error
        has_approved = "approved" in results
        has_cancelled = "cancelled" in results
        assert has_approved != has_cancelled  # XOR

        final_req = EnrollmentRequest.objects.get(pk=req_id)
        if has_approved:
            assert final_req.status == EnrollmentRequest.Status.APPROVED
            assert Membership.objects.filter(
                course=course, student=student, status="active"
            ).exists()
        else:
            assert final_req.status == EnrollmentRequest.Status.CANCELLED
            assert not Membership.objects.filter(course=course, student=student).exists()

    def test_approve_vs_reject_race(self, test_setup):
        student = test_setup["student"]
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        req = request_enrollment(student, course.id)
        req_id = req.id

        barrier = Barrier(2)
        results = []

        def worker_approve():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                approve_enrollment_request(teacher, req_id)
                return "approved"
            except Exception as e:
                return f"approve_err: {type(e).__name__}"
            finally:
                connections.close_all()

        def worker_reject():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                reject_enrollment_request(teacher, req_id, reason="Từ chối")
                return "rejected"
            except Exception as e:
                return f"reject_err: {type(e).__name__}"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            f1 = pool.submit(worker_approve)
            f2 = pool.submit(worker_reject)
            results = [f1.result(), f2.result()]

        has_approved = "approved" in results
        has_rejected = "rejected" in results
        assert has_approved != has_rejected  # Exactly one wins

        final_req = EnrollmentRequest.objects.get(pk=req_id)
        assert final_req.status in (
            EnrollmentRequest.Status.APPROVED,
            EnrollmentRequest.Status.REJECTED,
        )


@pytest.mark.django_db
class TestEnrollmentAcceptance:
    @pytest.mark.parametrize("invalid", ["inactive", "revoked", "unverified"])
    def test_approval_rechecks_student_eligibility_without_partial_state(self, test_setup, invalid):
        student, teacher, course = (test_setup[k] for k in ("student", "teacher", "course"))
        req = request_enrollment(student, course.id)
        if invalid == "inactive":
            User.objects.filter(pk=student.pk).update(is_active=False)
        elif invalid == "revoked":
            RoleGrant.objects.filter(user=student, role=Role.STUDENT).update(
                revoked_at=timezone.now(), revoked_by=teacher, revoke_reason="acceptance"
            )
        else:
            VerifiedEmail.objects.filter(user=student).update(email_digest="stale")
        with pytest.raises(PermissionDenied):
            approve_enrollment_request(teacher, req.id)
        req.refresh_from_db()
        assert req.status == "pending"
        assert not Membership.objects.filter(course=course, student=student).exists()

    def test_stale_teacher_cannot_approve_after_account_disabled(self, test_setup):
        student, teacher, course = (test_setup[k] for k in ("student", "teacher", "course"))
        req = request_enrollment(student, course.id)
        User.objects.filter(pk=teacher.pk).update(is_active=False)
        with pytest.raises(PermissionDenied):
            approve_enrollment_request(teacher, req.id)
        req.refresh_from_db()
        assert req.status == "pending"

    def test_rejection_freeform_text_stays_out_of_audit(self, test_setup):
        from platform_core.models import AuditEvent, OutboxEvent

        student, teacher, course = (test_setup[k] for k in ("student", "teacher", "course"))
        req = request_enrollment(student, course.id)
        reject_enrollment_request(teacher, req.id, "Private review text")
        req.refresh_from_db()
        assert req.rejection_reason == "Private review text"
        event = AuditEvent.objects.get(action="courses.enrollment_rejected", resource_id=course.id)
        assert "reason" not in event.metadata
        assert "Private review text" not in str(event.metadata)
        assert OutboxEvent.objects.filter(dedupe_key=str(event.id)).exists()


@pytest.mark.django_db(transaction=True)
def test_approval_waits_for_identity_policy_and_rechecks_actor():
    from threading import Event

    from django.db import transaction

    from identity.services.common import lock_role_policy

    student = make_test_user("race-student@example.invalid", Role.STUDENT)
    teacher = make_test_user("race-teacher@example.invalid", Role.TEACHER)
    course = Course.objects.create(
        code="RACE-IDENTITY", name="Race", term="T", teacher=teacher, enrollment_open=True
    )
    req = request_enrollment(student, course.id)
    started = Event()

    def approve():
        close_old_connections()
        try:
            started.set()
            try:
                approve_enrollment_request(teacher, req.id)
            except PermissionDenied:
                return "denied"
            return "approved"
        finally:
            close_old_connections()

    with ThreadPoolExecutor(max_workers=1) as pool:
        with transaction.atomic():
            lock_role_policy()
            pending = pool.submit(approve)
            assert started.wait(timeout=10)
            User.objects.filter(pk=teacher.pk).update(is_active=False)
        assert pending.result(timeout=15) == "denied"
    req.refresh_from_db()
    assert req.status == "pending"
    assert not Membership.objects.filter(course=course, student=student).exists()
