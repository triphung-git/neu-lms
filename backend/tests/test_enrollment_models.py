import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.utils import timezone

from courses.models import Course, EnrollmentRequest, Membership
from identity.models import RoleGrant, RoleRequest

User = get_user_model()


@pytest.fixture
def sample_users(db):
    now = timezone.now()
    student = User.objects.create_user(
        email="student1@neu.edu.vn",
        password="ValidPassword123!",
        display_name="Nguyễn Văn Sinh Viên",
    )
    req_s = RoleRequest.objects.create(
        user=student,
        role="student",
        status="approved",
        reviewed_by=student,
        reviewed_at=now,
        review_reason="test_setup",
    )
    RoleGrant.objects.create(
        user=student,
        role="student",
        grant_source="verified_student_email",
        source_request=req_s,
    )

    teacher = User.objects.create_user(
        email="teacher1@neu.edu.vn",
        password="ValidPassword123!",
        display_name="TS. Giảng Viên A",
    )
    req_t = RoleRequest.objects.create(
        user=teacher,
        role="teacher",
        status="approved",
        reviewed_by=teacher,
        reviewed_at=now,
        review_reason="test_setup",
    )
    RoleGrant.objects.create(
        user=teacher,
        role="teacher",
        grant_source="teacher_approval",
        source_request=req_t,
        granted_by=teacher,
    )

    return student, teacher


@pytest.fixture
def sample_course(db, sample_users):
    _, teacher = sample_users
    return Course.objects.create(
        code="CS101",
        name="Lập trình Cơ bản",
        term="HK1-2026",
        teacher=teacher,
        status=Course.Status.OPEN,
        enrollment_open=True,
    )


