import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.db.models import ProtectedError
from django.utils import timezone

from assignments.constants import (
    DEFAULT_MAX_FILES_PER_SUBMISSION,
)
from assignments.exceptions import (
    AssignmentConflictError,
    AssignmentImmutableError,
    AssignmentValidationError,
    CourseArchivedError,
)
from assignments.models import (
    Assignment,
    AssignmentRubricCriterion,
    AssignmentStatus,
)
from assignments.services import (
    archive_assignment,
    check_student_eligibility,
    close_assignment,
    create_assignment,
    publish_assignment,
    reopen_assignment,
    update_assignment,
)
from courses.models import Chapter, Course, Lesson, Membership
from files.models import FilePurpose, FileStatus, StoredFile
from identity.models import Role, RoleGrant, RoleRequest, User, VerifiedEmail
from identity.services.accounts import digest


def _create_user_with_role(email: str, display_name: str, role: str) -> User:
    now = timezone.now()
    user = User.objects.create(
        email=email,
        display_name=display_name,
        is_active=True,
    )
    VerifiedEmail.objects.create(
        user=user,
        email_digest=digest(user.email),
        verified_at=now,
    )
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
        grant_source="teacher_approval" if role == "teacher" else "verified_student_email",
        source_request=req,
        granted_by=user if role == "teacher" else None,
    )
    return user


@pytest.fixture
def teacher_user(db):
    return _create_user_with_role(
        email=f"teacher-{uuid.uuid4().hex[:6]}@example.edu.vn",
        display_name="Giảng Viên Nguyễn Văn A",
        role=Role.TEACHER,
    )


@pytest.fixture
def student_user(db):
    return _create_user_with_role(
        email=f"student-{uuid.uuid4().hex[:6]}@example.edu.vn",
        display_name="Sinh Viên Trần Thị B",
        role=Role.STUDENT,
    )


@pytest.fixture
def course(db, teacher_user):
    return Course.objects.create(
        code=f"IT101-{uuid.uuid4().hex[:6]}",
        name="Lập trình Web Cơ bản",
        term="HK1 2026-2027",
        teacher=teacher_user,
        status=Course.Status.OPEN,
    )


@pytest.fixture
def other_course(db, teacher_user):
    return Course.objects.create(
        code=f"BA201-{uuid.uuid4().hex[:6]}",
        name="Quản trị Học liệu",
        term="HK1 2026-2027",
        teacher=teacher_user,
        status=Course.Status.OPEN,
    )


@pytest.fixture
def chapter(db, course):
    return Chapter.objects.create(
        course=course,
        title="Chương 1: Tổng quan Web",
        position=1,
    )


@pytest.fixture
def lesson(db, chapter):
    return Lesson.objects.create(
        chapter=chapter,
        title="Bài 1: Cấu trúc HTML5",
        position=1,
    )


@pytest.fixture
def other_chapter(db, other_course):
    return Chapter.objects.create(
        course=other_course,
        title="Chương khác",
        position=1,
    )


@pytest.fixture
def active_membership(db, course, student_user):
    return Membership.objects.create(
        course=course,
        student=student_user,
        status=Membership.Status.ACTIVE,
    )


@pytest.fixture
def stored_file(db, course, teacher_user):
    import hashlib

    from files.storage import get_storage

    content = b"%PDF-1.4\nassignment fixture\n%%EOF"
    item = StoredFile.objects.create(
        course=course,
        uploader=teacher_user,
        file_name="de_bai_chi_tiet.pdf",
        file_size=len(content),
        mime_type="application/pdf",
        storage_path="courses/assignments/de_bai.pdf",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.ASSIGNMENT_ATTACHMENT,
        is_published=True,
        sha256_hash=hashlib.sha256(content).hexdigest(),
    )
    get_storage().save(item.storage_path, content)
    return item


