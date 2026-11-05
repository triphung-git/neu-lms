"""Regression checks for grounded chat, persistent history and background delivery."""

import uuid
from datetime import timedelta
from unittest.mock import Mock

import pytest
from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from ai_assistant.chat_safety import ABSTENTION, grounded_answer
from ai_assistant.models import ChatConversation, ChatTurn, EmbeddingIndexState
from ai_assistant.retrieval import RetrievedChunk
from courses.models import CourseAnnouncement, CourseAnnouncementReceipt, Membership
from files.models import CourseFilePolicy
from identity.models import Role, RoleGrant, RoleRequest, User, VerifiedEmail
from identity.services.common import digest
from materials.models import Material, MaterialFileExtraction, MaterialVersion
from platform_core.models import NotificationEmailDelivery
from platform_core.notification_email import dispatch_notifications, enqueue_notifications
from tests.test_ai_summary_drafts import material_with_clean_extraction  # noqa: F401, F811


def student_user(email):
    user = User.objects.create(email=email)
    VerifiedEmail.objects.create(user=user, verified_at=timezone.now(), email_digest=digest(email))
    request = RoleRequest.objects.create(
        user=user,
        role=Role.STUDENT,
        status="approved",
        reviewed_at=timezone.now(),
        review_reason="test",
        reviewed_by=user,
    )
    RoleGrant.objects.create(
        user=user, role=Role.STUDENT, grant_source="verified_student_email", source_request=request
    )
    return user


@pytest.fixture
def chat_setup(material_with_clean_extraction, monkeypatch):  # noqa: F811
    teacher, course, material, version = material_with_clean_extraction
    MaterialVersion.objects.filter(pk=version.pk).update(
        is_published=True, published_at=timezone.now()
    )
    Material.objects.filter(pk=material.pk).update(published_version=version)
    student = student_user("chat.student@example.edu.vn")
    membership = Membership.objects.create(
        course=course, student=student, status=Membership.Status.ACTIVE
    )
    extraction = MaterialFileExtraction.objects.get(material_version=version)
    chunk = RetrievedChunk(
        "S1",
        str(material.id),
        material.title,
        course.code,
        course.name,
        "giao-trinh.pdf",
        1,
        extraction.extracted_text,
        1.0,
        str(version.id),
        str(extraction.stored_file_id),
        extraction.file_hash,
    )
    monkeypatch.setattr("ai_assistant.views.rate_limit", lambda **kwargs: None)
    provider = Mock(return_value="Nguyên tắc thiết kế hệ thống thông tin [S1].")
    monkeypatch.setattr("ai_assistant.views.generate_course_answer", provider)
    monkeypatch.setattr(
        "ai_assistant.views.retrieve_course_chunks_hybrid", lambda *a, **kw: [chunk]
    )
    client = APIClient()
    client.force_authenticate(student)
    return client, course, material, version, student, membership, provider, chunk


@pytest.mark.parametrize(
    "answer",
    [
        "Không có nguồn",
        "Nội dung [S99]",
        "Nội dung S1",
        "NO_SUPPORT: thiếu thông tin [S1]",
        "Nội dung [S1] nhưng [S9]",
    ],
)
def test_grounding_rejects_missing_unknown_or_abstained(answer):
    chunk = RetrievedChunk("S1", "x", "Title", "C", "Course", "f.pdf", 1, "text", 1)
    assert grounded_answer(answer, [chunk]) == (ABSTENTION, [])


def test_grounding_keeps_valid_citations():
    chunk = RetrievedChunk("S1", "x", "Title", "C", "Course", "f.pdf", 1, "text", 1)
    answer, sources = grounded_answer("Nội dung [S1].", [chunk])
    assert answer == "Nội dung [S1]."
    assert sources[0]["id"] == "S1"


@pytest.mark.django_db
def test_chat_persists_retries_and_isolates_users(chat_setup):
    client, course, material, version, student, membership, provider, chunk = chat_setup
    url = f"/api/v1/ai/courses/{course.pk}/chat"
    request_id = str(uuid.uuid4())
    body = {"question": "Nguyên tắc thiết kế là gì?", "request_id": request_id}
    first = client.post(url, body, format="json")
    assert first.status_code == 200, first.data
    assert first.data["citations"][0]["file_id"] == chunk.file_id
    assert client.post(url, body, format="json").data == first.data
    assert provider.call_count == 1
    assert client.post(url, {**body, "question": "Câu hỏi khác"}, format="json").status_code == 409
    history_url = url + "/history"
    assert len(client.get(history_url).data) == 1
    other = student_user("chat.other@example.edu.vn")
    Membership.objects.create(course=course, student=other)
    client.force_authenticate(other)
    assert client.get(history_url).data == []
    client.force_authenticate(student)
    assert client.delete(history_url).status_code == 204
    assert client.get(history_url).data == []


