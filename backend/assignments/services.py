import hashlib
import uuid
from decimal import Decimal
from typing import Any

from django.core.exceptions import PermissionDenied
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from courses.models import Chapter, Course, Lesson, Membership
from files.models import CourseFilePolicy, FilePurpose, FileStatus, StoredFile
from files.storage import get_storage
from identity.models import Role, User
from identity.services.common import has_role, lock_role_policy, require_verified
from platform_core.errors import DomainError
from platform_core.events import record_change

from .constants import (
    DEFAULT_ASSIGNMENT_ALLOWED_EXTENSIONS,
    DEFAULT_MAX_FILE_SIZE_BYTES,
    DEFAULT_MAX_FILES_PER_SUBMISSION,
)
from .exceptions import (
    AssignmentConflictError,
    AssignmentImmutableError,
    AssignmentNotFoundError,
    AssignmentPermissionDeniedError,
    AssignmentValidationError,
    CourseArchivedError,
)
from .models import (
    Assignment,
    AssignmentAttachment,
    AssignmentFilePolicy,
    AssignmentPublicationSnapshot,
    AssignmentReopenWindow,
    AssignmentRubricCriterion,
    AssignmentStatus,
    ReopenWindowScope,
    ReopenWindowTarget,
)


def _check_teacher_assignment_permission(
    course_id: uuid.UUID | str, user: Any, for_update: bool = False
) -> tuple[User, Course]:
    """Kiểm tra quyền hạn và sở hữu của giảng viên đối với môn học theo thứ tự khóa nhất quán.

    Thứ tự khóa (khi for_update=True):
    1. Identity role policy (lock_role_policy)
    2. User refresh & verification (tài khoản active, verified, có role TEACHER)
    3. Course select_for_update (khóa môn học, kiểm tra chưa lưu trữ, đúng chủ sở hữu)
    Nghiêm cấm admin-only, giảng viên khác và sinh viên biên soạn bài tập.
    """
    if not user or not user.is_authenticated:
        raise PermissionDenied("Yêu cầu đăng nhập để thực hiện thao tác này.")

    if for_update:
        lock_role_policy()
    actor = User.objects.filter(pk=user.id, is_active=True).first()
    if not actor:
        raise DomainError("ACCOUNT_INACTIVE")
    require_verified(actor)

    if not has_role(actor, Role.TEACHER):
        raise PermissionDenied("Bạn không có quyền quản lý bài tập môn học này.")

    try:
        course_qs = Course.objects.select_for_update() if for_update else Course.objects
        course = course_qs.get(pk=course_id)
    except Course.DoesNotExist as err:
        raise AssignmentNotFoundError("Môn học không tồn tại.") from err

    if for_update and course.status == Course.Status.ARCHIVED:
        raise CourseArchivedError("Môn học đã lưu trữ, không thể thực hiện thay đổi.")

    if course.teacher_id != actor.id:
        raise PermissionDenied("Chỉ giảng viên phụ trách môn học mới được biên soạn bài tập.")

    return actor, course


def _locked_assignment(assignment_id, actor):
    course_id = (
        Assignment.objects.filter(pk=assignment_id).values_list("course_id", flat=True).first()
    )
    if course_id is None:
        raise AssignmentNotFoundError()
    actor, course = _check_teacher_assignment_permission(course_id, actor, for_update=True)
    assignment = Assignment.objects.select_for_update().get(pk=assignment_id)
    assignment.course = course
    return assignment, actor


def _validate_attachments(course, files, assignment_id=None, verify_bytes=False):
    files = list(files)
    policy, _ = CourseFilePolicy.objects.get_or_create(course=course)
    if len(files) > policy.max_files_per_assignment:
        raise AssignmentValidationError("Vượt số tệp đính kèm được phép của môn học.")
    for item in files:
        if (
            item.course_id != course.pk
            or item.purpose != FilePurpose.ASSIGNMENT_ATTACHMENT
            or item.status != FileStatus.CLEAN
        ):
            raise AssignmentValidationError("Tệp chưa sạch hoặc không đúng phạm vi bài tập.")
        target = item.policy_snapshot.get("assignment_id")
        if target and target != str(assignment_id):
            raise AssignmentValidationError("Tệp thuộc bài tập khác.")
        extension = item.file_name.rsplit(".", 1)[-1].lower()
        if (
            extension not in policy.allowed_extensions
            or item.file_size > policy.max_file_size_bytes
        ):
            raise AssignmentValidationError("Tệp không đáp ứng chính sách hiện hành của môn học.")
        if verify_bytes:
            if not get_storage().exists(item.storage_path):
                raise AssignmentValidationError("Tệp không còn khả dụng trong kho lưu trữ.")
            content = get_storage().read(item.storage_path)
            if (
                len(content) != item.file_size
                or hashlib.sha256(content).hexdigest() != item.sha256_hash
            ):
                raise AssignmentValidationError("Nội dung tệp không khớp bản đã xác minh.")


