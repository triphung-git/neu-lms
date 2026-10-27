from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from identity.managers import canonical_email
from identity.models import Role, User
from identity.services.common import has_role, lock_role_policy, require_verified
from platform_core.errors import DomainError
from platform_core.events import record_change

from .models import Chapter, Course, EnrollmentRequest, Lesson, Membership


@transaction.atomic
def archive_course(user, course_id):
    course = Course.objects.select_for_update().get(pk=course_id)
    if not (has_role(user, Role.ADMIN) or teacher_can_manage_course(user, course)):
        raise PermissionDenied("Bạn không có quyền lưu trữ môn học này.")
    if course.status == Course.Status.ARCHIVED:
        return course

    course.status = Course.Status.ARCHIVED
    course.enrollment_open = False
    course.archived_at = timezone.now()
    course.save(update_fields=["status", "enrollment_open", "archived_at", "updated_at"])
    return course


@transaction.atomic
def transfer_course(course_id, teacher_id):
    course = Course.objects.select_for_update().get(pk=course_id)
    if course.status == Course.Status.ARCHIVED:
        raise ValidationError("Không thể chuyển giảng viên cho môn học đã lưu trữ.")

    try:
        teacher = User.objects.get(pk=teacher_id, is_active=True)
    except User.DoesNotExist as exc:
        raise ValidationError(
            {"teacher_id": ["Không tìm thấy giảng viên đang hoạt động."]}
        ) from exc

    if not has_role(teacher, Role.TEACHER):
        raise ValidationError({"teacher_id": ["Tài khoản chưa được cấp vai trò giảng viên."]})

    try:
        require_verified(teacher)
    except DomainError as exc:
        if exc.code != "EMAIL_NOT_VERIFIED":
            raise
        raise ValidationError({"teacher_id": ["Email giảng viên chưa được xác minh."]}) from exc

    course.teacher = teacher
    course.save(update_fields=["teacher", "updated_at"])
    return course


@transaction.atomic
def reorder_chapters(user, course_id, chapter_ids):
    course = Course.objects.select_for_update().get(pk=course_id)
    require_course_manager(user, course)

    chapters = list(Chapter.objects.filter(course=course).order_by("position", "id"))
    by_id = {chapter.id: chapter for chapter in chapters}
    if set(chapter_ids) != set(by_id) or len(chapter_ids) != len(by_id):
        raise ValidationError({"ids": ["Phải cung cấp đúng danh sách chương của môn học."]})

    for position, chapter_id in enumerate(chapter_ids, start=1):
        by_id[chapter_id].position = position
    Chapter.objects.bulk_update(chapters, ["position"])
    return list(Chapter.objects.filter(course=course).order_by("position", "id"))


@transaction.atomic
def reorder_lessons(user, chapter_id, lesson_ids):
    chapter = Chapter.objects.select_related("course").get(pk=chapter_id)
    course = Course.objects.select_for_update().get(pk=chapter.course_id)
    require_course_manager(user, course)

    lessons = list(Lesson.objects.filter(chapter=chapter).order_by("position", "id"))
    by_id = {lesson.id: lesson for lesson in lessons}
    if set(lesson_ids) != set(by_id) or len(lesson_ids) != len(by_id):
        raise ValidationError({"ids": ["Phải cung cấp đúng danh sách bài học của chương."]})

    for position, lesson_id in enumerate(lesson_ids, start=1):
        by_id[lesson_id].position = position
    Lesson.objects.bulk_update(lessons, ["position"])
    return list(Lesson.objects.filter(chapter=chapter).order_by("position", "id"))


def teacher_can_manage_course(user, course):
    return has_role(user, Role.TEACHER) and course.teacher_id == user.id


def require_course_manager(user, course):
    if not teacher_can_manage_course(user, course):
        raise PermissionDenied("Bạn không có quyền quản lý môn học này.")
    if course.status == Course.Status.ARCHIVED:
        raise PermissionDenied("Môn học đã lưu trữ và chỉ được xem.")