@pytest.mark.django_db
def test_chat_checks_preview_policy_and_withdrawal(chat_setup):
    client, course, _, _, _, membership, provider, _ = chat_setup
    policy, _ = CourseFilePolicy.objects.get_or_create(course=course)
    policy.preview_allowed = False
    policy.save()
    url = f"/api/v1/ai/courses/{course.pk}/chat"
    assert client.post(url, {"question": "Nguyên tắc thiết kế?"}, format="json").status_code == 403
    assert client.get(url + "/history").status_code == 403
    provider.assert_not_called()
    policy.preview_allowed = True
    policy.save()
    membership.status = Membership.Status.WITHDRAWN
    membership.save()
    assert client.get(url + "/history").status_code == 403


@pytest.mark.django_db
def test_hidden_source_removed_from_history(chat_setup):
    client, course, material, *_ = chat_setup
    url = f"/api/v1/ai/courses/{course.pk}/chat"
    assert client.post(url, {"question": "Nguyên tắc thiết kế?"}, format="json").status_code == 200
    Material.objects.filter(pk=material.pk).update(is_hidden=True)
    assert client.get(url + "/history").data == []


@pytest.mark.django_db
def test_clear_during_generation_does_not_restore_history(chat_setup):
    client, course, _, _, student, _, provider, _ = chat_setup

    def clear_then_answer(*a, **kw):
        conversation = ChatConversation.objects.get(user=student, course=course)
        conversation.generation += 1
        conversation.save()
        return "Nội dung [S1]"

    provider.side_effect = clear_then_answer
    response = client.post(
        f"/api/v1/ai/courses/{course.pk}/chat", {"question": "Nguyên tắc thiết kế?"}, format="json"
    )
    assert response.status_code == 409
    assert not ChatTurn.objects.exists()


@pytest.mark.django_db
def test_auto_index_retries_and_reindexes_title(chat_setup, monkeypatch):
    from ai_assistant.tasks import reconcile_embeddings

    _, _, material, _, _, _, _, _ = chat_setup
    command = Mock(side_effect=RuntimeError("provider down"))
    monkeypatch.setattr("ai_assistant.tasks.call_command", command)
    assert reconcile_embeddings() == 1
    state = EmbeddingIndexState.objects.get()
    assert state.status == "failed"
    assert reconcile_embeddings() == 0
    state.retry_at = timezone.now() - timedelta(seconds=1)
    state.save()
    command.side_effect = None
    assert reconcile_embeddings() == 1
    assert reconcile_embeddings() == 0
    Material.objects.filter(pk=material.pk).update(title="Updated source title")
    assert reconcile_embeddings() == 1


@pytest.mark.django_db
def test_announcement_email_dedupe_and_withdrawal(chat_setup, settings):
    _, course, _, _, student, membership, _, _ = chat_setup
    settings.NOTIFICATION_EMAIL_START_AT = (timezone.now() - timedelta(days=1)).isoformat()
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    notice = CourseAnnouncement.objects.create(
        course=course, author=course.teacher, title="Lịch học", body="Thông báo"
    )
    CourseAnnouncementReceipt.objects.create(announcement=notice, membership=membership)
    assert enqueue_notifications() == 1
    assert enqueue_notifications() == 0
    assert dispatch_notifications() == 1
    assert len(mail.outbox) == 1
    assert mail.outbox[0].to == [student.email]
    assert dispatch_notifications() == 0
    notice2 = CourseAnnouncement.objects.create(
        course=course, author=course.teacher, title="Tin mới", body="Thông báo"
    )
    CourseAnnouncementReceipt.objects.create(announcement=notice2, membership=membership)
    assert enqueue_notifications() == 1
    membership.status = Membership.Status.WITHDRAWN
    membership.save()
    assert dispatch_notifications() == 0
    assert NotificationEmailDelivery.objects.filter(status="skipped").count() == 1