def _check_assignment_read_permission(
    course_id: uuid.UUID | str, assignment_id: uuid.UUID | str, user: Any
) -> tuple[User, Course, Assignment]:
    """Kiểm tra quyền đọc bài tập của người dùng:
    - Yêu cầu đăng nhập, tài khoản active và email đã xác minh.
    - Môn học và bài tập phải tồn tại và liên kết với nhau.
    - Giảng viên phụ trách môn học: được phép xem toàn bộ trạng thái (kể cả draft và archived).
    - Sinh viên có ghi danh hợp lệ (active membership): được phép xem bài tập đã công bố
      (published, closed, archived); nghiêm cấm xem bài tập nháp (draft).
    - Giảng viên khác, admin-only, sinh viên đã rút học phần (withdrawn) hoặc ngoài môn học:
      bị từ chối 403.
    """
    if not user or not user.is_authenticated:
        raise PermissionDenied("Yêu cầu đăng nhập để xem bài tập.")

    actor = User.objects.filter(pk=user.id, is_active=True).first()
    if not actor:
        raise DomainError("ACCOUNT_INACTIVE")
    require_verified(actor)

    try:
        course = Course.objects.get(pk=course_id)
    except Course.DoesNotExist as err:
        raise AssignmentNotFoundError("Môn học không tồn tại.") from err

    try:
        assignment = (
            Assignment.objects.select_related("chapter", "lesson", "course")
            .prefetch_related("rubric_criteria", "attachments__file")
            .get(pk=assignment_id, course=course)
        )
    except Assignment.DoesNotExist as err:
        raise AssignmentNotFoundError("Bài tập không tồn tại.") from err

    is_teacher = has_role(actor, Role.TEACHER) and course.teacher_id == actor.id
    is_student = (
        has_role(actor, Role.STUDENT)
        and Membership.objects.filter(
            course=course, student=actor, status=Membership.Status.ACTIVE
        ).exists()
    )

    if not (is_teacher or is_student):
        raise AssignmentPermissionDeniedError("Bạn không có quyền truy cập bài tập này.")

    if is_student and not is_teacher:
        if assignment.published_at is None or assignment.status == AssignmentStatus.DRAFT:
            raise AssignmentPermissionDeniedError("Bài tập chưa được công bố.")

    return actor, course, assignment


def _check_course_published_assignments_access(
    course_id: uuid.UUID | str, user: Any
) -> tuple[User, Course]:
    """Kiểm tra quyền truy cập danh sách bài tập công bố của môn học:
    - Yêu cầu đăng nhập, active, verified.
    - Phải là giảng viên phụ trách môn học hoặc sinh viên có ghi danh active.
    """
    if not user or not user.is_authenticated:
        raise PermissionDenied("Yêu cầu đăng nhập để xem danh sách bài tập.")

    actor = User.objects.filter(pk=user.id, is_active=True).first()
    if not actor:
        raise DomainError("ACCOUNT_INACTIVE")
    require_verified(actor)

    try:
        course = Course.objects.get(pk=course_id)
    except Course.DoesNotExist as err:
        raise AssignmentNotFoundError("Môn học không tồn tại.") from err

    is_teacher = has_role(actor, Role.TEACHER) and course.teacher_id == actor.id
    is_student = (
        has_role(actor, Role.STUDENT)
        and Membership.objects.filter(
            course=course, student=actor, status=Membership.Status.ACTIVE
        ).exists()
    )

    if not (is_teacher or is_student):
        raise AssignmentPermissionDeniedError(
            "Bạn không có quyền truy cập bài tập của môn học này."
        )

    return actor, course


