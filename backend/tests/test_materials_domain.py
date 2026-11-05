import pytest
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, models
from django.utils import timezone

from courses.models import Chapter, Course, Lesson
from files.models import CourseFilePolicy, FilePurpose, FileStatus, StoredFile
from identity.models import Role, RoleGrant, User
from materials.models import (
    MaterialFile,
    MaterialType,
    MaterialVersion,
    MaterialVersionStatus,
    ProcessingStatus,
)
from materials.services import (
    add_file_to_version,
    create_material,
    create_material_version,
    finalize_material_version,
    hide_material,
    publish_material_version,
    remove_file_from_version,
    unhide_material,
)


def _create_user_with_role(email: str, display_name: str, role: str) -> User:
    from identity.models import RoleRequest, VerifiedEmail
    from identity.services.accounts import digest

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
    return _create_user_with_role("teacher_mat@neu.edu.vn", "Giang Vien Material", Role.TEACHER)


@pytest.fixture
def other_teacher(db):
    return _create_user_with_role("other_teacher@neu.edu.vn", "Other Teacher", Role.TEACHER)


@pytest.fixture
def student_user(db):
    return _create_user_with_role("11249999@st.neu.edu.vn", "Sinh Vien Test", Role.STUDENT)


@pytest.fixture
def course(db, teacher_user):
    c = Course.objects.create(
        code="CS101",
        name="Nhap mon Lap trinh",
        term="Hoc ky 1",
        teacher=teacher_user,
    )
    CourseFilePolicy.objects.create(course=c, max_files_per_assignment=2)
    return c


@pytest.fixture
def other_course(db, other_teacher):
    c = Course.objects.create(
        code="CS102",
        name="Cau truc du lieu",
        term="Hoc ky 1",
        teacher=other_teacher,
    )
    CourseFilePolicy.objects.create(course=c, max_files_per_assignment=2)
    return c


@pytest.fixture
def chapter(db, course):
    return Chapter.objects.create(course=course, title="Chuong 1: Tong quan", position=1)


@pytest.fixture
def lesson(db, chapter):
    return Lesson.objects.create(chapter=chapter, title="Bai 1: Gioi thieu", position=1)


@pytest.fixture
def clean_file_1(db, course, teacher_user):
    return StoredFile.objects.create(
        course=course,
        uploader=teacher_user,
        file_name="lecture1.pdf",
        file_size=1024 * 50,
        mime_type="application/pdf",
        storage_path="active/lecture1.pdf",
        sha256_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.COURSE_MATERIAL,
    )


@pytest.fixture
def clean_file_2(db, course, teacher_user):
    return StoredFile.objects.create(
        course=course,
        uploader=teacher_user,
        file_name="slides1.pdf",
        file_size=1024 * 80,
        mime_type="application/pdf",
        storage_path="active/slides1.pdf",
        sha256_hash="2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.COURSE_MATERIAL,
    )


