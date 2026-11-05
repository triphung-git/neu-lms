from datetime import timedelta

import pytest
from django.contrib.auth.hashers import check_password
from django.utils import timezone
from rest_framework.test import APIClient

from assignments.models import Assignment, SubmissionGradeEntry, SubmissionRevision
from courses.models import Chapter, Course, Lesson, Membership
from files.models import StoredFile
from identity.models import Role, RoleGrant, RoleRequest, User, VerifiedEmail
from identity.services.common import digest
from learning.models import (
    AttendanceRecord,
    AttendanceSession,
    EnrollmentKey,
    GradeAppeal,
    GroupSubmission,
    LessonProgress,
)

pytestmark = pytest.mark.django_db


def user(email, role):
    u = User.objects.create(email=email, display_name=email)
    VerifiedEmail.objects.create(user=u, verified_at=timezone.now(), email_digest=digest(email))
    r = RoleRequest.objects.create(
        user=u, role=role, status="approved", reviewed_by=u, reviewed_at=timezone.now()
    )
    RoleGrant.objects.create(
        user=u,
        role=role,
        grant_source="verified_student_email" if role == "student" else "teacher_approval",
        source_request=r,
        granted_by=u,
    )
    return u


def client(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


@pytest.fixture
def setup():
    t = user("teacher@neu.edu.vn", Role.TEACHER)
    s = user("student@st.neu.edu.vn", Role.STUDENT)
    o = user("other@st.neu.edu.vn", Role.STUDENT)
    c = Course.objects.create(code="EXT1", name="Extensions", teacher=t, term="2026")
    Membership.objects.create(course=c, student=s)
    now = timezone.now()
    a = Assignment.objects.create(
        course=c,
        created_by=t,
        title="Practice",
        status="published",
        published_at=now,
        due_at=now + timedelta(days=3),
    )
    return t, s, o, c, a


def api(c, suffix=""):
    return f"/api/v1/learning/courses/{c.pk}{suffix}"


def post(c, url, body, status=200):
    r = c.post(url, body, format="json")
    assert r.status_code == status, getattr(r, "data", r.content)
    return r.data


def stored(u, c, a=None):
    import uuid

    return StoredFile.objects.create(
        course=c,
        uploader=u,
        file_name="test.pdf",
        file_size=10,
        status="clean",
        purpose="assignment_submission" if a else "course_material",
        storage_path=str(uuid.uuid4()),
        sha256_hash="a" * 64,
        policy_snapshot={"assignment_id": str(a.pk)} if a else {},
    )


def test_enrollment(setup):
    t, s, o, c, a = setup
    post(
        client(t),
        api(c, "/actions"),
        {"action": "enrollment", "open": True, "password": "secret123"},
    )
    key = EnrollmentKey.objects.get(course=c)
    assert key.password_hash != "secret123" and check_password("secret123", key.password_hash)
    post(
        client(o), "/api/v1/learning/enrollment", {"course_id": str(c.pk), "password": "wrong"}, 400
    )
    assert not Membership.objects.filter(course=c, student=o).exists()
    for _ in range(2):
        post(
            client(o),
            "/api/v1/learning/enrollment",
            {"course_id": str(c.pk), "password": "secret123"},
        )
    assert Membership.objects.filter(course=c, student=o).count() == 1
    post(client(t), api(c, "/actions"), {"action": "enrollment", "open": False})
    post(
        client(o),
        "/api/v1/learning/enrollment",
        {"course_id": str(c.pk), "password": "secret123"},
        404,
    )


def test_attendance(setup):
    t, s, o, c, a = setup
    now = timezone.now()
    post(
        client(t),
        api(c, "/attendance"),
        {
            "action": "create",
            "title": "Session",
            "code": "abcdef",
            "opens_at": (now - timedelta(minutes=2)).isoformat(),
            "late_at": (now + timedelta(minutes=2)).isoformat(),
            "closes_at": (now + timedelta(hours=1)).isoformat(),
        },
    )
    session = AttendanceSession.objects.get(course=c)
    body = {"action": "checkin", "session_id": session.pk, "code": "abcdef"}
    post(client(o), api(c, "/attendance"), body, 403)
    for _ in range(2):
        post(client(s), api(c, "/attendance"), body)
    assert AttendanceRecord.objects.filter(session=session, student=s).count() == 1
    post(
        client(t),
        api(c, "/attendance"),
        {
            "action": "correct",
            "session_id": session.pk,
            "student_id": str(s.pk),
            "status": "late",
            "reason": "Checked by teacher",
        },
    )
    r = AttendanceRecord.objects.get(session=session, student=s)
    assert r.status == "late" and r.corrections[0]["from"] == "present"
    post(client(t), api(c, "/attendance"), {"action": "close", "session_id": session.pk})
    post(client(s), api(c, "/attendance"), body, 400)
    assert client(t).get(api(c, "/attendance") + "?export=csv").status_code == 200


def test_progress(setup):
    t, s, o, c, a = setup
    ch = Chapter.objects.create(course=c, title="Chapter", position=1)
    lesson = Lesson.objects.create(chapter=ch, title="Lesson", position=1)
    body = {"action": "progress", "lesson_id": str(lesson.pk), "completed": True}
    for _ in range(2):
        post(client(s), api(c, "/actions"), body)
    assert LessonProgress.objects.count() == 1
    post(client(o), api(c, "/actions"), body, 403)
    assert client(t).get(api(c, "/progress")).data["items"][0]["percent"] == 100
    post(client(s), api(c, "/actions"), {**body, "completed": False})
    assert LessonProgress.objects.count() == 0


def test_discussion(setup):
    from learning.models import Discussion, DiscussionReply, LearningNotice

    t, s, o, c, a = setup
    post(
        client(s), api(c, "/discussion"), {"action": "create", "title": "Question", "body": "Help"}
    )
    topic = Discussion.objects.get()
    post(
        client(t),
        api(c, "/discussion"),
        {"action": "reply", "topic_id": topic.pk, "body": "Answer"},
    )
    assert LearningNotice.objects.filter(user=s).count() == 1
    reply = DiscussionReply.objects.get()
    post(
        client(s),
        api(c, "/discussion"),
        {"action": "moderate", "topic_id": topic.pk, "locked": True},
        403,
    )
    post(
        client(t),
        api(c, "/discussion"),
        {
            "action": "moderate",
            "topic_id": topic.pk,
            "reply_id": reply.pk,
            "accepted": True,
            "resolved": True,
            "locked": True,
        },
    )
    post(
        client(s),
        api(c, "/discussion"),
        {"action": "reply", "topic_id": topic.pk, "body": "Again"},
        400,
    )
    post(
        client(t),
        api(c, "/discussion"),
        {"action": "moderate", "topic_id": topic.pk, "hidden": True},
    )
    assert client(s).get(api(c, "/discussion")).data["items"] == []


def test_library(setup):
    t, s, o, c, a = setup
    f = stored(t, c)
    data = {"file_id": str(f.pk), "title": "Doc", "visibility": "private"}
    created = post(client(t), "/api/v1/learning/library", data, 201)
    assert client(s).get("/api/v1/learning/library").data["items"] == []
    assert client(s).delete("/api/v1/learning/library/" + str(created["id"])).status_code == 403
    post(
        client(t),
        "/api/v1/learning/library",
        {**data, "id": created["id"], "visibility": "course"},
        201,
    )
    assert len(client(s).get("/api/v1/learning/library").data["items"]) == 1
    assert client(o).get("/api/v1/learning/library").data["items"] == []
    f.status = "scanning"
    f.save()
    assert client(s).get("/api/v1/learning/library").data["items"] == []
    assert client(t).delete("/api/v1/learning/library/" + str(created["id"])).status_code == 204
    assert StoredFile.objects.filter(pk=f.pk).exists()


def test_appeal(setup):
    t, s, o, c, a = setup
    sub = SubmissionRevision.objects.create(
        assignment=a,
        student=s,
        file=stored(s, c, a),
        number=1,
        submitted_at=timezone.now(),
        is_late=False,
    )
    grade = SubmissionGradeEntry.objects.create(
        submission=sub, version=1, score=5, status="published", graded_by=t
    )
    post(
        client(t),
        api(c, "/appeals"),
        {
            "action": "policy",
            "assignment_id": str(a.pk),
            "deadline": (timezone.now() + timedelta(days=2)).isoformat(),
        },
    )
    post(
        client(s),
        api(c, "/appeals"),
        {"action": "create", "grade_id": grade.pk, "reason": "Please review"},
    )
    post(
        client(s),
        api(c, "/appeals"),
        {"action": "create", "grade_id": grade.pk, "reason": "Duplicate"},
        400,
    )
    appeal = GradeAppeal.objects.get()
    post(
        client(t),
        api(c, "/appeals"),
        {
            "action": "resolve",
            "id": appeal.pk,
            "expected_version": 2,
            "score": "7",
            "response": "Corrected",
        },
        400,
    )
    post(
        client(t),
        api(c, "/appeals"),
        {
            "action": "resolve",
            "id": appeal.pk,
            "expected_version": 1,
            "score": "7",
            "response": "Corrected",
        },
    )
    grade.refresh_from_db()
    assert grade.score == 5
    assert sub.grade_entries.count() == 2
    assert GradeAppeal.objects.get().resolved_grade.score == 7


def test_groups(setup):
    from learning.models import GroupPolicy, StudyGroup

    t, s, o, c, a = setup
    Membership.objects.create(course=c, student=o)
    post(
        client(t),
        api(c, "/groups"),
        {
            "action": "policy",
            "assignment_id": str(a.pk),
            "max_members": 2,
            "formation_deadline": (timezone.now() + timedelta(days=1)).isoformat(),
        },
    )
    policy = GroupPolicy.objects.get()
    post(
        client(s),
        api(c, "/groups"),
        {"action": "create", "policy_id": policy.pk, "name": "Group 1"},
    )
    g = StudyGroup.objects.get()
    post(
        client(s),
        api(c, "/groups"),
        {"action": "join", "policy_id": policy.pk, "group_id": g.pk},
        400,
    )
    post(client(o), api(c, "/groups"), {"action": "join", "policy_id": policy.pk, "group_id": g.pk})
    f = stored(s, c, a)
    body = {"action": "submit", "policy_id": policy.pk, "group_id": g.pk, "file_id": str(f.pk)}
    post(client(o), api(c, "/groups"), body, 404)
    post(client(s), api(c, "/groups"), body, 201)
    post(client(s), api(c, "/groups"), body)
    assert GroupSubmission.objects.count() == 1
    post(client(o), api(c, "/groups"), {"action": "leave", "policy_id": policy.pk}, 400)
    sub = GroupSubmission.objects.get()
    grade = {
        "action": "grade",
        "policy_id": policy.pk,
        "submission_id": sub.pk,
        "expected_version": 0,
        "score": "8",
        "published": False,
        "adjustments": {str(o.pk): {"score": "7", "reason": "Less contribution"}},
    }
    post(client(t), api(c, "/groups"), grade)
    assert client(o).get(api(c, "/groups")).data["items"][0]["submissions"][0]["grade"] is None
    post(client(t), api(c, "/groups"), {**grade, "expected_version": 1, "published": True})
    result = client(o).get(api(c, "/groups")).data["items"][0]["submissions"][0]["grade"]
    assert result["score"] == "7.00" and list(result["adjustments"]) == [str(o.pk)]


@pytest.mark.parametrize(
    "endpoint", ["/attendance", "/progress", "/discussion", "/downloads", "/appeals", "/groups", ""]
)
def test_outsider(setup, endpoint):
    t, s, o, c, a = setup
    assert client(o).get(api(c, endpoint)).status_code == 403


def test_reports_reject_student(setup):
    t, s, o, c, a = setup
    assert client(s).get("/api/v1/learning/reports").status_code == 403


def test_teacher_roster_and_group_appeal(setup):
    from learning.models import AppealPolicy, GroupGrade, GroupGradeAppeal, GroupPolicy, StudyGroup

    t, s, o, c, a = setup
    Membership.objects.create(course=c, student=o)
    policy = GroupPolicy.objects.create(
        assignment=a, max_members=2, formation_deadline=timezone.now() + timedelta(days=1)
    )
    roster = {
        "action": "roster",
        "policy_id": policy.pk,
        "name": "Teacher group",
        "leader_id": str(s.pk),
        "student_ids": [str(s.pk), str(o.pk)],
    }
    post(client(s), api(c, "/groups"), roster, 403)
    post(client(t), api(c, "/groups"), roster)
    g = StudyGroup.objects.get()
    sub = GroupSubmission.objects.create(
        group=g, file=stored(s, c, a), number=1, member_ids=[str(s.pk), str(o.pk)]
    )
    grade = GroupGrade.objects.create(submission=sub, version=1, score=6, published=True, teacher=t)
    AppealPolicy.objects.create(assignment=a, deadline=timezone.now() + timedelta(days=1))
    post(
        client(s),
        api(c, "/group-appeals"),
        {"action": "create", "grade_id": grade.pk, "reason": "Review my contribution"},
    )
    appeal = GroupGradeAppeal.objects.get()
    post(
        client(t),
        api(c, "/group-appeals"),
        {
            "action": "resolve",
            "id": appeal.pk,
            "expected_version": 1,
            "score": "8",
            "response": "Verified contribution",
        },
    )
    updated = sub.grades.get(version=2)
    assert updated.score == 6 and updated.adjustments[str(s.pk)]["score"] == "8.00"
    assert str(o.pk) not in updated.adjustments
    assert grade.score == 6
    assert client(o).get(api(c, "/group-appeals")).data["items"] == []
    post(client(t), api(c, "/groups"), {**roster, "group_id": g.pk}, 400)


def test_draft_delete_retains_published_summary(setup):
    from ai_assistant.models import MaterialSummaryDraft
    from materials.models import Material, MaterialVersion

    t, s, o, c, a = setup
    material = Material.objects.create(course=c, title="AI source", created_by=t)
    version = MaterialVersion.objects.create(
        material=material, version_number=1, title="Source", created_by=t
    )
    draft = MaterialSummaryDraft.objects.create(
        course=c, material=material, material_version=version, created_by=t, summary="Draft"
    )
    url = f"/api/v1/learning/drafts/{draft.pk}"
    assert client(s).delete(url).status_code == 403
    assert client(t).delete(url).status_code == 204
    assert Material.objects.filter(pk=material.pk).exists()
    draft = MaterialSummaryDraft.objects.create(
        course=c,
        material=material,
        material_version=version,
        created_by=t,
        summary="Published",
        status="confirmed",
        reviewed_by=t,
        reviewed_at=timezone.now(),
    )
    version.summary = "Published"
    version.summary_confirmed_at = timezone.now()
    version.save()
    assert client(t).delete(f"/api/v1/learning/drafts/{draft.pk}").status_code == 204
    version.refresh_from_db()
    assert version.summary == "Published" and version.summary_confirmed_at
    assert not MaterialSummaryDraft.objects.filter(pk=draft.pk).exists()


def test_reports_admin_and_bad_range(setup):
    t, s, o, c, a = setup
    RoleGrant.objects.create(
        user=t, role=Role.ADMIN, grant_source="internal_administration", granted_by=t
    )
    r = client(t).get("/api/v1/learning/reports")
    assert r.status_code == 200 and r.data["metrics"]["new_courses"] == 1
    assert client(t).get("/api/v1/learning/reports?export=csv").status_code == 200
    assert client(t).get("/api/v1/learning/reports?start=bad").status_code == 400


def test_actual_attachment_download_logging(setup, settings, tmp_path):
    import hashlib

    from assignments.models import AssignmentAttachment
    from files.storage import get_storage
    from learning.models import DownloadEvent

    t, s, o, c, a = setup
    settings.MEDIA_ROOT = str(tmp_path)
    settings.FILES_STORAGE_BACKEND = "local"
    f = stored(t, c)
    content = b"%PDF-1.4 test"
    f.file_size = len(content)
    f.sha256_hash = hashlib.sha256(content).hexdigest()
    f.purpose = "assignment_attachment"
    f.save()
    get_storage().save(f.storage_path, content)
    a = Assignment.objects.create(
        course=c,
        created_by=t,
        title="Attachment exercise",
        due_at=timezone.now() + timedelta(days=1),
    )
    AssignmentAttachment.objects.create(
        assignment=a, file=f, name=f.file_name, size_bytes=f.file_size
    )
    a.status = "published"
    a.published_at = timezone.now()
    a.save()
    base = f"/api/v1/courses/{c.pk}/assignments/{a.pk}/attachments/{f.pk}"
    assert client(o).get(base + "/download").status_code == 403
    assert DownloadEvent.objects.count() == 0
    for kind in ["download", "download", "preview"]:
        response = client(s).get(base + "/" + kind)
        assert response.status_code == 200, response.content
    assert DownloadEvent.objects.filter(kind="download").count() == 2
    assert DownloadEvent.objects.filter(kind="preview").count() == 1
    report = client(t).get(api(c, "/downloads")).data
    assert report["totals"][0]["count"] == 2


def test_csv_formula_escaping():
    from learning.common import csv_response

    content = csv_response([["=1+2", "safe"]], "test.csv").content.decode("utf-8-sig")
    assert content.startswith("'=1+2,safe")


def test_authenticated_mutations_require_csrf(setup):
    from tests.test_ai_summary_drafts import _auth_client

    t, s, o, c, a = setup
    browser = _auth_client(t)
    body = {"action": "enrollment", "open": True, "password": "secret123"}
    assert (
        browser.post(api(c, "/actions"), body, content_type="application/json").status_code == 403
    )
    assert browser.post_api(api(c, "/actions"), body).status_code == 200


def test_archived_course_rejects_new_actions(setup):
    t, s, o, c, a = setup
    c.status = "archived"
    c.archived_at = timezone.now()
    c.save()
    post(
        client(t),
        api(c, "/actions"),
        {"action": "enrollment", "open": True, "password": "secret123"},
        400,
    )
    post(
        client(s), api(c, "/discussion"), {"action": "create", "title": "New", "body": "Topic"}, 400
    )


def test_library_file_cannot_be_aborted(setup):
    from files.models import CourseFilePolicy
    from files.services import abort_upload_intent
    from learning.models import LibraryDocument
    from platform_core.errors import DomainError

    t, s, o, c, a = setup
    f = stored(t, c)
    CourseFilePolicy.objects.get_or_create(course=c)
    LibraryDocument.objects.create(owner=t, file=f, title="Preserved")
    with pytest.raises(DomainError):
        abort_upload_intent(file_id=f.pk, system_actor="cleanup_worker")
    f.refresh_from_db()
    assert f.status == "clean"


def test_enrollment_catalog_filters_and_membership(setup):
    t, s, o, c, a = setup
    c.enrollment_open = True
    c.save()
    second = Course.objects.create(
        code="PASS", name="Password course", teacher=t, term="2027", enrollment_open=True
    )
    EnrollmentKey.objects.create(course=second, password_hash="never-exposed")
    response = client(s).get("/api/v1/learning/enrollment")
    assert response.status_code == 200 and response.data["total"] == 2
    assert {x["requires_password"] for x in response.data["items"]} == {True, False}
    assert "never-exposed" not in str(response.data)
    assert next(x for x in response.data["items"] if x["code"] == c.code)["joined"]
    filtered = client(s).get(
        "/api/v1/learning/enrollment", {"term": "2027", "q": "PASS", "mode": "password"}
    )
    assert filtered.data["total"] == 1 and filtered.data["items"][0]["code"] == "PASS"
    second.enrollment_open = False
    second.save()
    assert client(s).get("/api/v1/learning/enrollment").data["total"] == 1


def test_attendance_totals_survive_archive_and_include_all_sessions(setup):
    t, s, o, c, a = setup
    now = timezone.now()
    sessions = [
        AttendanceSession.objects.create(
            course=c,
            title=f"Session {i}",
            code_hash="unused",
            opens_at=now - timedelta(hours=3),
            late_at=now - timedelta(hours=2),
            closes_at=now - timedelta(hours=1),
            closed=True,
        )
        for i in range(102)
    ]
    AttendanceRecord.objects.bulk_create(
        [
            AttendanceRecord(
                session=session,
                student=s,
                status="present" if i < 60 else "late" if i < 70 else "absent",
                checked_at=now - timedelta(hours=2) if i < 70 else None,
            )
            for i, session in enumerate(sessions)
        ]
    )
    AttendanceRecord.objects.create(
        session=sessions[0], student=o, status="present", checked_at=now
    )
    c.status = "archived"
    c.archived_at = now
    c.save()
    response = client(t).get(api(c, "/attendance"))
    assert response.status_code == 200 and response.data["total_sessions"] == 102
    row = next(r for r in response.data["summary"] if r["student_id"] == s.pk)
    assert (row["attended"], row["total"], row["present"], row["late"], row["absent"]) == (
        70,
        102,
        60,
        10,
        32,
    )
    own = client(s).get(api(c, "/attendance"))
    assert len(own.data["summary"]) == 1 and own.data["summary"][0]["student_id"] == s.pk
    assert client(t).get(api(c, "/attendance") + "?export=summary").status_code == 200
    assert client(s).get(api(c, "/attendance")).data["summary"] == own.data["summary"]
