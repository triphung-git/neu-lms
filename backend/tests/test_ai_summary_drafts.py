import json

import pytest
from django.conf import settings
from django.test import Client
from django.utils import timezone
from rest_framework import status

from courses.models import Course
from files.models import FilePurpose, FileStatus, StoredFile
from identity.models import Role, RoleGrant, RoleRequest, User, VerifiedEmail
from identity.services.accounts import digest
from identity.services.sessions import issue_session
from materials.models import (
    Material,
    MaterialFile,
    MaterialFileExtraction,
    MaterialVersion,
    MaterialVersionStatus,
    ProcessingStatus,
)
from materials.statuses import ExtractionStatus


def _teacher(email="summary.teacher@example.edu.vn"):
    user = User.objects.create(email=email, display_name="Summary Teacher", is_active=True)
    now = timezone.now()
    VerifiedEmail.objects.create(
        user=user,
        email_digest=digest(user.email),
        verified_at=now,
    )
    request = RoleRequest.objects.create(
        user=user,
        role=Role.TEACHER,
        status=RoleRequest.Status.APPROVED,
        reviewed_by=user,
        reviewed_at=now,
        review_reason="teacher_approval",
    )
    RoleGrant.objects.create(
        user=user,
        role=Role.TEACHER,
        grant_source="teacher_approval",
        source_request=request,
        granted_by=user,
    )
    return user