@pytest.mark.django_db
class TestMaterialDomainCreation:
    def test_create_material_successful_with_v1_draft(self, course, teacher_user, chapter, lesson):
        mat, ver = create_material(
            course=course,
            teacher=teacher_user,
            title="Giao trinh Lap trinh Python",
            description="Tai lieu chinh thuc",
            material_type=MaterialType.DOCUMENT,
            tags=["python", "co-ban"],
            chapter_id=chapter.id,
            lesson_id=lesson.id,
        )
        assert mat.id is not None
        assert mat.title == "Giao trinh Lap trinh Python"
        assert mat.course == course
        assert mat.chapter == chapter
        assert mat.lesson == lesson
        assert mat.published_version is None
        assert mat.is_hidden is False
        assert mat.tags == ["python", "co-ban"]

        assert ver.material == mat
        assert ver.version_number == 1
        assert ver.lifecycle_status == MaterialVersionStatus.DRAFT
        assert ver.processing_status == ProcessingStatus.PENDING
        assert ver.is_published is False
        assert ver.finalized_at is None
        assert ver.file_count == 0

    def test_create_material_with_initial_clean_files(
        self, course, teacher_user, clean_file_1, clean_file_2
    ):
        mat, ver = create_material(
            course=course,
            teacher=teacher_user,
            title="Bai giang Tong hop",
            initial_file_ids=[clean_file_1.id, clean_file_2.id],
        )
        assert ver.file_count == 2
        assert ver.total_size_bytes == clean_file_1.file_size + clean_file_2.file_size
        assert ver.material_files.count() == 2

        # Check snapshots on MaterialFile
        mf1 = ver.material_files.get(position=1)
        assert mf1.file == clean_file_1
        assert mf1.file_name == clean_file_1.file_name
        assert mf1.sha256_hash == clean_file_1.sha256_hash

    def test_create_material_non_teacher_forbidden(self, course, student_user):
        with pytest.raises(PermissionDenied):
            create_material(
                course=course,
                teacher=student_user,
                title="Hack material",
            )

    def test_create_material_archived_course_rejected(self, course, teacher_user):
        course.status = Course.Status.ARCHIVED
        course.archived_at = timezone.now()
        course.save()

        with pytest.raises(PermissionDenied, match="Môn học đã lưu trữ"):
            create_material(
                course=course,
                teacher=teacher_user,
                title="Hoc lieu moi",
            )

    def test_cross_course_chapter_rejected(self, course, other_course, teacher_user, other_teacher):
        other_chap = Chapter.objects.create(course=other_course, title="Chuong khac", position=1)
        with pytest.raises(ValidationError, match="Chương học phải thuộc cùng môn học"):
            create_material(
                course=course,
                teacher=teacher_user,
                title="Hoc lieu sai chuong",
                chapter_id=other_chap.id,
            )

    def test_cross_course_lesson_rejected(self, course, other_course, teacher_user, other_teacher):
        other_chap = Chapter.objects.create(course=other_course, title="Chuong khac", position=1)
        other_les = Lesson.objects.create(chapter=other_chap, title="Bai khac", position=1)
        with pytest.raises(ValidationError, match="Bài học phải thuộc cùng môn học"):
            create_material(
                course=course,
                teacher=teacher_user,
                title="Hoc lieu sai bai",
                lesson_id=other_les.id,
            )

    def test_lesson_not_belonging_to_chapter_rejected(self, course, teacher_user):
        c1 = Chapter.objects.create(course=course, title="C1", position=1)
        c2 = Chapter.objects.create(course=course, title="C2", position=2)
        l2 = Lesson.objects.create(chapter=c2, title="L2", position=1)

        with pytest.raises(ValidationError, match="Bài học phải thuộc chương học đã chọn"):
            create_material(
                course=course,
                teacher=teacher_user,
                title="Sai khop",
                chapter_id=c1.id,
                lesson_id=l2.id,
            )

    def test_initial_file_from_different_course_rejected(
        self, course, other_course, teacher_user, other_teacher
    ):
        alien_file = StoredFile.objects.create(
            course=other_course,
            uploader=other_teacher,
            file_name="alien.pdf",
            file_size=500,
            mime_type="application/pdf",
            storage_path="active/alien.pdf",
            status=FileStatus.CLEAN,
        )
        with pytest.raises(ValidationError, match="không thuộc môn học này"):
            create_material(
                course=course,
                teacher=teacher_user,
                title="Hoc lieu kem file la",
                initial_file_ids=[alien_file.id],
            )

    def test_initial_file_unclean_rejected(self, course, teacher_user):
        unclean_file = StoredFile.objects.create(
            course=course,
            uploader=teacher_user,
            file_name="virus.pdf",
            file_size=500,
            mime_type="application/pdf",
            storage_path="quarantine/virus.pdf",
            status=FileStatus.QUARANTINE_PENDING,
        )
        with pytest.raises(ValidationError, match="chưa được quét an toàn"):
            create_material(
                course=course,
                teacher=teacher_user,
                title="Hoc lieu virus",
                initial_file_ids=[unclean_file.id],
            )