@pytest.mark.django_db
def test_email_failure_is_retryable_and_bounded(chat_setup, settings, monkeypatch):
    _, course, _, _, student, membership, _, _ = chat_setup
    notice = CourseAnnouncement.objects.create(
        course=course, author=course.teacher, title="Tin", body="Nội dung"
    )
    receipt = CourseAnnouncementReceipt.objects.create(announcement=notice, membership=membership)
    delivery = NotificationEmailDelivery.objects.create(
        kind="announcement", source_id=receipt.id, recipient=student
    )
    monkeypatch.setattr(
        "platform_core.notification_email.EmailMessage.send", Mock(side_effect=OSError("smtp down"))
    )
    for _ in range(5):
        NotificationEmailDelivery.objects.filter(pk=delivery.pk).update(available_at=timezone.now())
        assert dispatch_notifications() == 0
    delivery.refresh_from_db()
    assert delivery.status == "failed"
    assert delivery.attempts == 5


@pytest.mark.django_db
def test_source_revoked_while_provider_runs_abstains(chat_setup):
    client, course, material, _, _, _, provider, _ = chat_setup

    def hide_then_answer(*args, **kwargs):
        Material.objects.filter(pk=material.pk).update(is_hidden=True)
        return "Có nội dung [S1]."

    provider.side_effect = hide_then_answer
    response = client.post(
        f"/api/v1/ai/courses/{course.pk}/chat", {"question": "Thiết kế như nào?"}, format="json"
    )
    assert response.status_code == 200
    assert response.data["answer"] == ABSTENTION
    assert response.data["citations"] == []


@pytest.mark.django_db
def test_grade_mail_never_contains_score_and_ignores_drafts(chat_setup, settings):
    from assignments.models import Assignment, SubmissionGradeEntry, SubmissionRevision
    from files.models import FilePurpose, FileStatus, StoredFile

    _, course, _, _, student, _, _, _ = chat_setup
    settings.NOTIFICATION_EMAIL_START_AT = (timezone.now() - timedelta(days=1)).isoformat()
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    assignment = Assignment.objects.create(
        course=course,
        created_by=course.teacher,
        title="Bài kiểm tra",
        status="published",
        published_at=timezone.now(),
        due_at=timezone.now() + timedelta(days=1),
    )
    file = StoredFile.objects.create(
        course=course,
        uploader=student,
        file_name="answer.pdf",
        file_size=10,
        storage_path="active/answer.pdf",
        status=FileStatus.CLEAN,
        purpose=FilePurpose.ASSIGNMENT_SUBMISSION,
    )
    submission = SubmissionRevision.objects.create(
        assignment=assignment,
        student=student,
        file=file,
        number=1,
        submitted_at=timezone.now(),
        is_late=False,
    )
    SubmissionGradeEntry.objects.create(
        submission=submission, version=1, score="7.25", status="draft", graded_by=course.teacher
    )
    assert enqueue_notifications() == 0
    SubmissionGradeEntry.objects.create(
        submission=submission, version=2, score="8.75", status="published", graded_by=course.teacher
    )
    assert enqueue_notifications() == 1
    assert dispatch_notifications() == 1
    assert "8.75" not in mail.outbox[0].body
    assert str(assignment.pk) in mail.outbox[0].body


@pytest.mark.django_db
def test_teacher_summary_counts_real_pending_drafts_and_deadlines(chat_setup):
    from ai_assistant.models import MaterialSummaryDraft
    from assignments.models import Assignment
    from courses.services import get_courses_summary

    _, course, material, version, _, _, _, _ = chat_setup
    MaterialSummaryDraft.objects.create(
        course=course,
        material=material,
        material_version=version,
        created_by=course.teacher,
        summary="Tóm tắt",
    )
    Assignment.objects.create(
        course=course,
        created_by=course.teacher,
        title="Sắp đến hạn",
        status="published",
        published_at=timezone.now(),
        due_at=timezone.now() + timedelta(days=2),
    )
    Assignment.objects.create(
        course=course,
        created_by=course.teacher,
        title="Còn xa",
        status="published",
        published_at=timezone.now(),
        due_at=timezone.now() + timedelta(days=20),
    )
    data = get_courses_summary(course.teacher, role_param="teacher")
    assert data["pending_ai_drafts"] == 1
    assert data["upcoming_deadlines"] == 1
    assert "pending_ai_drafts" not in data["unavailable_metrics"]
