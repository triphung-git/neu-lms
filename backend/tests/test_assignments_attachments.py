import hashlib
import itertools
import json
import uuid
from datetime import timedelta

import pytest
from django.conf import settings
from django.test import Client
from django.utils import timezone
from rest_framework import status

from assignments.exceptions import AssignmentImmutableError, AssignmentValidationError
from assignments.models import AssignmentStatus
from assignments.services import (
    create_assignment,
    publish_assignment,
    update_assignment,
)
from courses.models import Course, Membership
from files.constants import (
    DEFAULT_ALLOWED_EXTENSIONS,
)
from files.models import CourseFilePolicy, FilePurpose, FileStatus
from files.services import (
    abort_upload_intent,
    commit_upload,
    create_upload_intent,
    scan_stored_file,
)
from files.storage import get_storage
from identity.models import Role, RoleGrant, RoleRequest
from identity.services.accounts import confirm_email, create_account
from identity.services.sessions import issue_session
from platform_core.errors import DomainError

_counter = itertools.count(700)


@pytest.fixture
def make_user():
    def _create(role=None, verified=True):
        idx = next(_counter)
        email = f"asg_attach_{idx}@example.edu.vn"
        user = create_account(
            email=email,
            password="SafePassword!2026",
            display_name=f"Asg User {idx}",
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
                review_reason="assignment_attach_test",
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

    course = Course.objects.create(
        code=f"ASG-ATT-{uuid.uuid4().hex[:6]}",
        name="Bài tập và Tệp đính kèm",
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
        "course": course,
        "policy": policy,
        "membership": membership,
    }


def upload_and_clean_file(
    teacher, course, filename="de_bai_1.pdf", content=b"%PDF-1.4 test document"
):
    intent = create_upload_intent(
        actor=teacher,
        course_id=course.id,
        file_name=filename,
        file_size=len(content),
        mime_type="application/pdf",
        purpose=FilePurpose.ASSIGNMENT_ATTACHMENT,
    )
    storage = get_storage()
    storage.save(intent["storage_path"], content)
    commit_upload(
        actor=teacher,
        file_id=intent["file_id"],
        client_checksum=hashlib.sha256(content).hexdigest(),
    )
    return scan_stored_file(file_id=intent["file_id"])


@pytest.mark.django_db
class TestAssignmentUploadIntentAndValidation:
    def test_upload_intent_teacher_success(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        c = api_client(teacher)
        assignment = create_assignment(
            course_id=course.pk,
            title="Scoped upload",
            due_at=timezone.now() + timedelta(days=1),
            created_by=teacher,
        )

        res = c.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/upload-intent",
            {
                "file_name": "lab_guide.pdf",
                "file_size": 1024,
                "mime_type": "application/pdf",
                "purpose": "assignment_attachment",
                "assignment_id": str(assignment.pk),
            },
        )
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()
        assert data["purpose"] == "assignment_attachment"
        assert "storage_path" in data

    def test_upload_intent_student_forbidden(self, api_client, test_setup):
        student = test_setup["student"]
        course = test_setup["course"]
        c = api_client(student)

        res = c.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/upload-intent",
            {
                "file_name": "student_trying_attachment.pdf",
                "file_size": 1024,
                "mime_type": "application/pdf",
                "purpose": "assignment_attachment",
            },
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_upload_intent_other_teacher_forbidden(self, api_client, test_setup):
        other_teacher = test_setup["other_teacher"]
        course = test_setup["course"]
        c = api_client(other_teacher)

        res = c.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/upload-intent",
            {
                "file_name": "other_teacher.pdf",
                "file_size": 1024,
                "mime_type": "application/pdf",
                "purpose": "assignment_attachment",
            },
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_upload_intent_submission_rejected_before_b11(self, api_client, test_setup):
        student = test_setup["student"]
        course = test_setup["course"]
        c = api_client(student)

        res = c.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/upload-intent",
            {
                "file_name": "submission.pdf",
                "file_size": 1024,
                "mime_type": "application/pdf",
                "purpose": "assignment_submission",
            },
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_upload_intent_on_published_assignment_blocked(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        c = api_client(teacher)

        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Assignment Published",
            due_at=timezone.now() + timedelta(days=7),
            publish_immediately=True,
        )

        res = c.api_request(
            "post",
            f"/api/v1/courses/{course.id}/files/upload-intent",
            {
                "file_name": "new_attachment.pdf",
                "file_size": 1024,
                "mime_type": "application/pdf",
                "purpose": "assignment_attachment",
                "assignment_id": str(asg.id),
            },
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestAttachmentScanningAndAttachmentRules:
    def test_attachment_quarantine_cannot_be_attached(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="unscanned.pdf",
            file_size=100,
            mime_type="application/pdf",
            purpose=FilePurpose.ASSIGNMENT_ATTACHMENT,
        )
        assert intent["status"] == FileStatus.QUARANTINE_PENDING

        with pytest.raises(AssignmentValidationError) as exc:
            create_assignment(
                course_id=course.id,
                created_by=teacher,
                title="Quarantined Attachment",
                due_at=timezone.now() + timedelta(days=7),
                attachment_file_ids=[intent["file_id"]],
            )
        assert "an toàn" in str(exc.value)

    def test_attachment_infected_cannot_be_attached(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        file_item = upload_and_clean_file(teacher, course, "virus.pdf", b"eicar test virus")
        file_item.status = FileStatus.INFECTED
        file_item.save(update_fields=["status"])

        with pytest.raises(AssignmentValidationError) as exc:
            create_assignment(
                course_id=course.id,
                created_by=teacher,
                title="Infected Attachment",
                due_at=timezone.now() + timedelta(days=7),
                attachment_file_ids=[file_item.id],
            )
        assert "an toàn" in str(exc.value)

    def test_attachment_clean_can_be_attached(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        content = b"%PDF-1.4 Assignment Guide Clean"
        clean_file = upload_and_clean_file(teacher, course, "guide.pdf", content)

        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Assignment Clean",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )
        assert asg.attachments.count() == 1
        att = asg.attachments.first()
        assert att.file == clean_file
        assert att.name == "guide.pdf"
        assert att.size_bytes == len(content)


@pytest.mark.django_db
class TestPublishedSnapshotManifestAndFingerprint:
    def test_published_snapshot_contains_attachment_fingerprint(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        content = b"%PDF-1.4 Published Attachment Document"
        clean_file = upload_and_clean_file(teacher, course, "exam.pdf", content)

        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Final Exam",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )

        publish_assignment(assignment_id=asg.id, actor=teacher)
        asg.refresh_from_db()
        assert asg.status == AssignmentStatus.PUBLISHED

        snapshot = asg.publication_snapshots.first()
        assert snapshot is not None
        assert len(snapshot.snapshot_attachments) == 1
        att_snap = snapshot.snapshot_attachments[0]
        assert att_snap["file_id"] == str(clean_file.id)
        assert att_snap["name"] == "exam.pdf"
        assert att_snap["size_bytes"] == len(content)
        assert att_snap["sha256_hash"] == hashlib.sha256(content).hexdigest()
        assert att_snap["mime_type"] == "application/pdf"

    def test_cannot_modify_attachments_after_publish(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        clean_file = upload_and_clean_file(teacher, course, "doc1.pdf")
        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Immutable Assignment",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
            publish_immediately=True,
        )

        another_file = upload_and_clean_file(teacher, course, "doc2.pdf")
        with pytest.raises(AssignmentImmutableError):
            update_assignment(
                assignment_id=asg.id,
                actor=teacher,
                attachment_file_ids=[another_file.id],
            )


@pytest.mark.django_db
class TestDeliveryAndPermissions:
    def test_teacher_can_download_and_preview_draft_attachment(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        c_teacher = api_client(teacher)

        content = b"%PDF-1.4 Draft Attachment Guide Content"
        clean_file = upload_and_clean_file(teacher, course, "draft_guide.pdf", content)

        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Draft Assignment",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )
        assert asg.status == AssignmentStatus.DRAFT

        # 1. Download
        dl_res = c_teacher.api_request(
            "get",
            f"/api/v1/courses/{course.id}/assignments/{asg.id}/attachments/{clean_file.id}/download",
        )
        assert dl_res.status_code == status.HTTP_200_OK
        assert dl_res.content == content
        assert "attachment" in dl_res["Content-Disposition"]
        assert dl_res["Content-Security-Policy"] == "sandbox; default-src 'none'"
        assert dl_res["X-Content-Type-Options"] == "nosniff"

        # 2. Preview
        pv_res = c_teacher.api_request(
            "get",
            f"/api/v1/courses/{course.id}/assignments/{asg.id}/attachments/{clean_file.id}/preview",
        )
        assert pv_res.status_code == status.HTTP_200_OK
        assert pv_res.content == content
        assert "inline" in pv_res["Content-Disposition"]

    def test_student_cannot_download_or_preview_draft_attachment(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        student = test_setup["student"]
        course = test_setup["course"]
        c_student = api_client(student)

        clean_file = upload_and_clean_file(teacher, course, "secret_draft.pdf")
        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Secret Draft Assignment",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )

        dl_res = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/assignments/{asg.id}/attachments/{clean_file.id}/download",
        )
        assert dl_res.status_code == status.HTTP_403_FORBIDDEN

        pv_res = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/assignments/{asg.id}/attachments/{clean_file.id}/preview",
        )
        assert pv_res.status_code == status.HTTP_403_FORBIDDEN

    def test_student_can_download_and_preview_published_attachment(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        student = test_setup["student"]
        course = test_setup["course"]
        c_student = api_client(student)

        content = b"%PDF-1.4 Published Assignment Content for Students"
        clean_file = upload_and_clean_file(teacher, course, "homework.pdf", content)
        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Homework 1",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
            publish_immediately=True,
        )

        dl_res = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/assignments/{asg.id}/attachments/{clean_file.id}/download",
        )
        assert dl_res.status_code == status.HTTP_200_OK
        assert dl_res.content == content
        assert "attachment" in dl_res["Content-Disposition"]

        pv_res = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/assignments/{asg.id}/attachments/{clean_file.id}/preview",
        )
        assert pv_res.status_code == status.HTTP_200_OK
        assert "inline" in pv_res["Content-Disposition"]

    def test_preview_disabled_by_policy(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        student = test_setup["student"]
        course = test_setup["course"]
        policy = test_setup["policy"]
        c_student = api_client(student)

        policy.preview_allowed = False
        policy.save(update_fields=["preview_allowed"])

        content = b"%PDF-1.4 Preview Disabled Content"
        clean_file = upload_and_clean_file(teacher, course, "no_preview.pdf", content)
        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="No Preview Assignment",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
            publish_immediately=True,
        )

        # Preview fails with 403
        pv_res = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/assignments/{asg.id}/attachments/{clean_file.id}/preview",
        )
        assert pv_res.status_code == status.HTTP_403_FORBIDDEN

        # Download still succeeds
        dl_res = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/assignments/{asg.id}/attachments/{clean_file.id}/download",
        )
        assert dl_res.status_code == status.HTTP_200_OK
        assert dl_res.content == content

    def test_hash_tampering_integrity_check(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        student = test_setup["student"]
        course = test_setup["course"]
        c_student = api_client(student)

        content = b"%PDF-1.4 Original Content"
        clean_file = upload_and_clean_file(teacher, course, "original.pdf", content)
        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Tampered Check Assignment",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
            publish_immediately=True,
        )

        # Tamper with storage content directly
        storage = get_storage()
        resolved_path = storage._resolve(clean_file.storage_path)
        resolved_path.write_bytes(b"%PDF-1.4 Tampered Content Modified")

        dl_res = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/assignments/{asg.id}/attachments/{clean_file.id}/download",
        )
        assert dl_res.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestRawB08BypassPrevention:
    def test_raw_file_list_hides_draft_assignment_attachment_from_student(
        self, api_client, test_setup
    ):
        teacher = test_setup["teacher"]
        student = test_setup["student"]
        course = test_setup["course"]

        clean_file = upload_and_clean_file(teacher, course, "hidden_draft_file.pdf")
        create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Draft Hidden",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )

        c_student = api_client(student)
        res = c_student.api_request("get", f"/api/v1/courses/{course.id}/files")
        assert res.status_code == status.HTTP_200_OK
        file_ids = [f["id"] for f in res.json().get("results", [])]
        assert str(clean_file.id) not in file_ids

    def test_raw_file_detail_forbidden_for_draft_attachment_to_student(
        self, api_client, test_setup
    ):
        teacher = test_setup["teacher"]
        student = test_setup["student"]
        course = test_setup["course"]

        clean_file = upload_and_clean_file(teacher, course, "draft_for_detail.pdf")
        create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Draft Detail",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )

        c_student = api_client(student)
        res = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{clean_file.id}",
        )
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_raw_file_download_and_preview_forbidden_for_draft_to_student(
        self, api_client, test_setup
    ):
        teacher = test_setup["teacher"]
        student = test_setup["student"]
        course = test_setup["course"]

        clean_file = upload_and_clean_file(teacher, course, "draft_download.pdf")
        create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Draft Bypass Attempt",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )

        c_student = api_client(student)
        # Raw download
        res_dl = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{clean_file.id}/download",
        )
        assert res_dl.status_code == status.HTTP_403_FORBIDDEN

        # Raw preview
        res_pv = c_student.api_request(
            "get",
            f"/api/v1/courses/{course.id}/files/{clean_file.id}/preview",
        )
        assert res_pv.status_code == status.HTTP_403_FORBIDDEN

    def test_raw_file_patch_publication_rejected_for_attachment(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        c_teacher = api_client(teacher)

        clean_file = upload_and_clean_file(teacher, course, "attachment_pub_try.pdf")
        create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Assignment for patch test",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )

        res = c_teacher.api_request(
            "patch",
            f"/api/v1/courses/{course.id}/files/{clean_file.id}",
            {"is_published": True},
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "quản lý qua bài tập" in str(res.json())

    def test_raw_file_delete_rejected_when_attached(self, api_client, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]
        c_teacher = api_client(teacher)

        clean_file = upload_and_clean_file(teacher, course, "delete_attached.pdf")
        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Assignment for delete test",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )

        # Attached to draft -> cannot delete directly via files API
        res = c_teacher.api_request(
            "delete",
            f"/api/v1/courses/{course.id}/files/{clean_file.id}",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "không thể xóa trực tiếp" in str(res.json())

        # Attached to published -> cannot delete
        publish_assignment(assignment_id=asg.id, actor=teacher)
        res_pub = c_teacher.api_request(
            "delete",
            f"/api/v1/courses/{course.id}/files/{clean_file.id}",
        )
        assert res_pub.status_code == status.HTTP_400_BAD_REQUEST
        assert "đã công bố" in str(res_pub.json())

    def test_abort_upload_intent_rejected_when_attached(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        clean_file = upload_and_clean_file(teacher, course, "abort_try.pdf")
        create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Assignment abort test",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id],
        )

        with pytest.raises(DomainError) as exc:
            abort_upload_intent(file_id=clean_file.id, actor=teacher)
        assert exc.value.code == "INVALID_FILE_STATE"


@pytest.mark.django_db
class TestDeduplicationAndRetry:
    def test_duplicate_attachment_ids_deduplicated(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        clean_file = upload_and_clean_file(teacher, course, "unique.pdf")

        # Pass same file ID multiple times
        asg = create_assignment(
            course_id=course.id,
            created_by=teacher,
            title="Deduplication Assignment",
            due_at=timezone.now() + timedelta(days=7),
            attachment_file_ids=[clean_file.id, clean_file.id, clean_file.id],
        )
        assert asg.attachments.count() == 1

        # Update with duplicates
        update_assignment(
            assignment_id=asg.id,
            actor=teacher,
            attachment_file_ids=[clean_file.id, clean_file.id],
        )
        assert asg.attachments.count() == 1

    def test_commit_upload_retry_does_not_double_count_quota(self, test_setup):
        teacher = test_setup["teacher"]
        course = test_setup["course"]

        content = b"%PDF-1.4 Quota Retry Document Content"
        intent = create_upload_intent(
            actor=teacher,
            course_id=course.id,
            file_name="quota_test.pdf",
            file_size=len(content),
            mime_type="application/pdf",
            purpose=FilePurpose.ASSIGNMENT_ATTACHMENT,
        )

        storage = get_storage()
        storage.save(intent["storage_path"], content)

        policy = course.file_policy
        initial_used = policy.used_quota_bytes

        # First commit
        item1 = commit_upload(
            actor=teacher,
            file_id=intent["file_id"],
            client_checksum=hashlib.sha256(content).hexdigest(),
        )
        policy.refresh_from_db()
        used_after_first = policy.used_quota_bytes
        assert used_after_first == initial_used + len(content)

        # Retry commit (idempotent)
        item2 = commit_upload(
            actor=teacher,
            file_id=intent["file_id"],
            client_checksum=hashlib.sha256(content).hexdigest(),
        )
        policy.refresh_from_db()
        assert policy.used_quota_bytes == used_after_first
        assert item1.id == item2.id