@pytest.mark.django_db
class TestAssignmentCreationAndValidation:
    def test_create_assignment_successful_draft(
        self, course, chapter, lesson, teacher_user, stored_file
    ):
        due = timezone.now() + timedelta(days=7)
        rubric_data = [
            {"title": "Cấu trúc HTML", "max_score": "4.00", "position": 1},
            {"title": "CSS Responsive", "max_score": "6.00", "position": 2},
        ]
        fp_data = {
            "max_files_per_submission": 3,
            "max_file_size_bytes": 20 * 1024 * 1024,
            "allowed_extensions": ["PDF", ".zip"],
        }

        assignment = create_assignment(
            course_id=course.id,
            chapter_id=chapter.id,
            lesson_id=lesson.id,
            title="Bài tập 01: Thiết kế giao diện",
            instructions="Sinh viên làm theo yêu cầu đề bài đính kèm.",
            due_at=due,
            allow_late=True,
            ai_grading_opt_in=True,
            created_by=teacher_user,
            rubric_criteria_data=rubric_data,
            file_policy_data=fp_data,
            attachment_file_ids=[stored_file.id],
        )

        assert assignment.id is not None
        assert assignment.status == AssignmentStatus.DRAFT
        assert assignment.version == 1
        assert assignment.total_score == Decimal("10.00")
        assert assignment.allow_late is True
        assert assignment.ai_grading_opt_in is True

        # Check rubric
        assert assignment.rubric_criteria.count() == 2
        crit1 = assignment.rubric_criteria.first()
        assert crit1.title == "Cấu trúc HTML"
        assert crit1.max_score == Decimal("4.00")

        # Check file policy
        assert hasattr(assignment, "file_policy")
        assert assignment.file_policy.max_files_per_submission == 3
        assert assignment.file_policy.allowed_extensions == ["pdf", "zip"]

        # Check attachments
        assert assignment.attachments.count() == 1
        assert assignment.attachments.first().file == stored_file

    def test_create_assignment_missing_title_raises_error(self, course, teacher_user):
        with pytest.raises(AssignmentValidationError) as exc:
            create_assignment(
                course_id=course.id,
                title="",
                due_at=timezone.now() + timedelta(days=3),
                created_by=teacher_user,
            )
        assert "Tiêu đề bài tập không được để trống" in str(exc.value)

    def test_create_assignment_in_archived_course_rejected(self, course, teacher_user):
        course.status = Course.Status.ARCHIVED
        course.archived_at = timezone.now()
        course.save()

        with pytest.raises(CourseArchivedError):
            create_assignment(
                course_id=course.id,
                title="Bài tập trong môn đã lưu trữ",
                due_at=timezone.now() + timedelta(days=3),
                created_by=teacher_user,
            )


@pytest.mark.django_db
class TestCrossCourseReferences:
    def test_cross_course_chapter_rejected(self, course, other_chapter, teacher_user):
        assignment = Assignment(
            course=course,
            chapter=other_chapter,  # other_chapter belongs to other_course
            title="Bài tập vi phạm chapter",
            due_at=timezone.now() + timedelta(days=5),
            created_by=teacher_user,
        )
        with pytest.raises(ValidationError) as exc:
            assignment.full_clean()
        assert "chapter" in exc.value.message_dict

    def test_cross_course_lesson_rejected(self, course, other_course, teacher_user):
        ch = Chapter.objects.create(course=other_course, title="Other Ch", position=1)
        ls = Lesson.objects.create(chapter=ch, title="Other Ls", position=1)

        assignment = Assignment(
            course=course,
            lesson=ls,
            title="Bài tập vi phạm lesson",
            due_at=timezone.now() + timedelta(days=5),
            created_by=teacher_user,
        )
        with pytest.raises(ValidationError) as exc:
            assignment.full_clean()
        assert "lesson" in exc.value.message_dict

    def test_lesson_not_in_selected_chapter_rejected(self, course, teacher_user):
        ch1 = Chapter.objects.create(course=course, title="Ch1", position=1)
        ch2 = Chapter.objects.create(course=course, title="Ch2", position=2)
        ls2 = Lesson.objects.create(chapter=ch2, title="Lesson in Ch2", position=1)

        assignment = Assignment(
            course=course,
            chapter=ch1,
            lesson=ls2,  # ls2 belongs to ch2, not ch1!
            title="Bài tập vi phạm mismatch chapter/lesson",
            due_at=timezone.now() + timedelta(days=5),
            created_by=teacher_user,
        )
        with pytest.raises(ValidationError) as exc:
            assignment.full_clean()
        assert "lesson" in exc.value.message_dict


