import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from rest_framework import status
from rest_framework.test import APIClient

from assignments.models import (
    AssignmentStatus,
    ReopenWindowScope,
    ReopenWindowTarget,
)
from assignments.services import (
    check_student_eligibility,
    create_assignment,
    create_reopen_window,
    publish_assignment,
    revoke_reopen_window,
    update_assignment,
    validate_submission_commit_eligibility,
)
from courses.models import Course, Membership
from files.models import CourseFilePolicy
from identity.models import Role, RoleGrant, RoleRequest
from identity.services.accounts import confirm_email, create_account
from identity.services.sessions import issue_session


@pytest.fixture
def api_client():
    return APIClient(enforce_csrf_checks=False)


def create_user_with_role(email_prefix: str, role_name: str):
    idx = uuid.uuid4().hex[:6]
    email = f"{email_prefix}_{idx}@example.edu.vn"
    user = create_account(email=email, password="ValidPassword123!", display_name=f"User {idx}")
    confirm_email(user_id=user.id, expected_email=email)

    grant_source = {
        Role.STUDENT: "verified_student_email",
        Role.TEACHER: "teacher_approval",
        Role.ADMIN: "internal_administration",
    }[role_name]

    req = RoleRequest.objects.create(
        user=user,
        role=role_name,
        status=RoleRequest.Status.APPROVED,
        reviewed_by=user,
        reviewed_at=datetime.now(UTC),
        review_reason="fixture_grant",
    )
    RoleGrant.objects.create(
        user=user,
        role=role_name,
        grant_source=grant_source,
        source_request=req,
        granted_by=user if role_name == Role.TEACHER else None,
    )
    return user


def authenticate_client(client: APIClient, user):
    from django.conf import settings

    raw_key, _ = issue_session(user_id=user.id)
    client.cookies[settings.SESSION_COOKIE_NAME] = raw_key
    client.force_authenticate(user=user)
    return raw_key


@pytest.fixture
def teacher_user(db):
    return create_user_with_role("teacher_elig", Role.TEACHER)


@pytest.fixture
def other_teacher_user(db):
    return create_user_with_role("other_teacher_elig", Role.TEACHER)


@pytest.fixture
def student_user(db):
    return create_user_with_role("student_elig", Role.STUDENT)


@pytest.fixture
def other_student_user(db):
    return create_user_with_role("other_student_elig", Role.STUDENT)


@pytest.fixture
def active_course(db, teacher_user, student_user, other_student_user):
    course = Course.objects.create(
        code=f"ARCH{uuid.uuid4().hex[:4].upper()}",
        name="Software Architecture Course",
        term="HK1-2026",
        teacher=teacher_user,
        status=Course.Status.OPEN,
    )
    CourseFilePolicy.objects.create(
        course=course,
        allowed_extensions=["pdf", "docx", "zip"],
        max_file_size_bytes=20 * 1024 * 1024,
        course_quota_bytes=200 * 1024 * 1024,
        preview_allowed=True,
    )
    Membership.objects.create(
        course=course,
        student=student_user,
        status=Membership.Status.ACTIVE,
    )
    Membership.objects.create(
        course=course,
        student=other_student_user,
        status=Membership.Status.ACTIVE,
    )
    return course


@pytest.fixture
def published_assignment(db, active_course, teacher_user):
    now = datetime.now(UTC)
    asg = create_assignment(
        course_id=active_course.id,
        created_by=teacher_user,
        title="Microservices Architecture Lab",
        instructions="Complete the circuit breaker pattern implementation",
        due_at=now + timedelta(days=7),
        allow_late=False,
    )
    return publish_assignment(assignment_id=asg.id, actor=teacher_user)


