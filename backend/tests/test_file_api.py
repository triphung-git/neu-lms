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

from assignments.models import Assignment
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

    @pytest.mark.parametrize("close_before_commit", [False, True])
    def test_scoped_submission_upload(self, api_client, test_setup, close_before_commit):
        course = test_setup["course"]
        now = timezone.now()

        assignment = Assignment.objects.create(
            course=course,
            created_by=test_setup["teacher"],
            title="Bài thực hành",
            status=Assignment.Status.PUBLISHED,
            published_at=now,
            due_at=now + timedelta(days=1),
        )

        owner = api_client(test_setup["student"])
        other = api_client(test_setup["other_student"])
        Membership.objects.create(course=course, student=test_setup["other_student"])

        content = b"%PDF-1.4 test"
        base = f"/api/v1/courses/{course.id}/files"

        intent = owner.api_request(
            "post",
            f"{base}/upload-intent",
            {
                "purpose": "assignment_submission",
                "assignment_id": str(assignment.id),
                "file_name": "answer.pdf",
                "file_size": len(content),
            },
        )
        assert intent.status_code == 201

        item = StoredFile.objects.get(pk=intent.json()["file_id"])
        assert item.policy_snapshot["assignment_id"] == str(assignment.id)
        url = f"{base}/{item.id}"

        for client, expected in [(other, 403), (owner, 204)]:
            response = client.put(
                f"{url}/content",
                data=content,
                content_type="application/octet-stream",
                HTTP_X_CSRFTOKEN=client.csrf_token,
            )
            assert response.status_code == expected

        if close_before_commit:
            assignment.status = Assignment.Status.CLOSED
            assignment.save()

            assert owner.api_request("post", f"{url}/commit").status_code == 403
            item.refresh_from_db()
            assert item.status == FileStatus.QUARANTINE_PENDING
            return

        assert owner.api_request("post", f"{url}/commit").json()["status"] == "scanning"
        assert owner.get(url).json()["status"] == "scanning"
        assert owner.get(f"{url}/download").status_code == 403

        submit_url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}/submissions"
        payload = {"file_id": str(item.id)}

        # Tệp đang quét: chưa được ghi nhận là đã nộp.
        assert owner.api_request("post", submit_url, payload).status_code == 400

        assert scan_stored_file(file_id=item.id).status == FileStatus.CLEAN

        # Xác nhận lần đầu: tạo biên nhận số 1.
        first = owner.api_request("post", submit_url, payload)
        assert first.status_code == 201
        assert first.json()["number"] == 1
        assert first.json()["is_late"] is False

        # Gửi lại cùng yêu cầu: vẫn là biên nhận ban đầu.
        retry = owner.api_request("post", submit_url, payload)
        assert retry.status_code == 200
        assert retry.json() == first.json()

        teacher_url = f"/api/v1/assignments/{assignment.id}/submissions"
        teacher = api_client(test_setup["teacher"])

        listing = teacher.get(teacher_url)
        assert listing.status_code == 200, listing.content.decode()
        assert listing.json()["pagination"]["total_items"] == 1
        assert listing.json()["items"][0]["file_id"] == str(item.id)

        download = teacher.get(f"{url}/download")
        assert download.status_code == 200
        assert download.content == content

        assert owner.get(teacher_url).status_code == 403
        foreign_teacher = api_client(test_setup["other_teacher"])
        assert foreign_teacher.get(teacher_url).status_code == 403

        receipt_url = f"/api/v1/assignments/{assignment.id}/eligibility"

        # Sinh viên khác cùng lớp chưa nộp nên không có biên nhận.
        assert other.get(receipt_url).json()["latest_submission"] is None

        # Đóng bài rồi mở lại: chủ bài nộp vẫn đọc được biên nhận cũ.
        assignment.status = Assignment.Status.CLOSED
        assignment.save()

        response = owner.get(receipt_url)
        assert response.status_code == 200, response.content.decode()
        state = response.json()
        assert state["can_submit"] is False
        assert state["latest_submission"]["id"] == first.json()["id"]
        assert state["latest_submission"]["file_name"] == "answer.pdf"

        # Sinh viên khác không thể dùng file_id này để nộp bài.
        assert other.api_request("post", submit_url, payload).status_code == 404
        assert owner.get(f"{url}/download").content == content
        assert other.get(f"{url}/download").status_code == 403

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