def require_active_teacher(user):
    if not user or not user.is_active or not has_role(user, Role.TEACHER):
        raise PermissionDenied("Bạn cần vai trò giảng viên đang hoạt động.")
    try:
        require_verified(user)
    except DomainError as exc:
        if exc.code != "EMAIL_NOT_VERIFIED":
            raise
        raise PermissionDenied("Email giảng viên cần được xác minh.") from exc


def get_courses_summary(user, role_param=None):
    if not user or not user.is_authenticated or not user.is_active:
        raise PermissionDenied("Tài khoản không hợp lệ hoặc đã bị vô hiệu hóa.")

    is_teacher = has_role(user, Role.TEACHER)
    is_student = has_role(user, Role.STUDENT)

    if role_param:
        role_clean = role_param.strip().lower()
        if role_clean not in ("teacher", "student"):
            raise ValidationError(
                {"role": ["Tham số role không hợp lệ. Chỉ chấp nhận 'teacher' hoặc 'student'."]}
            )
        if role_clean == "teacher":
            if not is_teacher:
                raise PermissionDenied("Bạn không có vai trò giảng viên.")
            target_role = "teacher"
        else:
            if not is_student:
                raise PermissionDenied("Bạn không có vai trò sinh viên.")
            target_role = "student"
    else:
        if is_teacher and not is_student:
            target_role = "teacher"
        elif is_student and not is_teacher:
            target_role = "student"
        elif is_teacher and is_student:
            raise ValidationError(
                {
                    "role": [
                        "Tài khoản có nhiều vai trò. "
                        "Vui lòng chỉ định tham số role=teacher hoặc role=student."
                    ]
                }
            )
        else:
            raise PermissionDenied(
                "Tài khoản không có vai trò giảng viên hoặc sinh viên để xem tổng quan môn học."
            )

    if target_role == "teacher":
        teacher_courses = Course.objects.filter(teacher=user)
        counts = teacher_courses.aggregate(
            total_courses=Count("id", distinct=True),
            open_courses=Count("id", filter=Q(status=Course.Status.OPEN), distinct=True),
            archived_courses=Count("id", filter=Q(status=Course.Status.ARCHIVED), distinct=True),
            enrollment_open_courses=Count(
                "id",
                filter=Q(status=Course.Status.OPEN, enrollment_open=True),
                distinct=True,
            ),
        )

        total_chapters = Chapter.objects.filter(course__teacher=user).count()
        total_lessons = Lesson.objects.filter(chapter__course__teacher=user).count()

        active_memberships = Membership.objects.filter(
            course__teacher=user,
            status=Membership.Status.ACTIVE,
        )
        mem_counts = active_memberships.aggregate(
            total_memberships=Count("id"),
            distinct_students=Count("student_id", distinct=True),
        )

        recent_courses_qs = (
            teacher_courses.filter(status=Course.Status.OPEN)
            .order_by("-created_at")[:5]
            .annotate(
                active_member_count=Count(
                    "memberships",
                    filter=Q(memberships__status=Membership.Status.ACTIVE),
                    distinct=True,
                ),
                chapter_count=Count("chapters", distinct=True),
                lesson_count=Count("chapters__lessons", distinct=True),
            )
        )

        teacher_display = user.display_name or (user.email.split("@")[0] if user.email else "")
        recent_courses = [
            {
                "id": c.id,
                "code": c.code,
                "name": c.name,
                "term": c.term,
                "status": c.status,
                "enrollment_open": c.enrollment_open,
                "active_member_count": c.active_member_count,
                "teacher_name": teacher_display,
                "chapter_count": c.chapter_count,
                "lesson_count": c.lesson_count,
                "created_at": c.created_at,
                "updated_at": c.updated_at,
            }
            for c in recent_courses_qs
        ]

        return {
            "role": "teacher",
            "total_courses": counts["total_courses"] or 0,
            "open_courses": counts["open_courses"] or 0,
            "archived_courses": counts["archived_courses"] or 0,
            "enrollment_open_courses": counts["enrollment_open_courses"] or 0,
            "total_chapters": total_chapters,
            "total_lessons": total_lessons,
            "total_memberships": mem_counts["total_memberships"] or 0,
            "distinct_students": mem_counts["distinct_students"] or 0,
            "recent_courses": recent_courses,
            "pending_submissions": None,
            "upcoming_deadlines": None,
            "problem_materials": None,
            "pending_ai_drafts": None,
            "unavailable_metrics": [
                "pending_submissions",
                "upcoming_deadlines",
                "problem_materials",
                "pending_ai_drafts",
            ],
        }

    else:
        student_memberships = Membership.objects.filter(student=user)
        active_course_ids = student_memberships.filter(status=Membership.Status.ACTIVE).values_list(
            "course_id", flat=True
        )

        enrolled_courses = Course.objects.filter(id__in=active_course_ids)
        counts = enrolled_courses.aggregate(
            total_enrolled_courses=Count("id", distinct=True),
            open_enrolled_courses=Count("id", filter=Q(status=Course.Status.OPEN), distinct=True),
            archived_enrolled_courses=Count(
                "id", filter=Q(status=Course.Status.ARCHIVED), distinct=True
            ),
        )
        withdrawn_courses = student_memberships.filter(status=Membership.Status.WITHDRAWN).count()

        open_enrolled_courses = enrolled_courses.filter(status=Course.Status.OPEN)
        total_chapters = Chapter.objects.filter(course__in=open_enrolled_courses).count()
        total_lessons = Lesson.objects.filter(chapter__course__in=open_enrolled_courses).count()

        recent_courses_qs = (
            open_enrolled_courses.select_related("teacher")
            .order_by("-created_at")[:5]
            .annotate(
                chapter_count=Count("chapters", distinct=True),
                lesson_count=Count("chapters__lessons", distinct=True),
            )
        )

        recent_courses = [
            {
                "id": c.id,
                "code": c.code,
                "name": c.name,
                "term": c.term,
                "status": c.status,
                "enrollment_open": c.enrollment_open,
                "active_member_count": None,
                "teacher_name": c.teacher.display_name
                or (c.teacher.email.split("@")[0] if c.teacher.email else ""),
                "chapter_count": c.chapter_count,
                "lesson_count": c.lesson_count,
                "created_at": c.created_at,
                "updated_at": c.updated_at,
            }
            for c in recent_courses_qs
        ]

        return {
            "role": "student",
            "total_enrolled_courses": counts["total_enrolled_courses"] or 0,
            "open_enrolled_courses": counts["open_enrolled_courses"] or 0,
            "archived_enrolled_courses": counts["archived_enrolled_courses"] or 0,
            "withdrawn_courses": withdrawn_courses,
            "total_chapters": total_chapters,
            "total_lessons": total_lessons,
            "recent_courses": recent_courses,
            "upcoming_deadlines": None,
            "recent_grades": None,
            "recent_announcements": None,
            "unavailable_metrics": [
                "upcoming_deadlines",
                "recent_grades",
                "recent_announcements",
            ],
        }