@pytest.mark.django_db
class TestDeadlineBoundaryAndServerClockAuthority:
    """Kiểm thử biên chính xác deadline, timezone và server authority."""

    def test_one_second_before_deadline_allows_submission_and_replace(
        self, published_assignment, student_user
    ):
        deadline = published_assignment.due_at
        check_time = deadline - timedelta(seconds=1)

        # Chưa có bài nộp trước đó
        elig = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=check_time,
            has_existing_submission=False,
        )
        assert elig["can_submit"] is True
        assert elig["can_replace"] is True
        assert elig["is_late"] is False
        assert elig["reason"] is None

        # Đã có bài nộp trước đó -> trước hạn vẫn cho phép thay revision
        elig_replace = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=check_time,
            has_existing_submission=True,
        )
        assert elig_replace["can_submit"] is True
        assert elig_replace["can_replace"] is True
        assert elig_replace["is_late"] is False

    def test_exact_deadline_allows_submission_and_replace(self, published_assignment, student_user):
        deadline = published_assignment.due_at

        elig = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=deadline,
            has_existing_submission=False,
        )
        assert elig["can_submit"] is True
        assert elig["can_replace"] is True
        assert elig["is_late"] is False

    def test_one_second_after_deadline_without_allow_late_blocks_submission(
        self, published_assignment, student_user
    ):
        deadline = published_assignment.due_at
        check_time = deadline + timedelta(seconds=1)

        elig = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=check_time,
            has_existing_submission=False,
        )
        assert elig["can_submit"] is False
        assert elig["can_replace"] is False
        assert elig["is_late"] is True
        assert elig["reason"] == "DEADLINE_PASSED"

    def test_timezone_conversion_preserves_exact_instant(self, published_assignment, student_user):
        """Đảm bảo server authority quy đổi chính xác mọi timezone về mốc thời gian UTC thực tế."""
        deadline_utc = published_assignment.due_at
        # Giờ Hà Nội (+07:00)
        hanoi_tz = ZoneInfo("Asia/Ho_Chi_Minh")
        deadline_hanoi = deadline_utc.astimezone(hanoi_tz)

        # 10 giây trước deadline theo giờ Hà Nội
        check_hanoi_before = deadline_hanoi - timedelta(seconds=10)
        elig_before = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=check_hanoi_before,
        )
        assert elig_before["can_submit"] is True
        assert elig_before["is_late"] is False

        # 10 giây sau deadline theo giờ Hà Nội
        check_hanoi_after = deadline_hanoi + timedelta(seconds=10)
        elig_after = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=check_hanoi_after,
        )
        assert elig_after["can_submit"] is False
        assert elig_after["is_late"] is True


@pytest.mark.django_db
class TestAllowLateAndReplacementRules:
    """Kiểm thử quy tắc: Sau hạn chỉ nộp lần đầu nếu allowLate; cấm thay thế revision."""

    def test_after_deadline_with_allow_late_allows_first_submission(
        self, published_assignment, teacher_user, student_user
    ):
        # Bật allow_late sau công bố
        update_assignment(
            assignment_id=published_assignment.id,
            actor=teacher_user,
            allow_late=True,
            expected_version=published_assignment.version,
        )
        published_assignment.refresh_from_db()

        after_deadline = published_assignment.due_at + timedelta(hours=2)

        # Nộp lần đầu: cho phép nộp trễ nhưng không cho thay thế tiếp
        elig_first = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=after_deadline,
            has_existing_submission=False,
        )
        assert elig_first["can_submit"] is True
        assert elig_first["can_replace"] is False
        assert elig_first["is_late"] is True
        assert elig_first["reason"] == "LATE_FIRST_SUBMISSION_ALLOWED"

    def test_after_deadline_with_allow_late_blocks_replacement_submission(
        self, published_assignment, teacher_user, student_user
    ):
        update_assignment(
            assignment_id=published_assignment.id,
            actor=teacher_user,
            allow_late=True,
            expected_version=published_assignment.version,
        )
        published_assignment.refresh_from_db()

        after_deadline = published_assignment.due_at + timedelta(hours=2)

        # Nộp thay thế revision sau hạn: Bị chặn tuyệt đối theo quy tắc đã duyệt
        elig_replace = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=after_deadline,
            has_existing_submission=True,
        )
        assert elig_replace["can_submit"] is False
        assert elig_replace["can_replace"] is False
        assert elig_replace["is_late"] is True
        assert elig_replace["reason"] == "LATE_REPLACEMENT_NOT_ALLOWED"