@pytest.mark.django_db
def test_submission_intake_is_authorized_clean_and_idempotent(api_client, test_setup):
    from assignments.models import AssignmentFilePolicy, SubmissionRevision

    course = test_setup["course"]
    student = test_setup["student"]
    now = timezone.now()
    assignment = Assignment.objects.create(
        course=course,
        created_by=test_setup["teacher"],
        title="Bài nộp B11",
        status=Assignment.Status.PUBLISHED,
        published_at=now,
        due_at=now + timedelta(days=1),
    )
    AssignmentFilePolicy.objects.create(
        assignment=assignment,
        max_files_per_submission=1,
        max_file_size_bytes=1024 * 1024,
        allowed_extensions=["pdf"],
    )

    clean_file = StoredFile.objects.create(
        course=course,
        uploader=student,
        file_name="answer.pdf",
        file_size=1024,
        mime_type="application/pdf",
        storage_path=f"tests/{uuid.uuid4()}.pdf",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.ASSIGNMENT_SUBMISSION,
        policy_snapshot={"assignment_id": str(assignment.id)},
    )
    pending_file = StoredFile.objects.create(
        course=course,
        uploader=student,
        file_name="pending.pdf",
        file_size=1024,
        mime_type="application/pdf",
        storage_path=f"tests/{uuid.uuid4()}.pdf",
        status=FileStatus.QUARANTINE_PENDING,
        purpose=FilePurpose.ASSIGNMENT_SUBMISSION,
        policy_snapshot={"assignment_id": str(assignment.id)},
    )

    url = f"/api/v1/courses/{course.id}/assignments/{assignment.id}/submissions"
    student_client = api_client(student)
    teacher_client = api_client(test_setup["teacher"])
    other_student_client = api_client(test_setup["other_student"])

    # Only the enrolled student may commit a submission.
    assert (
        teacher_client.api_request("post", url, {"file_id": str(clean_file.id)}).status_code
        == status.HTTP_403_FORBIDDEN
    )
    assert (
        other_student_client.api_request("post", url, {"file_id": str(clean_file.id)}).status_code
        == status.HTTP_403_FORBIDDEN
    )

    # Pending/quarantined files cannot be committed.
    pending_response = student_client.api_request("post", url, {"file_id": str(pending_file.id)})
    assert pending_response.status_code == status.HTTP_400_BAD_REQUEST
    assert SubmissionRevision.objects.filter(assignment=assignment).count() == 0

    # A clean file is committed once and a retry returns the existing receipt.
    first = student_client.api_request("post", url, {"file_id": str(clean_file.id)})
    assert first.status_code == status.HTTP_201_CREATED, first.content.decode()
    first_payload = first.json()
    assert first_payload["number"] == 1
    assert first_payload["file_id"] == str(clean_file.id)

    retry = student_client.api_request("post", url, {"file_id": str(clean_file.id)})
    assert retry.status_code == status.HTTP_200_OK, retry.content.decode()
    assert retry.json()["id"] == first_payload["id"]
    assert retry.json()["number"] == 1
    assert SubmissionRevision.objects.filter(assignment=assignment).count() == 1


@pytest.mark.django_db
def test_submission_grading_lifecycle(api_client, test_setup):
    from assignments.models import SubmissionGradeEntry, SubmissionRevision

    course = test_setup["course"]
    now = timezone.now()

    assignment = Assignment.objects.create(
        course=course,
        created_by=test_setup["teacher"],
        title="Kiểm thử chấm điểm",
        status=Assignment.Status.PUBLISHED,
        published_at=now,
        due_at=now + timedelta(days=1),
    )

    item = StoredFile.objects.create(
        course=course,
        uploader=test_setup["student"],
        file_name="answer.pdf",
        file_size=100,
        storage_path=f"tests/{uuid.uuid4()}.pdf",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.ASSIGNMENT_SUBMISSION,
        policy_snapshot={"assignment_id": str(assignment.id)},
    )

    submission = SubmissionRevision.objects.create(
        assignment=assignment,
        student=test_setup["student"],
        file=item,
        number=1,
        submitted_at=now,
        is_late=False,
    )

    Membership.objects.create(
        course=course,
        student=test_setup["other_student"],
    )

    teacher = api_client(test_setup["teacher"])
    student = api_client(test_setup["student"])
    url = f"/api/v1/submissions/{submission.id}/grade"

    def read(client):
        response = client.get(url)
        assert response.status_code == 200, response.content.decode()
        return response.json()

    def save(score, state, version, expected=201):
        response = teacher.api_request(
            "post",
            url,
            {
                "score": score,
                "feedback": f"Nhận xét {score}",
                "status": state,
                "expected_version": version,
            },
        )
        assert response.status_code == expected, response.content.decode()
        return response.json()

    # Chưa chấm: sinh viên chưa có điểm.
    assert read(student)["grade"] is None
    assert read(teacher)["total_score"] == "10.00"

    # Sinh viên khác, giảng viên khác và admin không được đọc/chấm.
    payload = {
        "score": "8.50",
        "feedback": "Không được phép",
        "status": "published",
        "expected_version": 0,
    }

    for key in ("other_student", "other_teacher", "admin"):
        client = api_client(test_setup[key])
        assert client.get(url).status_code == 403
        assert client.api_request("post", url, payload).status_code == 403

    # Chính sinh viên cũng không được tự chấm.
    assert student.api_request("post", url, payload).status_code == 403

    assert not SubmissionGradeEntry.objects.filter(
        submission=submission,
    ).exists()

    # Điểm sai không được lưu.
    for invalid_score in ("-1", "10.01", "8.555", "abc"):
        save(invalid_score, "draft", 0, expected=400)

    assert not SubmissionGradeEntry.objects.filter(
        submission=submission,
    ).exists()

    # Bản nháp chỉ giảng viên thấy.
    def pending_count():
        response = teacher.get("/api/v1/courses/summary", {"role": "teacher"})
        assert response.status_code == 200, response.content.decode()

        summary = response.json()
        total = summary["pending_submissions"]
        rows = summary["pending_assignments"]

        # Dữ liệu của test này chỉ có một sinh viên và một bài tập.
        if total == 1:
            assert len(rows) == 1
            assert rows[0]["assignment_id"] == str(assignment.pk)
            assert rows[0]["title"] == assignment.title
            assert rows[0]["course_name"] == course.name
            assert rows[0]["waiting"] == 1
        elif total == 0:
            assert rows == []

        return total

    assert pending_count() == 1
    draft = save("8.50", "draft", 0)
    assert pending_count() == 1
    assert draft["version"] == 1
    assert read(teacher)["grade"]["score"] == "8.50"
    assert read(student)["grade"] is None

    # Công bố: sinh viên thấy điểm và nhận xét.
    published = save("8.50", "published", 1)
    assert pending_count() == 0
    assert published["version"] == 2
    assert read(student)["grade"] == published

    # Phiên đăng nhập mới vẫn đọc được điểm đã lưu.
    fresh_student = api_client(test_setup["student"])
    assert read(fresh_student)["grade"] == published

    # Sửa nháp: điểm đã công bố trước đó vẫn giữ nguyên.
    save("9.00", "draft", 2)
    assert read(teacher)["grade"]["version"] == 3
    assert read(student)["grade"] == published

    # Tab dùng phiên bản cũ không được ghi đè.
    save("7.00", "published", 2, expected=409)
    assert submission.grade_entries.count() == 3
    assert read(student)["grade"] == published

    # Công bố bản mới.
    final = save("9.00", "published", 3)
    assert final["version"] == 4
    assert read(student)["grade"] == final

    # Lịch sử các lần lưu còn đầy đủ.
    history = list(
        submission.grade_entries.order_by("version").values_list(
            "status",
            flat=True,
        )
    )
    assert history == ["draft", "published", "draft", "published"]
    history_url = f"/api/v1/submissions/{submission.id}/grade-history"

    teacher_history = teacher.get(history_url)
    assert teacher_history.status_code == 200, teacher_history.content.decode()
    assert [item["version"] for item in teacher_history.json()["items"]] == [4, 3, 2, 1]

    student_history = student.get(history_url)
    assert student_history.status_code == 200, student_history.content.decode()
    assert [item["version"] for item in student_history.json()["items"]] == [4, 2]

    first_page = student.get(history_url, {"page_size": 1}).json()
    assert first_page["pagination"]["total_items"] == 2
    assert first_page["items"][0]["version"] == 4

    second_page = student.get(
        history_url,
        {"page_size": 1, "page": 2},
    ).json()
    assert second_page["items"][0]["version"] == 2

    for key in ("other_student", "other_teacher", "admin"):
        client = api_client(test_setup[key])
        assert client.get(history_url).status_code == 403

    # Sinh viên rút khỏi môn không còn quyền đọc điểm.
    membership = test_setup["membership"]
    membership.status = Membership.Status.WITHDRAWN
    membership.save(update_fields=["status"])

    assert student.get(url).status_code == 403
    assert student.get(history_url).status_code == 403


