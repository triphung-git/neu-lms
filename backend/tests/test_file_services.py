import concurrent.futures
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.db import connection
from django.utils import timezone

from courses.models import Course, Membership
from files.models import CourseFilePolicy, FilePurpose, FileStatus, StoredFile
from files.services import (
    abort_upload_intent,
    cleanup_expired_upload_intents,
    commit_upload,
    create_upload_intent,
    get_file_extension,
    sanitize_filename,
)
from files.storage import get_storage
from identity.models import RoleGrant, RoleRequest, VerifiedEmail
from identity.services.common import digest
from platform_core.errors import DomainError

User = get_user_model()


def make_file_test_user(email: str, role: str = "teacher", display_name: str = "Test User"):
    now = timezone.now()
    user = User.objects.create_user(
        email=email,
        password="ValidPassword123!",
        display_name=display_name,
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
def teacher(db):
    return make_file_test_user(
        "teacher_svc@neu.edu.vn",
        role="teacher",
        display_name="TS. Giảng Viên Service",
    )


@pytest.fixture
def foreign_teacher(db):
    return make_file_test_user(
        "foreign_teacher@neu.edu.vn",
        role="teacher",
        display_name="TS. Giảng Viên Khác",
    )


@pytest.fixture
def student_member(db, course):
    user = make_file_test_user(
        "11241111@st.neu.edu.vn",
        role="student",
        display_name="Sinh Viên Member",
    )
    Membership.objects.create(
        course=course,
        student=user,
        status=Membership.Status.ACTIVE,
    )
    return user


@pytest.fixture
def non_member_student(db):
    return make_file_test_user(
        "11242222@st.neu.edu.vn",
        role="student",
        display_name="Sinh Viên Non Member",
    )


@pytest.fixture
def course(teacher):
    c = Course.objects.create(
        code="CS202-SVC",
        name="Cấu trúc dữ liệu và giải thuật",
        term="HK1-2026",
        teacher=teacher,
        enrollment_open=True,
    )
    CourseFilePolicy.objects.create(
        course=c,
        max_file_size_bytes=10 * 1024 * 1024,  # 10 MB
        course_quota_bytes=50 * 1024 * 1024,  # 50 MB
        allowed_extensions=["pdf", "docx", "zip"],
    )
    return c


# ==============================================================================
# Helper Functions Tests
# ==============================================================================


def test_sanitize_filename():
    assert sanitize_filename("../../etc/passwd.pdf") == "passwd.pdf"
    assert sanitize_filename("..\\..\\windows\\system32.docx") == "system32.docx"
    assert sanitize_filename("Tài Liệu Học Tập (2026).pdf") == "Tài Liệu Học Tập (2026).pdf"
    assert sanitize_filename("???///:::***") == "unnamed_file"


def test_get_file_extension():
    assert get_file_extension("document.PDF") == "pdf"
    assert get_file_extension("archive.tar.gz") == "gz"
    assert get_file_extension("no_ext") == ""


# ==============================================================================
# create_upload_intent Tests
# ==============================================================================


@pytest.mark.django_db
class TestCreateUploadIntent:
    def test_teacher_creates_course_material_intent_success(self, teacher, course):
        result = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="slide1.pdf",
            file_size=2 * 1024 * 1024,
            mime_type="application/pdf",
            purpose=FilePurpose.COURSE_MATERIAL,
        )

        assert result["file_name"] == "slide1.pdf"
        assert result["file_size"] == 2 * 1024 * 1024
        assert result["status"] == FileStatus.QUARANTINE_PENDING
        assert result["purpose"] == FilePurpose.COURSE_MATERIAL

        policy = CourseFilePolicy.objects.get(course=course)
        assert policy.reserved_quota_bytes == 2 * 1024 * 1024
        assert policy.used_quota_bytes == 0

        stored = StoredFile.objects.get(id=result["file_id"])
        assert stored.status == FileStatus.QUARANTINE_PENDING
        assert stored.uploader == teacher

    def test_student_submission_requires_future_assignment_scope(self, student_member, course):
        with pytest.raises(DomainError) as exc:
            create_upload_intent(
                actor=student_member,
                course_id=course.id,
                file_name="submission.pdf",
                file_size=100,
                purpose=FilePurpose.ASSIGNMENT_SUBMISSION,
            )
        assert exc.value.code == "FORBIDDEN"
        assert not StoredFile.objects.filter(uploader=student_member).exists()

    def test_student_forbidden_to_upload_course_material(self, student_member, course):
        with pytest.raises(DomainError) as exc:
            create_upload_intent(
                actor=student_member,
                course_id=course.id,
                file_name="lecture.pdf",
                file_size=1024 * 1024,
                purpose=FilePurpose.COURSE_MATERIAL,
            )
        assert exc.value.code == "FORBIDDEN"

    def test_non_member_student_forbidden_to_upload_submission(self, non_member_student, course):
        with pytest.raises(DomainError) as exc:
            create_upload_intent(
                actor=non_member_student,
                course_id=course.id,
                file_name="sub.pdf",
                file_size=1024 * 1024,
                purpose=FilePurpose.ASSIGNMENT_SUBMISSION,
            )
        assert exc.value.code == "FORBIDDEN"

    def test_foreign_teacher_forbidden(self, foreign_teacher, course):
        with pytest.raises(DomainError) as exc:
            create_upload_intent(
                actor=foreign_teacher,
                course_id=course.id,
                file_name="test.pdf",
                file_size=1024 * 1024,
                purpose=FilePurpose.COURSE_MATERIAL,
            )
        assert exc.value.code == "FORBIDDEN"

    def test_archived_course_rejects_upload(self, teacher, course):
        course.status = Course.Status.ARCHIVED
        course.archived_at = timezone.now()
        course.save()

        with pytest.raises(DomainError) as exc:
            create_upload_intent(
                actor=teacher,
                course_id=course.id,
                file_name="doc.pdf",
                file_size=1024 * 1024,
            )
        assert exc.value.code == "COURSE_ARCHIVED"

    def test_disallowed_extension_rejected(self, teacher, course):
        with pytest.raises(DomainError) as exc:
            create_upload_intent(
                actor=teacher,
                course_id=course.id,
                file_name="malware.exe",
                file_size=1024,
            )
        assert exc.value.code == "FILE_EXTENSION_NOT_ALLOWED"

    def test_file_size_exceeding_max_limit_rejected(self, teacher, course):
        # Course max is 10MB
        with pytest.raises(DomainError) as exc:
            create_upload_intent(
                actor=teacher,
                course_id=course.id,
                file_name="huge.pdf",
                file_size=11 * 1024 * 1024,
            )
        assert exc.value.code == "FILE_SIZE_EXCEEDS_LIMIT"

    def test_invalid_file_size_rejected(self, teacher, course):
        with pytest.raises(DomainError) as exc:
            create_upload_intent(
                actor=teacher,
                course_id=course.id,
                file_name="zero.pdf",
                file_size=0,
            )
        assert exc.value.code == "INVALID_FILE_SIZE"

    def test_quota_exceeded_rejected(self, teacher, course):
        policy = CourseFilePolicy.objects.get(course=course)
        # course quota is 50MB, set used to 45MB
        policy.used_quota_bytes = 45 * 1024 * 1024
        policy.save()

        # available quota is 5MB, try to upload 6MB
        with pytest.raises(DomainError) as exc:
            create_upload_intent(
                actor=teacher,
                course_id=course.id,
                file_name="large.pdf",
                file_size=6 * 1024 * 1024,
            )
        assert exc.value.code == "QUOTA_EXCEEDED"

        # Quota remains unchanged
        policy.refresh_from_db()
        assert policy.reserved_quota_bytes == 0
        assert policy.used_quota_bytes == 45 * 1024 * 1024