@pytest.mark.django_db
class TestReopenWindowsAndAuditedExceptions:
    """Kiểm thử cửa sổ mở lại do giảng viên chủ động cấp quyền."""

    def test_class_wide_reopen_window_with_all_actions(
        self, published_assignment, teacher_user, student_user
    ):
        now = datetime.now(UTC)
        # Đưa bài tập về quá hạn
        published_assignment.due_at = now - timedelta(hours=2)
        published_assignment.save()

        window_end = now + timedelta(days=2)

        # Tạo cửa sổ mở lại cho toàn bộ lớp với phạm vi ALL_ACTIONS
        window = create_reopen_window(
            assignment_id=published_assignment.id,
            actor=teacher_user,
            target_type=ReopenWindowTarget.ALL,
            end_at=window_end,
            scope=ReopenWindowScope.ALL_ACTIONS,
            reason="Technical outage extension for all students",
        )
        assert window.is_active is True

        check_time = now + timedelta(hours=1)
        elig = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=check_time,
            has_existing_submission=True,  # Muốn thay revision
        )
        assert elig["can_submit"] is True
        assert elig["can_replace"] is True
        assert elig["in_reopen_window"] is True
        assert elig["reopen_window_id"] == str(window.id)
        assert elig["reason"] == "REOPEN_WINDOW_ACTIVE"
        assert elig["effective_deadline"] == window_end.isoformat()

    def test_student_specific_reopen_window_isolates_permissions(
        self, published_assignment, teacher_user, student_user, other_student_user
    ):
        now = datetime.now(UTC)
        # Đưa bài tập về quá hạn
        published_assignment.due_at = now - timedelta(hours=2)
        published_assignment.save()

        window_end = now + timedelta(days=3)

        # Cấp cửa sổ ngoại lệ chỉ cho student_user
        window = create_reopen_window(
            assignment_id=published_assignment.id,
            actor=teacher_user,
            target_type=ReopenWindowTarget.STUDENT,
            student_id=student_user.id,
            end_at=window_end,
            scope=ReopenWindowScope.FIRST_ONLY,
            reason="Medical leave extension",
        )
        assert window.student_id == student_user.id

        check_time = now + timedelta(hours=1)

        # student_user được nộp lần đầu theo cửa sổ ngoại lệ
        elig_target = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=check_time,
            has_existing_submission=False,
        )
        assert elig_target["can_submit"] is True
        assert elig_target["in_reopen_window"] is True
        assert elig_target["reason"] == "REOPEN_WINDOW_FIRST_ONLY"

        # student_user không được thay revision vì scope=FIRST_ONLY
        elig_target_replace = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=check_time,
            has_existing_submission=True,
        )
        assert elig_target_replace["can_submit"] is False
        assert elig_target_replace["reason"] == "REOPEN_WINDOW_NO_REPLACE"

        # other_student_user không có cửa sổ ngoại lệ -> Bị chặn quá hạn bình thường
        elig_other = check_student_eligibility(
            assignment=published_assignment,
            student=other_student_user,
            current_time=check_time,
            has_existing_submission=False,
        )
        assert elig_other["can_submit"] is False
        assert elig_other["in_reopen_window"] is False
        assert elig_other["reason"] == "DEADLINE_PASSED"

    def test_revoking_reopen_window_immediately_blocks_intake(
        self, published_assignment, teacher_user, student_user
    ):
        now = datetime.now(UTC)
        # Đưa bài tập về quá hạn
        published_assignment.due_at = now - timedelta(hours=2)
        published_assignment.save()

        window_end = now + timedelta(days=2)
        window = create_reopen_window(
            assignment_id=published_assignment.id,
            actor=teacher_user,
            target_type=ReopenWindowTarget.ALL,
            end_at=window_end,
            scope=ReopenWindowScope.ALL_ACTIONS,
            reason="Temporary grace window",
        )

        check_time = now + timedelta(hours=1)
        # Trước khi thu hồi: Cho phép
        assert (
            check_student_eligibility(
                assignment=published_assignment, student=student_user, current_time=check_time
            )["can_submit"]
            is True
        )

        # Giảng viên thu hồi cửa sổ
        revoke_reopen_window(window_id=window.id, actor=teacher_user)
        window.refresh_from_db()
        assert window.is_active is False

        # Sau khi thu hồi: Lập tức bị chặn
        elig_after = check_student_eligibility(
            assignment=published_assignment, student=student_user, current_time=check_time
        )
        assert elig_after["can_submit"] is False
        assert elig_after["in_reopen_window"] is False
        assert elig_after["reason"] == "DEADLINE_PASSED"


