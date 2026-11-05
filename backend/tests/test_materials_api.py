import hashlib

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from courses.models import Chapter, Course, Lesson, Membership
from files.models import CourseFilePolicy, FilePurpose, FileStatus, StoredFile
from files.storage import get_storage
from identity.models import Role, RoleGrant, RoleRequest, User, VerifiedEmail
from materials.models import (
    Material,
    MaterialType,
    MaterialVersionStatus,
    MaterialVisibility,
)


def _create_user_with_role(email: str, role_name: str) -> User:
    from identity.services.accounts import digest

    now = timezone.now()
    user = User.objects.create(
        email=email,
        display_name=email.split("@")[0],
        is_active=True,
    )
    user.set_password("SecurePass123!")
    user.save()
    VerifiedEmail.objects.create(
        user=user,
        email_digest=digest(user.email),
        verified_at=now,
    )

    grant_source = {
        Role.STUDENT: "verified_student_email",
        Role.TEACHER: "teacher_approval",
        Role.ADMIN: "internal_administration",
    }[role_name]

    req = None
    if role_name != Role.ADMIN:
        req = RoleRequest.objects.create(
            user=user,
            role=role_name,
            status="approved",
            reviewed_by=user,
            reviewed_at=now,
            review_reason="test_setup",
        )

    RoleGrant.objects.create(
        user=user,
        role=role_name,
        grant_source=grant_source,
        source_request=req,
        granted_by=user if role_name == Role.TEACHER else None,
    )
    return user


def _auth_client(user: User) -> APIClient:
    from django.conf import settings

    from identity.services.sessions import issue_session

    client = APIClient()
    raw_key, _ = issue_session(user_id=user.id)
    client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
    client.force_authenticate(user=user)
    return client


@pytest.fixture
def teacher_owner():
    return _create_user_with_role("teacher_owner@neu.edu.vn", Role.TEACHER)


@pytest.fixture
def other_teacher():
    return _create_user_with_role("teacher_other@neu.edu.vn", Role.TEACHER)


@pytest.fixture
def student_member():
    return _create_user_with_role("11240001@st.neu.edu.vn", Role.STUDENT)


@pytest.fixture
def student_non_member():
    return _create_user_with_role("11240002@st.neu.edu.vn", Role.STUDENT)


@pytest.fixture
def admin_only():
    return _create_user_with_role("admin_only@neu.edu.vn", Role.ADMIN)


@pytest.fixture
def course(teacher_owner):
    c = Course.objects.create(
        code="CS101",
        name="Lập trình căn bản",
        term="HK1-2026",
        teacher=teacher_owner,
        status=Course.Status.OPEN,
    )
    CourseFilePolicy.objects.create(
        course=c,
        allowed_extensions=["pdf", "docx", "png"],
        max_file_size_bytes=10 * 1024 * 1024,
        course_quota_bytes=100 * 1024 * 1024,
        preview_allowed=True,
    )
    return c


@pytest.fixture
def enrolled_course(course, student_member):
    Membership.objects.create(
        course=course,
        student=student_member,
        status=Membership.Status.ACTIVE,
    )
    return course


@pytest.fixture
def chapter_and_lesson(course):
    chap = Chapter.objects.create(course=course, title="Chương 1: Giới thiệu", position=1)
    les = Lesson.objects.create(chapter=chap, title="Bài 1: Cài đặt môi trường", position=1)
    return chap, les


@pytest.fixture
def clean_file(course, teacher_owner):
    content = b"%PDF-1.4 Mock clean pdf file content for material"
    storage_path = f"active/{course.id}/test_pdf.pdf"
    get_storage().save(storage_path, content)

    return StoredFile.objects.create(
        course=course,
        uploader=teacher_owner,
        file_name="slide_bai1.pdf",
        file_size=len(content),
        mime_type="application/pdf",
        storage_path=storage_path,
        status=FileStatus.CLEAN,
        sha256_hash=hashlib.sha256(content).hexdigest(),
        purpose=FilePurpose.COURSE_MATERIAL,
    )