@pytest.mark.django_db
class TestManifestAndVersioning:
    def test_add_and_remove_file_in_draft_version(
        self, course, teacher_user, clean_file_1, clean_file_2
    ):
        mat, ver = create_material(course=course, teacher=teacher_user, title="Test Mat")

        mf1 = add_file_to_version(ver, clean_file_1, teacher_user, label="Tap 1")
        assert mf1.position == 1
        assert mf1.label == "Tap 1"
        assert ver.file_count == 1
        assert ver.total_size_bytes == clean_file_1.file_size

        mf2 = add_file_to_version(ver, clean_file_2, teacher_user, label="Tap 2")
        assert mf2.position == 2
        assert ver.file_count == 2
        assert ver.total_size_bytes == clean_file_1.file_size + clean_file_2.file_size

        # Remove mf1
        remove_file_from_version(ver, mf1.id, teacher_user)
        assert ver.file_count == 1
        assert ver.total_size_bytes == clean_file_2.file_size
        # Verify mf2 re-indexed to position 1
        mf2.refresh_from_db()
        assert mf2.position == 1

    def test_add_duplicate_file_rejected(self, course, teacher_user, clean_file_1):
        mat, ver = create_material(course=course, teacher=teacher_user, title="Test Mat")
        add_file_to_version(ver, clean_file_1, teacher_user)
        with pytest.raises(ValidationError, match="đã có trong danh sách"):
            add_file_to_version(ver, clean_file_1, teacher_user)

    def test_finalize_draft_success(self, course, teacher_user, clean_file_1, clean_file_2):
        mat, ver = create_material(
            course=course,
            teacher=teacher_user,
            title="Finalize Test",
            initial_file_ids=[clean_file_1.id, clean_file_2.id],
        )

        fin_ver = finalize_material_version(ver, teacher_user)
        assert fin_ver.lifecycle_status == MaterialVersionStatus.FINALIZED
        assert fin_ver.finalized_at is not None
        assert len(fin_ver.manifest_hash) == 64
        assert fin_ver.processing_status == ProcessingStatus.PENDING
        assert "max_file_size_bytes" in fin_ver.policy_snapshot

    def test_finalize_empty_manifest_rejected(self, course, teacher_user):
        mat, ver = create_material(course=course, teacher=teacher_user, title="Empty Mat")
        with pytest.raises(ValidationError, match="phải có ít nhất một tệp tin"):
            finalize_material_version(ver, teacher_user)

    def test_frozen_manifest_cannot_be_modified(
        self, course, teacher_user, clean_file_1, clean_file_2
    ):
        mat, ver = create_material(
            course=course,
            teacher=teacher_user,
            title="Immutable Test",
            initial_file_ids=[clean_file_1.id],
        )
        finalize_material_version(ver, teacher_user)

        # Cannot add file via service
        with pytest.raises(ValidationError, match="Không thể thêm tệp"):
            add_file_to_version(ver, clean_file_2, teacher_user)

        # Cannot remove file via service
        mf1 = ver.material_files.first()
        with pytest.raises(ValidationError, match="Không thể xóa tệp"):
            remove_file_from_version(ver, mf1.id, teacher_user)

        # Cannot add MaterialFile directly via model save
        with pytest.raises(ValidationError, match="đã đóng băng"):
            MaterialFile.objects.create(
                material_version=ver,
                file=clean_file_2,
                position=2,
            )

        # Cannot delete MaterialFile directly via model delete
        with pytest.raises(ValidationError, match="đã đóng băng"):
            mf1.delete()