@pytest.mark.django_db
def test_teacher_gradebook_search(api_client, test_setup):
    course = test_setup["course"]
    teacher = api_client(test_setup["teacher"])
    student = test_setup["student"]
    other = test_setup["other_student"]

    # Sinh viên thứ nhất đã được ghi danh trong test_setup.
    Membership.objects.create(
        course=course,
        student=other,
        status=Membership.Status.ACTIVE,
    )

    student.display_name = "An Nguyễn"
    student.save(update_fields=["display_name"])
    other.display_name = "Quang Trần"
    other.save(update_fields=["display_name"])

    now = timezone.now()
    assignment = Assignment.objects.create(
        course=course,
        created_by=test_setup["teacher"],
        title="Bài kiểm tra bộ lọc",
        status=Assignment.Status.PUBLISHED,
        published_at=now,
        due_at=now + timedelta(days=1),
    )

    url = f"/api/v1/courses/{course.pk}/gradebook"

    def fetch(**params):
        response = teacher.get(
            url,
            {
                "assignment_id": str(assignment.pk),
                "page_size": 1,
                **params,
            },
        )
        assert response.status_code == 200, response.content.decode()
        return response.json()

    # Danh sách xếp theo tên: An ở trang 1, Quang ở trang 2.
    first_page = fetch()
    assert first_page["pagination"]["total_items"] == 2
    assert first_page["items"][0]["student_id"] == str(student.pk)
    assert fetch(page=2)["items"][0]["student_id"] == str(other.pk)

    # Tìm từ trang đầu vẫn thấy Quang: backend lọc trước khi phân trang.
    by_name = fetch(search="QUANG")
    assert by_name["pagination"]["total_items"] == 1
    assert by_name["items"][0]["student_id"] == str(other.pk)

    by_email = fetch(search=student.email.upper())
    assert by_email["pagination"]["total_items"] == 1
    assert by_email["items"][0]["student_id"] == str(student.pk)

    assert fetch(search="khong-khop-voi-ai")["items"] == []
    assert fetch(search="")["pagination"]["total_items"] == 2

    foreign_teacher = api_client(test_setup["other_teacher"])
    denied = foreign_teacher.get(url, {"search": "Quang"})
    assert denied.status_code == 403

    import csv
    import io

    export_params = {
        "assignment_id": str(assignment.pk),
        "download": "csv",
        "page_size": 1,
    }

    def read_csv(params):
        response = teacher.get(url, params)
        assert response.status_code == 200, response.content.decode()
        assert response["Content-Type"].startswith("text/csv")
        assert "attachment" in response["Content-Disposition"]
        text = response.content.decode("utf-8-sig")
        return list(csv.DictReader(io.StringIO(text)))

    # Bảng có 1 người mỗi trang, nhưng file phải có cả 2 người.
    exported = read_csv(export_params)
    assert [row["Sinh viên"] for row in exported] == ["An Nguyễn", "Quang Trần"]
    assert all(row["Trạng thái chấm"] == "Chưa nộp" for row in exported)

    # Sau khi lọc theo tên, file chỉ còn đúng người được tìm.
    filtered = read_csv({**export_params, "search": "QUANG"})
    assert [row["Email"] for row in filtered] == [other.email]

    # Giảng viên ngoài môn cũng bị chặn khi gọi trực tiếp URL xuất.
    assert foreign_teacher.get(url, export_params).status_code == 403