@pytest.mark.django_db
class TestManualCloseAndArchiveRules:
    """Kiểm thử quy tắc: Đóng thủ công chặn nộp; archive luôn chặn ghi."""

    def test_manual_close_blocks_submission_even_before_deadline(
        self, published_assignment, teacher_user, student_user
    ):
        # Giảng viên đóng nhận bài thủ công trước hạn
        published_assignment.manually_closed_at = datetime.now(UTC)
        published_assignment.status = AssignmentStatus.CLOSED
        published_assignment.save()

        check_time = published_assignment.due_at - timedelta(days=2)
        elig = check_student_eligibility(
            assignment=published_assignment,
            student=student_user,
            current_time=check_time,
        )
        assert elig["can_submit"] is False
        assert elig["manually_closed"] is True
        assert elig["reason"] == "MANUALLY_CLOSED"

    def test_assignment_archived_blocks_submission(self, published_assignment, student_user):
        published_assignment.status = AssignmentStatus.ARCHIVED
        published_assignment.save()

        elig = check_student_eligibility(assignment=published_assignment, student=student_user)
        assert elig["can_submit"] is False
        assert elig["reason"] == "ASSIGNMENT_ARCHIVED"

    def test_course_archived_blocks_submission(
        self, published_assignment, active_course, student_user
    ):
        active_course.status = Course.Status.ARCHIVED
        active_course.archived_at = datetime.now(UTC)
        active_course.save()
        published_assignment.course.refresh_from_db()

        elig = check_student_eligibility(assignment=published_assignment, student=student_user)
        assert elig["can_submit"] is False
        assert elig["reason"] == "COURSE_ARCHIVED"


@pytest.mark.django_db
class TestFilePolicyVersioningAndCommitContract:
    """Kiểm thử: File-policy version áp dụng cho lần nộp tương lai; không vô hiệu hóa bài cũ."""

    def test_file_policy_version_increments_and_applies_at_commit(
        self, published_assignment, teacher_user, student_user
    ):
        initial_policy = published_assignment.file_policy
        assert initial_policy.version == 1

        # Giảng viên cập nhật policy sau công bố: Giới hạn 2 tệp, tối đa 10MB, chỉ pdf
        update_assignment(
            assignment_id=published_assignment.id,
            actor=teacher_user,
            file_policy_data={
                "max_files_per_submission": 2,
                "max_file_size_bytes": 10 * 1024 * 1024,
                "allowed_extensions": ["pdf"],
            },
            expected_version=published_assignment.version,
        )
        published_assignment.refresh_from_db()
        updated_policy = published_assignment.file_policy
        assert updated_policy.version == 2
        assert updated_policy.max_files_per_submission == 2

        # Thẩm định tại commit với 1 tệp pdf hợp lệ -> Hợp lệ theo policy v2
        commit_res_valid = validate_submission_commit_eligibility(
            assignment=published_assignment,
            student=student_user,
            files_info=[{"name": "solution.pdf", "size": 2 * 1024 * 1024}],
        )
        assert commit_res_valid["valid"] is True
        assert commit_res_valid["policy_version_applied"] == 2
        assert commit_res_valid["ai_grading_opt_in"] is False

        # Thẩm định tại commit với 3 tệp (vượt quá 2 tệp của policy v2) -> Bị từ chối
        commit_res_invalid = validate_submission_commit_eligibility(
            assignment=published_assignment,
            student=student_user,
            files_info=[
                {"name": "p1.pdf", "size": 1024},
                {"name": "p2.pdf", "size": 1024},
                {"name": "p3.pdf", "size": 1024},
            ],
        )
        assert commit_res_invalid["valid"] is False
        assert any("Vượt quá số lượng tệp" in err for err in commit_res_invalid["errors"])