def _auth_client(user):
    client = Client(enforce_csrf_checks=True)
    response = client.get("/api/v1/auth/csrf")
    assert response.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)
    csrf_token = client.cookies["csrftoken"].value
    raw_session, _ = issue_session(user_id=user.id)
    client.cookies[settings.SESSION_COOKIE_NAME] = raw_session
    client.csrf_token = csrf_token

    def post_api(path, payload=None):
        body = {} if payload is None else payload
        return client.post(
            path,
            data=json.dumps(body),
            content_type="application/json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )

    client.post_api = post_api
    return client


@pytest.fixture
def material_with_clean_extraction(db):
    teacher = _teacher()
    course = Course.objects.create(
        code="AI-SUM-101",
        name="Học phần kiểm thử AI",
        term="HK1-2026",
        teacher=teacher,
    )
    material = Material.objects.create(
        course=course,
        title="Giáo trình kiểm thử",
        created_by=teacher,
    )
    version = MaterialVersion.objects.create(
        material=material,
        version_number=1,
        title=material.title,
        lifecycle_status=MaterialVersionStatus.DRAFT,
        processing_status=ProcessingStatus.PENDING,
        created_by=teacher,
    )
    stored_file = StoredFile.objects.create(
        course=course,
        uploader=teacher,
        file_name="giao-trinh.pdf",
        file_size=1024,
        mime_type="application/pdf",
        storage_path="active/giao-trinh.pdf",
        sha256_hash="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.COURSE_MATERIAL,
    )
    material_file = MaterialFile.objects.create(
        material_version=version,
        file=stored_file,
        position=1,
    )
    MaterialFileExtraction.objects.create(
        material_version=version,
        material_file=material_file,
        stored_file=stored_file,
        status=ExtractionStatus.SUCCESS,
        file_hash=stored_file.sha256_hash,
        extracted_text=("Chương 1 giới thiệu các nguyên tắc thiết kế hệ thống thông tin."),
        page_count=1,
        completed_at=timezone.now(),
    )
    version.lifecycle_status = MaterialVersionStatus.FINALIZED
    version.finalized_at = timezone.now()
    version.processing_status = ProcessingStatus.READY
    version.file_count = 1
    version.save(
        update_fields=[
            "lifecycle_status",
            "finalized_at",
            "processing_status",
            "file_count",
            "updated_at",
        ]
    )
    return teacher, course, material, version


@pytest.mark.django_db
class TestTeacherAISummaryDraftFlow:
    def test_teacher_can_generate_edit_and_confirm_summary(
        self, material_with_clean_extraction, monkeypatch
    ):
        from platform_core.models import OutboxEvent

        teacher, course, material, version = material_with_clean_extraction
        monkeypatch.setattr(
            "ai_assistant.views.generate_material_summary",
            lambda title, sources: "Tóm tắt do AI tạo từ nguồn đã trích xuất.",
        )
        client = _auth_client(teacher)

        created = client.post_api(
            f"/api/v1/ai/courses/{course.id}/materials/{material.id}/summary-drafts"
        )
        assert created.status_code == status.HTTP_201_CREATED
        draft_data = created.json()
        assert draft_data["status"] == "pending"
        assert draft_data["source_file_names"] == ["giao-trinh.pdf"]

        reviewed = client.post_api(
            f"/api/v1/ai/teacher/summary-drafts/{draft_data['id']}/review",
            {
                "status": "confirmed",
                "summary": "Tóm tắt đã được giảng viên biên tập.",
            },
        )
        assert reviewed.status_code == status.HTTP_200_OK
        assert reviewed.json()["status"] == "confirmed"

        version.refresh_from_db()
        assert version.summary == "Tóm tắt đã được giảng viên biên tập."
        assert version.summary_confirmed_at is not None
        assert OutboxEvent.objects.filter(event_type="materials.ai_summary_draft_created").exists()
        assert OutboxEvent.objects.filter(event_type="materials.ai_summary_confirmed").exists()

    def test_summary_ignores_clean_files_outside_the_course_material_manifest(
        self, material_with_clean_extraction, monkeypatch
    ):
        teacher, course, material, version = material_with_clean_extraction
        unrelated_file = StoredFile.objects.create(
            course=course,
            uploader=teacher,
            file_name="khong-thuoc-hoc-lieu.txt",
            file_size=128,
            mime_type="text/plain",
            storage_path="active/unrelated.txt",
            sha256_hash="a" * 64,
            status=FileStatus.CLEAN,
            purpose=FilePurpose.GENERAL,
        )
        # Build a deliberately inconsistent historical row to ensure the summary
        # endpoint rejects it even if its extraction claims SUCCESS and CLEAN.
        version.lifecycle_status = MaterialVersionStatus.DRAFT
        version.finalized_at = None
        version.save(update_fields=["lifecycle_status", "finalized_at", "updated_at"])
        unrelated_manifest = MaterialFile.objects.create(
            material_version=version,
            file=unrelated_file,
            position=2,
        )
        version.lifecycle_status = MaterialVersionStatus.FINALIZED
        version.finalized_at = timezone.now()
        version.save(update_fields=["lifecycle_status", "finalized_at", "updated_at"])
        MaterialFileExtraction.objects.create(
            material_version=version,
            material_file=unrelated_manifest,
            stored_file=unrelated_file,
            status=ExtractionStatus.SUCCESS,
            file_hash=unrelated_file.sha256_hash,
            extracted_text="Nội dung không được phép đưa vào bản tóm tắt học liệu.",
            page_count=1,
            completed_at=timezone.now(),
        )
        captured_sources = []

        def fake_summary(title, sources):
            captured_sources.extend(sources)
            return "Tóm tắt chỉ từ nguồn hợp lệ."

        monkeypatch.setattr("ai_assistant.views.generate_material_summary", fake_summary)
        response = _auth_client(teacher).post_api(
            f"/api/v1/ai/courses/{course.id}/materials/{material.id}/summary-drafts"
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert [source["file_name"] for source in captured_sources] == ["giao-trinh.pdf"]
        assert all("khong-thuoc-hoc-lieu" not in source["file_name"] for source in captured_sources)

    def test_course_chat_applies_per_user_rate_limit_before_retrieval(
        self, material_with_clean_extraction, monkeypatch
    ):
        teacher, course, _, _ = material_with_clean_extraction
        calls = []
        monkeypatch.setattr("ai_assistant.views.rate_limit", lambda **kwargs: calls.append(kwargs))
        monkeypatch.setattr(
            "ai_assistant.views.retrieve_course_chunks_hybrid",
            lambda *args, **kwargs: [object()],
        )
        monkeypatch.setattr(
            "ai_assistant.views.generate_course_answer",
            lambda *args, **kwargs: "NO_SUPPORT: Chưa đủ thông tin từ học liệu.",
        )

        response = _auth_client(teacher).post_api(
            f"/api/v1/ai/courses/{course.id}/chat",
            {"question": "Giải thích nội dung học liệu."},
        )

        assert response.status_code == status.HTTP_200_OK
        assert calls == [
            {
                "scope": "ai.course.chat",
                "identity": str(teacher.id),
                "maximum": 30,
            }
        ]

    def test_non_owner_teacher_cannot_generate_summary(self, material_with_clean_extraction):
        _, course, material, _ = material_with_clean_extraction
        other_teacher = _teacher(email="summary.other@example.edu.vn")
        client = _auth_client(other_teacher)
        response = client.post_api(
            f"/api/v1/ai/courses/{course.id}/materials/{material.id}/summary-drafts"
        )
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_existing_pending_draft_is_reused_without_another_ai_call(
        self, material_with_clean_extraction, monkeypatch
    ):
        from ai_assistant.models import MaterialSummaryDraft

        teacher, course, material, version = material_with_clean_extraction
        draft = MaterialSummaryDraft.objects.create(
            course=course,
            material=material,
            material_version=version,
            created_by=teacher,
            summary="Bản nháp có sẵn.",
            source_file_names=["giao-trinh.pdf"],
        )
        monkeypatch.setattr(
            "ai_assistant.views.generate_material_summary",
            lambda *args, **kwargs: pytest.fail("Không được gọi AI khi đã có bản nháp chờ duyệt."),
        )

        response = _auth_client(teacher).post_api(
            f"/api/v1/ai/courses/{course.id}/materials/{material.id}/summary-drafts"
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["id"] == str(draft.id)
        assert MaterialSummaryDraft.objects.filter(material_version=version).count() == 1

    def test_discard_does_not_update_material_summary(
        self, material_with_clean_extraction, monkeypatch
    ):
        from ai_assistant.models import MaterialSummaryDraft

        teacher, course, material, version = material_with_clean_extraction
        monkeypatch.setattr(
            "ai_assistant.views.generate_material_summary",
            lambda title, sources: "Tóm tắt cần giảng viên rà soát.",
        )
        client = _auth_client(teacher)
        created = client.post_api(
            f"/api/v1/ai/courses/{course.id}/materials/{material.id}/summary-drafts"
        )
        draft_id = created.json()["id"]

        response = client.post_api(
            f"/api/v1/ai/teacher/summary-drafts/{draft_id}/review",
            {"status": "discarded"},
        )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["status"] == "discarded"
        version.refresh_from_db()
        assert version.summary == ""
        assert version.summary_confirmed_at is None
        assert MaterialSummaryDraft.objects.get(pk=draft_id).reviewed_by_id == teacher.id

    def test_teacher_list_is_scoped_to_owned_courses(self, material_with_clean_extraction):
        from ai_assistant.models import MaterialSummaryDraft

        teacher, course, material, version = material_with_clean_extraction
        own_draft = MaterialSummaryDraft.objects.create(
            course=course,
            material=material,
            material_version=version,
            created_by=teacher,
            summary="Bản nháp của giảng viên phụ trách.",
            source_file_names=["giao-trinh.pdf"],
        )
        other_teacher = _teacher(email="summary.other-list@example.edu.vn")
        response = _auth_client(other_teacher).get("/api/v1/ai/teacher/summary-drafts")

        assert response.status_code == status.HTTP_200_OK
        assert response.json() == []
        assert MaterialSummaryDraft.objects.filter(pk=own_draft.pk).exists()

    def test_other_teacher_cannot_review_a_draft(self, material_with_clean_extraction, monkeypatch):
        teacher, course, material, _ = material_with_clean_extraction
        monkeypatch.setattr(
            "ai_assistant.views.generate_material_summary",
            lambda title, sources: "Tóm tắt cần giảng viên rà soát.",
        )
        created = _auth_client(teacher).post_api(
            f"/api/v1/ai/courses/{course.id}/materials/{material.id}/summary-drafts"
        )
        draft_id = created.json()["id"]
        other_teacher = _teacher(email="summary.other-review@example.edu.vn")

        response = _auth_client(other_teacher).post_api(
            f"/api/v1/ai/teacher/summary-drafts/{draft_id}/review",
            {"status": "confirmed", "summary": "Không được phép duyệt."},
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
