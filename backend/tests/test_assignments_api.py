import hashlib
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from decimal import Decimal
from threading import Barrier

import pytest
from django.conf import settings
from django.db import close_old_connections, connections
from django.utils import timezone
from rest_framework.test import APIClient

from assignments.models import (
    Assignment,
    AssignmentPublicationSnapshot,
    AssignmentStatus,
)
from courses.models import Chapter, Course, Lesson
from files.models import CourseFilePolicy, FilePurpose, FileStatus, StoredFile
from files.storage import get_storage
from identity.models import Role, RoleGrant, RoleRequest, User, VerifiedEmail
from platform_core.models import AuditEvent


def _create_user_with_role(
    email: str, role_name: str, is_active: bool = True, is_verified: bool = True
) -> User:
    from identity.services.accounts import digest

    now = timezone.now()
    user = User.objects.create(
        email=email,
        display_name=email.split("@")[0],
        is_active=is_active,
    )
    user.set_password("SecurePass123!")
    user.save()

    if is_verified:
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
def admin_only():
    return _create_user_with_role("admin_only@neu.edu.vn", Role.ADMIN)


@pytest.fixture
def unverified_teacher():
    return _create_user_with_role("unverified@neu.edu.vn", Role.TEACHER, is_verified=False)


@pytest.fixture
def inactive_teacher():
    return _create_user_with_role("inactive@neu.edu.vn", Role.TEACHER, is_active=False)


@pytest.fixture
def course(teacher_owner):
    c = Course.objects.create(
        code="ACC101",
        name="Nguyên lý Kế toán",
        term="HK1-2026",
        teacher=teacher_owner,
        status=Course.Status.OPEN,
    )
    CourseFilePolicy.objects.create(
        course=c,
        allowed_extensions=["pdf", "docx", "zip"],
        max_file_size_bytes=20 * 1024 * 1024,
        course_quota_bytes=200 * 1024 * 1024,
        preview_allowed=True,
    )
    return c


@pytest.fixture
def other_course(other_teacher):
    c = Course.objects.create(
        code="MKT101",
        name="Marketing căn bản",
        term="HK1-2026",
        teacher=other_teacher,
        status=Course.Status.OPEN,
    )
    CourseFilePolicy.objects.create(
        course=c,
        allowed_extensions=["pdf", "docx"],
        max_file_size_bytes=10 * 1024 * 1024,
        course_quota_bytes=100 * 1024 * 1024,
        preview_allowed=True,
    )
    return c


@pytest.fixture
def chapter_and_lesson(course):
    chap = Chapter.objects.create(course=course, title="Chương 1: Tổng quan Kế toán", position=1)
    les = Lesson.objects.create(chapter=chap, title="Bài 1: Định nghĩa và vai trò", position=1)
    return chap, les


@pytest.fixture
def other_chapter(other_course):
    return Chapter.objects.create(course=other_course, title="Chương ngoài", position=1)


@pytest.fixture
def clean_attachment_file(course, teacher_owner):
    content = b"%PDF-1.4 Mock clean assignment problem attachment"
    storage_path = f"active/{course.id}/assignment_problem.pdf"
    get_storage().save(storage_path, content)

    return StoredFile.objects.create(
        course=course,
        uploader=teacher_owner,
        file_name="de_bai_tap_lon.pdf",
        file_size=len(content),
        mime_type="application/pdf",
        storage_path=storage_path,
        status=FileStatus.CLEAN,
        sha256_hash=hashlib.sha256(content).hexdigest(),
        purpose=FilePurpose.ASSIGNMENT_ATTACHMENT,
    )


@pytest.fixture
def other_course_file(other_course, other_teacher):
    content = b"%PDF-1.4 Other course file"
    storage_path = f"active/{other_course.id}/other.pdf"
    get_storage().save(storage_path, content)

    return StoredFile.objects.create(
        course=other_course,
        uploader=other_teacher,
        file_name="other.pdf",
        file_size=len(content),
        mime_type="application/pdf",
        storage_path=storage_path,
        status=FileStatus.CLEAN,
        sha256_hash=hashlib.sha256(content).hexdigest(),
        purpose=FilePurpose.ASSIGNMENT_ATTACHMENT,
    )