@pytest.mark.django_db
def test_published_rubric_after_draft_edit(api_client, test_setup):
    from decimal import Decimal

    from assignments.models import AssignmentRubricCriterion, SubmissionRevision

    course = test_setup["course"]
    owner = test_setup["student"]
    now = timezone.now()

    # Tạo rubric khi bài còn nháp, sau đó mới công bố bài tập.
    assignment = Assignment.objects.create(
        course=course,
        created_by=test_setup["teacher"],
        title="Báo cáo thực hành",
        status=Assignment.Status.DRAFT,
        due_at=now + timedelta(days=1),
    )

    content, layout = [
        AssignmentRubricCriterion.objects.create(
            assignment=assignment,
            position=position,
            title=title,
            max_score=Decimal(limit),
        )
        for position, title, limit in [
            (1, "Nội dung", "6.00"),
            (2, "Trình bày", "4.00"),
        ]
    ]

    assignment.status = Assignment.Status.PUBLISHED
    assignment.published_at = now
    assignment.save()

    file = StoredFile.objects.create(
        course=course,
        uploader=owner,
        file_name="report.pdf",
        file_size=100,
        storage_path=f"tests/{uuid.uuid4()}.pdf",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.ASSIGNMENT_SUBMISSION,
        policy_snapshot={"assignment_id": str(assignment.pk)},
    )

    submission = SubmissionRevision.objects.create(
        assignment=assignment,
        student=owner,
        file=file,
        number=1,
        submitted_at=now,
        is_late=False,
    )

    teacher = api_client(test_setup["teacher"])
    student = api_client(owner)
    url = f"/api/v1/submissions/{submission.pk}/grade"
    history_url = f"/api/v1/submissions/{submission.pk}/grade-history"

    def save(state, version, score, feedback, expected=201):
        response = teacher.api_request(
            "post",
            url,
            {
                "status": state,
                "expected_version": version,
                "feedback": feedback,
                "rubric_scores": [
                    {"criterion_id": str(layout.pk), "score": "3.50"},
                    {"criterion_id": str(content.pk), "score": score},
                ],
            },
        )
        assert response.status_code == expected, response.content.decode()
        return response.json()

    def get(client, endpoint):
        response = client.get(endpoint)
        assert response.status_code == 200, response.content.decode()
        return response.json()

    # Nội dung tối đa 6.00. Yêu cầu sai phải bị từ chối trước khi lưu.
    save("draft", 0, "6.01", "Vượt điểm", expected=400)
    assert submission.grade_entries.count() == 0

    # Gửi tiêu chí đảo thứ tự để kiểm tra điểm được ghép theo ID.
    first = save("published", 0, "5.25", "Nhận xét đã công bố")
    assert first["score"] == "8.75"
    assert [(mark["title"], mark["score"]) for mark in first["rubric_breakdown"]] == [
        ("Nội dung", "5.25"),
        ("Trình bày", "3.50"),
    ]

    # Giảng viên thấy bản nháp mới. Sinh viên vẫn thấy nguyên bản đã công bố.
    draft = save("draft", 1, "6.00", "Nhận xét đang sửa")
    assert draft["score"] == "9.50"
    assert get(teacher, url)["grade"] == draft
    assert get(student, url)["grade"] == first
    notices_url = "/api/v1/me/grade-notices"
    notices = get(student, notices_url)
    assert notices["pagination"]["total_items"] == 1
    assert notices["items"][0]["score"] == "8.75"
    assert notices["items"][0]["assignment_id"] == str(assignment.pk)
    assert notices["items"][0]["revision"] == 1
    assert get(student, history_url)["items"] == [first]

    # Sau lần công bố tiếp theo, sinh viên thấy 9.50 và xem lại được 8.75.
    final = save("published", 2, "6.00", "Nhận xét chính thức")
    assert get(student, url)["grade"] == final
    assert get(student, history_url)["items"] == [final, first]

    notices = get(student, notices_url)
    assert [item["score"] for item in notices["items"]] == ["9.50", "8.75"]

    # Cùng học một môn nhưng sinh viên khác không thấy điểm của owner.
    other_student = test_setup["other_student"]
    Membership.objects.create(
        course=course,
        student=other_student,
        status=Membership.Status.ACTIVE,
    )
    other = api_client(other_student)
    assert get(other, notices_url)["items"] == []

    unread_url = f"{notices_url}/unread"
    assert get(student, unread_url)["unread_count"] == 2

    notice_id = notices["items"][0]["id"]
    read_url = f"{notices_url}/{notice_id}/read"

    # Sinh viên khác không thể đánh dấu thông báo của chủ bài.
    assert other.api_request("post", read_url).status_code == 404
    assert get(student, unread_url)["unread_count"] == 2

    # Lần đọc đầu tiên giảm số chưa đọc và lưu thời điểm đọc.
    assert student.api_request("post", read_url).status_code == 204
    assert get(student, unread_url)["unread_count"] == 1
    read_at = get(student, notices_url)["items"][0]["read_at"]
    assert read_at is not None

    # Gửi lại cùng yêu cầu vẫn giữ thời điểm đọc lần đầu.
    assert student.api_request("post", read_url).status_code == 204
    assert get(student, notices_url)["items"][0]["read_at"] == read_at
    assert get(student, unread_url)["unread_count"] == 1

    read_all_url = f"{notices_url}/read-all"

    # Sinh viên khác bấm "đọc tất cả" chỉ tác động tới tài khoản của họ.
    other_response = other.api_request("post", read_all_url)
    assert other_response.status_code == 200, other_response.content.decode()
    assert other_response.json()["updated_count"] == 0
    assert get(student, unread_url)["unread_count"] == 1

    # Chủ bài đánh dấu nốt thông báo còn lại.
    response = student.api_request("post", read_all_url)
    assert response.status_code == 200, response.content.decode()
    assert response.json()["updated_count"] == 1
    assert get(student, unread_url)["unread_count"] == 0

    # Thông báo đã đọc từ trước phải giữ nguyên thời điểm đọc.
    items = get(student, notices_url)["items"]
    previously_read = next(item for item in items if item["id"] == notice_id)
    assert previously_read["read_at"] == read_at

    # Gửi lại yêu cầu không cập nhật thêm bản ghi nào.
    retry = student.api_request("post", read_all_url)
    assert retry.status_code == 200, retry.content.decode()
    assert retry.json()["updated_count"] == 0

    # Sau khi rút môn, thông báo điểm của môn cũng không còn hiển thị.
    membership = test_setup["membership"]
    membership.status = Membership.Status.WITHDRAWN
    membership.save(update_fields=["status"])
    assert get(student, notices_url)["items"] == []