@transaction.atomic
def create_assignment(
    *,
    course_id: uuid.UUID | str,
    title: str,
    due_at: Any,
    created_by: Any,
    instructions: str = "",
    allow_late: bool = False,
    chapter_id: uuid.UUID | str | None = None,
    lesson_id: uuid.UUID | str | None = None,
    ai_grading_opt_in: bool = False,
    rubric_criteria_data: list[dict[str, Any]] | None = None,
    file_policy_data: dict[str, Any] | None = None,
    attachment_file_ids: list[uuid.UUID | str] | None = None,
    publish_immediately: bool = False,
) -> Assignment:
    """Tạo mới một bài tập với các tiêu chí rubric và chính sách tệp."""
    created_by, course = _check_teacher_assignment_permission(
        course_id, created_by, for_update=True
    )

    if not title or not title.strip():
        raise AssignmentValidationError(
            "Tiêu đề bài tập không được để trống.",
            field_errors={"title": ["Tiêu đề bài tập không được để trống."]},
        )

    if not due_at:
        raise AssignmentValidationError(
            "Hạn nộp bài tập không được để trống.",
            field_errors={"due_at": ["Hạn nộp bài tập không được để trống."]},
        )

    # 1.1 Kiểm tra liên kết chương / bài học thuộc cùng môn học
    if chapter_id:
        if not Chapter.objects.filter(pk=chapter_id, course=course).exists():
            raise AssignmentValidationError(
                "Chương không thuộc môn học này hoặc không tồn tại.",
                field_errors={"chapter_id": ["Chương không thuộc môn học này hoặc không tồn tại."]},
            )

    if lesson_id:
        lesson_qs = Lesson.objects.filter(pk=lesson_id, chapter__course=course)
        if chapter_id:
            lesson_qs = lesson_qs.filter(chapter_id=chapter_id)
        if not lesson_qs.exists():
            raise AssignmentValidationError(
                "Bài học không thuộc môn học này hoặc không tồn tại.",
                field_errors={"lesson_id": ["Bài học không thuộc môn học này hoặc không tồn tại."]},
            )

    # 1.2 Kiểm tra tệp đính kèm thuộc cùng môn học, đã clean và đúng mục đích
    validated_files = []
    if attachment_file_ids:
        deduped_ids = list(dict.fromkeys(attachment_file_ids))
        for f_id in deduped_ids:
            stored_file = StoredFile.objects.filter(pk=f_id, course=course).first()
            if not stored_file:
                raise AssignmentValidationError(
                    "Tệp đính kèm không thuộc môn học này hoặc không tồn tại.",
                    field_errors={
                        "attachment_file_ids": [
                            "Tệp đính kèm không thuộc môn học này hoặc không tồn tại."
                        ]
                    },
                )
            if stored_file.status != FileStatus.CLEAN:
                raise AssignmentValidationError(
                    "Tệp đính kèm chưa được kiểm tra an toàn hoặc có mã độc.",
                    field_errors={
                        "attachment_file_ids": ["Tệp đính kèm chưa được kiểm tra an toàn."]
                    },
                )
            if stored_file.purpose != FilePurpose.ASSIGNMENT_ATTACHMENT:
                raise AssignmentValidationError(
                    "Tệp đính kèm không đúng mục đích đính kèm bài tập.",
                    field_errors={
                        "attachment_file_ids": [
                            "Tệp đính kèm không đúng mục đích đính kèm bài tập."
                        ]
                    },
                )
            validated_files.append(stored_file)

    _validate_attachments(course, validated_files)
    # 2. Khởi tạo đối tượng Assignment
    assignment = Assignment(
        course=course,
        chapter_id=chapter_id,
        lesson_id=lesson_id,
        title=title.strip(),
        instructions=instructions or "",
        status=AssignmentStatus.DRAFT,
        due_at=due_at,
        allow_late=allow_late,
        ai_grading_opt_in=ai_grading_opt_in,
        created_by=created_by,
        updated_by=created_by,
        version=1,
    )
    assignment.save()

    # 3. Tạo các tiêu chí rubric
    criteria_list = rubric_criteria_data or []
    for idx, c_data in enumerate(criteria_list):
        crit_title = c_data.get("title", f"Tiêu chí {idx + 1}")
        crit_desc = c_data.get("description", "")
        crit_score = Decimal(str(c_data.get("max_score", "10.00")))
        crit_pos = c_data.get("position", idx + 1)

        AssignmentRubricCriterion.objects.create(
            assignment=assignment,
            title=crit_title,
            description=crit_desc,
            max_score=crit_score,
            position=crit_pos,
        )

    # 4. Tạo chính sách tệp
    fp_data = file_policy_data or {}
    max_files = fp_data.get("max_files_per_submission", DEFAULT_MAX_FILES_PER_SUBMISSION)
    max_size = fp_data.get("max_file_size_bytes", DEFAULT_MAX_FILE_SIZE_BYTES)
    allowed_exts = fp_data.get("allowed_extensions", DEFAULT_ASSIGNMENT_ALLOWED_EXTENSIONS)

    AssignmentFilePolicy.objects.create(
        assignment=assignment,
        max_files_per_submission=max_files,
        max_file_size_bytes=max_size,
        allowed_extensions=allowed_exts,
        version=1,
    )

    # 5. Gắn tệp đính kèm đề bài nếu có
    for stored_file in validated_files:
        AssignmentAttachment.objects.create(
            assignment=assignment,
            file=stored_file,
            name=stored_file.file_name,
            size_bytes=stored_file.file_size,
        )

    # 6. Ghi nhận nhật ký kiểm toán (Audit Event)
    record_change(
        action="assignments.created",
        resource_type="assignment",
        resource_id=assignment.id,
        actor=created_by,
        metadata={"course_id": str(course.id), "assignment_id": str(assignment.id)},
    )

    # 7. Công bố ngay nếu có yêu cầu
    if publish_immediately:
        publish_assignment(assignment_id=assignment.id, actor=created_by)
        assignment.refresh_from_db()

    return assignment