@pytest.mark.django_db
class TestEligibilityAndReopenWindowApiEndpoints:
    """Kiểm thử toàn diện các REST API endpoints của B10-04."""

    def test_student_eligibility_api_success(
        self, api_client, active_course, published_assignment, student_user
    ):
        authenticate_client(api_client, student_user)

        res = api_client.get(
            f"/api/v1/courses/{active_course.id}/assignments/{published_assignment.id}/eligibility"
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()
        assert data["can_submit"] is True
        assert data["can_replace"] is True
        assert data["is_late"] is False
        assert data["contract_version"] == "B10-04"
        assert "applicable_file_policy" in data
        assert data["applicable_file_policy"]["version"] == 1

    def test_student_cannot_supply_existing_submission_state(
        self, api_client, active_course, published_assignment, student_user
    ):
        authenticate_client(api_client, student_user)

        res = api_client.get(
            f"/api/v1/courses/{active_course.id}/assignments/{published_assignment.id}/eligibility?has_existing_submission=true"
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "validation_error"

    def test_teacher_reopen_window_crud_api(
        self,
        api_client,
        active_course,
        published_assignment,
        teacher_user,
        student_user,
        other_teacher_user,
    ):
        authenticate_client(api_client, teacher_user)

        # 1. Giảng viên tạo reopen window
        end_time = (datetime.now(UTC) + timedelta(days=2)).isoformat()
        res_create = api_client.post(
            f"/api/v1/courses/{active_course.id}/assignments/{published_assignment.id}/reopen-windows",
            {
                "target_type": "student",
                "student_id": str(student_user.id),
                "end_at": end_time,
                "scope": "all_actions",
                "reason": "Illness medical certificate provided",
            },
            format="json",
        )
        assert res_create.status_code == status.HTTP_201_CREATED
        win_data = res_create.json()
        assert win_data["target_type"] == "student"
        assert win_data["student_id"] == str(student_user.id)
        assert win_data["is_active"] is True
        window_id = win_data["id"]

        # 2. Liệt kê danh sách reopen windows
        res_list = api_client.get(
            f"/api/v1/courses/{active_course.id}/assignments/{published_assignment.id}/reopen-windows"
        )
        assert res_list.status_code == status.HTTP_200_OK
        assert len(res_list.json()) == 1

        # 3. Giảng viên khác cố tình can thiệp -> 403 Forbidden
        authenticate_client(api_client, other_teacher_user)
        res_other = api_client.delete(
            f"/api/v1/courses/{active_course.id}/assignments/{published_assignment.id}/reopen-windows/{window_id}"
        )
        assert res_other.status_code == status.HTTP_403_FORBIDDEN

        # 4. Giảng viên sở hữu thu hồi window
        authenticate_client(api_client, teacher_user)
        res_del = api_client.delete(
            f"/api/v1/courses/{active_course.id}/assignments/{published_assignment.id}/reopen-windows/{window_id}"
        )
        assert res_del.status_code == status.HTTP_200_OK
        assert res_del.json()["is_active"] is False
