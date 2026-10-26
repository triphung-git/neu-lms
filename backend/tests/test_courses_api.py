import itertools
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from django.conf import settings
from django.db import close_old_connections
from django.test import Client
from django.utils import timezone
from rest_framework import status

from courses.models import Chapter, Course, Lesson, Membership
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


@pytest.mark.django_db
class TestCourseAcceptance:
    def test_invalid_course_id_returns_404(self, make_user, api_client):
        client = api_client(make_user(Role.TEACHER))
        for suffix in ("", "/archive"):
            response = client.api_request(
                "get" if not suffix else "post", f"/api/v1/courses/not-a-uuid{suffix}"
            )
            assert response.status_code == 404

    def test_multirole_owner_member_count_is_not_multiplied(self, make_user, api_client):
        owner = make_user(Role.TEACHER)
        student_request = RoleRequest.objects.create(
            user=owner,
            role=Role.STUDENT,
            status="approved",
            reviewed_by=owner,
            reviewed_at=timezone.now(),
            review_reason="course_test",
        )
        RoleGrant.objects.create(
            user=owner,
            role=Role.STUDENT,
            grant_source="verified_student_email",
            source_request=student_request,
        )
        course = create_course(owner)
        for _ in range(3):
            Membership.objects.create(course=course, student=make_user(Role.STUDENT))
        client = api_client(owner)
        assert client.get(f"/api/v1/courses/{course.id}").json()["active_member_count"] == 3
        response = client.api_request("post", f"/api/v1/courses/{course.id}/archive")
        assert response.status_code == 200
        assert response.json()["active_member_count"] == 3

    def test_foreign_owner_student_and_admin_cannot_edit_content(self, make_user, api_client):
        course = create_course(make_user(Role.TEACHER))
        chapter = Chapter.objects.create(course=course, title="Chapter", position=1)
        lesson = Lesson.objects.create(chapter=chapter, title="Lesson", position=1)
        base = f"/api/v1/courses/{course.id}"
        for role in (Role.TEACHER, Role.STUDENT, Role.ADMIN):
            user = make_user(role)
            if role == Role.STUDENT:
                Membership.objects.create(course=course, student=user)
            client = api_client(user)
            for method, url, body in [
                ("patch", base, {"name": "Forbidden"}),
                ("delete", base, None),
                ("post", f"{base}/chapters", {"title": "Forbidden"}),
                ("patch", f"{base}/chapters/{chapter.id}", {"title": "Forbidden"}),
                ("delete", f"{base}/chapters/{chapter.id}", None),
                ("post", f"{base}/chapters/reorder", {"ids": [str(chapter.id)]}),
                ("post", f"{base}/chapters/{chapter.id}/lessons", {"title": "Forbidden"}),
                (
                    "patch",
                    f"{base}/chapters/{chapter.id}/lessons/{lesson.id}",
                    {"title": "Forbidden"},
                ),
                ("delete", f"{base}/chapters/{chapter.id}/lessons/{lesson.id}", None),
                (
                    "post",
                    f"{base}/chapters/{chapter.id}/lessons/reorder",
                    {"ids": [str(lesson.id)]},
                ),
            ]:
                assert client.api_request(method, url, body).status_code in (403, 404)
        course.refresh_from_db()
        chapter.refresh_from_db()
        lesson.refresh_from_db()
        assert course.name != "Forbidden"
        assert chapter.title == "Chapter" and lesson.title == "Lesson"

    def test_course_mutations_require_csrf(self, make_user, api_client):
        owner = make_user(Role.TEACHER)
        course = create_course(owner)
        client = api_client(owner)
        for method, url in [
            ("post", "/api/v1/courses"),
            ("patch", f"/api/v1/courses/{course.id}"),
            ("delete", f"/api/v1/courses/{course.id}"),
            ("post", f"/api/v1/courses/{course.id}/archive"),
            ("post", f"/api/v1/courses/{course.id}/chapters"),
        ]:
            response = getattr(client, method)(url, data="{}", content_type="application/json")
            assert response.status_code == 403
        course.refresh_from_db()
        assert course.status == "open"

    def test_reorder_rejects_missing_duplicate_and_foreign_ids_atomically(
        self, make_user, api_client
    ):
        owner = make_user(Role.TEACHER)
        course = create_course(owner)
        client = api_client(owner)
        chapters = [
            Chapter.objects.create(course=course, title=f"Chapter {i}", position=i) for i in (1, 2)
        ]
        foreign = Chapter.objects.create(course=create_course(owner), title="Other", position=1)
        lessons = [
            Lesson.objects.create(chapter=chapters[0], title=f"Lesson {i}", position=i)
            for i in (1, 2)
        ]
        for url, objects, foreign_id in [
            (f"/api/v1/courses/{course.id}/chapters/reorder", chapters, foreign.id),
            (
                f"/api/v1/courses/{course.id}/chapters/{chapters[0].id}/lessons/reorder",
                lessons,
                uuid.uuid4(),
            ),
        ]:
            for ids in (
                [],
                [objects[0].id],
                [objects[0].id, objects[0].id],
                [objects[0].id, foreign_id],
            ):
                response = client.api_request("post", url, {"ids": [str(item) for item in ids]})
                assert response.status_code == 400
                for obj in objects:
                    obj.refresh_from_db()
                assert [obj.position for obj in objects] == [1, 2]
            response = client.api_request(
                "post", url, {"ids": [str(obj.id) for obj in reversed(objects)]}
            )
            assert response.status_code == 200
            assert [item["id"] for item in response.json()] == [
                str(obj.id) for obj in reversed(objects)
            ]

    def test_transfer_revokes_previous_owner_and_archived_mutations_are_blocked(
        self, make_user, api_client
    ):
        admin = make_user(Role.ADMIN)
        old = make_user(Role.TEACHER)
        new = make_user(Role.TEACHER)
        course = create_course(old)
        client = api_client(admin)
        base = f"/api/v1/courses/{course.id}"
        assert (
            client.api_request(
                "post", f"/api/v1/admin/courses/{course.id}/transfer", {"teacher_id": str(new.id)}
            ).status_code
            == 200
        )
        assert api_client(old).get(base).status_code == 404
        new_client = api_client(new)
        assert new_client.api_request("patch", base, {"name": "New owner"}).status_code == 200
        assert client.api_request("post", f"{base}/archive").status_code == 200
        assert (
            client.api_request(
                "post", f"/api/v1/admin/courses/{course.id}/transfer", {"teacher_id": str(old.id)}
            ).status_code
            == 400
        )
        for method in ("patch", "delete"):
            assert (
                new_client.api_request(
                    method, base, {"enrollment_open": True} if method == "patch" else None
                ).status_code
                == 403
            )
        assert new_client.get(base).status_code == 200

    def test_case_insensitive_unique_code_and_empty_course_deletion(self, make_user, api_client):
        owner = make_user(Role.TEACHER)
        course = create_course(owner, code="SAME")
        client = api_client(owner)
        response = client.api_request(
            "post", "/api/v1/courses", {"code": " same ", "name": "Duplicate", "term": "HK1"}
        )
        assert response.status_code == 400
        assert client.api_request("delete", f"/api/v1/courses/{course.id}").status_code == 204
        assert not Course.objects.filter(pk=course.id).exists()