@pytest.mark.django_db
class TestMaterialApiPermissions:
    """Kiểm tra ma trận phân quyền: GV phụ trách vs GV khác vs SV vs Admin-only."""

    def test_teacher_can_create_material_and_v1_draft(
        self, enrolled_course, teacher_owner, chapter_and_lesson, clean_file
    ):
        client = _auth_client(teacher_owner)
        chap, les = chapter_and_lesson

        url = f"/api/v1/courses/{enrolled_course.id}/materials"
        payload = {
            "title": "Bài giảng Lập trình C++",
            "description": "Tài liệu lý thuyết",
            "material_type": MaterialType.DOCUMENT,
            "tags": ["c++", "basics"],
            "chapter_id": str(chap.id),
            "lesson_id": str(les.id),
            "initial_file_ids": [str(clean_file.id)],
        }
        res = client.post(url, payload, format="json")
        assert res.status_code == 201
        data = res.data
        assert data["title"] == "Bài giảng Lập trình C++"
        assert data["visibility"] == MaterialVisibility.DRAFT
        assert data["published_version"] is None
        assert data["latest_version"]["version_number"] == 1

        # Check DB
        mat = Material.objects.get(id=data["id"])
        assert mat.versions.count() == 1
        v1 = mat.versions.first()
        assert v1.material_files.count() == 1

    def test_other_teacher_forbidden_to_create_material(self, course, other_teacher):
        client = _auth_client(other_teacher)
        url = f"/api/v1/courses/{course.id}/materials"
        res = client.post(url, {"title": "Hack Material"}, format="json")
        assert res.status_code == 403

    def test_student_forbidden_to_create_material(self, enrolled_course, student_member):
        client = _auth_client(student_member)
        url = f"/api/v1/courses/{enrolled_course.id}/materials"
        res = client.post(url, {"title": "Student Material"}, format="json")
        assert res.status_code == 403

    def test_admin_only_forbidden_to_author_material(self, course, admin_only):
        client = _auth_client(admin_only)
        url = f"/api/v1/courses/{course.id}/materials"
        res = client.post(url, {"title": "Admin Material"}, format="json")
        assert res.status_code == 403


