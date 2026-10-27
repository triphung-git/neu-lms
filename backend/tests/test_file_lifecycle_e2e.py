import itertools
import json
import uuid

import pytest
from django.conf import settings
from django.test import Client
from django.utils import timezone
from rest_framework import status

from courses.models import Course, Membership
from files.models import CourseFilePolicy, FilePurpose, FileStatus, StoredFile
from files.scanner import ELF_MAGIC
from files.services import commit_upload, scan_stored_file
from files.storage import get_storage
from identity.models import Role, RoleGrant, RoleRequest
from identity.services.accounts import confirm_email, create_account
from identity.services.sessions import issue_session

_counter = itertools.count(700)


@pytest.fixture
def make_user():
    def _create(role=None, verified=True):
        idx = next(_counter)
        email = f"e2e_user_{idx}@example.edu.vn"
        user = create_account(
            email=email,
            password="E2eSafePassword!2026",
            display_name=f"E2E User {idx}",
        )
        if verified:
            confirm_email(user_id=user.id, expected_email=email)

        if role == Role.ADMIN:
            req = None
        elif role:
            req = RoleRequest.objects.create(
                user=user,
                role=role,
                status=RoleRequest.Status.APPROVED,
                reviewed_by=user,
                reviewed_at=timezone.now(),
                review_reason="e2e_integration_test",
            )
        else:
            req = None

        if role:
            RoleGrant.objects.create(
                user=user,
                role=role,
                grant_source={
                    Role.STUDENT: "verified_student_email",
                    Role.TEACHER: "teacher_approval",
                    Role.ADMIN: "internal_administration",
                }[role],
                source_request=None if role == Role.ADMIN else req,
                granted_by=None if role == Role.STUDENT else user,
            )
        return user

    return _create


@pytest.fixture
def api_client():
    def _create(user=None):
        client = Client(enforce_csrf_checks=True)
        client.get("/api/v1/auth/csrf")
        client.csrf_token = client.cookies["csrftoken"].value
        if user:
            raw_key, _ = issue_session(user_id=user.id)
            client.cookies[settings.SESSION_COOKIE_NAME] = raw_key

        def request(method, url, data=None):
            kwargs = {"HTTP_X_CSRFTOKEN": client.csrf_token}
            if data is not None:
                kwargs.update({"data": json.dumps(data), "content_type": "application/json"})
            return getattr(client, method)(url, **kwargs)

        client.api_request = request
        return client

    return _create