@pytest.mark.django_db
class TestDeleteCourseChapterLessonBehavior:
    def test_delete_chapter_does_not_delete_assignment(self, course, chapter, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            chapter_id=chapter.id,
            title="Bài tập thuộc chapter",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
        )
        assert assignment.chapter_id == chapter.id

        # Delete Chapter -> SET_NULL, assignment remains intact
        chapter.delete()

        assignment.refresh_from_db()
        assert assignment.chapter_id is None
        assert assignment.title == "Bài tập thuộc chapter"

    def test_delete_lesson_does_not_delete_assignment(self, course, chapter, lesson, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            chapter_id=chapter.id,
            lesson_id=lesson.id,
            title="Bài tập thuộc lesson",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
        )
        assert assignment.lesson_id == lesson.id

        # Delete Lesson -> SET_NULL, assignment remains intact
        lesson.delete()

        assignment.refresh_from_db()
        assert assignment.lesson_id is None
        assert assignment.title == "Bài tập thuộc lesson"

    def test_delete_course_with_assignment_protected(self, course, teacher_user):
        create_assignment(
            course_id=course.id,
            title="Bài tập khóa môn",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
        )
        # Deleting course must raise ProtectedError
        with pytest.raises(ProtectedError):
            course.delete()


@pytest.mark.django_db
class TestInvalidRubricAndFilePolicy:
    def test_rubric_negative_score_rejected(self, course, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
        )
        criterion = AssignmentRubricCriterion(
            assignment=assignment,
            title="Tiêu chí lỗi",
            max_score=Decimal("-1.00"),
            position=1,
        )
        with pytest.raises(ValidationError) as exc:
            criterion.full_clean()
        assert "max_score" in exc.value.message_dict

    def test_file_policy_out_of_range_max_files_rejected(self, course, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
        )
        policy = assignment.file_policy
        policy.max_files_per_submission = 0  # < 1
        with pytest.raises(ValidationError) as exc:
            policy.full_clean()
        assert "max_files_per_submission" in exc.value.message_dict

        policy.max_files_per_submission = 25  # > 10
        with pytest.raises(ValidationError) as exc:
            policy.full_clean()
        assert "max_files_per_submission" in exc.value.message_dict

    def test_file_policy_non_positive_file_size_rejected(self, course, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
        )
        policy = assignment.file_policy
        policy.max_file_size_bytes = 0
        with pytest.raises(ValidationError) as exc:
            policy.full_clean()
        assert "max_file_size_bytes" in exc.value.message_dict