@transaction.atomic
def update_assignment(
    *,
    assignment_id: uuid.UUID | str,
    actor: Any,
    expected_version: int | None = None,
    title: str | None = None,
    instructions: str | None = None,
    due_at: Any = None,
    allow_late: bool | None = None,
    chapter_id: uuid.UUID | str | None = ...,  # Sentinel for default
    lesson_id: uuid.UUID | str | None = ...,
    ai_grading_opt_in: bool | None = None,
    rubric_criteria_data: list[dict[str, Any]] | None = None,
    file_policy_data: dict[str, Any] | None = None,
    attachment_file_ids: list[uuid.UUID | str] | None = None,
) -> Assignment:
    """Cập nhật thông tin bài tập, kiểm soát tương tranh lạc quan và bất biến khi đã công bố."""
    assignment, actor = _locked_assignment(assignment_id, actor)

    # 1. Kiểm tra trạng thái môn học
    if assignment.course.status == Course.Status.ARCHIVED:
        raise CourseArchivedError()
    if assignment.status == AssignmentStatus.ARCHIVED:
        raise AssignmentValidationError("Bài tập đã lưu trữ và chỉ được đọc.")

    # 2. Kiểm soát tương tranh lạc quan (Optimistic Concurrency Control)
    if expected_version is not None and assignment.version != expected_version:
        raise AssignmentConflictError()

    is_published_or_beyond = assignment.status in [
        AssignmentStatus.PUBLISHED,
        AssignmentStatus.CLOSED,
        AssignmentStatus.ARCHIVED,
    ]

    # 3. Kiểm tra bất biến đề bài và rubric khi bài tập đã công bố (IMMUTABLE_AFTER_PUBLISH)
    if is_published_or_beyond:
        if title is not None and title.strip() != assignment.title:
            raise AssignmentImmutableError(
                "Không được phép sửa tiêu đề bài tập sau khi bài tập đã công bố."
            )
        if instructions is not None and instructions != assignment.instructions:
            raise AssignmentImmutableError(
                "Không được phép sửa nội dung đề bài sau khi bài tập đã công bố."
            )
        if rubric_criteria_data is not None:
            raise AssignmentImmutableError(
                "Không được phép chỉnh sửa tiêu chí rubric sau khi bài tập đã công bố."
            )
        if attachment_file_ids is not None:
            raise AssignmentImmutableError(
                "Không được phép sửa tệp đính kèm của bài tập đã công bố."
            )

    # 4. Cập nhật các trường được phép
    if not is_published_or_beyond:
        # Trong bản nháp (draft), được phép cập nhật tiêu đề và yêu cầu
        if title is not None:
            if not title.strip():
                raise AssignmentValidationError("Tiêu đề bài tập không được để trống.")
            assignment.title = title.strip()
        if instructions is not None:
            assignment.instructions = instructions

        # Cập nhật rubric trong bản nháp
        if rubric_criteria_data is not None:
            assignment.rubric_criteria.all().delete()
            for idx, c_data in enumerate(rubric_criteria_data):
                crit_title = c_data.get("title", f"Tiêu chí {idx + 1}")
                crit_desc = c_data.get("description", "")
                crit_score = Decimal(str(c_data.get("max_score", "10.00")))
                crit_pos = c_data.get("position", idx + 1)
                AssignmentRubricCriterion.objects.create(
                    assignment=assignment,
                    title=crit_title,
                    description=crit_desc,
                    max_score=crit_score,
                    position=crit_pos,
                )

        # Cập nhật tệp đính kèm trong bản nháp
        if attachment_file_ids is not None:
            deduped_ids = list(dict.fromkeys(attachment_file_ids))
            validated_files = []
            for f_id in deduped_ids:
                stored_file = StoredFile.objects.filter(pk=f_id, course=assignment.course).first()
                if not stored_file:
                    raise AssignmentValidationError(
                        "Tệp đính kèm không thuộc môn học này hoặc không tồn tại.",
                        field_errors={
                            "attachment_file_ids": [
                                "Tệp đính kèm không thuộc môn học này hoặc không tồn tại."
                            ]
                        },
                    )
                if stored_file.status != FileStatus.CLEAN:
                    raise AssignmentValidationError(
                        "Tệp đính kèm chưa được kiểm tra an toàn hoặc có mã độc.",
                        field_errors={
                            "attachment_file_ids": ["Tệp đính kèm chưa được kiểm tra an toàn."]
                        },
                    )
                if stored_file.purpose != FilePurpose.ASSIGNMENT_ATTACHMENT:
                    raise AssignmentValidationError(
                        "Tệp đính kèm không đúng mục đích đính kèm bài tập.",
                        field_errors={
                            "attachment_file_ids": [
                                "Tệp đính kèm không đúng mục đích đính kèm bài tập."
                            ]
                        },
                    )
                validated_files.append(stored_file)

            _validate_attachments(assignment.course, validated_files, assignment.id)
            assignment.attachments.all().delete()
            for stored_file in validated_files:
                AssignmentAttachment.objects.create(
                    assignment=assignment,
                    file=stored_file,
                    name=stored_file.file_name,
                    size_bytes=stored_file.file_size,
                )

    # Các trường được phép cập nhật sau khi công bố:
    if due_at is not None:
        assignment.due_at = due_at

    if allow_late is not None:
        assignment.allow_late = allow_late

    if ai_grading_opt_in is not None:
        assignment.ai_grading_opt_in = ai_grading_opt_in

    if chapter_id is not ...:
        if (
            chapter_id is not None
            and not Chapter.objects.filter(pk=chapter_id, course=assignment.course).exists()
        ):
            raise AssignmentValidationError(
                "Chương không thuộc môn học này hoặc không tồn tại.",
                field_errors={"chapter_id": ["Chương không thuộc môn học này hoặc không tồn tại."]},
            )
        assignment.chapter_id = chapter_id

    if lesson_id is not ...:
        if lesson_id is not None:
            lesson_qs = Lesson.objects.filter(pk=lesson_id, chapter__course=assignment.course)
            effective_chapter_id = assignment.chapter_id if chapter_id is ... else chapter_id
            if effective_chapter_id:
                lesson_qs = lesson_qs.filter(chapter_id=effective_chapter_id)
            if not lesson_qs.exists():
                raise AssignmentValidationError(
                    "Bài học không thuộc môn học này hoặc không tồn tại.",
                    field_errors={
                        "lesson_id": ["Bài học không thuộc môn học này hoặc không tồn tại."]
                    },
                )
        assignment.lesson_id = lesson_id

    # Cập nhật File Policy cho các lần nộp sau
    if file_policy_data is not None:
        policy, _ = AssignmentFilePolicy.objects.get_or_create(assignment=assignment)
        if "max_files_per_submission" in file_policy_data:
            policy.max_files_per_submission = file_policy_data["max_files_per_submission"]
        if "max_file_size_bytes" in file_policy_data:
            policy.max_file_size_bytes = file_policy_data["max_file_size_bytes"]
        if "allowed_extensions" in file_policy_data:
            policy.allowed_extensions = file_policy_data["allowed_extensions"]
        policy.version += 1
        policy.save()

    # Tăng phiên bản bài tập
    assignment.version += 1
    assignment.updated_by = actor
    assignment.save()

    # Ghi nhận nhật ký kiểm toán
    record_change(
        action="assignments.updated",
        resource_type="assignment",
        resource_id=assignment.id,
        actor=actor,
        metadata={
            "course_id": str(assignment.course_id),
            "assignment_id": str(assignment.id),
            "version": str(assignment.version),
        },
    )

    return assignment


