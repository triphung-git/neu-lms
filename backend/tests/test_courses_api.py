import itertools
import json
import uuid

import pytest
from django.conf import settings
from django.test import Client
from django.utils import timezone
from rest_framework import status

from courses.models import Chapter, Course, Membership
from identity.models import Role, RoleGrant, RoleRequest
from identity.services.accounts import confirm_email, create_account
from identity.services.sessions import issue_session

_counter = itertools.count(1)


@pytest.fixture
def make_user():
    def _create(role=None, verified=True):
        email = f"course_{next(_counter)}@example.edu.vn"
        user = create_account(
            email=email,
            password="SafeCoursePassword!2026",
            display_name=f"Course User {email}",
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
                review_reason="course_test",
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
        "code": f"COURSE-{uuid.uuid4().hex[:8]}",
        "name": "Môn học kiểm thử",
        "term": "HK1-2026",
        "teacher": teacher,
    }
    defaults.update(kwargs)
    return Course.objects.create(**defaults)


@pytest.mark.django_db
class TestCourseApi:
    def test_teacher_can_create_update_and_filter_owned_courses(self, make_user, api_client):
        teacher = make_user(Role.TEACHER)
        client = api_client(teacher)
        created = client.api_request(
            "post",
            "/api/v1/courses",
            {
                "code": "  web202 ",
                "name": "  Lập trình Web  ",
                "term": " HK1-2026 ",
                "description": " Mô tả ",
                "enrollment_open": True,
            },
        )

        assert created.status_code == status.HTTP_201_CREATED
        assert created.json()["code"] == "WEB202"
        assert created.json()["name"] == "Lập trình Web"
        assert created.json()["enrollment_open"] is True
        course_id = created.json()["id"]

        updated = client.api_request(
            "patch",
            f"/api/v1/courses/{course_id}",
            {"name": "Lập trình Web nâng cao", "enrollment_open": False},
        )
        assert updated.status_code == status.HTTP_200_OK
        assert updated.json()["name"] == "Lập trình Web nâng cao"
        assert updated.json()["teacher"] == str(teacher.id)

        listed = client.get("/api/v1/courses?status=open")
        assert listed.status_code == status.HTTP_200_OK
        assert [item["id"] for item in listed.json()["items"]] == [course_id]

    def test_course_visibility_is_limited_to_owner_active_members_and_admin(
        self, make_user, api_client
    ):
        teacher = make_user(Role.TEACHER)
        other_teacher = make_user(Role.TEACHER)
        student = make_user(Role.STUDENT)
        admin = make_user(Role.ADMIN)
        course = create_course(teacher)
        other_course = create_course(other_teacher)
        Membership.objects.create(course=course, student=student)

        teacher_response = api_client(teacher).get("/api/v1/courses")
        student_response = api_client(student).get("/api/v1/courses")
        admin_response = api_client(admin).get("/api/v1/courses")

        assert {item["id"] for item in teacher_response.json()["items"]} == {str(course.id)}
        assert {item["id"] for item in student_response.json()["items"]} == {str(course.id)}
        assert {item["id"] for item in admin_response.json()["items"]} == {
            str(course.id),
            str(other_course.id),
        }

        Membership.objects.filter(course=course, student=student).update(
            status=Membership.Status.WITHDRAWN
        )
        student_response = api_client(student).get("/api/v1/courses")
        assert student_response.json()["items"] == []

    def test_unverified_or_non_teacher_cannot_create_course(self, make_user, api_client):
        student_client = api_client(make_user(Role.STUDENT))
        denied = student_client.api_request(
            "post",
            "/api/v1/courses",
            {"code": "NOPE1", "name": "Không được tạo", "term": "HK1-2026"},
        )
        assert denied.status_code == status.HTTP_403_FORBIDDEN

        unverified_teacher = make_user(Role.TEACHER, verified=False)
        unverified_client = api_client(unverified_teacher)
        denied = unverified_client.api_request(
            "post",
            "/api/v1/courses",
            {"code": "NOPE2", "name": "Chưa xác minh", "term": "HK1-2026"},
        )
        assert denied.status_code == status.HTTP_403_FORBIDDEN

    def test_chapters_and_lessons_are_scoped_ordered_and_conditionally_deletable(
        self, make_user, api_client
    ):
        teacher = make_user(Role.TEACHER)
        client = api_client(teacher)
        course = create_course(teacher)
        other_course = create_course(teacher)

        first = client.api_request(
            "post",
            f"/api/v1/courses/{course.id}/chapters",
            {"title": "Chương đầu"},
        )
        second = client.api_request(
            "post",
            f"/api/v1/courses/{course.id}/chapters",
            {"title": "Chương hai"},
        )
        other = client.api_request(
            "post",
            f"/api/v1/courses/{other_course.id}/chapters",
            {"title": "Chương khác"},
        )
        assert first.status_code == second.status_code == other.status_code == 201

        chapter_one = first.json()
        chapter_two = second.json()
        reordered = client.api_request(
            "post",
            f"/api/v1/courses/{course.id}/chapters/reorder",
            {"ids": [chapter_two["id"], chapter_one["id"]]},
        )
        assert [item["id"] for item in reordered.json()] == [
            chapter_two["id"],
            chapter_one["id"],
        ]

        lesson = client.api_request(
            "post",
            f"/api/v1/courses/{course.id}/chapters/{chapter_one['id']}/lessons",
            {"title": "Bài học", "description": "Nội dung"},
        )
        assert lesson.status_code == status.HTTP_201_CREATED

        wrong_parent = client.api_request(
            "patch",
            f"/api/v1/courses/{other_course.id}/chapters/{chapter_one['id']}",
            {"title": "Không được chuyển chéo"},
        )
        assert wrong_parent.status_code == status.HTTP_404_NOT_FOUND

        blocked_delete = client.api_request(
            "delete",
            f"/api/v1/courses/{course.id}/chapters/{chapter_one['id']}",
        )
        assert blocked_delete.status_code == status.HTTP_400_BAD_REQUEST

        delete_lesson = client.api_request(
            "delete",
            f"/api/v1/courses/{course.id}/chapters/{chapter_one['id']}/lessons/{lesson.json()['id']}",
        )
        assert delete_lesson.status_code == status.HTTP_204_NO_CONTENT

        delete_chapter = client.api_request(
            "delete",
            f"/api/v1/courses/{course.id}/chapters/{chapter_one['id']}",
        )
        assert delete_chapter.status_code == status.HTTP_204_NO_CONTENT

    def test_archiving_is_one_way_and_makes_course_read_only(self, make_user, api_client):
        teacher = make_user(Role.TEACHER)
        client = api_client(teacher)
        course = create_course(teacher, enrollment_open=True)

        archived = client.api_request("post", f"/api/v1/courses/{course.id}/archive")
        assert archived.status_code == status.HTTP_200_OK
        assert archived.json()["status"] == Course.Status.ARCHIVED
        assert archived.json()["enrollment_open"] is False
        assert archived.json()["archived_at"] is not None

        update = client.api_request(
            "patch",
            f"/api/v1/courses/{course.id}",
            {"name": "Không được sửa"},
        )
        assert update.status_code == status.HTTP_403_FORBIDDEN

        create_chapter = client.api_request(
            "post",
            f"/api/v1/courses/{course.id}/chapters",
            {"title": "Không được thêm"},
        )
        assert create_chapter.status_code == status.HTTP_403_FORBIDDEN

    def test_admin_transfer_requires_active_verified_teacher_and_preserves_content(
        self, make_user, api_client
    ):
        admin = make_user(Role.ADMIN)
        old_teacher = make_user(Role.TEACHER)
        new_teacher = make_user(Role.TEACHER)
        student = make_user(Role.STUDENT)
        unverified_teacher = make_user(Role.TEACHER, verified=False)
        course = create_course(old_teacher)
        chapter = Chapter.objects.create(course=course, title="Chương 1", position=1)
        Membership.objects.create(course=course, student=student)

        client = api_client(admin)
        denied = client.api_request(
            "post",
            f"/api/v1/admin/courses/{course.id}/transfer",
            {"teacher_id": str(unverified_teacher.id)},
        )
        assert denied.status_code == status.HTTP_400_BAD_REQUEST

        transferred = client.api_request(
            "post",
            f"/api/v1/admin/courses/{course.id}/transfer",
            {"teacher_id": str(new_teacher.id)},
        )
        assert transferred.status_code == status.HTTP_200_OK
        assert transferred.json()["teacher"] == str(new_teacher.id)
        assert Course.objects.filter(pk=course.id, chapters=chapter).exists()
        assert Membership.objects.filter(course=course, student=student).exists()

    def test_course_cannot_be_deleted_with_memberships_or_structure(self, make_user, api_client):
        teacher = make_user(Role.TEACHER)
        student = make_user(Role.STUDENT)
        course = create_course(teacher)
        Membership.objects.create(course=course, student=student)

        blocked = api_client(teacher).api_request("delete", f"/api/v1/courses/{course.id}")
        assert blocked.status_code == status.HTTP_400_BAD_REQUEST
        assert Course.objects.filter(pk=course.id).exists()
