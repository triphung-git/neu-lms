import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError

from courses.models import Course
from files.constants import (
    DEFAULT_ALLOWED_EXTENSIONS,
    DEFAULT_COURSE_QUOTA_BYTES,
    DEFAULT_MAX_FILE_SIZE_BYTES,
    DEFAULT_MAX_FILES_PER_ASSIGNMENT,
    SYSTEM_MAX_COURSE_QUOTA_BYTES,
    SYSTEM_MAX_FILE_SIZE_BYTES,
)
from files.models import CourseFilePolicy, FilePurpose, FileScanResult, FileStatus, StoredFile

User = get_user_model()


@pytest.fixture
def sample_teacher(db):
    return User.objects.create_user(
        email="teacher_b08@neu.edu.vn",
        password="ValidPassword123!",
        display_name="TS. Giảng Viên B08",
    )


@pytest.fixture
def sample_student(db):
    return User.objects.create_user(
        email="11249999@st.neu.edu.vn",
        password="ValidPassword123!",
        display_name="Nguyễn Văn Test B08",
    )


@pytest.fixture
def sample_course(sample_teacher):
    return Course.objects.create(
        code="CS101-B08",
        name="Lập trình căn bản B08",
        term="HK1-2026",
        teacher=sample_teacher,
    )


# ==============================================================================
# 1. CourseFilePolicy Tests
# ==============================================================================


@pytest.mark.django_db
class TestCourseFilePolicyModel:
    def test_default_values(self, sample_course):
        policy = CourseFilePolicy.objects.create(course=sample_course)

        assert policy.max_file_size_bytes == DEFAULT_MAX_FILE_SIZE_BYTES
        assert policy.course_quota_bytes == DEFAULT_COURSE_QUOTA_BYTES
        assert policy.max_files_per_assignment == DEFAULT_MAX_FILES_PER_ASSIGNMENT
        assert policy.used_quota_bytes == 0
        assert policy.reserved_quota_bytes == 0
        assert policy.preview_allowed is True
        assert policy.allowed_extensions == DEFAULT_ALLOWED_EXTENSIONS
        assert policy.created_at is not None
        assert policy.updated_at is not None

    def test_clean_method_normalizes_extensions(self, sample_course):
        policy = CourseFilePolicy(
            course=sample_course,
            allowed_extensions=[" .PDF ", "DOCX", "xlsx", ".pdf"],
        )
        policy.clean()
        assert policy.allowed_extensions == ["pdf", "docx", "xlsx"]

    def test_clean_method_validates_ceilings(self, sample_course):
        policy = CourseFilePolicy(
            course=sample_course,
            max_file_size_bytes=SYSTEM_MAX_FILE_SIZE_BYTES + 1,
        )
        with pytest.raises(ValidationError) as exc_info:
            policy.clean()
        assert "max_file_size_bytes" in exc_info.value.message_dict

        policy.max_file_size_bytes = DEFAULT_MAX_FILE_SIZE_BYTES
        policy.course_quota_bytes = SYSTEM_MAX_COURSE_QUOTA_BYTES + 1
        with pytest.raises(ValidationError) as exc_info:
            policy.clean()
        assert "course_quota_bytes" in exc_info.value.message_dict

    def test_clean_method_validates_max_files_range(self, sample_course):
        policy = CourseFilePolicy(
            course=sample_course,
            max_files_per_assignment=0,
        )
        with pytest.raises(ValidationError) as exc_info:
            policy.clean()
        assert "max_files_per_assignment" in exc_info.value.message_dict

        policy.max_files_per_assignment = 11
        with pytest.raises(ValidationError) as exc_info:
            policy.clean()
        assert "max_files_per_assignment" in exc_info.value.message_dict

    def test_clean_method_validates_extensions_type(self, sample_course):
        policy = CourseFilePolicy(
            course=sample_course,
            allowed_extensions="not-a-list",
        )
        with pytest.raises(ValidationError) as exc_info:
            policy.clean()
        assert "allowed_extensions" in exc_info.value.message_dict

    def test_db_constraint_system_ceilings(self, sample_course):
        # max_file_size_bytes cannot exceed SYSTEM_MAX_FILE_SIZE_BYTES
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                CourseFilePolicy.objects.create(
                    course=sample_course,
                    max_file_size_bytes=SYSTEM_MAX_FILE_SIZE_BYTES + 1,
                )

        # course_quota_bytes cannot exceed SYSTEM_MAX_COURSE_QUOTA_BYTES
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                CourseFilePolicy.objects.create(
                    course=sample_course,
                    course_quota_bytes=SYSTEM_MAX_COURSE_QUOTA_BYTES + 1,
                )

    def test_db_constraint_positive_limits(self, sample_course):
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                CourseFilePolicy.objects.create(
                    course=sample_course,
                    max_file_size_bytes=0,
                )

        with transaction.atomic():
            with pytest.raises(IntegrityError):
                CourseFilePolicy.objects.create(
                    course=sample_course,
                    course_quota_bytes=0,
                )

    def test_db_constraint_non_negative_quotas(self, sample_course):
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                CourseFilePolicy.objects.create(
                    course=sample_course,
                    used_quota_bytes=-1,
                )

        with transaction.atomic():
            with pytest.raises(IntegrityError):
                CourseFilePolicy.objects.create(
                    course=sample_course,
                    reserved_quota_bytes=-1,
                )

    def test_db_constraint_max_files_range(self, sample_course):
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                CourseFilePolicy.objects.create(
                    course=sample_course,
                    max_files_per_assignment=0,
                )

        with transaction.atomic():
            with pytest.raises(IntegrityError):
                CourseFilePolicy.objects.create(
                    course=sample_course,
                    max_files_per_assignment=11,
                )

    def test_one_to_one_relationship(self, sample_course):
        CourseFilePolicy.objects.create(course=sample_course)
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                CourseFilePolicy.objects.create(course=sample_course)

    def test_cascade_delete_with_course(self, sample_course):
        policy = CourseFilePolicy.objects.create(course=sample_course)
        policy_id = policy.id
        sample_course.delete()
        assert not CourseFilePolicy.objects.filter(id=policy_id).exists()