def require_active_student(user):
    if (
        not user
        or not user.is_authenticated
        or not user.is_active
        or not has_role(user, Role.STUDENT)
    ):
        raise PermissionDenied("Bạn cần vai trò sinh viên đang hoạt động.")
    try:
        require_verified(user)
    except DomainError as exc:
        if exc.code != "EMAIL_NOT_VERIFIED":
            raise
        raise PermissionDenied("Email sinh viên cần được xác minh.") from exc


def current_enrollment_actor(user):
    """Serialize eligibility checks with identity mutations before locking courses."""
    if not user or not getattr(user, "is_authenticated", False):
        raise PermissionDenied("Authentication required.")
    lock_role_policy()
    actor = User.objects.filter(pk=user.pk, is_active=True).first()
    if actor is None:
        raise PermissionDenied("Account is inactive.")
    return actor


@transaction.atomic
def request_enrollment(student, course_id):
    student = current_enrollment_actor(student)
    require_active_student(student)

    try:
        course = Course.objects.select_for_update().get(pk=course_id)
    except Course.DoesNotExist as exc:
        raise ValidationError({"course_id": ["Không tìm thấy môn học."]}) from exc

    if course.status == Course.Status.ARCHIVED:
        raise ValidationError({"course": ["Môn học đã lưu trữ, không thể gửi yêu cầu ghi danh."]})

    if not course.enrollment_open:
        raise ValidationError({"course": ["Môn học hiện đang đóng nhận ghi danh."]})

    if Membership.objects.filter(
        course=course, student=student, status=Membership.Status.ACTIVE
    ).exists():
        raise ValidationError({"student": ["Bạn đã là thành viên đang học môn học này."]})

    if EnrollmentRequest.objects.filter(
        course=course, student=student, status=EnrollmentRequest.Status.PENDING
    ).exists():
        raise ValidationError(
            {"student": ["Bạn đang có yêu cầu ghi danh chờ duyệt cho môn học này."]}
        )

    enrollment_req = EnrollmentRequest.objects.create(
        course=course,
        student=student,
        status=EnrollmentRequest.Status.PENDING,
    )

    record_change(
        actor=student,
        action="courses.enrollment_requested",
        resource_type="course",
        resource_id=course.id,
        metadata={
            "course_id": str(course.id),
            "student_id": str(student.id),
            "request_id": str(enrollment_req.id),
        },
    )
    return enrollment_req