@pytest.mark.django_db
def test_course_announcement_delivery_and_read(api_client, test_setup):
    course = test_setup["course"]
    teacher = api_client(test_setup["teacher"])
    other_teacher = api_client(test_setup["other_teacher"])
    student = api_client(test_setup["student"])
    other = api_client(test_setup["other_student"])

    publish_url = "/api/v1/teacher/course-announcements/publish"
    inbox_url = "/api/v1/me/course-announcements"

    payload = {
        "request_key": str(uuid.uuid4()),
        "course_id": str(course.pk),
        "title": "Lịch kiểm tra",
        "body": "Phòng A, bắt đầu lúc 08:00.",
    }

    published = teacher.api_request("post", publish_url, payload)
    assert published.status_code == 201, published.content.decode()
    notice_id = published.json()["id"]

    # Gửi lại cùng yêu cầu phải trả đúng thông báo cũ.
    retry = teacher.api_request("post", publish_url, payload)
    assert retry.status_code == 200, retry.content.decode()
    assert retry.json()["id"] == notice_id

    assert student.api_request("post", publish_url, payload).status_code == 403
    assert other_teacher.api_request("post", publish_url, payload).status_code == 404

    def fetch(client, url):
        response = client.get(url)
        assert response.status_code == 200, response.content.decode()
        return response.json()

    items = fetch(student, inbox_url)["items"]
    assert len(items) == 1
    assert items[0]["body"] == payload["body"]
    assert items[0]["is_read"] is False
    assert fetch(student, inbox_url + "/unread")["unread_count"] == 1
    assert fetch(student, inbox_url + f"/unread?course_id={course.pk}")["unread_count"] == 1

    # Sinh viên vào lớp sau thời điểm đăng không nhận thông báo cũ.
    Membership.objects.create(
        course=course,
        student=test_setup["other_student"],
        status=Membership.Status.ACTIVE,
    )
    assert fetch(other, inbox_url)["items"] == []

    read_url = f"{inbox_url}/{notice_id}/read"
    assert other.api_request("post", read_url).status_code == 404
    assert student.api_request("post", read_url).status_code == 204

    # Phiên đăng nhập mới vẫn đọc được trạng thái đã lưu.
    fresh = api_client(test_setup["student"])
    assert fetch(fresh, inbox_url)["items"][0]["is_read"] is True
    assert fetch(fresh, inbox_url + "/unread")["unread_count"] == 0

    # Đăng thêm hai thông báo trong môn hiện tại và một thông báo ở môn khác.
    for title in ("Lịch học bù", "Tài liệu ôn tập"):
        new_payload = {
            **payload,
            "request_key": str(uuid.uuid4()),
            "title": title,
        }
        response = teacher.api_request("post", publish_url, new_payload)
        assert response.status_code == 201, response.content.decode()

    other_course = Course.objects.create(
        code=f"NOTICE-{uuid.uuid4().hex[:8]}",
        name="Môn học thông báo độc lập",
        term="HK1-2026",
        teacher=test_setup["teacher"],
        status=Course.Status.OPEN,
        enrollment_open=True,
    )
    Membership.objects.create(
        course=other_course,
        student=test_setup["student"],
        status=Membership.Status.ACTIVE,
    )
    other_course_notice = teacher.api_request(
        "post",
        publish_url,
        {
            "request_key": str(uuid.uuid4()),
            "course_id": str(other_course.pk),
            "title": "Thông báo môn thứ hai",
            "body": "Nội dung chỉ thuộc môn học thứ hai.",
        },
    )
    assert other_course_notice.status_code == 201, other_course_notice.content.decode()

    unread_url = inbox_url + "/unread"
    read_all_url = inbox_url + "/read-all"

    assert fetch(student, unread_url)["unread_count"] == 3
    assert fetch(student, unread_url + f"?course_id={course.pk}")["unread_count"] == 2
    assert fetch(student, unread_url + f"?course_id={other_course.pk}")["unread_count"] == 1
    assert fetch(other, unread_url)["unread_count"] == 2

    # Đánh dấu đã đọc riêng môn hiện tại không được tác động sang môn khác.
    response = student.api_request("post", read_all_url + f"?course_id={course.pk}")
    assert response.status_code == 204, response.content.decode()
    assert fetch(student, unread_url + f"?course_id={course.pk}")["unread_count"] == 0
    assert fetch(student, unread_url + f"?course_id={other_course.pk}")["unread_count"] == 1

    # Giá trị course_id không hợp lệ phải trả lỗi validation thay vì đánh dấu toàn bộ.
    invalid_scope = student.api_request("post", read_all_url + "?course_id=not-a-uuid")
    assert invalid_scope.status_code == 400
    assert fetch(student, unread_url)["unread_count"] == 1

    # Bỏ bộ lọc sẽ đánh dấu phần còn lại trên toàn bộ các môn.
    response = student.api_request("post", read_all_url)
    assert response.status_code == 204, response.content.decode()

    # Phiên đăng nhập mới vẫn thấy đã đọc; bạn cùng lớp vẫn còn 2 tin.
    fresh_student = api_client(test_setup["student"])
    assert fetch(fresh_student, unread_url)["unread_count"] == 0
    assert fetch(fresh_student, inbox_url + "?unread=true")["items"] == []
    assert fetch(other, unread_url)["unread_count"] == 2

    # Thông báo đăng sau thao tác "đọc tất cả" phải xuất hiện là chưa đọc.
    newest = teacher.api_request(
        "post",
        publish_url,
        {
            **payload,
            "request_key": str(uuid.uuid4()),
            "title": "Đổi phòng học",
        },
    )
    assert newest.status_code == 201, newest.content.decode()

    unread_items = fetch(fresh_student, inbox_url + "?unread=true")["items"]
    assert [item["id"] for item in unread_items] == [newest.json()["id"]]
    assert fetch(fresh_student, unread_url)["unread_count"] == 1
    assert fetch(other, unread_url)["unread_count"] == 3

    membership = test_setup["membership"]
    membership.status = Membership.Status.WITHDRAWN
    membership.save(update_fields=["status"])

    # Withdrawing from one course must preserve notices from another course.
    remaining_items = fetch(fresh, inbox_url)["items"]
    assert len(remaining_items) == 1
    assert remaining_items[0]["course_id"] == str(other_course.pk)