@pytest.mark.django_db
class TestPublishedImmutability:
    def test_cannot_modify_title_or_instructions_after_publish(self, course, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Tiêu đề ban đầu",
            instructions="Yêu cầu ban đầu",
            due_at=timezone.now() + timedelta(days=5),
            created_by=teacher_user,
            rubric_criteria_data=[{"title": "Cơ bản", "max_score": 10, "position": 1}],
            publish_immediately=True,
        )
        assert assignment.status == AssignmentStatus.PUBLISHED

        # 1. Via Service -> raises AssignmentImmutableError
        with pytest.raises(AssignmentImmutableError):
            update_assignment(
                assignment_id=assignment.id,
                actor=teacher_user,
                title="Tiêu đề đã bị sửa đổi trái phép",
            )

        with pytest.raises(AssignmentImmutableError):
            update_assignment(
                assignment_id=assignment.id,
                actor=teacher_user,
                instructions="Nội dung đã bị sửa đổi trái phép",
            )

        # 2. Via Model save() -> raises AssignmentImmutableError
        assignment.title = "Direct Model Modification"
        with pytest.raises(AssignmentImmutableError):
            assignment.save()

    def test_cannot_modify_or_delete_rubric_after_publish(self, course, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Đề bài",
            due_at=timezone.now() + timedelta(days=5),
            created_by=teacher_user,
            rubric_criteria_data=[{"title": "Tiêu chí 1", "max_score": 10, "position": 1}],
            publish_immediately=True,
        )
        criterion = assignment.rubric_criteria.first()

        # Update via service
        with pytest.raises(AssignmentImmutableError):
            update_assignment(
                assignment_id=assignment.id,
                actor=teacher_user,
                rubric_criteria_data=[{"title": "Sửa tiêu chí", "max_score": 10, "position": 1}],
            )

        # Modify criterion directly
        criterion.title = "Sửa trực tiếp"
        with pytest.raises(AssignmentImmutableError):
            criterion.save()

        # Delete criterion directly
        with pytest.raises(AssignmentImmutableError):
            criterion.delete()

    def test_allowed_updates_after_publish_succeed(self, course, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Đề bài cố định",
            instructions="Yêu cầu cố định",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
            publish_immediately=True,
        )
        old_version = assignment.version
        new_due = timezone.now() + timedelta(days=10)

        updated = update_assignment(
            assignment_id=assignment.id,
            actor=teacher_user,
            expected_version=old_version,
            due_at=new_due,
            allow_late=True,
            ai_grading_opt_in=True,
            file_policy_data={
                "max_files_per_submission": 4,
                "max_file_size_bytes": 30 * 1024 * 1024,
            },
        )

        assert updated.due_at == new_due
        assert updated.allow_late is True
        assert updated.ai_grading_opt_in is True
        assert updated.version == old_version + 1
        assert updated.file_policy.max_files_per_submission == 4
        assert updated.file_policy.version == 2
        # Title and instructions remained strictly intact
        assert updated.title == "Đề bài cố định"


@pytest.mark.django_db
class TestPublicationSnapshot:
    def test_publish_creates_immutable_snapshot(self, course, teacher_user, stored_file):
        assignment = create_assignment(
            course_id=course.id,
            title="Đề bài gốc v1",
            instructions="Hướng dẫn gốc v1",
            due_at=timezone.now() + timedelta(days=5),
            created_by=teacher_user,
            rubric_criteria_data=[
                {"title": "Tiêu chí A", "max_score": 4, "position": 1},
                {"title": "Tiêu chí B", "max_score": 6, "position": 2},
            ],
            attachment_file_ids=[stored_file.id],
        )
        assert assignment.publication_snapshots.count() == 0

        # Publish
        published = publish_assignment(assignment_id=assignment.id, actor=teacher_user)
        assert published.status == AssignmentStatus.PUBLISHED
        assert published.publication_snapshots.count() == 1

        snapshot = published.publication_snapshots.first()
        assert snapshot.snapshot_title == "Đề bài gốc v1"
        assert snapshot.snapshot_instructions == "Hướng dẫn gốc v1"
        assert len(snapshot.snapshot_rubric) == 2
        assert snapshot.snapshot_rubric[0]["title"] == "Tiêu chí A"
        assert len(snapshot.snapshot_attachments) == 1
        assert snapshot.snapshot_attachments[0]["name"] == "de_bai_chi_tiet.pdf"

        # Even if allowed fields change later (e.g. file policy version 2):
        update_assignment(
            assignment_id=assignment.id,
            actor=teacher_user,
            file_policy_data={"max_files_per_submission": 8},
        )
        snapshot.refresh_from_db()
        assert (
            snapshot.snapshot_file_policy["max_files_per_submission"]
            == DEFAULT_MAX_FILES_PER_SUBMISSION
        )