@pytest.mark.django_db
class TestMaterialLifecycleMutations:
    """Kiểm tra toàn bộ vòng đời: Create -> Add/Remove file -> Finalize -> Publish -> Hide."""

    def test_full_lifecycle_flow(self, enrolled_course, teacher_owner, clean_file):
        client = _auth_client(teacher_owner)
        course_id = enrolled_course.id

        # 1. Create Material (without initial files)
        create_res = client.post(
            f"/api/v1/courses/{course_id}/materials",
            {"title": "Học liệu đầy đủ", "description": "Mô tả ban đầu"},
            format="json",
        )
        assert create_res.status_code == 201
        mat_id = create_res.data["id"]
        v1_id = create_res.data["latest_version"]["id"]

        # 2. Add file to draft v1
        add_file_res = client.post(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/versions/{v1_id}/files",
            {"file_id": str(clean_file.id), "label": "Tài liệu chính"},
            format="json",
        )
        assert add_file_res.status_code == 201
        assert add_file_res.data["file_name"] == "slide_bai1.pdf"

        # 3. Finalize v1
        fin_res = client.post(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/versions/{v1_id}/finalize"
        )
        assert fin_res.status_code == 200
        assert fin_res.data["lifecycle_status"] == MaterialVersionStatus.FINALIZED
        assert fin_res.data["manifest_hash"] != ""

        # Cannot modify files after finalize
        cant_add = client.post(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/versions/{v1_id}/files",
            {"file_id": str(clean_file.id)},
            format="json",
        )
        assert cant_add.status_code == 400

        # 4. Publish v1
        pub_res = client.post(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/publish",
            {"version_id": v1_id},
            format="json",
        )
        assert pub_res.status_code == 200
        assert pub_res.data["visibility"] == MaterialVisibility.PUBLISHED
        assert pub_res.data["published_version"]["id"] == v1_id

        # 5. Hide material
        hide_res = client.post(f"/api/v1/courses/{course_id}/materials/{mat_id}/hide")
        assert hide_res.status_code == 200
        assert hide_res.data["visibility"] == MaterialVisibility.HIDDEN

        # 6. Unhide material
        unhide_res = client.post(f"/api/v1/courses/{course_id}/materials/{mat_id}/unhide")
        assert unhide_res.status_code == 200
        assert unhide_res.data["visibility"] == MaterialVisibility.PUBLISHED

    def test_create_new_revision_does_not_affect_published_pointer(
        self, enrolled_course, teacher_owner, clean_file
    ):
        client = _auth_client(teacher_owner)
        course_id = enrolled_course.id

        # 1. Create, finalize, publish v1
        c_res = client.post(
            f"/api/v1/courses/{course_id}/materials",
            {"title": "Bài giảng versioned", "initial_file_ids": [str(clean_file.id)]},
            format="json",
        )
        mat_id = c_res.data["id"]
        v1_id = c_res.data["latest_version"]["id"]
        client.post(f"/api/v1/courses/{course_id}/materials/{mat_id}/versions/{v1_id}/finalize")
        client.post(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/publish",
            {"version_id": v1_id},
            format="json",
        )

        # 2. Create v2 draft (clone files from v1)
        v2_res = client.post(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/versions",
            {"changelog": "Cập nhật v2", "clone_from_version_id": v1_id},
            format="json",
        )
        assert v2_res.status_code == 201
        assert v2_res.data["version_number"] == 2
        assert v2_res.data["lifecycle_status"] == MaterialVersionStatus.DRAFT

        # 3. Verify material published_version is STILL v1!
        mat_res = client.get(f"/api/v1/courses/{course_id}/materials/{mat_id}")
        assert mat_res.status_code == 200
        assert mat_res.data["published_version"]["version_number"] == 1
        assert mat_res.data["latest_version"]["version_number"] == 2