@pytest.mark.django_db
class TestPublishingAndPointerIsolation:
    def test_create_new_version_does_not_affect_published_pointer(
        self, course, teacher_user, clean_file_1, clean_file_2
    ):
        mat, v1 = create_material(
            course=course,
            teacher=teacher_user,
            title="Pointer Test",
            initial_file_ids=[clean_file_1.id],
        )
        finalize_material_version(v1, teacher_user)
        publish_material_version(mat, v1, teacher_user)

        mat.refresh_from_db()
        assert mat.published_version == v1

        # Create v2 draft with clone
        v2 = create_material_version(
            material=mat,
            teacher=teacher_user,
            changelog="Sua loi chinh ta",
            clone_from_version=v1,
        )
        assert v2.version_number == 2
        assert v2.lifecycle_status == MaterialVersionStatus.DRAFT
        assert v2.file_count == 1

        # Invariant: published_version on Material is STILL v1!
        mat.refresh_from_db()
        assert mat.published_version == v1

    def test_publish_unfinalized_draft_rejected(self, course, teacher_user, clean_file_1):
        mat, v1 = create_material(
            course=course,
            teacher=teacher_user,
            title="Unfinalized Test",
            initial_file_ids=[clean_file_1.id],
        )
        with pytest.raises(ValidationError, match="Chỉ phiên bản đã đóng băng"):
            publish_material_version(mat, v1, teacher_user)

    def test_publish_alien_material_version_rejected(
        self, course, teacher_user, clean_file_1, clean_file_2
    ):
        mat1, v1 = create_material(
            course=course, teacher=teacher_user, title="M1", initial_file_ids=[clean_file_1.id]
        )
        mat2, v2 = create_material(
            course=course, teacher=teacher_user, title="M2", initial_file_ids=[clean_file_2.id]
        )
        finalize_material_version(v2, teacher_user)

        with pytest.raises(ValidationError, match="không thuộc về học liệu này"):
            publish_material_version(mat1, v2, teacher_user)

    def test_publish_and_hide_flow(self, course, teacher_user, clean_file_1, clean_file_2):
        mat, v1 = create_material(
            course=course,
            teacher=teacher_user,
            title="Hide Test",
            initial_file_ids=[clean_file_1.id],
        )
        finalize_material_version(v1, teacher_user)
        publish_material_version(mat, v1, teacher_user)

        mat.refresh_from_db()
        assert mat.is_hidden is False
        assert mat.published_version == v1

        # Hide
        hide_material(mat, teacher_user)
        mat.refresh_from_db()
        assert mat.is_hidden is True
        # Published version remains set for reference, but is_hidden hides it from students
        assert mat.published_version == v1

        # Unhide
        unhide_material(mat, teacher_user)
        mat.refresh_from_db()
        assert mat.is_hidden is False

    def test_unhide_without_published_version_rejected(self, course, teacher_user):
        mat, v1 = create_material(course=course, teacher=teacher_user, title="Never published")
        with pytest.raises(ValidationError, match="chưa có phiên bản nào được công bố"):
            unhide_material(mat, teacher_user)


@pytest.mark.django_db
class TestDeletionProtectionAndConstraints:
    def test_stored_file_referenced_by_material_cannot_be_deleted(
        self, course, teacher_user, clean_file_1
    ):
        mat, v1 = create_material(
            course=course,
            teacher=teacher_user,
            title="Protect Test",
            initial_file_ids=[clean_file_1.id],
        )
        finalize_material_version(v1, teacher_user)

        # Attempting to delete clean_file_1 directly must raise ProtectedError
        with pytest.raises(models.ProtectedError):
            clean_file_1.delete()

    def test_course_with_materials_cannot_be_deleted(self, course, teacher_user):
        create_material(course=course, teacher=teacher_user, title="Course Protect")
        with pytest.raises(models.ProtectedError):
            course.delete()

    def test_unique_version_number_constraint(self, course, teacher_user):
        mat, v1 = create_material(course=course, teacher=teacher_user, title="Unique Test")
        with pytest.raises(IntegrityError):
            MaterialVersion.objects.create(
                material=mat,
                version_number=1,  # duplicate version number!
                created_by=teacher_user,
            )

    def test_unique_file_in_version_constraint(self, course, teacher_user, clean_file_1):
        mat, v1 = create_material(
            course=course,
            teacher=teacher_user,
            title="Unique File Test",
            initial_file_ids=[clean_file_1.id],
        )
        with pytest.raises(IntegrityError):
            MaterialFile.objects.create(
                material_version=v1,
                file=clean_file_1,
                position=2,
            )

    def test_unique_position_in_version_constraint(
        self, course, teacher_user, clean_file_1, clean_file_2
    ):
        mat, v1 = create_material(
            course=course,
            teacher=teacher_user,
            title="Unique Pos Test",
            initial_file_ids=[clean_file_1.id],
        )
        with pytest.raises(IntegrityError):
            MaterialFile.objects.create(
                material_version=v1,
                file=clean_file_2,
                position=1,  # duplicate position 1!
            )


@pytest.mark.django_db(transaction=True)
def test_concurrent_revisions_allocate_distinct_version_numbers(course, teacher_user):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    from django.db import close_old_connections, connections

    from materials.models import Material

    mat, _ = create_material(course=course, teacher=teacher_user, title="Concurrent")
    barrier = Barrier(2)

    def mutate():
        close_old_connections()
        try:
            actor = User.objects.get(pk=teacher_user.pk)
            material = Material.objects.get(pk=mat.pk)
            barrier.wait(timeout=10)
            return create_material_version(material=material, teacher=actor).version_number
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(mutate) for _ in range(2)]
        assert sorted(f.result(timeout=30) for f in futures) == [2, 3]
    assert list(
        mat.versions.order_by("version_number").values_list("version_number", flat=True)
    ) == [1, 2, 3]