@transaction.atomic
def cancel_enrollment_request(student, request_id):
    student = current_enrollment_actor(student)
    if not student or not student.is_authenticated or not student.is_active:
        raise PermissionDenied("Tài khoản không hợp lệ hoặc đã bị vô hiệu hóa.")

    try:
        raw_req = EnrollmentRequest.objects.values_list("course_id", "student_id").get(
            pk=request_id
        )
    except EnrollmentRequest.DoesNotExist as exc:
        raise ValidationError({"request_id": ["Không tìm thấy yêu cầu ghi danh."]}) from exc

    course_id, student_id = raw_req
    if student_id != student.id:
        raise PermissionDenied("Bạn không có quyền hủy yêu cầu ghi danh của người khác.")

    course = Course.objects.select_for_update().get(pk=course_id)
    if course.status == Course.Status.ARCHIVED:
        raise ValidationError({"course": ["Môn học đã lưu trữ và ở chế độ chỉ đọc."]})

    enrollment_req = EnrollmentRequest.objects.select_for_update().get(pk=request_id)
    if enrollment_req.status != EnrollmentRequest.Status.PENDING:
        display_status = enrollment_req.get_status_display()
        raise ValidationError(
            {"status": [f"Không thể hủy yêu cầu đang ở trạng thái '{display_status}'."]}
        )

    enrollment_req.status = EnrollmentRequest.Status.CANCELLED
    enrollment_req.save(update_fields=["status", "updated_at"])

    record_change(
        actor=student,
        action="courses.enrollment_cancelled",
        resource_type="course",
        resource_id=course.id,
        metadata={
            "course_id": str(course.id),
            "student_id": str(student.id),
            "request_id": str(enrollment_req.id),
        },
    )
    return enrollment_req