@pytest.mark.django_db
class TestLockB08BypassAndDirectAccess:
    """Kiểm tra ngăn chặn bypass qua B08 API và kiểm quyền tải/xem trước."""

    def test_b08_delete_file_attached_to_material_rejected(
        self, enrolled_course, teacher_owner, clean_file
    ):
        client = _auth_client(teacher_owner)
        course_id = enrolled_course.id

        # Attach clean_file to material
        client.post(
            f"/api/v1/courses/{course_id}/materials",
            {"title": "Material with file", "initial_file_ids": [str(clean_file.id)]},
            format="json",
        )

        # Attempt to delete clean_file directly via B08 endpoint
        b08_del_res = client.delete(f"/api/v1/courses/{course_id}/files/{clean_file.id}")
        assert b08_del_res.status_code == 400
        assert "gắn vào học liệu" in str(b08_del_res.data)

    def test_b08_patch_publication_on_material_file_rejected(
        self, enrolled_course, teacher_owner, clean_file
    ):
        client = _auth_client(teacher_owner)
        course_id = enrolled_course.id

        # Attach clean_file to material
        client.post(
            f"/api/v1/courses/{course_id}/materials",
            {"title": "Material with file", "initial_file_ids": [str(clean_file.id)]},
            format="json",
        )

        # Attempt to toggle is_published directly via B08 endpoint
        b08_patch_res = client.patch(
            f"/api/v1/courses/{course_id}/files/{clean_file.id}",
            {"is_published": True},
            format="json",
        )
        assert b08_patch_res.status_code == 400
        assert "gắn vào học liệu" in str(b08_patch_res.data)

    def test_student_cannot_access_unclean_or_hidden_or_draft_material_file(
        self, enrolled_course, teacher_owner, student_member, clean_file
    ):
        teacher_client = _auth_client(teacher_owner)
        student_client = _auth_client(student_member)
        course_id = enrolled_course.id

        # Create draft material (not published yet)
        c_res = teacher_client.post(
            f"/api/v1/courses/{course_id}/materials",
            {"title": "Tài liệu bí mật", "initial_file_ids": [str(clean_file.id)]},
            format="json",
        )
        mat_id = c_res.data["id"]
        v1_id = c_res.data["latest_version"]["id"]

        # Student cannot see in list
        s_list = student_client.get(f"/api/v1/courses/{course_id}/materials")
        assert s_list.status_code == 200
        assert s_list.data["pagination"]["total_items"] == 0

        # Student cannot view detail
        s_det = student_client.get(f"/api/v1/courses/{course_id}/materials/{mat_id}")
        assert s_det.status_code == 403

        # Student cannot download via Material endpoint
        s_dl = student_client.get(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/files/{clean_file.id}/download"
        )
        assert s_dl.status_code == 403

        # Student cannot download via raw B08 endpoint
        s_raw_dl = student_client.get(f"/api/v1/courses/{course_id}/files/{clean_file.id}/download")
        assert s_raw_dl.status_code == 403

        # Now teacher finalizes and publishes
        teacher_client.post(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/versions/{v1_id}/finalize"
        )
        teacher_client.post(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/publish",
            {"version_id": v1_id},
            format="json",
        )

        # Student now CAN see in list
        s_list_pub = student_client.get(f"/api/v1/courses/{course_id}/materials")
        assert s_list_pub.status_code == 200
        assert s_list_pub.data["pagination"]["total_items"] == 1

        # Student can download via Material endpoint
        s_dl_pub = student_client.get(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/files/{clean_file.id}/download"
        )
        assert s_dl_pub.status_code == 200
        assert b"%PDF-1.4" in s_dl_pub.content

        # Student can preview via Material endpoint
        s_prev_pub = student_client.get(
            f"/api/v1/courses/{course_id}/materials/{mat_id}/files/{clean_file.id}/preview"
        )
        assert s_prev_pub.status_code == 200
        assert s_prev_pub["Content-Security-Policy"] == "sandbox; default-src 'none'"

        # If teacher hides the material, student is immediately blocked again!
        teacher_client.post(f"/api/v1/courses/{course_id}/materials/{mat_id}/hide")
        assert (
            student_client.get(
                f"/api/v1/courses/{course_id}/materials/{mat_id}/files/{clean_file.id}/download"
            ).status_code
            == 403
        )


@pytest.mark.django_db
class TestArchivedCourseProtection:
    """Môn học đã lưu trữ (ARCHIVED) khóa toàn bộ thao tác thay đổi."""

    def test_archived_course_rejects_material_mutations(self, course, teacher_owner):
        course.status = Course.Status.ARCHIVED
        course.archived_at = timezone.now()
        course.save()

        client = _auth_client(teacher_owner)
        url = f"/api/v1/courses/{course.id}/materials"
        res = client.post(url, {"title": "Archived Test"}, format="json")
        assert res.status_code in [400, 403]


def _review_published(course, teacher, file):
    from materials.services import (
        create_material,
        finalize_material_version,
        publish_material_version,
    )

    material, version = create_material(
        course=course, teacher=teacher, title="Review material", initial_file_ids=[file.id]
    )
    finalize_material_version(version, teacher)
    publish_material_version(material, version, teacher)
    return material, version