@pytest.mark.django_db(transaction=True)
def test_b08_full_lifecycle_and_security_integration(make_user, api_client):
    """
    Nghiệm thu toàn diện chuỗi B08-01 đến B08-06 trên PostgreSQL thật:
    1. Giảng viên cấu hình file policy (allowlist PDF/DOCX, max 20MB, quota 500MB, preview=False).
    2. Thử cấu hình vượt trần hệ thống (60MB > 50MB) -> Bị chặn 400 Bad Request.
    3. Sinh viên upload file PDF 5MB -> Quota môn học giữ chỗ nguyên tử.
    4. Thử tải về hoặc xem trước khi đang quarantine/scanning -> Bị chặn 403 Forbidden.
    5. Kích hoạt worker quét -> Trạng thái clean. Tệp được phép tải về.
    6. Xem trước bị chặn 403 Forbidden vì preview_allowed=False.
    7. Giảng viên bật lại preview_allowed=True -> Xem trước hoạt động bình thường (200 OK inline).
    8. Upload file virus EICAR -> Worker quét phát hiện infected, cách ly, hoàn trả quota.
    9. Sinh viên rút môn -> Quyền tải tệp học liệu bị thu hồi lập tức (403 Forbidden).
    10. Môn học lưu trữ (archived) -> Khóa mọi thao tác tải lên và sửa policy.
    """
    teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)

    teacher_client = api_client(teacher)
    student_client = api_client(student)

    # Khởi tạo môn học
    course = Course.objects.create(
        code=f"CS-{uuid.uuid4().hex[:6]}",
        name="Lập trình Nâng cao & Kho Tệp",
        term="HK1-2026",
        teacher=teacher,
        enrollment_open=True,
    )
    CourseFilePolicy.objects.create(
        course=course,
        allowed_extensions=["pdf", "docx"],
        max_file_size_bytes=20 * 1024 * 1024,
        max_files_per_assignment=5,
        course_quota_bytes=500 * 1024 * 1024,
        preview_allowed=True,
    )

    # Ghi danh sinh viên vào môn học
    Membership.objects.create(
        student=student,
        course=course,
        status=Membership.Status.ACTIVE,
    )

    storage = get_storage()

    # --------------------------------------------------------------------------
    # 1. Giảng viên cấu hình file policy (PDF/DOCX, max 20MB, quota 500MB, preview=False)
    # --------------------------------------------------------------------------
    resp = teacher_client.api_request(
        "patch",
        f"/api/v1/courses/{course.id}/file-policy",
        {
            "allowed_extensions": ["pdf", "docx"],
            "max_file_size_bytes": 20 * 1024 * 1024,
            "course_quota_bytes": 500 * 1024 * 1024,
            "preview_allowed": False,
        },
    )
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["preview_allowed"] is False
    assert resp.json()["max_file_size_bytes"] == 20 * 1024 * 1024

    # --------------------------------------------------------------------------
    # 2. Thử cấu hình vượt trần hệ thống (60MB > trần hệ thống 50MB) -> Bị chặn 400
    # --------------------------------------------------------------------------
    resp_over_ceiling = teacher_client.api_request(
        "patch",
        f"/api/v1/courses/{course.id}/file-policy",
        {"max_file_size_bytes": 60 * 1024 * 1024},
    )
    assert resp_over_ceiling.status_code == status.HTTP_400_BAD_REQUEST

    # --------------------------------------------------------------------------
    # 3. Sinh viên upload file PDF 5MB (Upload Intent & Atomic Quota Reservation)
    # --------------------------------------------------------------------------
    pdf_content = b"%PDF-1.4\n" + b"E2E Integration Test Document Content\n" * 150000
    actual_pdf_size = len(pdf_content)

    resp_intent = teacher_client.api_request(
        "post",
        f"/api/v1/courses/{course.id}/files/upload-intent",
        {
            "file_name": "bai-tap-chuong-1.pdf",
            "file_size": actual_pdf_size,
            "purpose": FilePurpose.COURSE_MATERIAL,
        },
    )
    assert resp_intent.status_code == status.HTTP_201_CREATED
    file_id = resp_intent.json()["file_id"]

    # Kiểm tra quota giữ chỗ tạm thời
    policy = CourseFilePolicy.objects.get(course=course)
    assert policy.reserved_quota_bytes == actual_pdf_size
    assert policy.used_quota_bytes == 0

    # --------------------------------------------------------------------------
    # 4. Thử tải về hoặc xem trước khi đang quarantine/scanning -> Bị chặn 403 Forbidden
    # --------------------------------------------------------------------------
    resp_dl_pending = student_client.get(f"/api/v1/courses/{course.id}/files/{file_id}/download")
    assert resp_dl_pending.status_code == status.HTTP_403_FORBIDDEN

    # Mô phỏng client upload tệp lên storage quarantine và commit qua service (chưa scan)
    stored_file = StoredFile.objects.get(id=file_id)
    storage.save(stored_file.storage_path, pdf_content)

    committed = commit_upload(
        actor=teacher,
        file_id=stored_file.id,
        client_checksum=stored_file.sha256_hash,
    )
    assert committed.status == FileStatus.SCANNING

    # Quota chuyển từ reserved sang used
    policy.refresh_from_db()
    assert policy.reserved_quota_bytes == 0
    assert policy.used_quota_bytes == actual_pdf_size

    # Thử tải về hoặc xem trước khi đang SCANNING -> Bị chặn 403 Forbidden
    resp_dl_scanning = student_client.get(f"/api/v1/courses/{course.id}/files/{file_id}/download")
    assert resp_dl_scanning.status_code == status.HTTP_403_FORBIDDEN
    assert resp_dl_scanning.json()["error"]["code"] == "permission_denied"

    resp_pv_scanning = student_client.get(f"/api/v1/courses/{course.id}/files/{file_id}/preview")
    assert resp_pv_scanning.status_code == status.HTTP_403_FORBIDDEN
    assert resp_pv_scanning.json()["error"]["code"] == "permission_denied"

    # --------------------------------------------------------------------------
    # 5. Kích hoạt worker quét -> Trạng thái CLEAN, tệp được phép tải về
    # --------------------------------------------------------------------------
    scan_stored_file(file_id=stored_file.id)
    stored_file.refresh_from_db()
    assert stored_file.status == FileStatus.CLEAN
    assert storage.exists(stored_file.storage_path)

    # Sinh viên (uploader) tải về thành công
    teacher_client.api_request(
        "patch", f"/api/v1/courses/{course.id}/files/{file_id}", {"is_published": True}
    )
    resp_dl_clean = student_client.get(f"/api/v1/courses/{course.id}/files/{file_id}/download")
    assert resp_dl_clean.status_code == status.HTTP_200_OK
    assert resp_dl_clean.headers["Content-Disposition"].startswith("attachment;")

    # --------------------------------------------------------------------------
    # 6. Xem trước bị chặn 403 Forbidden vì preview_allowed=False
    # --------------------------------------------------------------------------
    resp_pv_disabled = student_client.get(f"/api/v1/courses/{course.id}/files/{file_id}/preview")
    assert resp_pv_disabled.status_code == status.HTTP_403_FORBIDDEN
    assert resp_pv_disabled.json()["error"]["code"] == "permission_denied"

    # --------------------------------------------------------------------------
    # 7. Giảng viên bật lại preview_allowed=True -> Xem trước hoạt động bình thường
    # --------------------------------------------------------------------------
    teacher_client.api_request(
        "patch",
        f"/api/v1/courses/{course.id}/file-policy",
        {"preview_allowed": True},
    )

    resp_pv_enabled = student_client.get(f"/api/v1/courses/{course.id}/files/{file_id}/preview")
    assert resp_pv_enabled.status_code == status.HTTP_200_OK
    assert "inline;" in resp_pv_enabled.headers["Content-Disposition"]

    # --------------------------------------------------------------------------
    # 8. Upload file mã độc (ngụy trang ELF) -> Worker phát hiện INFECTED, hoàn quota
    # --------------------------------------------------------------------------
    malware_bytes = ELF_MAGIC + b"\x02\x01\x01\x00" * 32
    malware_size = len(malware_bytes)

    resp_malware_intent = teacher_client.api_request(
        "post",
        f"/api/v1/courses/{course.id}/files/upload-intent",
        {
            "file_name": "malware_test.pdf",
            "file_size": malware_size,
            "purpose": FilePurpose.COURSE_MATERIAL,
        },
    )
    malware_file_id = resp_malware_intent.json()["file_id"]
    malware_stored_file = StoredFile.objects.get(id=malware_file_id)

    storage.save(malware_stored_file.storage_path, malware_bytes)
    resp_commit_malware = teacher_client.api_request(
        "post",
        f"/api/v1/courses/{course.id}/files/{malware_file_id}/commit",
        {"client_checksum": malware_stored_file.sha256_hash},
    )
    assert resp_commit_malware.status_code == status.HTTP_200_OK
    assert resp_commit_malware.json()["status"] == FileStatus.SCANNING
    scan_stored_file(file_id=malware_file_id)

    # File bị chuyển trạng thái INFECTED và xóa khỏi storage
    malware_stored_file.refresh_from_db()
    assert malware_stored_file.status == FileStatus.INFECTED
    assert not storage.exists(malware_stored_file.storage_path)

    # Quota được hoàn lại (used_quota_bytes giảm về đúng actual_pdf_size)
    policy.refresh_from_db()
    assert policy.used_quota_bytes == actual_pdf_size

    # --------------------------------------------------------------------------
    # 9. Giảng viên tạo học liệu, công bố -> Sinh viên rút môn -> Thu hồi quyền tải ngay lập tức
    # --------------------------------------------------------------------------
    mat_content = b"%PDF-1.4\nLecture Material Content\n"
    resp_mat_intent = teacher_client.api_request(
        "post",
        f"/api/v1/courses/{course.id}/files/upload-intent",
        {
            "file_name": "bai-giang-chuong-1.pdf",
            "file_size": len(mat_content),
            "purpose": FilePurpose.COURSE_MATERIAL,
        },
    )
    mat_id = resp_mat_intent.json()["file_id"]
    mat_stored_file = StoredFile.objects.get(id=mat_id)
    storage.save(mat_stored_file.storage_path, mat_content)
    resp_mat_commit = teacher_client.api_request(
        "post",
        f"/api/v1/courses/{course.id}/files/{mat_id}/commit",
        {"client_checksum": mat_stored_file.sha256_hash},
    )
    assert resp_mat_commit.status_code == status.HTTP_200_OK
    scan_stored_file(file_id=mat_id)
    mat_stored_file.refresh_from_db()
    assert mat_stored_file.status == FileStatus.CLEAN

    # Giảng viên công bố học liệu (clean != published)
    teacher_client.api_request(
        "patch",
        f"/api/v1/courses/{course.id}/files/{mat_id}",
        {"is_published": True},
    )

    # Sinh viên khi còn là active member thì tải được học liệu
    resp_stud_dl = student_client.get(f"/api/v1/courses/{course.id}/files/{mat_id}/download")
    assert resp_stud_dl.status_code == status.HTTP_200_OK

    # Sinh viên rút khỏi môn học (status = WITHDRAWN)
    membership = Membership.objects.get(student=student, course=course)
    membership.status = Membership.Status.WITHDRAWN
    membership.save()

    # Thử tải lại -> Bị thu hồi quyền lập tức (403 Forbidden)
    resp_stud_after_drop = student_client.get(
        f"/api/v1/courses/{course.id}/files/{mat_id}/download"
    )
    assert resp_stud_after_drop.status_code == status.HTTP_403_FORBIDDEN

    # --------------------------------------------------------------------------
    # 10. Môn học lưu trữ (archived) -> Khóa mọi thao tác tải lên và sửa file policy
    # --------------------------------------------------------------------------
    course.status = Course.Status.ARCHIVED
    course.archived_at = timezone.now()
    course.save()

    # Thử sửa policy -> 403 Forbidden
    resp_patch_archived = teacher_client.api_request(
        "patch",
        f"/api/v1/courses/{course.id}/file-policy",
        {"preview_allowed": False},
    )
    assert resp_patch_archived.status_code == status.HTTP_403_FORBIDDEN

    # Thử tạo upload intent mới -> 403 Forbidden
    resp_upload_archived = teacher_client.api_request(
        "post",
        f"/api/v1/courses/{course.id}/files/upload-intent",
        {
            "file_name": "tailieu-moi.pdf",
            "file_size": 1024,
            "purpose": FilePurpose.COURSE_MATERIAL,
        },
    )
    assert resp_upload_archived.status_code == status.HTTP_403_FORBIDDEN