@pytest.mark.django_db
def test_upcoming_deadlines_after_submission_and_personal_reopen(api_client, test_setup):
    from datetime import datetime

    from assignments.models import AssignmentReopenWindow

    course = test_setup["course"]
    teacher = test_setup["teacher"]
    student = test_setup["student"]
    owner = api_client(student)
    other = api_client(test_setup["other_student"])

    Membership.objects.create(
        course=course,
        student=test_setup["other_student"],
        status=Membership.Status.ACTIVE,
    )

    now = timezone.now()
    url = "/api/v1/me/upcoming-assignments"

    def make_assignment(title, days):
        return Assignment.objects.create(
            course=course,
            created_by=teacher,
            title=title,
            status=Assignment.Status.PUBLISHED,
            published_at=now - timedelta(days=3),
            due_at=now + timedelta(days=days),
        )

    def read(client):
        response = client.get(url)
        assert response.status_code == 200, response.content.decode()
        return response.json()

    # Cả lớp có 5 bài đến hạn trong 5 ngày tiếp theo.
    scheduled = [make_assignment(f"Bài {day}", day) for day in range(1, 6)]
    make_assignment("Bài đến hạn sau 8 ngày", 8)

    # Bài này đã quá hạn. Chỉ student được mở lại thêm 2 giờ.
    reopened = make_assignment("Bài mở lại riêng", -1)
    end = now + timedelta(hours=2)

    AssignmentReopenWindow.objects.create(
        assignment=reopened,
        target_type=AssignmentReopenWindow.Target.STUDENT,
        student=student,
        start_at=now - timedelta(hours=1),
        end_at=end,
        created_by=teacher,
        reason="Gia hạn riêng",
    )

    # Student có 6 bài nhưng chỉ nhận 5 bài gần nhất.
    before = read(owner)
    expected_preview = [reopened, *scheduled[:4]]

    assert before["total"] == 6
    assert [row["id"] for row in before["items"]] == [
        str(assignment.pk) for assignment in expected_preview
    ]
    assert datetime.fromisoformat(before["items"][0]["deadline"]) == end

    # Bạn cùng lớp chỉ thấy 5 bài theo hạn thông thường.
    classmates = read(other)
    assert classmates["total"] == 5
    assert [row["id"] for row in classmates["items"]] == [
        str(assignment.pk) for assignment in scheduled
    ]

    # Chuẩn bị tệp đã quét sạch rồi gọi chính API nộp bài.
    first = scheduled[0]
    item = StoredFile.objects.create(
        course=course,
        uploader=student,
        file_name="answer.pdf",
        file_size=100,
        storage_path=f"tests/{uuid.uuid4()}.pdf",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.ASSIGNMENT_SUBMISSION,
        policy_snapshot={"assignment_id": str(first.pk)},
    )

    submitted = owner.api_request(
        "post",
        f"/api/v1/courses/{course.pk}/assignments/{first.pk}/submissions",
        {"file_id": str(item.pk)},
    )
    assert submitted.status_code == 201, submitted.content.decode()

    # Bài vừa nộp biến mất. Bài thứ 5 trước đó ngoài phần xem trước nay xuất hiện.
    after = read(owner)
    expected_after = [reopened, *scheduled[1:]]

    assert after["total"] == 5
    assert [row["id"] for row in after["items"]] == [
        str(assignment.pk) for assignment in expected_after
    ]

    assert read(other) == classmates
    assert api_client(teacher).get(url).status_code == 403