@pytest.mark.django_db
class TestAssignmentApiPermissions:
    """Kiểm tra ma trận phân quyền: GV phụ trách vs GV khác vs SV
    vs Admin-only vs Unverified vs Inactive.
    """

    def test_anonymous_cannot_access_teacher_endpoints(self, course):
        client = APIClient()
        url = f"/api/v1/courses/{course.id}/assignments"
        assert client.get(url).status_code == 401
        assert client.post(url, {"title": "Test"}, format="json").status_code == 401

    def test_inactive_user_cannot_access(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        teacher_owner.is_active = False
        teacher_owner.save(update_fields=["is_active"])
        url = f"/api/v1/courses/{course.id}/assignments"
        assert client.get(url).status_code == 401

    def test_unverified_teacher_forbidden(self, course, unverified_teacher):
        client = _auth_client(unverified_teacher)
        url = f"/api/v1/courses/{course.id}/assignments"
        res = client.get(url)
        assert res.status_code == 400
        assert res.data["error"]["code"] == "email_not_verified"

    def test_student_forbidden_to_access_teacher_endpoints(self, course, student_member):
        client = _auth_client(student_member)
        url = f"/api/v1/courses/{course.id}/assignments"
        assert client.get(url).status_code == 403
        assert client.post(url, {"title": "Hack"}, format="json").status_code == 403

    def test_other_teacher_forbidden_to_access(self, course, other_teacher):
        client = _auth_client(other_teacher)
        url = f"/api/v1/courses/{course.id}/assignments"
        assert client.get(url).status_code == 403
        assert client.post(url, {"title": "Hack"}, format="json").status_code == 403

    def test_admin_only_forbidden_to_author_assignment(self, course, admin_only):
        client = _auth_client(admin_only)
        url = f"/api/v1/courses/{course.id}/assignments"
        assert client.get(url).status_code == 403
        assert client.post(url, {"title": "Admin"}, format="json").status_code == 403

    def test_course_owner_can_list_and_create(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        url = f"/api/v1/courses/{course.id}/assignments"
        get_res = client.get(url)
        assert get_res.status_code == 200
        assert get_res.data["items"] == []

        due_date = (timezone.now() + timedelta(days=7)).isoformat()
        post_res = client.post(url, {"title": "Bài tập 1", "due_at": due_date}, format="json")
        assert post_res.status_code == 201
        assert post_res.data["title"] == "Bài tập 1"

    def test_archived_course_rejects_mutations(self, course, teacher_owner):
        course.status = Course.Status.ARCHIVED
        course.archived_at = timezone.now()
        course.save()

        client = _auth_client(teacher_owner)
        url = f"/api/v1/courses/{course.id}/assignments"
        due_date = (timezone.now() + timedelta(days=7)).isoformat()
        res = client.post(url, {"title": "Bài tập mới", "due_at": due_date}, format="json")
        assert res.status_code == 400
        assert res.data["error"]["code"] == "course_archived"

    def test_transferred_course_blocks_previous_teacher(self, course, teacher_owner, other_teacher):
        client_owner = _auth_client(teacher_owner)
        url = f"/api/v1/courses/{course.id}/assignments"
        assert client_owner.get(url).status_code == 200

        # Chuyển giao môn học cho giáo viên khác
        course.teacher = other_teacher
        course.save()

        # Giáo viên cũ mất quyền tác giả ngay lập tức
        assert client_owner.get(url).status_code == 403
        # Giáo viên mới có toàn quyền
        client_new = _auth_client(other_teacher)
        assert client_new.get(url).status_code == 200


@pytest.mark.django_db
class TestAssignmentCsrfEnforcement:
    """Kiểm tra CSRF thật cho mọi mutation."""

    def test_mutation_requires_valid_csrf_token(self, course, teacher_owner):
        from identity.services.sessions import issue_session

        client = APIClient(enforce_csrf_checks=True)
        raw_key, _ = issue_session(user_id=teacher_owner.id)
        client.cookies[settings.SESSION_COOKIE_NAME] = raw_key

        url = f"/api/v1/courses/{course.id}/assignments"
        due_date = (timezone.now() + timedelta(days=7)).isoformat()

        # POST không có CSRF token -> 403
        res_no_csrf = client.post(url, {"title": "No CSRF", "due_at": due_date}, format="json")
        assert res_no_csrf.status_code == 403

        # Lấy CSRF token hợp lệ
        client.get("/api/v1/auth/csrf")
        csrf_token = client.cookies["csrftoken"].value

        # POST có CSRF token hợp lệ -> 201
        res_with_csrf = client.post(
            url,
            {"title": "Valid CSRF", "due_at": due_date},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        assert res_with_csrf.status_code == 201


@pytest.mark.django_db
class TestAssignmentListAndPagination:
    """Kiểm tra phân trang, bộ lọc status/chapter và tìm kiếm."""

    def test_pagination_and_summary_fields(self, course, teacher_owner, chapter_and_lesson):
        client = _auth_client(teacher_owner)
        chap, les = chapter_and_lesson
        url = f"/api/v1/courses/{course.id}/assignments"

        # Tạo 3 bài tập
        now = timezone.now()
        for i in range(1, 4):
            Assignment.objects.create(
                course=course,
                chapter=chap if i == 1 else None,
                lesson=les if i == 1 else None,
                title=f"Bài tập {i}",
                instructions=f"Hướng dẫn {i}",
                due_at=now + timedelta(days=i),
                status=AssignmentStatus.DRAFT if i < 3 else AssignmentStatus.PUBLISHED,
                created_by=teacher_owner,
                updated_by=teacher_owner,
            )

        # Lấy trang 1 với page_size = 2
        res = client.get(url, {"page": 1, "page_size": 2})
        assert res.status_code == 200
        data = res.data
        assert data["pagination"]["page"] == 1
        assert data["pagination"]["page_size"] == 2
        assert data["pagination"]["total_items"] == 3
        assert data["pagination"]["total_pages"] == 2
        assert len(data["items"]) == 2

        # Lọc theo status=draft
        res_draft = client.get(url, {"status": "draft"})
        assert res_draft.status_code == 200
        assert res_draft.data["pagination"]["total_items"] == 2

        # Lọc theo chapter_id
        res_chap = client.get(url, {"chapter_id": str(chap.id)})
        assert res_chap.status_code == 200
        assert res_chap.data["pagination"]["total_items"] == 1
        assert res_chap.data["items"][0]["title"] == "Bài tập 1"

        # Tìm kiếm theo từ khóa
        res_search = client.get(url, {"search": "Bài tập 2"})
        assert res_search.status_code == 200
        assert res_search.data["pagination"]["total_items"] == 1
        assert res_search.data["items"][0]["title"] == "Bài tập 2"


@pytest.mark.django_db
class TestAssignmentCreationAndAudit:
    """Kiểm tra tạo bản nháp với đầy đủ rubric, policy, tệp đính kèm và audit event."""

    def test_create_draft_full_attributes_and_audit(
        self, course, teacher_owner, chapter_and_lesson, clean_attachment_file
    ):
        client = _auth_client(teacher_owner)
        chap, les = chapter_and_lesson
        url = f"/api/v1/courses/{course.id}/assignments"

        due_date = (timezone.now() + timedelta(days=10)).isoformat()
        payload = {
            "title": "Bài tập lớn Giữa kỳ",
            "instructions": "Sinh viên lập bảng cân đối kế toán",
            "due_at": due_date,
            "allow_late": True,
            "chapter_id": str(chap.id),
            "lesson_id": str(les.id),
            "ai_grading_opt_in": True,
            "rubric_criteria": [
                {
                    "title": "Tính chính xác số liệu",
                    "description": "Các tài khoản đúng số dư",
                    "max_score": "5.00",
                    "position": 1,
                },
                {
                    "title": "Trình bày chuẩn mực",
                    "description": "Theo chuẩn VAS",
                    "max_score": "5.00",
                    "position": 2,
                },
            ],
            "file_policy": {
                "max_files_per_submission": 3,
                "max_file_size_bytes": 15 * 1024 * 1024,
                "allowed_extensions": ["pdf", "xlsx"],
            },
            "attachment_file_ids": [str(clean_attachment_file.id)],
        }

        res = client.post(url, payload, format="json")
        assert res.status_code == 201
        data = res.data

        assert data["title"] == "Bài tập lớn Giữa kỳ"
        assert data["status"] == "draft"
        assert data["version"] == 1
        assert data["allow_late"] is True
        assert data["ai_grading_opt_in"] is True
        assert len(data["rubric_criteria"]) == 2
        assert Decimal(data["total_score"]) == Decimal("10.00")
        assert data["file_policy"]["max_files_per_submission"] == 3
        assert "xlsx" in data["file_policy"]["allowed_extensions"]
        assert len(data["attachments"]) == 1
        assert data["attachments"][0]["name"] == "de_bai_tap_lon.pdf"
        assert data["attachments"][0]["download_url"] is not None

        # Kiểm tra Audit Event đã ghi nhận
        audit = AuditEvent.objects.filter(
            action="assignments.created", resource_id=data["id"]
        ).first()
        assert audit is not None
        assert audit.actor == teacher_owner
        assert audit.metadata["course_id"] == str(course.id)

    def test_create_and_publish_immediately(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        url = f"/api/v1/courses/{course.id}/assignments"

        due_date = (timezone.now() + timedelta(days=5)).isoformat()
        payload = {
            "title": "Bài kiểm tra nhanh",
            "instructions": "Làm bài trong 30 phút",
            "due_at": due_date,
            "publish_immediately": True,
        }

        res = client.post(url, payload, format="json")
        assert res.status_code == 201
        assert res.data["status"] == "published"
        assert res.data["published_at"] is not None

        # Kiểm tra snapshot đã được tạo
        snapshot = AssignmentPublicationSnapshot.objects.filter(
            assignment_id=res.data["id"]
        ).first()
        assert snapshot is not None
        assert snapshot.snapshot_title == "Bài kiểm tra nhanh"


@pytest.mark.django_db
class TestAssignmentUpdateAndImmutability:
    """Kiểm tra tính bất biến sau publish: cấm sửa đề/rubric/attachments, cho phép sửa settings."""

    def test_update_draft_succeeds(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        assignment = Assignment.objects.create(
            course=course,
            title="Bản nháp 1",
            instructions="Đề ban đầu",
            due_at=timezone.now() + timedelta(days=3),
            status=AssignmentStatus.DRAFT,
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=1,
        )

        url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}"
        patch_res = client.patch(
            url,
            {"title": "Bản nháp đã sửa", "instructions": "Đề cập nhật"},
            format="json",
        )
        assert patch_res.status_code == 200
        assert patch_res.data["title"] == "Bản nháp đã sửa"
        assert patch_res.data["instructions"] == "Đề cập nhật"
        assert patch_res.data["version"] == 2

    def test_cannot_modify_content_or_rubric_after_publish(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        assignment = Assignment.objects.create(
            course=course,
            title="Đề chính thức đã công bố",
            instructions="Nội dung đã chốt",
            due_at=timezone.now() + timedelta(days=7),
            status=AssignmentStatus.PUBLISHED,
            published_at=timezone.now(),
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=2,
        )

        url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}"

        # 1. Cấm sửa title
        res_title = client.patch(url, {"title": "Sửa tiêu đề hồi tố"}, format="json")
        assert res_title.status_code == 400
        assert res_title.data["error"]["code"] == "immutable_after_publish"

        # 2. Cấm sửa instructions
        res_inst = client.patch(url, {"instructions": "Sửa nội dung đề hồi tố"}, format="json")
        assert res_inst.status_code == 400
        assert res_inst.data["error"]["code"] == "immutable_after_publish"

        # 3. Cấm sửa rubric
        res_rubric = client.patch(
            url,
            {"rubric_criteria": [{"title": "Tiêu chí mới", "max_score": "10.00"}]},
            format="json",
        )
        assert res_rubric.status_code == 400
        assert res_rubric.data["error"]["code"] == "immutable_after_publish"

        # 4. Cấm sửa attachments
        res_attach = client.patch(url, {"attachment_file_ids": [str(uuid.uuid4())]}, format="json")
        assert res_attach.status_code == 400
        assert res_attach.data["error"]["code"] == "immutable_after_publish"

    def test_allowed_settings_update_after_publish(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        assignment = Assignment.objects.create(
            course=course,
            title="Bài tập thực hành",
            instructions="Đề bài bất biến",
            due_at=timezone.now() + timedelta(days=2),
            status=AssignmentStatus.PUBLISHED,
            published_at=timezone.now(),
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=1,
        )
        # Tạo policy mặc định
        from assignments.models import AssignmentFilePolicy

        AssignmentFilePolicy.objects.create(assignment=assignment, version=1)

        url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}"
        new_due = (timezone.now() + timedelta(days=5)).isoformat()
        payload = {
            "due_at": new_due,
            "allow_late": True,
            "ai_grading_opt_in": True,
            "file_policy": {
                "max_files_per_submission": 5,
                "allowed_extensions": ["pdf", "docx"],
            },
        }

        res = client.patch(url, payload, format="json")
        assert res.status_code == 200
        assert res.data["allow_late"] is True
        assert res.data["ai_grading_opt_in"] is True
        assert res.data["file_policy"]["max_files_per_submission"] == 5
        assert res.data["file_policy"]["version"] == 2
        assert res.data["version"] == 2


@pytest.mark.django_db
class TestOptimisticConcurrencyAndStale:
    """Kiểm tra Optimistic Concurrency Control (OCC) qua expected_version và If-Match header."""

    def test_expected_version_conflict(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        assignment = Assignment.objects.create(
            course=course,
            title="Assignment OCC",
            due_at=timezone.now() + timedelta(days=3),
            status=AssignmentStatus.DRAFT,
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=3,
        )

        url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}"

        # Gửi version cũ (stale version 2 != 3) -> 409 Conflict
        res_stale = client.patch(
            url,
            {"title": "Updated", "expected_version": 2},
            format="json",
        )
        assert res_stale.status_code == 409
        assert res_stale.data["error"]["code"] == "conflict"

        # Gửi version khớp (expected_version = 3) -> 200 OK
        res_ok = client.patch(
            url,
            {"title": "Updated", "expected_version": 3},
            format="json",
        )
        assert res_ok.status_code == 200
        assert res_ok.data["version"] == 4

    def test_if_match_header_occ(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        assignment = Assignment.objects.create(
            course=course,
            title="Assignment Header OCC",
            due_at=timezone.now() + timedelta(days=3),
            status=AssignmentStatus.DRAFT,
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=1,
        )

        url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}"

        # 1. Update với If-Match: "1" -> 200 OK
        res_ok = client.patch(url, {"title": "Updated First"}, format="json", HTTP_IF_MATCH='"1"')
        assert res_ok.status_code == 200
        assert res_ok.data["version"] == 2

        # 2. Cố gắng update lại với If-Match: "1" (stale) -> 409 Conflict
        res_stale = client.patch(
            url, {"title": "Updated Stale"}, format="json", HTTP_IF_MATCH='"1"'
        )
        assert res_stale.status_code == 409


@pytest.mark.django_db
class TestIdempotencyAndReplay:
    """Kiểm tra Command Replay & Idempotency Key."""

    def test_create_replay_and_conflict(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        url = f"/api/v1/courses/{course.id}/assignments"
        idem_key = "test-assignment-create-key-001"
        due_date = (timezone.now() + timedelta(days=5)).isoformat()
        payload = {"title": "Bài tập Idempotent", "due_at": due_date}

        # 1. Gửi lần đầu -> 201 Created
        res1 = client.post(url, payload, format="json", HTTP_IDEMPOTENCY_KEY=idem_key)
        assert res1.status_code == 201
        created_id = res1.data["id"]

        # 2. Gửi lại cùng key và cùng payload -> Replay thành công (201 và cùng id)
        res2 = client.post(url, payload, format="json", HTTP_IDEMPOTENCY_KEY=idem_key)
        assert res2.status_code == 201
        assert res2.data["id"] == created_id

        # Chỉ có đúng 1 bài tập trong cơ sở dữ liệu
        assert Assignment.objects.filter(course=course).count() == 1

        # 3. Gửi cùng key nhưng payload khác -> 409 Idempotency Conflict
        diff_payload = {"title": "Tiêu đề khác", "due_at": due_date}
        res3 = client.post(url, diff_payload, format="json", HTTP_IDEMPOTENCY_KEY=idem_key)
        assert res3.status_code == 409
        assert res3.data["error"]["code"] == "idempotency_conflict"


@pytest.mark.django_db
class TestAssignmentLifecycleActions:
    """Kiểm tra Publish, Close, Reopen, Archive và Preview."""

    def test_publish_and_reopen_lifecycle(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        assignment = Assignment.objects.create(
            course=course,
            title="Vòng đời bài tập",
            instructions="Hướng dẫn",
            due_at=timezone.now() + timedelta(days=2),
            status=AssignmentStatus.DRAFT,
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=1,
        )

        base_url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}"

        # 1. Publish
        pub_res = client.post(f"{base_url}/publish")
        assert pub_res.status_code == 200
        assert pub_res.data["status"] == "published"
        assert pub_res.data["published_at"] is not None

        # 2. Manual Close
        close_res = client.post(f"{base_url}/close")
        assert close_res.status_code == 200
        assert close_res.data["status"] == "closed"
        assert close_res.data["manually_closed_at"] is not None

        # 3. Reopen với due_at mới
        new_due = (timezone.now() + timedelta(days=4)).isoformat()
        reopen_res = client.post(f"{base_url}/reopen", {"new_due_at": new_due}, format="json")
        assert reopen_res.status_code == 200
        assert reopen_res.data["status"] == "published"
        assert reopen_res.data["manually_closed_at"] is None

        # 4. Archive
        archive_res = client.post(f"{base_url}/archive")
        assert archive_res.status_code == 200
        assert archive_res.data["status"] == "archived"

    def test_preview_assignment(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        assignment = Assignment.objects.create(
            course=course,
            title="Đề thi thử",
            instructions="Đề mẫu",
            due_at=timezone.now() + timedelta(days=2),
            status=AssignmentStatus.DRAFT,
            created_by=teacher_owner,
            updated_by=teacher_owner,
        )

        preview_url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}/preview"
        res = client.get(preview_url)
        assert res.status_code == 200
        assert res.data["preview_mode"] is True
        assert res.data["assignment"]["title"] == "Đề thi thử"


@pytest.mark.django_db
class TestCrossCourseReferences:
    """Kiểm tra chặt chẽ việc chặn liên kết chéo môn học
    (Chương, Bài học, Tệp đính kèm) - không gây lỗi 500.
    """

    def test_reject_foreign_chapter(self, course, teacher_owner, other_chapter):
        client = _auth_client(teacher_owner)
        url = f"/api/v1/courses/{course.id}/assignments"
        due_date = (timezone.now() + timedelta(days=5)).isoformat()

        payload = {
            "title": "Bài tập sai chương",
            "due_at": due_date,
            "chapter_id": str(other_chapter.id),
        }
        res = client.post(url, payload, format="json")
        assert res.status_code == 400
        assert res.data["error"]["code"] == "validation_error"
        assert "chapter_id" in res.data["error"]["details"]

    def test_reject_foreign_file(self, course, teacher_owner, other_course_file):
        client = _auth_client(teacher_owner)
        url = f"/api/v1/courses/{course.id}/assignments"
        due_date = (timezone.now() + timedelta(days=5)).isoformat()

        payload = {
            "title": "Bài tập sai tệp",
            "due_at": due_date,
            "attachment_file_ids": [str(other_course_file.id)],
        }
        res = client.post(url, payload, format="json")
        assert res.status_code == 400
        assert res.data["error"]["code"] == "validation_error"
        assert "attachment_file_ids" in res.data["error"]["details"]

    def test_reject_infected_file(self, course, teacher_owner):
        client = _auth_client(teacher_owner)
        url = f"/api/v1/courses/{course.id}/assignments"
        due_date = (timezone.now() + timedelta(days=5)).isoformat()

        infected = StoredFile.objects.create(
            course=course,
            uploader=teacher_owner,
            file_name="virus.exe",
            file_size=1024,
            mime_type="application/octet-stream",
            storage_path="infected/test.exe",
            status=FileStatus.INFECTED,
            sha256_hash="f" * 64,
            purpose=FilePurpose.ASSIGNMENT_ATTACHMENT,
        )

        payload = {
            "title": "Bài tập file nhiễm mã độc",
            "due_at": due_date,
            "attachment_file_ids": [str(infected.id)],
        }
        res = client.post(url, payload, format="json")
        assert res.status_code == 400
        assert res.data["error"]["code"] == "validation_error"


@pytest.mark.django_db(transaction=True)
class TestAssignmentConcurrencyPostgreSql:
    """Kiểm tra tương tranh thực tế trên PostgreSQL:
    OCC locking, publish đồng thời, update đồng thời.
    """

    def test_concurrent_update_with_same_expected_version_fails_for_one(
        self, course, teacher_owner
    ):
        assignment = Assignment.objects.create(
            course=course,
            title="Initial Title",
            due_at=timezone.now() + timedelta(days=3),
            status=AssignmentStatus.DRAFT,
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=1,
        )

        barrier = Barrier(2)

        def worker(new_title):
            close_old_connections()
            try:
                barrier.wait(timeout=5)
                client = _auth_client(teacher_owner)
                url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}"
                res = client.patch(url, {"title": new_title, "expected_version": 1}, format="json")
                return res.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            future1 = executor.submit(worker, "Title Update A")
            future2 = executor.submit(worker, "Title Update B")
            statuses = [future1.result(), future2.result()]

        # Đúng một yêu cầu thành công (200) và một yêu cầu bị từ chối do xung đột phiên bản (409)
        assert statuses.count(200) == 1
        assert statuses.count(409) == 1

        assignment.refresh_from_db()
        assert assignment.version == 2
        assert assignment.title in ["Title Update A", "Title Update B"]

    def test_concurrent_publish_is_atomic_and_safe(self, course, teacher_owner):
        assignment = Assignment.objects.create(
            course=course,
            title="Publish Concurrency Test",
            instructions="Kiểm tra tương tranh",
            due_at=timezone.now() + timedelta(days=3),
            status=AssignmentStatus.DRAFT,
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=1,
        )

        barrier = Barrier(2)

        def worker():
            close_old_connections()
            try:
                barrier.wait(timeout=5)
                client = _auth_client(teacher_owner)
                url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}/publish"
                res = client.post(url)
                return res.status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            future1 = executor.submit(worker)
            future2 = executor.submit(worker)
            statuses = [future1.result(), future2.result()]

        # Cả hai luồng hoàn tất an toàn (200), không sinh lỗi 500
        assert all(code == 200 for code in statuses)
        assignment.refresh_from_db()
        assert assignment.status == AssignmentStatus.PUBLISHED
        assert AssignmentPublicationSnapshot.objects.filter(assignment=assignment).count() == 1


@pytest.mark.django_db
class TestStudentAssignmentViewAndPermissions:
    """Kiểm tra toàn diện phân quyền và hiển thị của sinh viên:
    - Sinh viên ghi danh xem bài tập đã công bố (published/closed/archived).
    - Sinh viên bị chặn xem bài tập nháp (draft) với HTTP 403.
    - Giảng viên khác, admin-only, sinh viên rút học phần hoặc ngoài môn học bị chặn 403.
    - Chuyển giao môn học: Giảng viên cũ bị chặn 403, giảng viên mới xem được.
    - Direct assignment URL /assignments/{id} và /assignments/{id}/eligibility.
    - Endpoint danh sách công bố /courses/{course_id}/published-assignments không lộ draft.
    """

    @pytest.fixture
    def enrolled_student(self, course, student_member):
        from courses.models import Membership

        Membership.objects.create(
            course=course,
            student=student_member,
            status=Membership.Status.ACTIVE,
        )
        return student_member

    @pytest.fixture
    def withdrawn_student(self, course):
        user = _create_user_with_role("11240002@st.neu.edu.vn", Role.STUDENT)
        from courses.models import Membership

        Membership.objects.create(
            course=course,
            student=user,
            status=Membership.Status.WITHDRAWN,
        )
        return user

    @pytest.fixture
    def outside_student(self):
        return _create_user_with_role("11240003@st.neu.edu.vn", Role.STUDENT)

    @pytest.fixture
    def published_assignment(self, course, teacher_owner):
        return Assignment.objects.create(
            course=course,
            title="Bài tập Đã công bố",
            instructions="Đề bài làm bài tập 1",
            due_at=timezone.now() + timedelta(days=5),
            status=AssignmentStatus.PUBLISHED,
            published_at=timezone.now(),
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=1,
        )

    @pytest.fixture
    def draft_assignment(self, course, teacher_owner):
        return Assignment.objects.create(
            course=course,
            title="Bài tập Nháp",
            instructions="Đề bài nháp chưa công bố",
            due_at=timezone.now() + timedelta(days=5),
            status=AssignmentStatus.DRAFT,
            created_by=teacher_owner,
            updated_by=teacher_owner,
            version=1,
        )

    def test_enrolled_student_can_view_published_assignment(
        self, course, published_assignment, enrolled_student
    ):
        client = _auth_client(enrolled_student)
        url = f"/api/v1/courses/{course.id}/assignments/{published_assignment.id}"
        res = client.get(url)
        assert res.status_code == 200
        assert res.data["id"] == str(published_assignment.id)
        assert res.data["title"] == "Bài tập Đã công bố"
        assert res.data["status"] == "published"

    def test_enrolled_student_cannot_view_draft_assignment(
        self, course, draft_assignment, enrolled_student
    ):
        client = _auth_client(enrolled_student)
        url = f"/api/v1/courses/{course.id}/assignments/{draft_assignment.id}"
        res = client.get(url)
        assert res.status_code == 403
        assert res.data["error"]["code"] == "permission_denied"

    def test_outside_student_forbidden_to_view_published_assignment(
        self, course, published_assignment, outside_student
    ):
        client = _auth_client(outside_student)
        url = f"/api/v1/courses/{course.id}/assignments/{published_assignment.id}"
        res = client.get(url)
        assert res.status_code == 403
        assert res.data["error"]["code"] == "permission_denied"

    def test_withdrawn_student_forbidden_to_view_published_assignment(
        self, course, published_assignment, withdrawn_student
    ):
        client = _auth_client(withdrawn_student)
        url = f"/api/v1/courses/{course.id}/assignments/{published_assignment.id}"
        res = client.get(url)
        assert res.status_code == 403
        assert res.data["error"]["code"] == "permission_denied"

    def test_other_teacher_forbidden_to_view_assignment(
        self, course, published_assignment, other_teacher
    ):
        client = _auth_client(other_teacher)
        url = f"/api/v1/courses/{course.id}/assignments/{published_assignment.id}"
        res = client.get(url)
        assert res.status_code == 403
        assert res.data["error"]["code"] == "permission_denied"

    def test_admin_only_forbidden_to_view_assignment(
        self, course, published_assignment, admin_only
    ):
        client = _auth_client(admin_only)
        url = f"/api/v1/courses/{course.id}/assignments/{published_assignment.id}"
        res = client.get(url)
        assert res.status_code == 403
        assert res.data["error"]["code"] == "permission_denied"

    def test_direct_assignment_url_works_for_student_and_blocks_draft(
        self, published_assignment, draft_assignment, enrolled_student
    ):
        client = _auth_client(enrolled_student)
        # Direct URL cho published -> 200
        res_pub = client.get(f"/api/v1/assignments/{published_assignment.id}")
        assert res_pub.status_code == 200
        assert res_pub.data["title"] == "Bài tập Đã công bố"

        # Direct URL cho draft -> 403
        res_draft = client.get(f"/api/v1/assignments/{draft_assignment.id}")
        assert res_draft.status_code == 403

    def test_direct_eligibility_url_works(self, published_assignment, enrolled_student):
        client = _auth_client(enrolled_student)
        res = client.get(f"/api/v1/assignments/{published_assignment.id}/eligibility")
        assert res.status_code == 200
        assert res.data["can_submit"] is True

    def test_published_assignments_list_excludes_drafts_and_enforces_membership(
        self, course, published_assignment, draft_assignment, enrolled_student, outside_student
    ):
        # 1. Enrolled student lấy danh sách -> chỉ thấy published, không thấy draft
        client = _auth_client(enrolled_student)
        url = f"/api/v1/courses/{course.id}/published-assignments"
        res = client.get(url)
        assert res.status_code == 200
        items = res.data["items"]
        assert len(items) == 1
        assert items[0]["id"] == str(published_assignment.id)
        assert items[0]["status"] == "published"

        # 2. Outside student lấy danh sách -> 403
        client_outside = _auth_client(outside_student)
        res_out = client_outside.get(url)
        assert res_out.status_code == 403


@pytest.mark.django_db
@pytest.mark.parametrize("action", ["close", "reopen", "archive"])
def test_acceptance_foreign_assignment_cannot_be_mutated_through_owned_course(
    course, other_course, teacher_owner, other_teacher, action
):
    from assignments.services import create_assignment

    foreign = create_assignment(
        course_id=other_course.pk,
        title="Private foreign draft",
        due_at=timezone.now() + timedelta(days=2),
        created_by=other_teacher,
    )
    response = _auth_client(teacher_owner).post(
        f"/api/v1/courses/{course.pk}/assignments/{foreign.pk}/{action}", {}, format="json"
    )
    assert response.status_code == 404
    foreign.refresh_from_db()
    assert foreign.status == AssignmentStatus.DRAFT


@pytest.mark.django_db
@pytest.mark.parametrize("action", ["close", "reopen"])
def test_acceptance_draft_transition_cannot_publish_without_snapshot(course, teacher_owner, action):
    from assignments.services import create_assignment

    assignment = create_assignment(
        course_id=course.pk,
        title="Private draft",
        due_at=timezone.now() + timedelta(days=2),
        created_by=teacher_owner,
    )
    response = _auth_client(teacher_owner).post(
        f"/api/v1/courses/{course.pk}/assignments/{assignment.pk}/{action}", {}, format="json"
    )
    assert response.status_code == 400
    assignment.refresh_from_db()
    assert assignment.status == AssignmentStatus.DRAFT and assignment.published_at is None
    assert not assignment.publication_snapshots.exists()


@pytest.mark.django_db
def test_acceptance_archived_draft_is_not_visible_to_enrolled_student(
    course, teacher_owner, student_member
):
    from assignments.services import archive_assignment, create_assignment
    from courses.models import Membership

    Membership.objects.create(
        course=course, student=student_member, status=Membership.Status.ACTIVE
    )
    assignment = create_assignment(
        course_id=course.pk,
        title="Archived private draft",
        due_at=timezone.now() + timedelta(days=2),
        created_by=teacher_owner,
    )
    archive_assignment(assignment_id=assignment.pk, actor=teacher_owner)
    client = _auth_client(student_member)
    assert client.get(f"/api/v1/assignments/{assignment.pk}").status_code == 403
    response = client.get(f"/api/v1/courses/{course.pk}/published-assignments")
    assert response.status_code == 200 and response.data["items"] == []


@pytest.mark.django_db
def test_acceptance_assignment_mutation_requires_real_session_csrf(course, teacher_owner):
    from django.test import Client

    from assignments.services import create_assignment
    from identity.services.sessions import issue_session

    assignment = create_assignment(
        course_id=course.pk,
        title="CSRF draft",
        due_at=timezone.now() + timedelta(days=2),
        created_by=teacher_owner,
    )
    client = Client(enforce_csrf_checks=True)
    raw, _ = issue_session(user_id=teacher_owner.pk)
    client.cookies[settings.SESSION_COOKIE_NAME] = raw
    client.get("/api/v1/auth/csrf")
    url = f"/api/v1/courses/{course.pk}/assignments/{assignment.pk}"
    assert (
        client.patch(url, data='{"title":"Denied"}', content_type="application/json").status_code
        == 403
    )
    assert (
        client.patch(
            url,
            data='{"title":"Allowed"}',
            content_type="application/json",
            HTTP_X_CSRFTOKEN=client.cookies["csrftoken"].value,
        ).status_code
        == 200
    )