@pytest.mark.django_db
class TestLifecycleStateMachine:
    def test_close_and_reopen_assignment(self, course, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Bài kiểm tra nhanh",
            due_at=timezone.now() + timedelta(days=2),
            created_by=teacher_user,
            publish_immediately=True,
        )
        assert assignment.status == AssignmentStatus.PUBLISHED
        assert assignment.manually_closed_at is None

        # 1. Close assignment
        closed = close_assignment(
            assignment_id=assignment.id,
            actor=teacher_user,
            reason="Hết giờ làm bài kiểm tra nhanh",
        )
        assert closed.status == AssignmentStatus.CLOSED
        assert closed.manually_closed_at is not None

        # 2. Reopen assignment with extension
        extension = timezone.now() + timedelta(days=4)
        reopened = reopen_assignment(
            assignment_id=assignment.id,
            actor=teacher_user,
            reopen_until=extension,
            reason="Mở lại cho sinh viên nộp bù",
        )
        assert reopened.status == AssignmentStatus.PUBLISHED
        assert reopened.manually_closed_at is None
        assert reopened.due_at == extension

    def test_archive_assignment(self, course, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập kết thúc",
            due_at=timezone.now() + timedelta(days=1),
            created_by=teacher_user,
            publish_immediately=True,
        )
        archived = archive_assignment(assignment_id=assignment.id, actor=teacher_user)
        assert archived.status == AssignmentStatus.ARCHIVED


@pytest.mark.django_db
class TestOptimisticConcurrencyControl:
    def test_mismatched_version_raises_conflict(self, course, teacher_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập kiểm tra OCC",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
        )
        assert assignment.version == 1

        with pytest.raises(AssignmentConflictError):
            update_assignment(
                assignment_id=assignment.id,
                actor=teacher_user,
                expected_version=99,  # Mismatched version
                due_at=timezone.now() + timedelta(days=5),
            )


@pytest.mark.django_db
class TestStudentEligibilityServerAuthority:
    def test_unenrolled_student_cannot_submit(self, course, teacher_user, student_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập cho lớp",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
            publish_immediately=True,
        )
        # student_user is NOT enrolled in course
        result = check_student_eligibility(
            assignment=assignment,
            student=student_user,
        )
        assert result["can_submit"] is False
        assert result["reason"] == "NOT_ENROLLED"

    def test_withdrawn_student_cannot_submit(self, course, teacher_user, student_user):
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập cho lớp",
            due_at=timezone.now() + timedelta(days=3),
            created_by=teacher_user,
            publish_immediately=True,
        )
        Membership.objects.create(
            course=course,
            student=student_user,
            status=Membership.Status.WITHDRAWN,
        )
        result = check_student_eligibility(
            assignment=assignment,
            student=student_user,
        )
        assert result["can_submit"] is False
        assert result["reason"] == "NOT_ENROLLED"

    def test_before_deadline_active_student_can_submit(
        self, course, teacher_user, student_user, active_membership
    ):
        due = timezone.now() + timedelta(days=2)
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập",
            due_at=due,
            allow_late=False,
            created_by=teacher_user,
            publish_immediately=True,
        )
        # Test at current time (before deadline)
        result = check_student_eligibility(
            assignment=assignment,
            student=student_user,
            current_time=timezone.now(),
        )
        assert result["can_submit"] is True
        assert result["is_late"] is False

    def test_after_deadline_with_allow_late_is_allowed(
        self, course, teacher_user, student_user, active_membership
    ):
        due = timezone.now() - timedelta(days=1)  # Passed 1 day ago
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập cho nộp trễ",
            due_at=due,
            allow_late=True,
            created_by=teacher_user,
            publish_immediately=True,
        )
        result = check_student_eligibility(
            assignment=assignment,
            student=student_user,
            current_time=timezone.now(),
        )
        assert result["can_submit"] is True
        assert result["is_late"] is True

    def test_after_deadline_without_allow_late_is_rejected(
        self, course, teacher_user, student_user, active_membership
    ):
        due = timezone.now() - timedelta(days=1)  # Passed 1 day ago
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập không cho nộp trễ",
            due_at=due,
            allow_late=False,
            created_by=teacher_user,
            publish_immediately=True,
        )
        result = check_student_eligibility(
            assignment=assignment,
            student=student_user,
            current_time=timezone.now(),
        )
        assert result["can_submit"] is False
        assert result["reason"] == "DEADLINE_PASSED"
        assert result["is_late"] is True

    def test_manually_closed_assignment_cannot_submit(
        self, course, teacher_user, student_user, active_membership
    ):
        due = timezone.now() + timedelta(days=5)
        assignment = create_assignment(
            course_id=course.id,
            title="Bài tập bị đóng sớm",
            due_at=due,
            allow_late=True,
            created_by=teacher_user,
            publish_immediately=True,
        )
        close_assignment(assignment_id=assignment.id, actor=teacher_user)
        assignment.refresh_from_db()

        result = check_student_eligibility(
            assignment=assignment,
            student=student_user,
            current_time=timezone.now(),
        )
        assert result["can_submit"] is False
        assert result["reason"] == "MANUALLY_CLOSED"