@transaction.atomic
def approve_enrollment_request(teacher, request_id):
    teacher = current_enrollment_actor(teacher)
    require_active_teacher(teacher)

    try:
        course_id = EnrollmentRequest.objects.values_list("course_id", flat=True).get(pk=request_id)
    except EnrollmentRequest.DoesNotExist as exc:
        raise ValidationError({"request_id": ["Không tìm thấy yêu cầu ghi danh."]}) from exc

    course = Course.objects.select_for_update().get(pk=course_id)
    if course.teacher_id != teacher.id:
        raise PermissionDenied(
            "Chỉ giảng viên phụ trách môn học mới có quyền duyệt yêu cầu ghi danh."
        )

    if course.status == Course.Status.ARCHIVED:
        raise ValidationError(
            {"course": ["Không thể duyệt yêu cầu ghi danh cho môn học đã lưu trữ."]}
        )

    enrollment_req = EnrollmentRequest.objects.select_for_update().get(pk=request_id)

    # Idempotency replay check
    if (
        enrollment_req.status == EnrollmentRequest.Status.APPROVED
        and enrollment_req.reviewed_by_id == teacher.id
    ):
        membership = Membership.objects.get(course=course, student=enrollment_req.student)
        return enrollment_req, membership

    if enrollment_req.status != EnrollmentRequest.Status.PENDING:
        display_status = enrollment_req.get_status_display()
        raise ValidationError(
            {"status": [f"Yêu cầu không ở trạng thái chờ duyệt (hiện tại: '{display_status}')."]}
        )

    require_active_student(enrollment_req.student)

    now = timezone.now()
    enrollment_req.status = EnrollmentRequest.Status.APPROVED
    enrollment_req.reviewed_by = teacher
    enrollment_req.reviewed_at = now
    enrollment_req.save(update_fields=["status", "reviewed_by", "reviewed_at", "updated_at"])

    # Tái sử dụng Membership theo policy giữ lịch sử
    membership = (
        Membership.objects.select_for_update()
        .filter(course=course, student=enrollment_req.student)
        .first()
    )
    if membership:
        membership.status = Membership.Status.ACTIVE
        membership.save(update_fields=["status", "updated_at"])
    else:
        membership = Membership.objects.create(
            course=course,
            student=enrollment_req.student,
            status=Membership.Status.ACTIVE,
        )

    record_change(
        actor=teacher,
        action="courses.enrollment_approved",
        resource_type="course",
        resource_id=course.id,
        metadata={
            "course_id": str(course.id),
            "student_id": str(enrollment_req.student_id),
            "request_id": str(enrollment_req.id),
            "membership_id": str(membership.id),
        },
    )
    return enrollment_req, membership


@transaction.atomic
def reject_enrollment_request(teacher, request_id, reason=""):
    teacher = current_enrollment_actor(teacher)
    require_active_teacher(teacher)

    try:
        course_id = EnrollmentRequest.objects.values_list("course_id", flat=True).get(pk=request_id)
    except EnrollmentRequest.DoesNotExist as exc:
        raise ValidationError({"request_id": ["Không tìm thấy yêu cầu ghi danh."]}) from exc

    course = Course.objects.select_for_update().get(pk=course_id)
    if course.teacher_id != teacher.id:
        raise PermissionDenied(
            "Chỉ giảng viên phụ trách môn học mới có quyền từ chối yêu cầu ghi danh."
        )

    if course.status == Course.Status.ARCHIVED:
        raise ValidationError({"course": ["Không thể từ chối yêu cầu cho môn học đã lưu trữ."]})

    enrollment_req = EnrollmentRequest.objects.select_for_update().get(pk=request_id)

    # Idempotency replay check
    if (
        enrollment_req.status == EnrollmentRequest.Status.REJECTED
        and enrollment_req.reviewed_by_id == teacher.id
    ):
        return enrollment_req

    if enrollment_req.status != EnrollmentRequest.Status.PENDING:
        display_status = enrollment_req.get_status_display()
        raise ValidationError(
            {"status": [f"Yêu cầu không ở trạng thái chờ duyệt (hiện tại: '{display_status}')."]}
        )

    now = timezone.now()
    enrollment_req.status = EnrollmentRequest.Status.REJECTED
    enrollment_req.reviewed_by = teacher
    enrollment_req.reviewed_at = now
    enrollment_req.rejection_reason = (reason or "").strip()
    enrollment_req.save(
        update_fields=[
            "status",
            "reviewed_by",
            "reviewed_at",
            "rejection_reason",
            "updated_at",
        ]
    )

    record_change(
        actor=teacher,
        action="courses.enrollment_rejected",
        resource_type="course",
        resource_id=course.id,
        metadata={
            "course_id": str(course.id),
            "student_id": str(enrollment_req.student_id),
            "request_id": str(enrollment_req.id),
        },
    )
    return enrollment_req


