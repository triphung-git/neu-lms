import itertools
import json
import uuid

import pytest
from django.conf import settings
from django.test import Client
from django.utils import timezone
from rest_framework import status

from courses.models import Chapter, Course, EnrollmentRequest, Lesson, Membership
from identity.models import Role, RoleGrant, RoleRequest
from identity.services.accounts import confirm_email, create_account
from identity.services.sessions import issue_session

_counter = itertools.count(100)


@pytest.fixture
def make_user():
    def _create(role=None, verified=True):
        idx = next(_counter)
        email = f"enroll_api_{idx}@example.edu.vn"
        user = create_account(
            email=email,
            password="SafeCoursePassword!2026",
            display_name=f"Enroll User {idx}",
        )
        if verified:
            confirm_email(user_id=user.id, expected_email=email)

        if role == Role.ADMIN:
            request = None
        elif role:
            request = RoleRequest.objects.create(
                user=user,
                role=role,
                status=RoleRequest.Status.APPROVED,
                reviewed_by=user,
                reviewed_at=timezone.now(),
                review_reason="enroll_api_test",
            )
        else:
            request = None

        if role:
            RoleGrant.objects.create(
                user=user,
                role=role,
                grant_source={
                    Role.STUDENT: "verified_student_email",
                    Role.TEACHER: "teacher_approval",
                    Role.ADMIN: "internal_administration",
                }[role],
                source_request=None if role == Role.ADMIN else request,
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


def create_course(teacher, **kwargs):
    defaults = {
        "code": f"ENROLL-{uuid.uuid4().hex[:8]}",
        "name": "Môn học đăng ký",
        "term": "HK1-2026",
        "teacher": teacher,
        "status": Course.Status.OPEN,
        "enrollment_open": True,
    }
    defaults.update(kwargs)
    return Course.objects.create(**defaults)


# ---------------------------------------------------------------------------
# Catalog API Tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_catalog_anonymous_rejected(api_client):
    client = api_client()
    resp = client.api_request("get", "/api/v1/courses/catalog")
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_catalog_only_open_and_enrollment_open_courses(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)

    c1 = create_course(teacher, code="CAT-OPEN-1", name="Môn mở 1", enrollment_open=True)
    c2 = create_course(teacher, code="CAT-CLOSED-2", name="Môn đóng 2", enrollment_open=False)
    c3 = create_course(
        teacher,
        code="CAT-ARCH-3",
        name="Môn lưu trữ 3",
        status=Course.Status.ARCHIVED,
        enrollment_open=False,
        archived_at=timezone.now(),
    )

    client = api_client(student)
    resp = client.api_request("get", "/api/v1/courses/catalog")
    assert resp.status_code == status.HTTP_200_OK

    data = resp.json()
    assert "items" in data
    assert "pagination" in data
    codes = [item["code"] for item in data["items"]]
    assert c1.code in codes
    assert c2.code not in codes
    assert c3.code not in codes


@pytest.mark.django_db
def test_catalog_metadata_no_content_leakage(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)

    course = create_course(teacher, code="CAT-LEAK-1", name="Môn bảo mật")
    ch = Chapter.objects.create(course=course, title="Chương bí mật", position=1)
    Lesson.objects.create(chapter=ch, title="Bài học bí mật", position=1)

    client = api_client(student)
    resp = client.api_request("get", "/api/v1/courses/catalog")
    assert resp.status_code == status.HTTP_200_OK

    items = resp.json()["items"]
    target = next((i for i in items if i["id"] == str(course.id)), None)
    assert target is not None
    assert "chapters" not in target
    assert "lessons" not in target
    assert "files" not in target
    assert target["code"] == "CAT-LEAK-1"
    assert target["name"] == "Môn bảo mật"
    assert target["teacher_name"] == teacher.display_name
    assert target["active_member_count"] == 0
    assert target["my_enrollment_status"] == "not_enrolled"
    assert target["pending_request_id"] is None


@pytest.mark.django_db
def test_catalog_search_and_term_filter(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)

    c1 = create_course(teacher, code="SEARCH-MATH", name="Toán cao cấp", term="HK1-2026")
    c2 = create_course(teacher, code="SEARCH-PHYS", name="Vật lý đại cương", term="HK2-2026")

    client = api_client(student)

    # Search by code
    resp = client.api_request("get", "/api/v1/courses/catalog?search=MATH")
    assert resp.status_code == status.HTTP_200_OK
    codes = [i["code"] for i in resp.json()["items"]]
    assert c1.code in codes
    assert c2.code not in codes

    # Filter by term
    resp = client.api_request("get", "/api/v1/courses/catalog?term=HK2-2026")
    assert resp.status_code == status.HTTP_200_OK
    codes = [i["code"] for i in resp.json()["items"]]
    assert c2.code in codes
    assert c1.code not in codes


@pytest.mark.django_db
def test_catalog_my_enrollment_status_states(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)

    c_not = create_course(teacher, code="ST-NOT")
    c_pend = create_course(teacher, code="ST-PEND")
    c_enr = create_course(teacher, code="ST-ENR")
    c_wdr = create_course(teacher, code="ST-WDR")

    # Pending request
    req = EnrollmentRequest.objects.create(
        course=c_pend,
        student=student,
        status=EnrollmentRequest.Status.PENDING,
    )
    # Active membership
    Membership.objects.create(
        course=c_enr,
        student=student,
        status=Membership.Status.ACTIVE,
    )
    # Withdrawn membership
    Membership.objects.create(
        course=c_wdr,
        student=student,
        status=Membership.Status.WITHDRAWN,
    )

    client = api_client(student)
    resp = client.api_request("get", "/api/v1/courses/catalog")
    assert resp.status_code == status.HTTP_200_OK

    by_id = {item["id"]: item for item in resp.json()["items"]}

    assert by_id[str(c_not.id)]["my_enrollment_status"] == "not_enrolled"
    assert by_id[str(c_not.id)]["pending_request_id"] is None

    assert by_id[str(c_pend.id)]["my_enrollment_status"] == "pending"
    assert by_id[str(c_pend.id)]["pending_request_id"] == str(req.id)

    assert by_id[str(c_enr.id)]["my_enrollment_status"] == "enrolled"
    assert by_id[str(c_enr.id)]["active_member_count"] == 1

    assert by_id[str(c_wdr.id)]["my_enrollment_status"] == "withdrawn"
    assert by_id[str(c_wdr.id)]["active_member_count"] == 0


# ---------------------------------------------------------------------------
# Enrollment Request API Tests (Student)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_student_enroll_flow(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)
    other_teacher = make_user(Role.TEACHER)

    course = create_course(teacher, enrollment_open=True)

    # Non-student cannot enroll
    client_teacher = api_client(other_teacher)
    resp = client_teacher.api_request("post", f"/api/v1/courses/{course.id}/enroll")
    assert resp.status_code == status.HTTP_403_FORBIDDEN

    # Active student enrolls successfully
    client_student = api_client(student)
    resp = client_student.api_request("post", f"/api/v1/courses/{course.id}/enroll")
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()
    assert data["course_id"] == str(course.id)
    assert data["course_code"] == course.code
    assert data["status"] == "pending"
    assert "requested_at" in data
    req_id = data["id"]

    # Re-enrolling while pending fails with 400
    resp_dup = client_student.api_request("post", f"/api/v1/courses/{course.id}/enroll")
    assert resp_dup.status_code == status.HTTP_400_BAD_REQUEST

    # Cancel request
    resp_cancel = client_student.api_request(
        "post", f"/api/v1/courses/enrollment-requests/{req_id}/cancel"
    )
    assert resp_cancel.status_code == status.HTTP_200_OK
    assert resp_cancel.json()["status"] == "cancelled"

    # Cancelling again fails with 400
    resp_cancel_dup = client_student.api_request(
        "post", f"/api/v1/courses/enrollment-requests/{req_id}/cancel"
    )
    assert resp_cancel_dup.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_student_cancel_other_student_request_forbidden(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    student1 = make_user(Role.STUDENT)
    student2 = make_user(Role.STUDENT)

    course = create_course(teacher)
    req = EnrollmentRequest.objects.create(
        course=course,
        student=student1,
        status=EnrollmentRequest.Status.PENDING,
    )

    client2 = api_client(student2)
    resp = client2.api_request("post", f"/api/v1/courses/enrollment-requests/{req.id}/cancel")
    assert resp.status_code in [status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND]


@pytest.mark.django_db
def test_student_my_enrollment_requests(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)

    c1 = create_course(teacher, code="MY-REQ-1")
    c2 = create_course(teacher, code="MY-REQ-2")

    EnrollmentRequest.objects.create(
        course=c1,
        student=student,
        status=EnrollmentRequest.Status.PENDING,
    )
    EnrollmentRequest.objects.create(
        course=c2,
        student=student,
        status=EnrollmentRequest.Status.REJECTED,
        reviewed_by=teacher,
        reviewed_at=timezone.now(),
        rejection_reason="Lớp đã đầy",
    )

    client = api_client(student)
    resp = client.api_request("get", "/api/v1/courses/enrollment-requests/my")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["pagination"]["total_items"] == 2

    # Filter by pending
    resp_pend = client.api_request("get", "/api/v1/courses/enrollment-requests/my?status=pending")
    assert resp_pend.status_code == status.HTTP_200_OK
    assert resp_pend.json()["pagination"]["total_items"] == 1
    assert resp_pend.json()["items"][0]["status"] == "pending"


# ---------------------------------------------------------------------------
# Teacher Queue and Review API Tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_teacher_view_and_review_requests(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    other_teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)

    course = create_course(teacher)
    req = EnrollmentRequest.objects.create(
        course=course,
        student=student,
        status=EnrollmentRequest.Status.PENDING,
    )

    # Other teacher cannot view queue
    client_other = api_client(other_teacher)
    resp = client_other.api_request("get", f"/api/v1/courses/{course.id}/enrollment-requests")
    assert resp.status_code == status.HTTP_403_FORBIDDEN

    # Owner teacher views queue
    client_owner = api_client(teacher)
    resp = client_owner.api_request("get", f"/api/v1/courses/{course.id}/enrollment-requests")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["pagination"]["total_items"] == 1
    item = resp.json()["items"][0]
    assert item["student_id"] == str(student.id)
    assert item["student_name"] == student.display_name
    assert item["student_email"] == student.email

    # Other teacher cannot approve
    resp_app_other = client_other.api_request(
        "post", f"/api/v1/courses/enrollment-requests/{req.id}/approve"
    )
    assert resp_app_other.status_code == status.HTTP_403_FORBIDDEN

    # Owner teacher approves
    resp_app = client_owner.api_request(
        "post", f"/api/v1/courses/enrollment-requests/{req.id}/approve"
    )
    assert resp_app.status_code == status.HTTP_200_OK
    assert resp_app.json()["status"] == "approved"
    assert resp_app.json()["reviewed_by_name"] == teacher.display_name

    # Membership was created
    assert Membership.objects.filter(
        course=course, student=student, status=Membership.Status.ACTIVE
    ).exists()


@pytest.mark.django_db
def test_teacher_reject_request_with_reason(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    student = make_user(Role.STUDENT)

    course = create_course(teacher)
    req = EnrollmentRequest.objects.create(
        course=course,
        student=student,
        status=EnrollmentRequest.Status.PENDING,
    )

    client_owner = api_client(teacher)
    resp = client_owner.api_request(
        "post",
        f"/api/v1/courses/enrollment-requests/{req.id}/reject",
        data={"reason": "Không đủ điều kiện tiên quyết."},
    )
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["status"] == "rejected"
    assert resp.json()["rejection_reason"] == "Không đủ điều kiện tiên quyết."

    req.refresh_from_db()
    assert req.status == EnrollmentRequest.Status.REJECTED
    assert req.reviewed_by == teacher
    assert req.reviewed_at is not None


# ---------------------------------------------------------------------------
# Membership Management API Tests
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_course_members_api_flow(make_user, api_client):
    teacher = make_user(Role.TEACHER)
    other_teacher = make_user(Role.TEACHER)
    student1 = make_user(Role.STUDENT)
    student2 = make_user(Role.STUDENT)

    course = create_course(teacher)

    client_owner = api_client(teacher)
    client_other = api_client(other_teacher)
    client_student1 = api_client(student1)

    # 1. Other teacher / student cannot view members
    assert (
        client_other.api_request("get", f"/api/v1/courses/{course.id}/members").status_code
        == status.HTTP_403_FORBIDDEN
    )
    assert (
        client_student1.api_request("get", f"/api/v1/courses/{course.id}/members").status_code
        == status.HTTP_403_FORBIDDEN
    )

    # 2. Owner adds member by email
    resp_add = client_owner.api_request(
        "post",
        f"/api/v1/courses/{course.id}/members",
        data={"student_email": student1.email},
    )
    assert resp_add.status_code == status.HTTP_201_CREATED
    assert resp_add.json()["student_id"] == str(student1.id)
    assert resp_add.json()["status"] == "active"

    # Adding non-existent email -> 400
    resp_nonexistent = client_owner.api_request(
        "post",
        f"/api/v1/courses/{course.id}/members",
        data={"student_email": "nonexistent@neu.edu.vn"},
    )
    assert resp_nonexistent.status_code == status.HTTP_400_BAD_REQUEST

    # Adding already active member is idempotent and returns 201 without duplicate row
    resp_dup = client_owner.api_request(
        "post",
        f"/api/v1/courses/{course.id}/members",
        data={"student_email": student1.email},
    )
    assert resp_dup.status_code == status.HTTP_201_CREATED
    assert resp_dup.json()["student_id"] == str(student1.id)
    assert Membership.objects.filter(course=course, student=student1).count() == 1

    # 3. List members
    resp_list = client_owner.api_request("get", f"/api/v1/courses/{course.id}/members")
    assert resp_list.status_code == status.HTTP_200_OK
    assert resp_list.json()["pagination"]["total_items"] == 1

    # 4. Student withdraws themselves
    resp_wdr_student = client_student1.api_request(
        "post", f"/api/v1/courses/{course.id}/members/{student1.id}/withdraw"
    )
    assert resp_wdr_student.status_code == status.HTTP_200_OK
    assert resp_wdr_student.json()["status"] == "withdrawn"

    # 5. Teacher re-enrolls student
    resp_re = client_owner.api_request(
        "post", f"/api/v1/courses/{course.id}/members/{student1.id}/re-enroll"
    )
    assert resp_re.status_code == status.HTTP_200_OK
    assert resp_re.json()["status"] == "active"

    # 6. Teacher withdraws student
    resp_wdr_teacher = client_owner.api_request(
        "post", f"/api/v1/courses/{course.id}/members/{student1.id}/withdraw"
    )
    assert resp_wdr_teacher.status_code == status.HTTP_200_OK
    assert resp_wdr_teacher.json()["status"] == "withdrawn"

    # 7. Unrelated student cannot withdraw another student
    client_student2 = api_client(student2)
    resp_wdr_unauth = client_student2.api_request(
        "post", f"/api/v1/courses/{course.id}/members/{student1.id}/withdraw"
    )
    assert resp_wdr_unauth.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_full_enrollment_lifecycle_b07_07(api_client, make_user):
    """
    B07-07 Full End-to-End Integration Verification:
    1. Owner (Teacher 1) creates course, closed admission.
    2. Owner opens admission via PATCH.
    3. Student finds course in catalog, submits enrollment request (pending).
    4. Student cancels request (cancelled), then resubmits (pending).
    5. Teacher 1 approves request -> Student becomes active member.
    6. Student can access course content (chapters).
    7. Student withdraws -> Access immediately revoked (404 on course retrieval).
    8. Teacher 1 re-enrolls student -> Access restored, preserving original Membership.id.
    9. Admin transfers course to Teacher 2 -> Teacher 1 forbidden (403), Teacher 2 has full access.
    10. Teacher 2 archives course -> Course becomes read-only, all mutations blocked.
    """
    teacher1 = make_user(role=Role.TEACHER)
    teacher2 = make_user(role=Role.TEACHER)
    admin = make_user(role=Role.ADMIN)
    student = make_user(role=Role.STUDENT)

    client_t1 = api_client(teacher1)
    client_t2 = api_client(teacher2)
    client_admin = api_client(admin)
    client_student = api_client(student)

    # 1. Create course initially closed
    course = create_course(teacher1, enrollment_open=False)
    chapter = Chapter.objects.create(course=course, title="Chương 1", position=1)
    Lesson.objects.create(chapter=chapter, title="Bài 1", position=1)

    # Student checks catalog -> Course is closed, does not appear
    resp_cat_closed = client_student.api_request("get", "/api/v1/courses/catalog")
    assert resp_cat_closed.status_code == status.HTTP_200_OK
    assert not any(c["id"] == str(course.id) for c in resp_cat_closed.json()["items"])

    # 2. Teacher 1 opens admission via PATCH
    resp_open = client_t1.api_request(
        "patch", f"/api/v1/courses/{course.id}", data={"enrollment_open": True}
    )
    assert resp_open.status_code == status.HTTP_200_OK
    assert resp_open.json()["enrollment_open"] is True

    # 3. Student finds course in catalog
    resp_cat_open = client_student.api_request("get", "/api/v1/courses/catalog")
    assert resp_cat_open.status_code == status.HTTP_200_OK
    cat_item = next(c for c in resp_cat_open.json()["items"] if c["id"] == str(course.id))
    assert cat_item["my_enrollment_status"] == "not_enrolled"

    # 4. Student enrolls -> pending
    resp_enr = client_student.api_request("post", f"/api/v1/courses/{course.id}/enroll")
    assert resp_enr.status_code == status.HTTP_201_CREATED
    req_id = resp_enr.json()["id"]
    assert resp_enr.json()["status"] == "pending"

    # Student cancels -> cancelled
    resp_cancel = client_student.api_request(
        "post", f"/api/v1/courses/enrollment-requests/{req_id}/cancel"
    )
    assert resp_cancel.status_code == status.HTTP_200_OK
    assert resp_cancel.json()["status"] == "cancelled"

    # Student resubmits -> pending again
    resp_re_enr = client_student.api_request("post", f"/api/v1/courses/{course.id}/enroll")
    assert resp_re_enr.status_code == status.HTTP_201_CREATED
    new_req_id = resp_re_enr.json()["id"]
    assert resp_re_enr.json()["status"] == "pending"

    # 5. Teacher 1 reviews requests and approves
    resp_reqs = client_t1.api_request("get", f"/api/v1/courses/{course.id}/enrollment-requests")
    assert resp_reqs.status_code == status.HTTP_200_OK
    assert any(r["id"] == new_req_id for r in resp_reqs.json()["items"])

    resp_approve = client_t1.api_request(
        "post", f"/api/v1/courses/enrollment-requests/{new_req_id}/approve"
    )
    assert resp_approve.status_code == status.HTTP_200_OK
    assert resp_approve.json()["status"] == "approved"

    # 6. Student is now active member and can view course content
    resp_view = client_student.api_request("get", f"/api/v1/courses/{course.id}")
    assert resp_view.status_code == status.HTTP_200_OK
    assert resp_view.json()["code"] == course.code

    resp_chaps = client_student.api_request("get", f"/api/v1/courses/{course.id}/chapters")
    assert resp_chaps.status_code == status.HTTP_200_OK
    assert len(resp_chaps.json()) == 1

    # Get membership record to verify ID preservation later
    member_record = Membership.objects.get(course=course, student=student)
    original_member_id = member_record.id
    original_added_at = member_record.added_at

    # 7. Student withdraws -> access revoked immediately
    resp_wdr = client_student.api_request(
        "post", f"/api/v1/courses/{course.id}/members/{student.id}/withdraw"
    )
    assert resp_wdr.status_code == status.HTTP_200_OK
    assert resp_wdr.json()["status"] == "withdrawn"

    # Student course access is now 404 (filtered out of visible_course_queryset)
    resp_view_wdr = client_student.api_request("get", f"/api/v1/courses/{course.id}")
    assert resp_view_wdr.status_code == status.HTTP_404_NOT_FOUND

    # 8. Teacher 1 re-enrolls student -> access restored, ID preserved
    resp_re_enroll = client_t1.api_request(
        "post", f"/api/v1/courses/{course.id}/members/{student.id}/re-enroll"
    )
    assert resp_re_enroll.status_code == status.HTTP_200_OK
    assert resp_re_enroll.json()["status"] == "active"

    member_restored = Membership.objects.get(course=course, student=student)
    assert member_restored.id == original_member_id
    assert member_restored.added_at == original_added_at

    # Student can access course content again
    resp_view_restored = client_student.api_request("get", f"/api/v1/courses/{course.id}")
    assert resp_view_restored.status_code == status.HTTP_200_OK

    # 9. Admin transfers course to Teacher 2
    resp_transfer = client_admin.api_request(
        "post",
        f"/api/v1/admin/courses/{course.id}/transfer",
        data={"teacher_id": str(teacher2.id)},
    )
    assert resp_transfer.status_code == status.HTTP_200_OK
    assert resp_transfer.json()["teacher"] == str(teacher2.id)

    # Former owner Teacher 1 is now forbidden (403)
    resp_t1_members = client_t1.api_request("get", f"/api/v1/courses/{course.id}/members")
    assert resp_t1_members.status_code == status.HTTP_403_FORBIDDEN

    # New owner Teacher 2 has full access
    resp_t2_members = client_t2.api_request("get", f"/api/v1/courses/{course.id}/members")
    assert resp_t2_members.status_code == status.HTTP_200_OK
    assert resp_t2_members.json()["pagination"]["total_items"] == 1

    # 10. Teacher 2 archives course
    resp_arch = client_t2.api_request("post", f"/api/v1/courses/{course.id}/archive")
    assert resp_arch.status_code == status.HTTP_200_OK
    assert resp_arch.json()["status"] == "archived"

    # In archived course, all mutations are blocked
    # Cannot add member
    extra_student = make_user(role=Role.STUDENT)
    resp_add_arch = client_t2.api_request(
        "post",
        f"/api/v1/courses/{course.id}/members",
        data={"student_email": extra_student.email},
    )
    assert resp_add_arch.status_code == status.HTTP_400_BAD_REQUEST
    assert "lưu trữ" in str(resp_add_arch.json()).lower()

    # Cannot withdraw member
    resp_wdr_arch = client_t2.api_request(
        "post", f"/api/v1/courses/{course.id}/members/{student.id}/withdraw"
    )
    assert resp_wdr_arch.status_code == status.HTTP_400_BAD_REQUEST
    assert "lưu trữ" in str(resp_wdr_arch.json()).lower()

    # Cannot toggle admission
    resp_patch_arch = client_t2.api_request(
        "patch", f"/api/v1/courses/{course.id}", data={"enrollment_open": True}
    )
    assert resp_patch_arch.status_code in (status.HTTP_400_BAD_REQUEST, status.HTTP_403_FORBIDDEN)


@pytest.mark.django_db
def test_workspace_course_list_narrows_admin_student_and_teacher_roles(make_user, api_client):
    user = make_user(Role.ADMIN)
    now = timezone.now()
    for role in (Role.STUDENT, Role.TEACHER):
        req = RoleRequest.objects.create(
            user=user,
            role=role,
            status="approved",
            reviewed_by=user,
            reviewed_at=now,
            review_reason="test",
        )
        RoleGrant.objects.create(
            user=user,
            role=role,
            source_request=req,
            granted_by=user if role == Role.TEACHER else None,
            grant_source="teacher_approval" if role == Role.TEACHER else "verified_student_email",
        )
    owned = create_course(user)
    enrolled = create_course(make_user(Role.TEACHER))
    create_course(make_user(Role.TEACHER))
    Membership.objects.create(course=enrolled, student=user)
    client = api_client(user)
    assert len(client.get("/api/v1/courses").json()["items"]) == 3
    assert [row["id"] for row in client.get("/api/v1/courses?role=student").json()["items"]] == [
        str(enrolled.id)
    ]
    assert [row["id"] for row in client.get("/api/v1/courses?role=teacher").json()["items"]] == [
        str(owned.id)
    ]
    assert client.get("/api/v1/courses?role=invalid").status_code == 400


@pytest.mark.django_db
def test_catalog_requires_verified_student_role(make_user, api_client):
    for role in (None, Role.ADMIN, Role.TEACHER):
        assert api_client(make_user(role)).get("/api/v1/courses/catalog").status_code == 403
    assert (
        api_client(make_user(Role.STUDENT, verified=False))
        .get("/api/v1/courses/catalog")
        .status_code
        == 403
    )


@pytest.mark.django_db
def test_member_and_request_search_applies_before_pagination(make_user, api_client):
    teacher, student, other = (
        make_user(Role.TEACHER),
        make_user(Role.STUDENT),
        make_user(Role.STUDENT),
    )
    course = create_course(teacher)
    for person in (student, other):
        Membership.objects.create(course=course, student=person)
        EnrollmentRequest.objects.create(course=course, student=person)
    client = api_client(teacher)
    for endpoint in ("members", "enrollment-requests"):
        url = f"/api/v1/courses/{course.id}/{endpoint}?page_size=1"
        assert client.get(url).json()["pagination"]["total_pages"] == 2
        response = client.get(url + f"&search={student.email}")
        assert response.status_code == 200
        assert response.json()["pagination"]["total_items"] == 1
        assert response.json()["items"][0]["student_id"] == str(student.id)


@pytest.mark.django_db
def test_enrollment_mutations_require_csrf_and_foreign_owner_denied(make_user, api_client):
    owner, student, foreign = (
        make_user(Role.TEACHER),
        make_user(Role.STUDENT),
        make_user(Role.TEACHER),
    )
    course = create_course(owner)
    req = EnrollmentRequest.objects.create(course=course, student=student)
    paths = [
        f"/api/v1/courses/{course.id}/enroll",
        f"/api/v1/courses/enrollment-requests/{req.id}/cancel",
        f"/api/v1/courses/enrollment-requests/{req.id}/approve",
        f"/api/v1/courses/enrollment-requests/{req.id}/reject",
        f"/api/v1/courses/{course.id}/members",
        f"/api/v1/courses/{course.id}/members/{student.id}/withdraw",
        f"/api/v1/courses/{course.id}/members/{student.id}/re-enroll",
    ]
    for path in paths:
        assert (
            api_client(owner).post(path, data="{}", content_type="application/json").status_code
            == 403
        )
    foreign_client = api_client(foreign)
    for suffix in ("approve", "reject"):
        assert (
            foreign_client.api_request(
                "post", f"/api/v1/courses/enrollment-requests/{req.id}/{suffix}"
            ).status_code
            == 403
        )
    req.refresh_from_db()
    assert req.status == "pending"