@pytest.mark.django_db(transaction=True)
class TestCourseConcurrency:
    def test_concurrent_reorders_leave_one_complete_order(self, make_user):
        from courses.services import reorder_chapters

        owner = make_user(Role.TEACHER)
        course = create_course(owner)
        chapters = [
            Chapter.objects.create(course=course, title=f"C{i}", position=i) for i in (1, 2, 3)
        ]
        ids = [chapter.id for chapter in chapters]
        orders = [ids[::-1], [ids[1], ids[2], ids[0]]]
        barrier = Barrier(2)

        def run(order):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                return [chapter.id for chapter in reorder_chapters(owner, course.id, order)]
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, orders))
        assert results == orders
        final = list(
            Chapter.objects.filter(course=course).order_by("position").values_list("id", flat=True)
        )
        assert final in orders
        assert list(
            Chapter.objects.filter(course=course)
            .order_by("position")
            .values_list("position", flat=True)
        ) == [1, 2, 3]

    def test_archive_and_reorder_serialize_without_partial_state(self, make_user):
        from rest_framework.exceptions import PermissionDenied

        from courses.services import archive_course, reorder_chapters

        owner = make_user(Role.TEACHER)
        course = create_course(owner, enrollment_open=True)
        chapters = [
            Chapter.objects.create(course=course, title=f"C{i}", position=i) for i in (1, 2)
        ]
        barrier = Barrier(2)

        def run(action):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                if action == "archive":
                    archive_course(owner, course.id)
                    return "archived"
                try:
                    reorder_chapters(owner, course.id, [chapter.id for chapter in chapters[::-1]])
                    return "reordered"
                except PermissionDenied:
                    return "blocked"
            finally:
                close_old_connections()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(run, ["archive", "reorder"]))
        assert results[0] == "archived" and results[1] in ("blocked", "reordered")
        course.refresh_from_db()
        assert course.status == "archived" and course.enrollment_open is False
        assert list(
            Chapter.objects.filter(course=course)
            .order_by("position")
            .values_list("position", flat=True)
        ) == [1, 2]