@transaction.atomic
def add_course_member(teacher, course_id, student_email):
    """Giảng viên phụ trách thêm sinh viên vào môn học.

    Tái sử dụng Membership nếu sinh viên từng có bản ghi (ví dụ trạng thái WITHDRAWN),
    giữ nguyên ID và added_at ban đầu, chỉ cập nhật status='active' và updated_at.
    Không tự ý phê duyệt EnrollmentRequest đang pending trái state machine B07-02.
    """
    teacher = current_enrollment_actor(teacher)
    require_active_teacher(teacher)

    try:
        course = Course.objects.select_for_update().get(pk=course_id)
    except Course.DoesNotExist as exc:
        raise ValidationError({"course_id": ["Môn học không tồn tại."]}) from exc

    if course.teacher_id != teacher.id:
        raise PermissionDenied("Chỉ giảng viên phụ trách môn học mới có quyền thêm thành viên.")

    if course.status == Course.Status.ARCHIVED:
        raise ValidationError({"course": ["Không thể thêm thành viên vào môn học đã lưu trữ."]})

    normalized_email = canonical_email(student_email or "")
    if not normalized_email:
        raise ValidationError({"student_email": ["Email sinh viên không được để trống."]})

    student = User.objects.filter(email=normalized_email).first()
    if not student:
        raise ValidationError({"student_email": ["Không tìm thấy tài khoản với email này."]})

    # Xác minh sinh viên đủ điều kiện: active, verified email, role student
    require_active_student(student)

    membership = (
        Membership.objects.select_for_update().filter(course=course, student=student).first()
    )

    if membership:
        if membership.status == Membership.Status.ACTIVE:
            return membership
        membership.status = Membership.Status.ACTIVE
        membership.save(update_fields=["status", "updated_at"])
    else:
        membership = Membership.objects.create(
            course=course,
            student=student,
            status=Membership.Status.ACTIVE,
        )

    record_change(
        actor=teacher,
        action="courses.member_added",
        resource_type="course",
        resource_id=course.id,
        metadata={
            "course_id": str(course.id),
            "student_id": str(student.id),
            "membership_id": str(membership.id),
        },
    )
    return membership


@transaction.atomic
def withdraw_course_member(actor, course_id, student_id):
    """Sinh viên tự rút lui khỏi môn học hoặc giảng viên phụ trách gỡ sinh viên.

    Không hard delete Membership; chuyển status sang WITHDRAWN để bảo toàn lịch sử.
    """
    actor = current_enrollment_actor(actor)
    try:
        course = Course.objects.select_for_update().get(pk=course_id)
    except Course.DoesNotExist as exc:
        raise ValidationError({"course_id": ["Môn học không tồn tại."]}) from exc

    if course.status == Course.Status.ARCHIVED:
        raise ValidationError({"course": ["Không thể rút thành viên khỏi môn học đã lưu trữ."]})

    is_self_withdraw = actor.id == student_id
    is_teacher_remove = course.teacher_id == actor.id

    if is_self_withdraw:
        require_active_student(actor)
    elif is_teacher_remove:
        require_active_teacher(actor)
    else:
        raise PermissionDenied("Bạn không có quyền rút thành viên khỏi môn học này.")

    membership = (
        Membership.objects.select_for_update().filter(course=course, student_id=student_id).first()
    )
    if not membership:
        raise ValidationError(
            {"membership": ["Không tìm thấy thông tin thành viên trong môn học."]}
        )

    if membership.status == Membership.Status.WITHDRAWN:
        return membership

    membership.status = Membership.Status.WITHDRAWN
    membership.save(update_fields=["status", "updated_at"])

    action = "courses.member_withdrawn" if is_self_withdraw else "courses.member_removed"
    record_change(
        actor=actor,
        action=action,
        resource_type="course",
        resource_id=course.id,
        metadata={
            "course_id": str(course.id),
            "student_id": str(student_id),
            "membership_id": str(membership.id),
        },
    )
    return membership