@pytest.mark.django_db
class TestEnrollmentRequestModel:
    def test_create_pending_request_successful(self, sample_users, sample_course):
        student, _ = sample_users
        req = EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.PENDING,
        )
        assert req.id is not None
        assert req.status == EnrollmentRequest.Status.PENDING
        assert req.reviewed_by is None
        assert req.reviewed_at is None
        assert req.rejection_reason == ""
        assert req.created_at is not None
        assert req.updated_at is not None

    def test_single_pending_request_constraint_prevents_duplicate_pending(
        self, sample_users, sample_course
    ):
        student, _ = sample_users
        EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.PENDING,
        )

        with transaction.atomic():
            with pytest.raises(IntegrityError):
                EnrollmentRequest.objects.create(
                    course=sample_course,
                    student=student,
                    status=EnrollmentRequest.Status.PENDING,
                )

    def test_allows_new_pending_request_after_terminal_state_preserving_history(
        self, sample_users, sample_course
    ):
        student, teacher = sample_users

        # First request rejected
        first_req = EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.REJECTED,
            reviewed_by=teacher,
            reviewed_at=timezone.now(),
            rejection_reason="Chưa đáp ứng môn tiên quyết",
        )

        # Student submits a second request (now pending)
        second_req = EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.PENDING,
        )

        assert first_req.id != second_req.id
        assert EnrollmentRequest.objects.filter(course=sample_course, student=student).count() == 2
        assert (
            EnrollmentRequest.objects.filter(
                course=sample_course,
                student=student,
                status=EnrollmentRequest.Status.PENDING,
            ).count()
            == 1
        )

    def test_allows_new_pending_request_after_cancellation_preserving_history(
        self, sample_users, sample_course
    ):
        student, _ = sample_users

        # First request cancelled by student
        cancelled_req = EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.CANCELLED,
        )

        # Re-apply
        new_req = EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.PENDING,
        )

        assert cancelled_req.id != new_req.id
        assert EnrollmentRequest.objects.filter(course=sample_course, student=student).count() == 2

    def test_review_consistency_constraint_approved_requires_reviewer_and_timestamp(
        self, sample_users, sample_course
    ):
        student, teacher = sample_users

        # Missing reviewed_by
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                EnrollmentRequest.objects.create(
                    course=sample_course,
                    student=student,
                    status=EnrollmentRequest.Status.APPROVED,
                    reviewed_at=timezone.now(),
                )

        # Missing reviewed_at
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                EnrollmentRequest.objects.create(
                    course=sample_course,
                    student=student,
                    status=EnrollmentRequest.Status.APPROVED,
                    reviewed_by=teacher,
                )

        # Valid approved request
        valid_req = EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.APPROVED,
            reviewed_by=teacher,
            reviewed_at=timezone.now(),
        )
        assert valid_req.status == EnrollmentRequest.Status.APPROVED

    def test_review_consistency_constraint_rejected_requires_reviewer_and_timestamp(
        self, sample_users, sample_course
    ):
        student, teacher = sample_users

        with transaction.atomic():
            with pytest.raises(IntegrityError):
                EnrollmentRequest.objects.create(
                    course=sample_course,
                    student=student,
                    status=EnrollmentRequest.Status.REJECTED,
                    reviewed_by=None,
                    reviewed_at=None,
                )

        valid_rejected = EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.REJECTED,
            reviewed_by=teacher,
            reviewed_at=timezone.now(),
            rejection_reason="Lớp đã đủ sĩ số",
        )
        assert valid_rejected.status == EnrollmentRequest.Status.REJECTED

    def test_review_consistency_constraint_pending_and_cancelled_cannot_have_reviewer(
        self, sample_users, sample_course
    ):
        student, teacher = sample_users

        # Pending cannot have reviewer
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                EnrollmentRequest.objects.create(
                    course=sample_course,
                    student=student,
                    status=EnrollmentRequest.Status.PENDING,
                    reviewed_by=teacher,
                    reviewed_at=timezone.now(),
                )

        # Cancelled cannot have reviewer
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                EnrollmentRequest.objects.create(
                    course=sample_course,
                    student=student,
                    status=EnrollmentRequest.Status.CANCELLED,
                    reviewed_by=teacher,
                    reviewed_at=timezone.now(),
                )

    def test_foreign_key_protect_on_course(self, sample_users, sample_course):
        student, _ = sample_users
        EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.PENDING,
        )

        with transaction.atomic():
            with pytest.raises(ProtectedError):
                sample_course.delete()

    def test_foreign_key_protect_on_student(self, sample_users, sample_course):
        student, _ = sample_users
        EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.PENDING,
        )

        with transaction.atomic():
            with pytest.raises(ProtectedError):
                student.delete()

    def test_foreign_key_protect_on_reviewer(self, sample_users, sample_course):
        student, teacher = sample_users
        EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.APPROVED,
            reviewed_by=teacher,
            reviewed_at=timezone.now(),
        )

        with transaction.atomic():
            with pytest.raises(ProtectedError):
                teacher.delete()

    def test_pending_request_does_not_create_active_membership(self, sample_users, sample_course):
        student, _ = sample_users
        EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.PENDING,
        )

        # Assert no membership created
        assert Membership.objects.filter(course=sample_course, student=student).count() == 0

    def test_membership_uniqueness_and_withdrawn_separation(self, sample_users, sample_course):
        student, _ = sample_users
        m = Membership.objects.create(
            course=sample_course,
            student=student,
            status=Membership.Status.WITHDRAWN,
        )

        assert m.status == Membership.Status.WITHDRAWN
        # Cannot create second membership
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                Membership.objects.create(
                    course=sample_course,
                    student=student,
                    status=Membership.Status.ACTIVE,
                )

        # But student CAN submit an EnrollmentRequest while previously withdrawn
        req = EnrollmentRequest.objects.create(
            course=sample_course,
            student=student,
            status=EnrollmentRequest.Status.PENDING,
        )
        assert req.status == EnrollmentRequest.Status.PENDING

    @pytest.mark.django_db(transaction=True)
    def test_concurrent_pending_requests_database_rejection(self, sample_users, sample_course):
        from concurrent.futures import ThreadPoolExecutor
        from threading import Barrier

        from django.db import close_old_connections, connections

        student, _ = sample_users
        course_id = sample_course.id
        student_id = student.id
        barrier = Barrier(2)

        def worker():
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                req = EnrollmentRequest.objects.create(
                    course_id=course_id,
                    student_id=student_id,
                    status=EnrollmentRequest.Status.PENDING,
                )
                return ("success", req.id)
            except IntegrityError as exc:
                return ("integrity_error", str(exc))
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(worker), pool.submit(worker)]
            results = [f.result() for f in futures]

        statuses = [r[0] for r in results]
        assert "success" in statuses
        assert "integrity_error" in statuses
        assert (
            EnrollmentRequest.objects.filter(
                course_id=course_id,
                student_id=student_id,
                status=EnrollmentRequest.Status.PENDING,
            ).count()
            == 1
        )

    def test_migration_history_and_upgrade_safe(self, sample_users, sample_course):
        from django.db import connection
        from django.db.migrations.executor import MigrationExecutor

        executor = MigrationExecutor(connection)
        applied = [m[1] for m in executor.loader.applied_migrations if m[0] == "courses"]
        assert "0003_membership_updated_at_enrollmentrequest" in applied