# ==============================================================================
# Concurrency Quota Reservation Test
# ==============================================================================


@pytest.mark.django_db(transaction=True)
def test_concurrency_quota_reservation_two_actors(teacher, foreign_teacher):
    # Setup test course with quota strictly allowing only ONE 8MB upload
    c = Course.objects.create(
        code="CS-CONCURRENCY",
        name="Kiểm thử tương tranh",
        term="HK1-2026",
        teacher=teacher,
        enrollment_open=True,
    )
    CourseFilePolicy.objects.create(
        course=c,
        max_file_size_bytes=10 * 1024 * 1024,
        course_quota_bytes=10 * 1024 * 1024,  # 10 MB total
        allowed_extensions=["pdf"],
    )

    file_size = 8 * 1024 * 1024  # 8 MB

    results = []

    def attempt_upload(user):
        connection.close()
        try:
            res = create_upload_intent(
                actor=user,
                course_id=c.id,
                file_name="file.pdf",
                file_size=file_size,
            )
            return ("SUCCESS", res)
        except DomainError as e:
            return ("FAILED", e.code)
        finally:
            connection.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(attempt_upload, teacher)
        f2 = executor.submit(attempt_upload, teacher)
        results = [f1.result(), f2.result()]

    statuses = [r[0] for r in results]
    assert statuses.count("SUCCESS") == 1
    assert statuses.count("FAILED") == 1
    failed_code = [r[1] for r in results if r[0] == "FAILED"][0]
    assert failed_code == "QUOTA_EXCEEDED"

    policy = CourseFilePolicy.objects.get(course=c)
    assert policy.reserved_quota_bytes == file_size
    assert policy.used_quota_bytes == 0