@transaction.atomic
def re_enroll_course_member(teacher, course_id, student_id):
    """Giảng viên phụ trách khôi phục thành viên đã rút lui.

    Khôi phục trên cùng bản ghi Membership (giữ nguyên ID và lịch sử).
    Kiểm tra sinh viên vẫn còn role student hoạt động (không khôi phục role đã thu hồi).
    """
    teacher = current_enrollment_actor(teacher)
    require_active_teacher(teacher)

    try:
        course = Course.objects.select_for_update().get(pk=course_id)
    except Course.DoesNotExist as exc:
        raise ValidationError({"course_id": ["Môn học không tồn tại."]}) from exc

    if course.teacher_id != teacher.id:
        raise PermissionDenied(
            "Chỉ giảng viên phụ trách môn học mới có quyền khôi phục thành viên."
        )

    if course.status == Course.Status.ARCHIVED:
        raise ValidationError({"course": ["Không thể thêm lại thành viên cho môn học đã lưu trữ."]})

    student = User.objects.filter(pk=student_id).first()
    if not student:
        raise ValidationError({"student_id": ["Không tìm thấy tài khoản sinh viên."]})

    # Bắt buộc role student còn active; không khôi phục nếu role đã bị thu hồi
    require_active_student(student)

    membership = (
        Membership.objects.select_for_update().filter(course=course, student=student).first()
    )
    if not membership:
        raise ValidationError(
            {"membership": ["Không tìm thấy thông tin thành viên trước đó để khôi phục."]}
        )

    if membership.status == Membership.Status.ACTIVE:
        return membership

    membership.status = Membership.Status.ACTIVE
    membership.save(update_fields=["status", "updated_at"])

    record_change(
        actor=teacher,
        action="courses.member_re_enrolled",
        resource_type="course",
        resource_id=course.id,
        metadata={
            "course_id": str(course.id),
            "student_id": str(student.id),
            "membership_id": str(membership.id),
        },
    )
    return membership


def get_course_membership(user, course_id):
    """Trả về Membership active của user trong course_id, hoặc None nếu không có."""
    if not getattr(user, "is_authenticated", False):
        return None
    if not has_role(user, Role.STUDENT):
        return None
    return Membership.objects.filter(
        course_id=course_id,
        student=user,
        status=Membership.Status.ACTIVE,
    ).first()


def require_course_member_or_owner(user, course_id):
    """Xác thực người dùng là giảng viên phụ trách môn hoặc sinh viên active member.

    Giao diện phân quyền tái sử dụng cho các phân hệ files (B08/B09)
    và assignments/grading (B10-B12).
    Trả về tuple: (course, membership, is_teacher: bool).
    """
    if not getattr(user, "is_authenticated", False):
        raise PermissionDenied("Yêu cầu đăng nhập để truy cập.")

    course = Course.objects.filter(pk=course_id).first()
    if not course:
        raise ValidationError({"course_id": ["Môn học không tồn tại."]})

    if has_role(user, Role.TEACHER) and course.teacher_id == user.id:
        return course, None, True

    if has_role(user, Role.STUDENT):
        membership = Membership.objects.filter(
            course=course,
            student=user,
            status=Membership.Status.ACTIVE,
        ).first()
        if membership:
            return course, membership, False

    raise PermissionDenied("Bạn không có quyền truy cập nội dung môn học này.")