@pytest.mark.django_db
def test_student_detail_never_exposes_new_draft(
    enrolled_course, teacher_owner, student_member, clean_file
):
    from materials.services import create_material_version

    mat, published = _review_published(enrolled_course, teacher_owner, clean_file)
    draft = create_material_version(mat, teacher_owner, changelog="PRIVATE DRAFT SECRET")
    client = _auth_client(student_member)
    response = client.get(f"/api/v1/materials/{mat.id}")
    assert response.status_code == 200
    assert response.data["latest_version"]["id"] == str(published.id)
    assert response.data["total_versions"] == 1
    assert "PRIVATE DRAFT SECRET" not in str(response.data)
    url = f"/api/v1/courses/{mat.course_id}/materials"
    assert client.get(url).data["items"][0]["latest_version_number"] == 1
    assert client.get(f"{url}/{mat.id}/versions/{draft.id}").status_code == 403


@pytest.mark.django_db
def test_hidden_material_cannot_leak_via_legacy_file_list(
    enrolled_course, teacher_owner, student_member, clean_file
):
    from materials.services import hide_material

    clean_file.is_published = True
    clean_file.save(update_fields=["is_published"])
    mat, _ = _review_published(enrolled_course, teacher_owner, clean_file)
    hide_material(mat, teacher_owner)
    client = _auth_client(student_member)
    base = f"/api/v1/courses/{enrolled_course.id}/files"
    assert not client.get(base).data["items"]
    assert client.get(f"{base}/{clean_file.id}/download").status_code == 403


@pytest.mark.django_db
def test_conditional_metadata_update_rejects_stale_snapshot(course, teacher_owner):
    from materials.services import create_material

    mat, _ = create_material(course=course, teacher=teacher_owner, title="Original")
    client = _auth_client(teacher_owner)
    url = f"/api/v1/courses/{course.id}/materials/{mat.id}"
    snapshot = client.get(url).data["updated_at"]
    response = client.patch(url, {"title": "First"}, format="json", HTTP_IF_MATCH=snapshot)
    assert response.status_code == 200
    assert (
        client.patch(url, {"title": "Stale"}, format="json", HTTP_IF_MATCH=snapshot).status_code
        == 409
    )
    mat.refresh_from_db()
    assert mat.title == "First"


