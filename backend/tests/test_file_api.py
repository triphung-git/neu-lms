import hashlib
import itertools
import json
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.conf import settings
from django.test import Client
from django.utils import timezone
from rest_framework import status

from courses.models import Course, Membership
from files.constants import (
    DEFAULT_ALLOWED_EXTENSIONS,
    SYSTEM_MAX_FILE_SIZE_BYTES,
)
from files.models import CourseFilePolicy, FilePurpose, FileStatus, StoredFile
from files.scanner import ClamAVSocketScanner
from files.services import (
    abort_upload_intent,
    commit_upload,
    create_upload_intent,
    receive_upload,
    scan_stored_file,
)
from files.storage import get_storage
from identity.models import Role, RoleGrant, RoleRequest
from identity.services.accounts import confirm_email, create_account
from identity.services.sessions import issue_session
from platform_core.errors import DomainError

_counter = itertools.count(200)


@pytest.fixture
def make_user():
    def _create(role=None, verified=True):
        idx = next(_counter)
        email = f"file_api_{idx}@example.edu.vn"
        user = create_account(
            email=email,
            password="SafeFilePassword!2026",
            display_name=f"File User {idx}",
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
                review_reason="file_api_test",
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


@pytest.fixture
def test_setup(make_user):
    teacher = make_user(Role.TEACHER)
    other_teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)
    other_student = make_user(Role.STUDENT)
    admin = make_user(Role.ADMIN)

    course = Course.objects.create(
        code=f"FILE-{uuid.uuid4().hex[:6]}",
        name="Quản trị hệ thống và Tệp tin",
        term="HK1-2026",
        teacher=teacher,
        enrollment_open=True,
    )
    policy = CourseFilePolicy.objects.create(
        course=course,
        max_file_size_bytes=10 * 1024 * 1024,
        max_files_per_assignment=5,
        course_quota_bytes=50 * 1024 * 1024,
        allowed_extensions=list(DEFAULT_ALLOWED_EXTENSIONS),
        preview_allowed=True,
    )
    membership = Membership.objects.create(
        course=course,
        student=student,
        status=Membership.Status.ACTIVE,
    )

    return {
        "teacher": teacher,
        "other_teacher": other_teacher,
        "student": student,
        "other_student": other_student,
        "admin": admin,
        "course": course,
        "policy": policy,
        "membership": membership,
    }