@transaction.atomic
def publish_assignment(
    *,
    assignment_id: uuid.UUID | str,
    actor: Any,
) -> Assignment:
    """Công bố bài tập cho sinh viên và tạo snapshot lưu trữ bất biến."""
    assignment, actor = _locked_assignment(assignment_id, actor)

    if assignment.course.status == Course.Status.ARCHIVED:
        raise CourseArchivedError()

    if assignment.status == AssignmentStatus.PUBLISHED:
        # Idempotent: nếu đã publish rồi thì trả về
        return assignment
    if assignment.status != AssignmentStatus.DRAFT:
        raise AssignmentValidationError("Chỉ được công bố bài tập đang ở bản nháp.")
    _validate_attachments(
        assignment.course,
        [attachment.file for attachment in assignment.attachments.select_related("file")],
        assignment.id,
        verify_bytes=True,
    )

    if not assignment.title.strip():
        raise AssignmentValidationError("Tiêu đề bài tập không được để trống khi công bố.")

    if not assignment.due_at:
        raise AssignmentValidationError("Hạn nộp bài tập không được để trống khi công bố.")

    # Thu thập dữ liệu rubric hiện tại để tạo Snapshot
    rubric_list = [
        {
            "id": str(c.id),
            "title": c.title,
            "description": c.description,
            "max_score": str(c.max_score),
            "position": c.position,
        }
        for c in assignment.rubric_criteria.all()
    ]

    # Thu thập file policy
    policy = getattr(assignment, "file_policy", None)
    file_policy_dict = (
        {
            "max_files_per_submission": policy.max_files_per_submission,
            "max_file_size_bytes": policy.max_file_size_bytes,
            "allowed_extensions": policy.allowed_extensions,
            "version": policy.version,
        }
        if policy
        else {}
    )

    # Thu thập attachments
    attachments_list = [
        {
            "id": str(a.id),
            "file_id": str(a.file_id),
            "name": a.name,
            "size_bytes": a.size_bytes,
            "sha256_hash": a.file.sha256_hash,
            "mime_type": a.file.mime_type,
        }
        for a in assignment.attachments.select_related("file").all()
    ]

    now = timezone.now()

    # Tạo Snapshot bất biến
    AssignmentPublicationSnapshot.objects.create(
        assignment=assignment,
        snapshot_version=assignment.version,
        snapshot_title=assignment.title,
        snapshot_instructions=assignment.instructions,
        snapshot_rubric=rubric_list,
        snapshot_file_policy=file_policy_dict,
        snapshot_attachments=attachments_list,
        published_at=now,
        published_by=actor,
    )

    # Cập nhật trạng thái
    assignment.status = AssignmentStatus.PUBLISHED
    assignment.published_at = now
    assignment.updated_by = actor
    assignment.version += 1
    assignment.save()

    # Ghi nhận nhật ký kiểm toán
    record_change(
        action="assignments.published",
        resource_type="assignment",
        resource_id=assignment.id,
        actor=actor,
        metadata={
            "course_id": str(assignment.course_id),
            "assignment_id": str(assignment.id),
            "version": str(assignment.version),
        },
    )

    return assignment


@transaction.atomic
def close_assignment(
    *,
    assignment_id: uuid.UUID | str,
    actor: Any,
    reason: str = "",
) -> Assignment:
    """Đóng nhận bài sớm thủ công bởi giảng viên."""
    assignment, actor = _locked_assignment(assignment_id, actor)
    if assignment.status == AssignmentStatus.CLOSED:
        return assignment
    if assignment.status != AssignmentStatus.PUBLISHED or assignment.published_at is None:
        raise AssignmentValidationError("Chỉ được đóng bài tập đã công bố.")

    if assignment.course.status == Course.Status.ARCHIVED:
        raise CourseArchivedError()

    assignment.status = AssignmentStatus.CLOSED
    assignment.manually_closed_at = timezone.now()
    assignment.updated_by = actor
    assignment.version += 1
    assignment.save()

    # Ghi nhận nhật ký kiểm toán
    record_change(
        action="assignments.closed",
        resource_type="assignment",
        resource_id=assignment.id,
        actor=actor,
        metadata={"course_id": str(assignment.course_id), "assignment_id": str(assignment.id)},
    )

    return assignment


@transaction.atomic
def reopen_assignment(
    *,
    assignment_id: uuid.UUID | str,
    actor: Any,
    reopen_until: Any = None,
    reason: str = "",
) -> Assignment:
    """Mở lại bài tập đã đóng và tùy chọn gia hạn thời hạn nộp bài."""
    assignment, actor = _locked_assignment(assignment_id, actor)
    if (
        assignment.status not in {AssignmentStatus.CLOSED, AssignmentStatus.PUBLISHED}
        or assignment.published_at is None
    ):
        raise AssignmentValidationError("Chỉ được mở lại bài tập đã công bố và chưa lưu trữ.")

    if assignment.course.status == Course.Status.ARCHIVED:
        raise CourseArchivedError()

    assignment.status = AssignmentStatus.PUBLISHED
    assignment.manually_closed_at = None

    if reopen_until:
        assignment.due_at = reopen_until

    assignment.updated_by = actor
    assignment.version += 1
    assignment.save()

    # Ghi nhận nhật ký kiểm toán
    record_change(
        action="assignments.reopened",
        resource_type="assignment",
        resource_id=assignment.id,
        actor=actor,
        metadata={"course_id": str(assignment.course_id), "assignment_id": str(assignment.id)},
    )

    return assignment