# ==============================================================================
# 2. StoredFile Tests
# ==============================================================================


@pytest.mark.django_db
class TestStoredFileModel:
    def test_create_valid_stored_file(self, sample_course, sample_teacher):
        stored_file = StoredFile.objects.create(
            course=sample_course,
            uploader=sample_teacher,
            file_name="lecture1.pdf",
            file_size=1024 * 1024,
            mime_type="application/pdf",
            storage_path="quarantine/lecture1.pdf",
            sha256_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            status=FileStatus.QUARANTINE_PENDING,
            purpose=FilePurpose.COURSE_MATERIAL,
        )

        assert stored_file.id is not None
        assert stored_file.status == FileStatus.QUARANTINE_PENDING
        assert stored_file.purpose == FilePurpose.COURSE_MATERIAL
        assert stored_file.is_published is False
        assert stored_file.created_at is not None
        assert stored_file.updated_at is not None

    def test_valid_statuses_and_purposes(self, sample_course, sample_teacher):
        for status_val in FileStatus.values:
            sf = StoredFile.objects.create(
                course=sample_course,
                uploader=sample_teacher,
                file_name=f"test_{status_val}.pdf",
                file_size=100,
                mime_type="application/pdf",
                storage_path=f"path/{status_val}",
                status=status_val,
            )
            assert sf.status == status_val

        for purpose_val in FilePurpose.values:
            sf = StoredFile.objects.create(
                course=sample_course,
                uploader=sample_teacher,
                file_name=f"test_{purpose_val}.pdf",
                file_size=100,
                mime_type="application/pdf",
                storage_path=f"path/{purpose_val}",
                purpose=purpose_val,
            )
            assert sf.purpose == purpose_val

    def test_db_constraint_invalid_status(self, sample_course, sample_teacher):
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                StoredFile.objects.create(
                    course=sample_course,
                    uploader=sample_teacher,
                    file_name="bad_status.pdf",
                    file_size=100,
                    mime_type="application/pdf",
                    storage_path="path/bad",
                    status="invalid_status_xyz",
                )

    def test_db_constraint_invalid_purpose(self, sample_course, sample_teacher):
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                StoredFile.objects.create(
                    course=sample_course,
                    uploader=sample_teacher,
                    file_name="bad_purpose.pdf",
                    file_size=100,
                    mime_type="application/pdf",
                    storage_path="path/bad",
                    purpose="invalid_purpose_xyz",
                )

    def test_db_constraint_negative_file_size(self, sample_course, sample_teacher):
        with transaction.atomic():
            with pytest.raises(IntegrityError):
                StoredFile.objects.create(
                    course=sample_course,
                    uploader=sample_teacher,
                    file_name="negative_size.pdf",
                    file_size=-1,
                    mime_type="application/pdf",
                    storage_path="path/negative",
                )

    def test_protect_course_deletion(self, sample_course, sample_teacher):
        StoredFile.objects.create(
            course=sample_course,
            uploader=sample_teacher,
            file_name="doc.pdf",
            file_size=100,
            mime_type="application/pdf",
            storage_path="path/doc",
        )
        with pytest.raises(ProtectedError):
            sample_course.delete()

    def test_protect_uploader_deletion(self, sample_course, sample_student):
        StoredFile.objects.create(
            course=sample_course,
            uploader=sample_student,
            file_name="submission.pdf",
            file_size=100,
            mime_type="application/pdf",
            storage_path="path/submission",
        )
        with pytest.raises(ProtectedError):
            sample_student.delete()


# ==============================================================================
# 3. FileScanResult Tests
# ==============================================================================


@pytest.mark.django_db
class TestFileScanResultModel:
    def test_create_scan_result(self, sample_course, sample_teacher):
        stored_file = StoredFile.objects.create(
            course=sample_course,
            uploader=sample_teacher,
            file_name="scanned.pdf",
            file_size=5000,
            mime_type="application/pdf",
            storage_path="active/scanned.pdf",
            status=FileStatus.CLEAN,
        )

        scan_result = FileScanResult.objects.create(
            file=stored_file,
            scan_engine="clamav-mock",
            is_clean=True,
            details={"signatures_checked": 12, "threat": None},
        )

        assert scan_result.id is not None
        assert scan_result.file == stored_file
        assert scan_result.is_clean is True
        assert scan_result.scan_engine == "clamav-mock"
        assert scan_result.details["signatures_checked"] == 12
        assert scan_result.scanned_at is not None

    def test_cascade_delete_with_stored_file(self, sample_course, sample_teacher):
        stored_file = StoredFile.objects.create(
            course=sample_course,
            uploader=sample_teacher,
            file_name="to_delete.pdf",
            file_size=5000,
            mime_type="application/pdf",
            storage_path="quarantine/to_delete.pdf",
        )
        result = FileScanResult.objects.create(
            file=stored_file,
            scan_engine="clamav-mock",
            is_clean=False,
            details={"threat": "EICAR-Test-Signature"},
        )
        result_id = result.id

        stored_file.delete()
        assert not FileScanResult.objects.filter(id=result_id).exists()