@pytest.mark.django_db
class TestFilePolicyAPI:
    def test_get_file_policy(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        student = test_setup["student"]
        other_student = test_setup["other_student"]
        course = test_setup["course"]

        # Teacher accesses
        c_teacher = api_client(teacher)
        res = c_teacher.api_request("get", f"/api/v1/courses/{course.id}/file-policy")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["course_id"] == str(course.id)
        assert data["preview_allowed"] is True
        assert data["max_files_per_assignment"] == 5

        # Active member student accesses
        c_student = api_client(student)
        res_st = c_student.api_request("get", f"/api/v1/courses/{course.id}/file-policy")
        assert res_st.status_code == status.HTTP_200_OK

        # Non-member student forbidden
        c_other = api_client(other_student)
        res_other = c_other.api_request("get", f"/api/v1/courses/{course.id}/file-policy")
        assert res_other.status_code == status.HTTP_403_FORBIDDEN

    def test_patch_file_policy(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        other_teacher = test_setup["other_teacher"]
        student = test_setup["student"]
        course = test_setup["course"]

        c_teacher = api_client(teacher)
        res = c_teacher.api_request(
            "patch",
            f"/api/v1/courses/{course.id}/file-policy",
            {
                "preview_allowed": False,
                "max_file_size_bytes": 15 * 1024 * 1024,
                "max_files_per_assignment": 8,
                "allowed_extensions": ["pdf", "docx"],
            },
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["preview_allowed"] is False
        assert data["max_file_size_bytes"] == 15 * 1024 * 1024
        assert data["allowed_extensions"] == ["pdf", "docx"]

        # Student cannot patch
        c_student = api_client(student)
        res_st = c_student.api_request(
            "patch",
            f"/api/v1/courses/{course.id}/file-policy",
            {"preview_allowed": True},
        )
        assert res_st.status_code == status.HTTP_403_FORBIDDEN

        # Other teacher cannot patch
        c_other_t = api_client(other_teacher)
        res_ot = c_other_t.api_request(
            "patch",
            f"/api/v1/courses/{course.id}/file-policy",
            {"preview_allowed": True},
        )
        assert res_ot.status_code == status.HTTP_403_FORBIDDEN

    def test_patch_file_policy_validation_ceilings(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        c = api_client(teacher)

        # Exceeding system ceiling (50MB)
        res = c.api_request(
            "patch",
            f"/api/v1/courses/{course.id}/file-policy",
            {"max_file_size_bytes": SYSTEM_MAX_FILE_SIZE_BYTES + 1024},
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST

        # Max files per assignment invalid
        res_invalid = c.api_request(
            "patch",
            f"/api/v1/courses/{course.id}/file-policy",
            {"max_files_per_assignment": 15},
        )
        assert res_invalid.status_code == status.HTTP_400_BAD_REQUEST

    def test_patch_file_policy_archived_course(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        course.status = Course.Status.ARCHIVED
        course.archived_at = timezone.now()
        course.save(update_fields=["status", "archived_at"])

        c = api_client(teacher)
        res = c.api_request(
            "patch",
            f"/api/v1/courses/{course.id}/file-policy",
            {"preview_allowed": False},
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestFileUploadAndDownloadAPI:
    def test_upload_commit_and_download_flow(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        student = test_setup["student"]
        other_student = test_setup["other_student"]
        course = test_setup["course"]

        c_teacher = api_client(teacher)

        # 1. Teacher creates upload intent
        pdf_content = b"%PDF-1.4\nLecture Material for Class\n%%EOF"
        res_intent = c_teacher.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/upload-intent",
            {
                "file_name": "bai_giang_1.pdf",
                "file_size": len(pdf_content),
                "purpose": "course_material",
            },
        )
        assert res_intent.status_code == status.HTTP_201_CREATED
        intent_data = res_intent.json()
        file_id = intent_data["file_id"]
        storage_path = intent_data["storage_path"]

        # 2. Save physical file to storage
        storage = get_storage()
        storage.save(storage_path, pdf_content)

        # 3. Commit upload -> automatically triggers scan -> status becomes CLEAN
        res_commit = c_teacher.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/{file_id}/commit",
            {"client_checksum": hashlib.sha256(pdf_content).hexdigest()},
        )
        assert res_commit.status_code == status.HTTP_200_OK
        commit_data = res_commit.json()
        assert commit_data["status"] == "scanning"
        assert scan_stored_file(file_id=file_id).status == FileStatus.CLEAN

        # 4. Teacher downloads successfully
        res_dl_teacher = c_teacher.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{file_id}/download",
        )
        assert res_dl_teacher.status_code == status.HTTP_200_OK
        assert "attachment" in res_dl_teacher["Content-Disposition"]
        assert res_dl_teacher.content == pdf_content

        # 5. Student cannot download because file is not published yet (clean != published)
        c_student = api_client(student)
        res_dl_unpub = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{file_id}/download",
        )
        assert res_dl_unpub.status_code == status.HTTP_403_FORBIDDEN

        # 6. Teacher publishes file
        res_pub = c_teacher.api_request(
            "patch",
            f"/api/v1/courses/{course.id}/files/{file_id}",
            {"is_published": True},
        )
        assert res_pub.status_code == status.HTTP_200_OK
        assert res_pub.json()["is_published"] is True

        # 7. Student can now download published file
        res_dl_student = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{file_id}/download",
        )
        assert res_dl_student.status_code == status.HTTP_200_OK
        assert res_dl_student.content == pdf_content

        # 8. Student preview
        res_preview = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{file_id}/preview",
        )
        assert res_preview.status_code == status.HTTP_200_OK
        assert "inline" in res_preview["Content-Disposition"]
        assert res_preview["X-Content-Type-Options"] == "nosniff"

        # 9. Teacher disables preview
        c_teacher.api_request(
            "patch",
            f"/api/v1/courses/{course.id}/file-policy",
            {"preview_allowed": False},
        )
        res_preview_disabled = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{file_id}/preview",
        )
        assert res_preview_disabled.status_code == status.HTTP_403_FORBIDDEN

        # 10. Non-member student forbidden
        c_other = api_client(other_student)
        res_other = c_other.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{file_id}/download",
        )
        assert res_other.status_code == status.HTTP_403_FORBIDDEN

    def test_download_infected_or_scanning_file_blocked(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        c_teacher = api_client(teacher)

        # Upload infected file
        pe_content = b"MZ\x90\x00malicious binary content"
        res_intent = c_teacher.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/upload-intent",
            {
                "file_name": "trojan.pdf",
                "file_size": len(pe_content),
                "purpose": "course_material",
            },
        )
        file_id = res_intent.json()["file_id"]
        get_storage().save(res_intent.json()["storage_path"], pe_content)

        # Commit triggers scan -> status becomes infected
        res_commit = c_teacher.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/{file_id}/commit",
        )
        assert res_commit.json()["status"] == "scanning"
        assert scan_stored_file(file_id=file_id).status == FileStatus.INFECTED

        # Download MUST be blocked
        res_dl = c_teacher.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{file_id}/download",
        )
        assert res_dl.status_code == status.HTTP_403_FORBIDDEN

    def test_student_submission_upload_requires_assignment_scope(self, api_client, test_setup):
        student, course = test_setup["student"], test_setup["course"]
        client = api_client(student)
        response = client.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/upload-intent",
            {"file_name": "submission.pdf", "file_size": 100, "purpose": "assignment_submission"},
        )
        assert response.status_code == 403
        assert not StoredFile.objects.filter(course=course).exists()

    def test_withdrawn_student_loses_download_access(self, api_client, test_setup):
        student = test_setup["student"]
        course = test_setup["course"]
        membership = test_setup["membership"]

        # Prepare clean, published course material
        stored_file = StoredFile.objects.create(
            course=course,
            uploader=test_setup["teacher"],
            file_name="material.pdf",
            file_size=1000,
            storage_path="active/material.pdf",
            status=FileStatus.CLEAN,
            purpose=FilePurpose.COURSE_MATERIAL,
            is_published=True,
        )
        get_storage().save("active/material.pdf", b"%PDF-1.4\nClean Content\n%%EOF")

        c_student = api_client(student)
        stored_file.sha256_hash = hashlib.sha256(
            get_storage().read(stored_file.storage_path)
        ).hexdigest()
        stored_file.file_size = get_storage().size(stored_file.storage_path)
        stored_file.save(update_fields=["sha256_hash", "file_size"])
        res_active = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{stored_file.id}/download",
        )
        assert res_active.status_code == status.HTTP_200_OK

        # Student withdraws from course
        membership.status = Membership.Status.WITHDRAWN
        membership.save(update_fields=["status"])

        # Immediately loses access
        res_withdrawn = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{stored_file.id}/download",
        )
        assert res_withdrawn.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_admin_and_unscoped_student_cannot_upload_or_manage_policy(api_client, test_setup):
    c = test_setup["course"]
    for role in ("admin", "student"):
        client = api_client(test_setup[role])
        assert (
            client.api_request(
                "post",
                f"/api/v1/courses/{c.id}/files/upload-intent",
                {"file_name": "test.pdf", "file_size": 10},
            ).status_code
            == 403
        )
        assert (
            client.api_request(
                "patch", f"/api/v1/courses/{c.id}/file-policy", {"preview_allowed": False}
            ).status_code
            == 403
        )