@pytest.mark.django_db
def test_teacher_dashboard_material_scan_counts(api_client, test_setup):
    course = test_setup["course"]
    teacher = api_client(test_setup["teacher"])
    other_teacher = api_client(test_setup["other_teacher"])

    def add_file(purpose, state, uploader):
        return StoredFile.objects.create(
            course=course,
            uploader=uploader,
            file_name="sample.pdf",
            file_size=100,
            storage_path=f"tests/{uuid.uuid4()}.pdf",
            purpose=purpose,
            status=state,
        )

    def counts(client):
        response = client.get("/api/v1/courses/summary", {"role": "teacher"})
        assert response.status_code == 200, response.content.decode()
        data = response.json()
        return data["scanning_materials"], data["problem_materials"]

    scanning = add_file(FilePurpose.COURSE_MATERIAL, FileStatus.SCANNING, test_setup["teacher"])
    add_file(FilePurpose.COURSE_MATERIAL, FileStatus.INFECTED, test_setup["teacher"])
    add_file(FilePurpose.COURSE_MATERIAL, FileStatus.CLEAN, test_setup["teacher"])
    add_file(
        FilePurpose.ASSIGNMENT_SUBMISSION,
        FileStatus.INFECTED,
        test_setup["student"],
    )

    assert counts(teacher) == (1, 1)
    assert counts(other_teacher) == (0, 0)

    # Sau khi tệp quét xong, chỉ số "Đang quét" phải giảm.
    scanning.status = FileStatus.CLEAN
    scanning.save(update_fields=["status"])
    assert counts(teacher) == (0, 1)


@pytest.mark.django_db
def test_admin_overview_counts_and_permissions(api_client, test_setup):
    from identity.models import User

    url = "/api/v1/admin/overview"
    admin = api_client(test_setup["admin"])

    def read():
        response = admin.get(url)
        assert response.status_code == 200, response.content.decode()
        return response.json()

    before = read()
    course = test_setup["course"]

    def add_test_file(purpose, state, uploader):
        return StoredFile.objects.create(
            course=course,
            uploader=uploader,
            file_name="overview-test.pdf",
            file_size=100,
            storage_path=f"tests/{uuid.uuid4()}.pdf",
            purpose=purpose,
            status=state,
        )

    scanning = add_test_file(
        FilePurpose.COURSE_MATERIAL,
        FileStatus.SCANNING,
        test_setup["teacher"],
    )
    add_test_file(
        FilePurpose.COURSE_MATERIAL,
        FileStatus.INFECTED,
        test_setup["teacher"],
    )

    # Cùng trạng thái INFECTED nhưng đây là bài nộp, không phải học liệu.
    add_test_file(
        FilePurpose.ASSIGNMENT_SUBMISSION,
        FileStatus.INFECTED,
        test_setup["student"],
    )

    current = read()
    assert current["infected_material_files"] == before["infected_material_files"] + 1
    assert current["scanning_material_files"] == before["scanning_material_files"] + 1

    scanning.status = FileStatus.CLEAN
    scanning.save(update_fields=["status"])

    finished = read()
    assert finished["scanning_material_files"] == before["scanning_material_files"]
    assert finished["infected_material_files"] == current["infected_material_files"]
    assert before["active_users"] == User.objects.filter(is_active=True).count()
    assert before["inactive_users"] == User.objects.filter(is_active=False).count()
    assert (
        before["open_courses"]
        == Course.objects.filter(
            status=Course.Status.OPEN,
        ).count()
    )
    assert (
        before["archived_courses"]
        == Course.objects.filter(
            status=Course.Status.ARCHIVED,
        ).count()
    )

    # Hai vai trò này không được xem thống kê toàn hệ thống.
    for key in ("teacher", "student"):
        assert api_client(test_setup[key]).get(url).status_code == 403

    # Thay đổi dữ liệu test để kiểm tra API đọc trạng thái hiện tại.
    user = test_setup["student"]
    user.is_active = False
    user.save(update_fields=["is_active"])

    course = test_setup["course"]
    course.status = Course.Status.ARCHIVED
    course.archived_at = timezone.now()
    course.save(update_fields=["status", "archived_at"])

    after = read()
    assert after["infected_material_files"] == finished["infected_material_files"]
    assert after["active_users"] == before["active_users"] - 1
    assert after["inactive_users"] == before["inactive_users"] + 1
    assert after["open_courses"] == before["open_courses"] - 1
    assert after["archived_courses"] == before["archived_courses"] + 1