@pytest.mark.django_db
def test_acceptance_services_enforce_owner_for_create_and_update(
    course, teacher_user, student_user
):
    from django.core.exceptions import PermissionDenied

    with pytest.raises(PermissionDenied):
        create_assignment(
            course_id=course.pk,
            title="Denied",
            due_at=timezone.now() + timedelta(days=1),
            created_by=student_user,
        )
    assignment = create_assignment(
        course_id=course.pk,
        title="Owned",
        due_at=timezone.now() + timedelta(days=1),
        created_by=teacher_user,
    )
    with pytest.raises(PermissionDenied):
        update_assignment(assignment_id=assignment.pk, actor=student_user, title="Denied")


@pytest.mark.django_db
def test_acceptance_publication_checks_actual_attachment_bytes(course, teacher_user, stored_file):
    from files.storage import get_storage

    assignment = create_assignment(
        course_id=course.pk,
        title="Integrity",
        due_at=timezone.now() + timedelta(days=1),
        created_by=teacher_user,
        attachment_file_ids=[stored_file.pk],
    )
    get_storage().delete(stored_file.storage_path)
    with pytest.raises(AssignmentValidationError):
        publish_assignment(assignment_id=assignment.pk, actor=teacher_user)
    assignment.refresh_from_db()
    assert assignment.status == AssignmentStatus.DRAFT
    assert not assignment.publication_snapshots.exists()


@pytest.mark.django_db
def test_acceptance_policy_revisions_and_publication_snapshot_preserved(course, teacher_user):
    from assignments.exceptions import AssignmentImmutableError
    from assignments.models import AssignmentFilePolicy, AssignmentFilePolicyRevision

    assignment = create_assignment(
        course_id=course.pk,
        title="Policy history",
        due_at=timezone.now() + timedelta(days=1),
        created_by=teacher_user,
    )
    policy = AssignmentFilePolicy.objects.get(assignment=assignment)
    assert policy.max_files_per_submission == 1 and policy.max_file_size_bytes == 25 * 1024 * 1024
    assert policy.allowed_extensions == ["pdf", "docx"]
    publish_assignment(assignment_id=assignment.pk, actor=teacher_user)
    snapshot = assignment.publication_snapshots.get()
    update_assignment(
        assignment_id=assignment.pk,
        actor=teacher_user,
        file_policy_data={"max_files_per_submission": 2},
    )
    old = AssignmentFilePolicyRevision.objects.get(assignment=assignment, version=1)
    latest = AssignmentFilePolicyRevision.objects.get(assignment=assignment, version=2)
    assert old.configuration["max_files_per_submission"] == 1
    assert latest.configuration["max_files_per_submission"] == 2
    snapshot.snapshot_title = "Modified"
    with pytest.raises(AssignmentImmutableError):
        snapshot.save()


@pytest.mark.django_db
def test_acceptance_cached_rubric_cannot_change_after_publication(course, teacher_user):
    assignment = create_assignment(
        course_id=course.pk,
        title="Rubric",
        due_at=timezone.now() + timedelta(days=1),
        created_by=teacher_user,
        rubric_criteria_data=[{"title": "First", "max_score": "10"}],
    )
    criterion = assignment.rubric_criteria.select_related("assignment").get()
    publish_assignment(assignment_id=assignment.pk, actor=teacher_user)
    criterion.title = "Changed"
    with pytest.raises(AssignmentImmutableError):
        criterion.save()