@transaction.atomic
def archive_assignment(
    *,
    assignment_id: uuid.UUID | str,
    actor: Any,
) -> Assignment:
    """Lưu trữ bài tập."""
    assignment, actor = _locked_assignment(assignment_id, actor)

    assignment.status = AssignmentStatus.ARCHIVED
    assignment.updated_by = actor
    assignment.version += 1
    assignment.save()

    # Ghi nhận nhật ký kiểm toán
    record_change(
        action="assignments.archived",
        resource_type="assignment",
        resource_id=assignment.id,
        actor=actor,
        metadata={"course_id": str(assignment.course_id), "assignment_id": str(assignment.id)},
    )

    return assignment


def check_student_eligibility(
    *,
    assignment: Assignment,
    student: Any,
    current_time: Any = None,
    has_existing_submission: bool = False,
    existing_submission_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Kiểm tra tính hợp lệ nộp bài của sinh viên theo Thẩm quyền Máy chủ (Server Authority).

    Tuyệt đối không tin cậy studentId, role hay giờ do client gửi lên.
    Hỗ trợ hợp đồng nộp bài (submission contract) chuẩn bị tích hợp B11:
    - Trước hạn có thể thay revision.
    - Sau hạn chỉ cho nộp lần đầu nếu allowLate, trừ cửa sổ ngoại lệ hợp lệ.
    - Đóng thủ công chặn nộp; archive luôn chặn ghi.
    """
    assignment = Assignment.objects.select_related("course").get(pk=assignment.pk)
    now = current_time or timezone.now()
    now_iso = now.isoformat() if hasattr(now, "isoformat") else str(now)
    deadline_iso = (
        assignment.due_at.isoformat()
        if hasattr(assignment.due_at, "isoformat")
        else str(assignment.due_at)
    )

    file_policy = getattr(assignment, "file_policy", None)
    applicable_file_policy = {
        "version": file_policy.version if file_policy else 1,
        "max_files": file_policy.max_files_per_submission
        if file_policy
        else DEFAULT_MAX_FILES_PER_SUBMISSION,
        "max_file_size_bytes": file_policy.max_file_size_bytes
        if file_policy
        else DEFAULT_MAX_FILE_SIZE_BYTES,
        "allowed_extensions": file_policy.allowed_extensions
        if file_policy
        else list(DEFAULT_ASSIGNMENT_ALLOWED_EXTENSIONS),
    }

    base_result = {
        "can_submit": False,
        "can_replace": False,
        "is_late": False,
        "reason": None,
        "server_time": now_iso,
        "deadline": deadline_iso,
        "effective_deadline": deadline_iso,
        "allow_late": assignment.allow_late,
        "manually_closed": assignment.manually_closed_at is not None
        or assignment.status == AssignmentStatus.CLOSED,
        "in_reopen_window": False,
        "reopen_window_id": None,
        "reopen_window_scope": None,
        "reopen_window_end": None,
        "has_existing_submission": has_existing_submission,
        "applicable_file_policy": applicable_file_policy,
        "contract_version": "B10-04",
    }

    # 1. Kiểm tra môn học lưu trữ
    if assignment.course.status == Course.Status.ARCHIVED:
        base_result["reason"] = "COURSE_ARCHIVED"
        return base_result

    # 2. Kiểm tra quyền ghi danh của sinh viên (Active Membership)
    if not student or not getattr(student, "is_authenticated", False):
        base_result["reason"] = "UNAUTHENTICATED"
        return base_result
    student = User.objects.filter(pk=student.pk, is_active=True).first()
    if student is None or not has_role(student, Role.STUDENT):
        base_result["reason"] = "NOT_ENROLLED"
        return base_result
    try:
        require_verified(student)
    except DomainError:
        base_result["reason"] = "NOT_ENROLLED"
        return base_result

    is_enrolled = Membership.objects.filter(
        course=assignment.course,
        student=student,
        status=Membership.Status.ACTIVE,
    ).exists()

    if not is_enrolled:
        base_result["reason"] = "NOT_ENROLLED"
        return base_result

    # 3. Kiểm tra trạng thái bài tập
    if assignment.status == AssignmentStatus.DRAFT:
        base_result["reason"] = "NOT_PUBLISHED"
        return base_result

    if assignment.status == AssignmentStatus.ARCHIVED:
        base_result["reason"] = "ASSIGNMENT_ARCHIVED"
        return base_result

    # Đóng thủ công chặn nộp; archive luôn chặn ghi
    if assignment.status == AssignmentStatus.CLOSED or assignment.manually_closed_at is not None:
        base_result["reason"] = "MANUALLY_CLOSED"
        return base_result

    # 4. Kiểm tra xem có cửa sổ mở lại / ngoại lệ (Reopen Window) hợp lệ cho sinh viên không
    reopen_window = (
        AssignmentReopenWindow.objects.filter(
            assignment=assignment,
            is_active=True,
            start_at__lte=now,
            end_at__gte=now,
        )
        .filter(
            Q(target_type=ReopenWindowTarget.ALL)
            | Q(target_type=ReopenWindowTarget.STUDENT, student=student)
        )
        .order_by("scope", "-target_type", "-end_at")
        .first()
    )

    # 5. So sánh với hạn nộp (Deadline) và Cửa sổ mở lại
    if now <= assignment.due_at:
        # Trước hoặc đúng hạn: Sinh viên có thể nộp mới hoặc thay revision
        base_result["can_submit"] = True
        base_result["can_replace"] = True
        base_result["is_late"] = False
        return base_result

    # Đã quá hạn (now > assignment.due_at)
    base_result["is_late"] = True

    if reopen_window is not None:
        # Nằm trong cửa sổ mở lại hợp lệ do giảng viên chủ động cấp
        base_result["in_reopen_window"] = True
        base_result["reopen_window_id"] = str(reopen_window.id)
        base_result["reopen_window_scope"] = reopen_window.scope
        base_result["reopen_window_end"] = reopen_window.end_at.isoformat()
        base_result["effective_deadline"] = reopen_window.end_at.isoformat()

        if reopen_window.scope == ReopenWindowScope.ALL_ACTIONS:
            base_result["can_submit"] = True
            base_result["can_replace"] = True
            base_result["reason"] = "REOPEN_WINDOW_ACTIVE"
            return base_result
        elif reopen_window.scope == ReopenWindowScope.FIRST_ONLY:
            if not has_existing_submission:
                base_result["can_submit"] = True
                base_result["can_replace"] = False
                base_result["reason"] = "REOPEN_WINDOW_FIRST_ONLY"
                return base_result
            else:
                base_result["can_submit"] = False
                base_result["can_replace"] = False
                base_result["reason"] = "REOPEN_WINDOW_NO_REPLACE"
                return base_result

    # Quá hạn và không có cửa sổ mở lại:
    # "Sau hạn chỉ cho nộp lần đầu nếu allowLate, trừ cửa sổ ngoại lệ hợp lệ."
    if assignment.allow_late:
        if not has_existing_submission:
            base_result["can_submit"] = True
            base_result["can_replace"] = False
            base_result["reason"] = "LATE_FIRST_SUBMISSION_ALLOWED"
            return base_result
        else:
            base_result["can_submit"] = False
            base_result["can_replace"] = False
            base_result["reason"] = "LATE_REPLACEMENT_NOT_ALLOWED"
            return base_result
    else:
        base_result["can_submit"] = False
        base_result["can_replace"] = False
        base_result["reason"] = "DEADLINE_PASSED"
        return base_result


@transaction.atomic
def create_reopen_window(
    *,
    assignment_id: uuid.UUID | str,
    actor: Any,
    end_at: Any,
    target_type: str = ReopenWindowTarget.ALL,
    student_id: uuid.UUID | str | None = None,
    start_at: Any = None,
    scope: str = ReopenWindowScope.ALL_ACTIONS,
    reason: str = "",
) -> AssignmentReopenWindow:
    """Giảng viên chủ động tạo cửa sổ mở lại / ngoại lệ nộp bài có kiểm soát."""
    assignment, actor = _locked_assignment(assignment_id, actor)
    course = assignment.course

    if assignment.status not in [AssignmentStatus.PUBLISHED, AssignmentStatus.CLOSED]:
        raise AssignmentValidationError(
            "Chỉ có thể tạo cửa sổ mở lại cho bài tập đã công bố hoặc đã đóng."
        )

    now = timezone.now()
    actual_start = start_at or now
    if end_at <= actual_start:
        raise AssignmentValidationError("Thời điểm kết thúc cửa sổ phải sau thời điểm bắt đầu.")

    student = None
    if target_type == ReopenWindowTarget.STUDENT:
        if not student_id:
            raise AssignmentValidationError(
                "Yêu cầu chỉ định sinh viên khi target_type là student."
            )
        student = User.objects.filter(pk=student_id).first()
        if not student:
            raise AssignmentValidationError("Sinh viên chỉ định không tồn tại.")
        is_enrolled = Membership.objects.filter(
            course=course,
            student=student,
            status=Membership.Status.ACTIVE,
        ).exists()
        if not is_enrolled:
            raise AssignmentValidationError(
                "Sinh viên chỉ định chưa ghi danh tích cực vào môn học này."
            )

    window = AssignmentReopenWindow.objects.create(
        assignment=assignment,
        target_type=target_type,
        student=student,
        start_at=actual_start,
        end_at=end_at,
        scope=scope,
        reason=reason or "",
        is_active=True,
        created_by=actor,
    )

    record_change(
        action="assignments.reopen_window_created",
        resource_type="assignment",
        resource_id=assignment.id,
        actor=actor,
        metadata={
            "course_id": str(course.id),
            "assignment_id": str(assignment.id),
            "window_id": str(window.id),
            "target_type": str(target_type),
        },
    )

    return window


@transaction.atomic
def revoke_reopen_window(
    *,
    window_id: uuid.UUID | str,
    actor: Any,
) -> AssignmentReopenWindow:
    """Giảng viên thu hồi / hủy hiệu lực cửa sổ mở lại."""
    candidate = AssignmentReopenWindow.objects.filter(pk=window_id).first()
    if candidate is None:
        raise AssignmentNotFoundError()
    assignment, actor = _locked_assignment(candidate.assignment_id, actor)
    course = assignment.course
    window = AssignmentReopenWindow.objects.select_for_update().get(pk=window_id)

    window.is_active = False
    window.save()

    record_change(
        action="assignments.reopen_window_revoked",
        resource_type="assignment",
        resource_id=window.assignment.id,
        actor=actor,
        metadata={
            "course_id": str(course.id),
            "assignment_id": str(window.assignment.id),
            "window_id": str(window.id),
        },
    )

    return window


def validate_submission_commit_eligibility(
    *,
    assignment: Assignment,
    student: Any,
    files_info: list[dict[str, Any]],
    commit_time: Any = None,
    has_existing_submission: bool = False,
) -> dict[str, Any]:
    """Hợp đồng thẩm định tại thời điểm commit revision sau khi scan clean (chuẩn bị cho B11).

    Kiểm tra deadline theo giờ server tại commit_time; kiểm tra tệp theo policy hiện hành;
    không tự trừ điểm muộn; giữ điểm đã chấm của revision cũ.
    """
    assignment = Assignment.objects.select_related("course").get(pk=assignment.pk)
    server_now = commit_time or timezone.now()
    eligibility = check_student_eligibility(
        assignment=assignment,
        student=student,
        current_time=server_now,
        has_existing_submission=has_existing_submission,
    )

    errors = []
    if not eligibility["can_submit"]:
        errors.append(f"Không đủ điều kiện nộp bài: {eligibility.get('reason')}")

    file_policy = getattr(assignment, "file_policy", None)
    if file_policy:
        if not files_info:
            errors.append("Cần ít nhất một tệp trong bản nộp.")
        if len(files_info) > file_policy.max_files_per_submission:
            errors.append(
                f"Vượt quá số lượng tệp: tối đa {file_policy.max_files_per_submission} tệp."
            )

        allowed_exts = {ext.lower().lstrip(".") for ext in file_policy.allowed_extensions}
        for f in files_info:
            size = f.get("size") or f.get("file_size") or 0
            name = f.get("name") or f.get("filename") or ""
            ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
            if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
                errors.append("Dung lượng tệp không hợp lệ.")
                continue
            if size > file_policy.max_file_size_bytes:
                errors.append(
                    f"Tệp {name} vượt quá dung lượng tối đa ({file_policy.max_file_size_bytes} B)."
                )
            if ext not in allowed_exts:
                errors.append(f"Định dạng tệp {ext} không được phép theo chính sách môn học.")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "eligibility": eligibility,
        "policy_version_applied": file_policy.version if file_policy else 1,
        "is_late": eligibility["is_late"],
        "can_replace": eligibility["can_replace"],
        "commit_server_time": server_now.isoformat(),
        "ai_grading_opt_in": assignment.ai_grading_opt_in,
    }


def get_assignment_attachment_for_delivery(
    *,
    actor: Any,
    course_id: uuid.UUID | str,
    assignment_id: uuid.UUID | str,
    file_id: uuid.UUID | str,
    is_preview: bool = False,
) -> tuple[AssignmentAttachment, bytes]:
    """Phân phối tệp đính kèm bài tập với kiểm tra quyền giữa giảng viên và sinh viên."""
    if not actor or not actor.is_authenticated:
        raise PermissionDenied("Yêu cầu đăng nhập để thực hiện thao tác này.")

    actor = User.objects.filter(pk=actor.pk, is_active=True).first()
    if actor is None:
        raise DomainError("ACCOUNT_INACTIVE")
    require_verified(actor)
    course = Course.objects.filter(pk=course_id).first()
    if not course:
        raise AssignmentNotFoundError("Môn học không tồn tại.")

    assignment = Assignment.objects.filter(pk=assignment_id, course=course).first()
    if not assignment:
        raise AssignmentNotFoundError("Bài tập không tồn tại.")

    is_teacher = has_role(actor, Role.TEACHER) and course.teacher_id == actor.id
    is_student = (
        has_role(actor, Role.STUDENT)
        and Membership.objects.filter(
            course=course, student=actor, status=Membership.Status.ACTIVE
        ).exists()
    )

    if not (is_teacher or is_student):
        raise AssignmentPermissionDeniedError("Bạn không có quyền truy cập tệp đính kèm này.")

    if is_student and not is_teacher:
        if assignment.published_at is None or assignment.status not in [
            AssignmentStatus.PUBLISHED,
            AssignmentStatus.CLOSED,
            AssignmentStatus.ARCHIVED,
        ]:
            raise AssignmentPermissionDeniedError("Bài tập chưa được công bố.")

    attachment = assignment.attachments.select_related("file").filter(file_id=file_id).first()
    if not attachment:
        raise AssignmentNotFoundError("Tệp đính kèm không thuộc bài tập này.")

    if attachment.file.status != FileStatus.CLEAN:
        raise AssignmentPermissionDeniedError("Tệp tin chưa được quét an toàn (clean).")

    if is_preview:
        ext = attachment.name.rsplit(".", 1)[-1].lower()
        if ext not in {
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
        }:
            raise AssignmentPermissionDeniedError("Định dạng không hỗ trợ xem trước an toàn.")
        policy = CourseFilePolicy.objects.filter(course=course).first()
        if policy and not policy.preview_allowed:
            raise AssignmentPermissionDeniedError(
                "Chính sách khóa học không cho phép xem trước tài liệu."
            )

    storage = get_storage()
    storage_path = attachment.file.storage_path
    if not storage.exists(storage_path):
        raise AssignmentNotFoundError("Tệp tin không tồn tại trên hệ thống lưu trữ.")

    content = storage.read(storage_path)
    expected_hash = attachment.file.sha256_hash
    expected_size = attachment.size_bytes or attachment.file.file_size
    if len(content) != expected_size or hashlib.sha256(content).hexdigest() != expected_hash:
        raise AssignmentPermissionDeniedError("Tính toàn vẹn của tệp tin không hợp lệ.")

    with transaction.atomic():
        record_change(
            action="assignments.attachment_delivered",
            resource_type="assignment",
            resource_id=assignment.id,
            actor=actor,
            metadata={
                "course_id": str(course.id),
                "assignment_id": str(assignment.id),
                "file_id": str(file_id),
            },
        )
    return attachment, content