@pytest.mark.django_db
def test_admin_recent_activity_order_and_permissions(api_client, test_setup):
    from platform_core.models import AuditEvent

    url = "/api/v1/admin/recent-activity"
    admin = api_client(test_setup["admin"])

    # Dùng mốc riêng để 7 sự kiện test xếp sau các sự kiện tạo tài khoản.
    start = timezone.now() + timedelta(days=1)
    created = []

    for i in range(7):
        by_service = i == 6

        event = AuditEvent.objects.create(
            occurred_at=start + timedelta(seconds=i),
            actor=None if by_service else test_setup["teacher"],
            system_actor="scan_worker" if by_service else "",
            action=f"test.activity.{i}",
            resource_type="course",
            resource_id=test_setup["course"].pk,
            metadata={"internal_note": "không đưa lên dashboard"},
        )
        created.append(event)

    response = admin.get(url)
    assert response.status_code == 200, response.content.decode()
    rows = response.json()

    # Chỉ lấy 6 sự kiện mới nhất, mới nhất đứng đầu.
    assert [row["id"] for row in rows] == [str(event.pk) for event in reversed(created[1:])]
    assert rows[0]["actor_name"] == "scan_worker"
    assert rows[1]["actor_name"] == test_setup["teacher"].display_name
    assert all("metadata" not in row for row in rows)

    for role in ("teacher", "student"):
        assert api_client(test_setup[role]).get(url).status_code == 403

    list_url = "/api/v1/admin/audit-log"

    def fetch_page(**params):
        result = admin.get(list_url, params)
        assert result.status_code == 200, result.content.decode()
        return result.json()

    # Có 7 sự kiện test. Mỗi trang lấy 2 sự kiện.
    first = fetch_page(search="test.activity.", page_size=2)
    assert first["pagination"]["total_items"] == 7
    assert first["pagination"]["total_pages"] == 4
    assert [row["action"] for row in first["items"]] == [
        "test.activity.6",
        "test.activity.5",
    ]

    second = fetch_page(search="test.activity.", page_size=2, page=2)
    assert [row["action"] for row in second["items"]] == [
        "test.activity.4",
        "test.activity.3",
    ]

    # Tìm sự kiện cũ nhất từ trang đầu.
    matched = fetch_page(search="test.activity.0")
    assert matched["pagination"]["total_items"] == 1
    row = matched["items"][0]
    assert row["resource_id"] == str(test_setup["course"].pk)
    assert row["correlation_id"] == str(created[0].correlation_id)
    assert "metadata" not in row

    invalid = admin.get(
        list_url,
        {
            "start": "2026-11-03",
            "end": "2026-11-01",
        },
    )
    assert invalid.status_code == 400

    for role in ("teacher", "student"):
        assert api_client(test_setup[role]).get(list_url).status_code == 403


@pytest.mark.django_db
def test_admin_overview_pending_teacher_requests(api_client, test_setup, make_user):
    from identity.models import Role, RoleRequest

    admin = api_client(test_setup["admin"])
    overview_url = "/api/v1/admin/overview"
    requests_url = "/api/v1/admin/teacher-requests"

    def pending_count():
        overview = admin.get(overview_url)
        assert overview.status_code == 200, overview.content.decode()
        count = overview.json()["pending_teacher_requests"]

        listing = admin.get(requests_url, {"status": "pending"})
        assert listing.status_code == 200, listing.content.decode()
        assert listing.json()["pagination"]["total_items"] == count
        return count

    before = pending_count()

    # Fixture tạo tài khoản đã xác minh email, đủ điều kiện để duyệt.
    applicant = make_user()
    request = RoleRequest.objects.create(
        user=applicant,
        role=Role.TEACHER,
        status=RoleRequest.Status.PENDING,
    )
    assert pending_count() == before + 1

    approved = admin.api_request(
        "post",
        f"{requests_url}/{request.pk}/approve",
    )
    assert approved.status_code == 200, approved.content.decode()

    request.refresh_from_db()
    assert request.status == RoleRequest.Status.APPROVED
    assert pending_count() == before


@pytest.mark.django_db
def test_admin_file_limits_match_upload_policy(api_client, test_setup):
    from files.constants import (
        DEFAULT_ALLOWED_EXTENSIONS,
        DEFAULT_COURSE_QUOTA_BYTES,
        DEFAULT_MAX_FILE_SIZE_BYTES,
        SYSTEM_MAX_COURSE_QUOTA_BYTES,
        SYSTEM_MAX_FILE_SIZE_BYTES,
    )

    url = "/api/v1/admin/file-limits"
    admin = api_client(test_setup["admin"])
    response = admin.get(url)

    assert response.status_code == 200, response.content.decode()
    assert response.json() == {
        "max_file_bytes": SYSTEM_MAX_FILE_SIZE_BYTES,
        "max_course_quota_bytes": SYSTEM_MAX_COURSE_QUOTA_BYTES,
        "default_file_bytes": DEFAULT_MAX_FILE_SIZE_BYTES,
        "default_course_quota_bytes": DEFAULT_COURSE_QUOTA_BYTES,
        "default_extensions": list(DEFAULT_ALLOWED_EXTENSIONS),
    }

    for role in ("teacher", "student"):
        assert api_client(test_setup[role]).get(url).status_code == 403