@pytest.mark.django_db
def test_real_content_size_checksum_replay_and_delete_are_atomic(api_client, test_setup):
    owner, c = test_setup["teacher"], test_setup["course"]
    client = api_client(owner)
    data = b"%PDF-1.4 genuine bytes"
    intent = create_upload_intent(
        actor=owner, course_id=c.id, file_name="test.pdf", file_size=len(data)
    )
    file_id = intent["file_id"]
    url = f"/api/v1/courses/{c.id}/files/{file_id}/content"
    assert client.put(url, data=data, content_type="application/octet-stream").status_code == 403
    assert (
        client.put(
            url,
            data=data + b"bad",
            content_type="application/octet-stream",
            HTTP_X_CSRFTOKEN=client.csrf_token,
        ).status_code
        == 400
    )
    assert (
        client.put(
            url,
            data=data,
            content_type="application/octet-stream",
            HTTP_X_CSRFTOKEN=client.csrf_token,
        ).status_code
        == 204
    )
    with pytest.raises(DomainError):
        commit_upload(actor=owner, file_id=file_id, client_checksum="wrong")
    policy = CourseFilePolicy.objects.get(course=c)
    assert policy.reserved_quota_bytes == len(data) and policy.used_quota_bytes == 0
    file = commit_upload(
        actor=owner, file_id=file_id, client_checksum=hashlib.sha256(data).hexdigest()
    )
    assert commit_upload(actor=owner, file_id=file_id).id == file.id
    scan_stored_file(file_id=file_id)
    assert (
        client.api_request(
            "patch", f"/api/v1/courses/{c.id}/file-policy", {"course_quota_bytes": 1}
        ).status_code
        == 400
    )
    abort_upload_intent(actor=owner, file_id=file_id)
    abort_upload_intent(actor=owner, file_id=file_id)
    policy.refresh_from_db()
    assert policy.used_quota_bytes == policy.reserved_quota_bytes == 0