@pytest.mark.django_db
def test_material_creation_idempotency_replay_and_conflict(course, teacher_owner):
    client = _auth_client(teacher_owner)
    url = f"/api/v1/courses/{course.id}/materials"
    key = "material-review-command-0001"
    first = client.post(url, {"title": "Once"}, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert first.status_code == 201
    again = client.post(url, {"title": "Once"}, format="json", HTTP_IDEMPOTENCY_KEY=key)
    assert again.status_code == 201 and again.data["id"] == first.data["id"]
    assert Material.objects.count() == 1
    assert (
        client.post(
            url, {"title": "Different"}, format="json", HTTP_IDEMPOTENCY_KEY=key
        ).status_code
        == 409
    )


@pytest.mark.django_db
def test_manifest_count_policy_and_scope_are_enforced(course, teacher_owner, clean_file):
    from django.core.exceptions import ValidationError

    from materials.services import create_material, finalize_material_version

    second = StoredFile.objects.create(
        course=course,
        uploader=teacher_owner,
        file_name="second.pdf",
        file_size=1,
        sha256_hash="a" * 64,
        storage_path="review-second",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.COURSE_MATERIAL,
    )
    mat, version = create_material(
        course=course,
        teacher=teacher_owner,
        title="Count",
        initial_file_ids=[clean_file.id, second.id],
    )
    with pytest.raises(ValidationError, match="số tệp"):
        finalize_material_version(version, teacher_owner)
    second.purpose = FilePurpose.ASSIGNMENT_SUBMISSION
    second.save(update_fields=["purpose"])
    with pytest.raises(ValidationError, match="scope"):
        create_material(
            course=course, teacher=teacher_owner, title="Wrong scope", initial_file_ids=[second.id]
        )


@pytest.mark.django_db
def test_archive_and_role_revocation_refresh_cached_domain_objects(course, teacher_owner):
    from django.core.exceptions import PermissionDenied

    from materials.services import create_material, update_material

    mat, _ = create_material(course=course, teacher=teacher_owner, title="Before")
    Course.objects.filter(pk=course.pk).update(
        status=Course.Status.ARCHIVED, archived_at=timezone.now()
    )
    with pytest.raises(PermissionDenied):
        update_material(mat, teacher_owner, title="After archive")
    Course.objects.filter(pk=course.pk).update(status=Course.Status.OPEN, archived_at=None)
    RoleGrant.objects.filter(user=teacher_owner, role=Role.TEACHER).update(
        revoked_at=timezone.now(), revoked_by=teacher_owner, revoke_reason="review"
    )
    with pytest.raises(PermissionDenied):
        update_material(mat, teacher_owner, title="After revoke")


@pytest.mark.django_db
def test_direct_service_delete_cannot_bypass_manifest(course, teacher_owner, clean_file):
    from files.services import abort_upload_intent
    from platform_core.errors import DomainError

    _review_published(course, teacher_owner, clean_file)
    with pytest.raises(DomainError):
        abort_upload_intent(actor=teacher_owner, file_id=clean_file.id)
    clean_file.refresh_from_db()
    assert clean_file.status == FileStatus.CLEAN and get_storage().exists(clean_file.storage_path)


@pytest.mark.django_db
def test_current_preview_policy_and_safe_types_are_authoritative(course, teacher_owner, clean_file):
    mat, _ = _review_published(course, teacher_owner, clean_file)
    CourseFilePolicy.objects.filter(course=course).update(preview_allowed=False)
    client = _auth_client(teacher_owner)
    url = f"/api/v1/courses/{course.id}/materials/{mat.id}"
    detail = client.get(url).data
    assert detail["published_version"]["files"][0]["preview_url"] is None
    assert client.get(f"{url}/files/{clean_file.id}/preview").status_code == 403
    assert client.get(f"{url}/files/{clean_file.id}/download").status_code == 200


@pytest.mark.django_db
def test_material_mutations_require_real_session_csrf(course, teacher_owner):
    from django.conf import settings

    from identity.services.sessions import issue_session

    client = APIClient(enforce_csrf_checks=True)
    raw, _ = issue_session(user_id=teacher_owner.id)
    client.cookies[settings.SESSION_COOKIE_NAME] = raw
    url = f"/api/v1/courses/{course.id}/materials"
    assert client.post(url, {"title": "No CSRF"}, format="json").status_code == 403
    assert client.get("/api/v1/auth/csrf").status_code == 204
    token = client.cookies["csrftoken"].value
    assert (
        client.post(url, {"title": "CSRF valid"}, format="json", HTTP_X_CSRFTOKEN=token).status_code
        == 201
    )


@pytest.mark.django_db
def test_invalid_material_filters_are_validation_errors(course, teacher_owner):
    client = _auth_client(teacher_owner)
    root = f"/api/v1/courses/{course.id}/materials"
    assert client.get(root, {"chapter_id": "not-a-uuid"}).status_code == 400
    assert client.get(root + "/search", {"type": "invalid"}).status_code == 400
    assert client.get(root + "/search", {"sort_by": "invalid"}).status_code == 400


@pytest.mark.django_db
def test_revision_idempotency_replay_and_payload_conflict(course, teacher_owner):
    from materials.services import create_material

    mat, _ = create_material(course=course, teacher=teacher_owner, title="Replay revision")
    client = _auth_client(teacher_owner)
    url = f"/api/v1/courses/{course.pk}/materials/{mat.pk}/versions"
    headers = {"HTTP_IDEMPOTENCY_KEY": "review-revision-command"}
    first = client.post(url, {"changelog": "Revision"}, format="json", **headers)
    replay = client.post(url, {"changelog": "Revision"}, format="json", **headers)
    assert first.status_code == replay.status_code == 201
    assert first.data["id"] == replay.data["id"]
    assert mat.versions.count() == 2
    assert client.post(url, {"changelog": "Changed"}, format="json", **headers).status_code == 409