# ==============================================================================
# commit_upload Tests
# ==============================================================================


@pytest.mark.django_db
class TestCommitUpload:
    def test_commit_upload_success(self, teacher, course):
        import hashlib

        content = b"%PDF-1.4 Content"
        checksum = hashlib.sha256(content).hexdigest()
        intent = create_upload_intent(
            actor=teacher, course_id=course.id, file_name="lecture.pdf", file_size=len(content)
        )
        get_storage().save(intent["storage_path"], content)
        committed = commit_upload(
            actor=teacher, file_id=intent["file_id"], client_checksum=checksum
        )
        assert committed.status == FileStatus.SCANNING
        assert committed.sha256_hash == checksum
        policy = CourseFilePolicy.objects.get(course=course)
        assert policy.reserved_quota_bytes == 0 and policy.used_quota_bytes == len(content)

    def test_commit_upload_missing_storage_file(self, teacher, course):
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="missing.pdf",
            file_size=2000,
        )

        with pytest.raises(DomainError) as exc:
            commit_upload(actor=teacher, file_id=intent["file_id"])
        assert exc.value.code == "FILE_NOT_FOUND"

    def test_commit_retry_is_idempotent(self, teacher, course):
        content = b"%PDF-1.4 test"
        intent = create_upload_intent(
            actor=teacher, course_id=course.id, file_name="state.pdf", file_size=len(content)
        )
        get_storage().save(intent["storage_path"], content)
        first = commit_upload(actor=teacher, file_id=intent["file_id"])
        second = commit_upload(actor=teacher, file_id=intent["file_id"])
        assert first.id == second.id and second.status == FileStatus.SCANNING
        assert CourseFilePolicy.objects.get(course=course).used_quota_bytes == len(content)

    def test_commit_upload_unauthorized_user(self, teacher, foreign_teacher, course):
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="secure.pdf",
            file_size=2000,
        )
        storage = get_storage()
        storage.save(intent["storage_path"], b"content")

        with pytest.raises(DomainError) as exc:
            commit_upload(actor=foreign_teacher, file_id=intent["file_id"])
        assert exc.value.code == "FORBIDDEN"


# ==============================================================================
# abort_upload_intent & cleanup Tests
# ==============================================================================


@pytest.mark.django_db
class TestAbortAndCleanupUpload:
    def test_abort_upload_intent_success(self, teacher, course):
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="abort_me.pdf",
            file_size=3 * 1024 * 1024,
        )

        storage = get_storage()
        storage.save(intent["storage_path"], b"abort content")
        assert storage.exists(intent["storage_path"]) is True

        policy = CourseFilePolicy.objects.get(course=course)
        assert policy.reserved_quota_bytes == 3 * 1024 * 1024

        aborted = abort_upload_intent(actor=teacher, file_id=intent["file_id"])
        assert aborted.status == FileStatus.DELETED
        assert storage.exists(intent["storage_path"]) is False

        policy.refresh_from_db()
        assert policy.reserved_quota_bytes == 0

    def test_cleanup_expired_upload_intents(self, teacher, course):
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="expired.pdf",
            file_size=4 * 1024 * 1024,
        )

        # Backdate the record to 3 hours ago
        StoredFile.objects.filter(id=intent["file_id"]).update(
            created_at=timezone.now() - timedelta(hours=3),
            expires_at=timezone.now() - timedelta(hours=1),
        )

        policy = CourseFilePolicy.objects.get(course=course)
        assert policy.reserved_quota_bytes == 4 * 1024 * 1024

        cleaned_count = cleanup_expired_upload_intents(older_than_seconds=7200)
        assert cleaned_count == 1

        policy.refresh_from_db()
        assert policy.reserved_quota_bytes == 0

        stored = StoredFile.objects.get(id=intent["file_id"])
        assert stored.status == FileStatus.DELETED