@pytest.mark.django_db
def test_expired_intent_and_archived_commit_fail_closed(test_setup):
    owner, c = test_setup["teacher"], test_setup["course"]
    data = b"%PDF-1.4 test"
    intent = create_upload_intent(
        actor=owner, course_id=c.id, file_name="expiry.pdf", file_size=len(data)
    )
    receive_upload(actor=owner, file_id=intent["file_id"], content=data)
    StoredFile.objects.filter(pk=intent["file_id"]).update(
        expires_at=timezone.now() - timedelta(seconds=1)
    )
    with pytest.raises(DomainError):
        commit_upload(actor=owner, file_id=intent["file_id"])
    c.status = "archived"
    c.archived_at = timezone.now()
    c.save()
    with pytest.raises(DomainError):
        commit_upload(actor=owner, file_id=intent["file_id"])


@pytest.mark.django_db
def test_integrity_tampering_never_grants_clean_or_download(api_client, test_setup):
    owner, c = test_setup["teacher"], test_setup["course"]
    data = b"%PDF-1.4 original"
    intent = create_upload_intent(
        actor=owner, course_id=c.id, file_name="tamper.pdf", file_size=len(data)
    )
    receive_upload(actor=owner, file_id=intent["file_id"], content=data)
    item = commit_upload(actor=owner, file_id=intent["file_id"])
    storage = get_storage()
    with pytest.raises(ValueError):
        storage.save(item.storage_path, b"replaced")
    # Simulate an out-of-band storage mutation; scanner and delivery verify the bound hash.
    storage._resolve(item.storage_path).write_bytes(b"x" * len(data))
    with pytest.raises(ValueError):
        scan_stored_file(file_id=item.id)
    item.refresh_from_db()
    assert item.status == FileStatus.SCANNING
    assert (
        api_client(owner).get(f"/api/v1/courses/{c.id}/files/{item.id}/download").status_code == 403
    )


def test_clamav_connection_failure_is_not_a_clean_verdict():
    with patch("files.scanner.socket.socket") as socket:
        socket.return_value.__enter__.return_value.connect.side_effect = OSError("unavailable")
        with pytest.raises(OSError):
            ClamAVSocketScanner().scan(b"%PDF-1.4 safe", "safe.pdf")
