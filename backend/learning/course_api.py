from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.db.models import Count, Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework import exceptions
from rest_framework.response import Response

from assignments.models import Assignment, SubmissionRevision
from courses.models import Course, EnrollmentRequest, Lesson, Membership
from identity.models import Role
from identity.services.common import has_role
from identity.services.passwords import rate_limit

from .common import (
    LearningBase,
    course_access,
    csv_response,
    date_range,
    field,
    member_ids,
    require_manager,
)
from .models import (
    AttendanceRecord,
    AttendanceSession,
    Discussion,
    DiscussionReply,
    DownloadEvent,
    EnrollmentKey,
    LearningNotice,
    LessonProgress,
)


class CourseHubView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, course_id):
        course, manager = course_access(request.user, course_id)
        students = (
            list(
                Membership.objects.filter(course=course, status="active").values(
                    "student_id", "student__display_name", "student__email"
                )
            )
            if manager
            else []
        )
        lessons = list(Lesson.objects.filter(chapter__course=course).values("id", "title"))
        done = list(
            LessonProgress.objects.filter(
                lesson__chapter__course=course, student=request.user
            ).values_list("lesson_id", flat=True)
        )
        return Response(
            {
                "course": {"id": course.id, "name": course.name, "status": course.status},
                "manager": manager,
                "students": students,
                "lessons": lessons,
                "completed": done,
                "enrollment_open": course.enrollment_open,
                "has_password": EnrollmentKey.objects.filter(course=course).exists(),
                "assignments": [
                    {"id": a.pk, "title": a.title, "total_score": a.total_score}
                    for a in Assignment.objects.filter(course=course).exclude(status="draft")
                ],
            }
        )


class EnrollmentView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT, parameters=[OpenApiParameter("q", str), OpenApiParameter("term", str), OpenApiParameter("mode", str, enum=["password", "approval"]), OpenApiParameter("page", int)])
    def get(self, request):
        if not has_role(request.user, Role.STUDENT):
            raise exceptions.PermissionDenied()
        qs = Course.objects.filter(status="open", enrollment_open=True)
        terms = list(qs.order_by('term').values_list('term', flat=True).distinct())
        qs = qs.annotate(
            requires_password=Exists(EnrollmentKey.objects.filter(course_id=OuterRef('pk'))),
            joined=Exists(Membership.objects.filter(course_id=OuterRef('pk'), student=request.user, status='active')),
            requested=Exists(EnrollmentRequest.objects.filter(course_id=OuterRef('pk'), student=request.user, status='pending')),
        )
        q = request.query_params.get('q', '').strip()
        if q:
            qs = qs.filter(Q(code__icontains=q)|Q(name__icontains=q)|Q(teacher__display_name__icontains=q))
        term = request.query_params.get('term')
        if term:
            qs = qs.filter(term=term)
        mode = request.query_params.get('mode')
        if mode in ('password', 'approval'):
            qs = qs.filter(requires_password=mode=='password')
        from rest_framework import serializers
        page = serializers.IntegerField(min_value=1).run_validation(request.query_params.get('page', 1))
        total = qs.count()
        items = list(qs.order_by('code', 'id').values('id','code','name','term','teacher__display_name','requires_password','joined','requested')[(page-1)*24:page*24])
        return Response({'items': items, 'terms': terms, 'total': total, 'page': page})

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        # Rate limiting is outside the transaction so invalid passwords are counted.
        rate_limit(scope="learning.join", identity=str(request.user.pk), maximum=10)
        with transaction.atomic():
            course = get_object_or_404(
                Course.objects.select_for_update(),
                pk=field(request.data, "course_id", "uuid"),
                status="open",
                enrollment_open=True,
            )
            if not has_role(request.user, Role.STUDENT):
                raise exceptions.PermissionDenied()
            key = get_object_or_404(EnrollmentKey, course=course)
            if not check_password(field(request.data, "password"), key.password_hash):
                raise exceptions.ValidationError("Mật khẩu không đúng / Invalid password.")
            Membership.objects.update_or_create(
                course=course, student=request.user, defaults={"status": "active"}
            )
            EnrollmentRequest.objects.filter(
                course=course, student=request.user, status="pending"
            ).update(status="cancelled")
            return Response({"joined": True})


class CourseActionView(LearningBase):
    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request, course_id):
        course, manager = course_access(request.user, course_id, write=True)
        d = request.data
        action = field(d, "action", "title")
        if action == "enrollment":
            require_manager(manager)
            opened = field(d, "open", "bool")
            password = field(d, "password", required=False)
            if password:
                if not 6 <= len(password) <= 128:
                    raise exceptions.ValidationError(
                        "Mật khẩu 6–128 ký tự / Password 6–128 characters."
                    )
                EnrollmentKey.objects.update_or_create(
                    course=course, defaults={"password_hash": make_password(password)}
                )
            if opened and not EnrollmentKey.objects.filter(course=course).exists():
                raise exceptions.ValidationError("Cần đặt mật khẩu / Set a password first.")
            course.enrollment_open = opened
            course.save(update_fields=["enrollment_open", "updated_at"])
        elif action == "progress":
            if manager:
                raise exceptions.PermissionDenied()
            lesson = get_object_or_404(
                Lesson, pk=field(d, "lesson_id", "uuid"), chapter__course=course
            )
            if field(d, "completed", "bool"):
                LessonProgress.objects.get_or_create(lesson=lesson, student=request.user)
            else:
                LessonProgress.objects.filter(lesson=lesson, student=request.user).delete()
        else:
            raise exceptions.ValidationError("Unknown action")
        return Response({"ok": True})


class ProgressView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, course_id):
        course, manager = course_access(request.user, course_id)
        ids = member_ids(course) if manager else [request.user.pk]
        total = Lesson.objects.filter(chapter__course=course).count()
        assignments = Assignment.objects.filter(course=course, published_at__isnull=False).exclude(
            status="draft"
        )
        rows = []
        for m in Membership.objects.filter(
            course=course, student_id__in=ids, status="active"
        ).select_related("student"):
            done = LessonProgress.objects.filter(
                student=m.student, lesson__chapter__course=course
            ).count()
            submitted = (
                SubmissionRevision.objects.filter(student=m.student, assignment__in=assignments)
                .values("assignment_id")
                .distinct()
                .count()
            )
            from .models import GroupSubmission

            group_count = (
                GroupSubmission.objects.filter(
                    group__members__student=m.student, group__policy__assignment__in=assignments
                )
                .values("group__policy__assignment_id")
                .distinct()
                .count()
            )
            rows.append(
                {
                    "student": m.student.display_name,
                    "email": m.student.email,
                    "completed": done,
                    "total": total,
                    "percent": round(100 * done / total) if total else 0,
                    "submitted": submitted + group_count,
                    "assignments": assignments.count(),
                }
            )
        if request.query_params.get("export") == "csv":
            return csv_response(
                [list(rows[0])] + [list(x.values()) for x in rows] if rows else [["student"]],
                "progress.csv",
            )
        return Response({"items": rows})


class AttendanceView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, course_id):
        course, manager = course_access(request.user, course_id)
        sessions = list(
            AttendanceSession.objects.filter(course=course)
            .order_by("-opens_at")
            .values("id", "title", "opens_at", "late_at", "closes_at", "closed")
        )
        records = AttendanceRecord.objects.filter(session__course=course)
        if not manager:
            records = records.filter(student=request.user)
        records = list(
            records.values(
                "id",
                "session_id",
                "student_id",
                "student__display_name",
                "student__email",
                "status",
                "checked_at",
                "corrections",
            )
        )
        active_sessions = {
            s["id"] for s in sessions if not s["closed"] and s["closes_at"] > timezone.now()
        }
        for record in records:
            if (
                record["session_id"] in active_sessions
                and record["status"] == "absent"
                and not record["corrections"]
            ):
                record["status"] = "pending"
        # Aggregate persisted roster rows across all sessions, including archived courses.
        summary = {}
        for record in records:
            row = summary.setdefault(record['student_id'], {
                'student_id': record['student_id'], 'name': record['student__display_name'],
                'email': record['student__email'], 'total': 0, 'attended': 0,
                'present': 0, 'late': 0, 'absent': 0, 'pending': 0,
            })
            row['total'] += 1
            row[record['status']] += 1
            row['attended'] += record['status'] in ('present', 'late')
        summary = sorted(summary.values(), key=lambda r: (r['name'], r['email']))
        if request.query_params.get('export') == 'summary':
            return csv_response(
                [['student', 'email', 'attended', 'assigned_sessions', 'present', 'late', 'absent', 'pending']]
                + [[r['name'], r['email'], r['attended'], r['total'], r['present'], r['late'], r['absent'], r['pending']] for r in summary],
                'attendance-summary.csv',
            )
        if request.query_params.get("export") == "csv":
            return csv_response(
                [["session", "student", "status", "checked_at"]]
                + [
                    [r["session_id"], r["student__display_name"], r["status"], r["checked_at"]]
                    for r in records
                ],
                "attendance.csv",
            )
        return Response({"sessions": sessions, "records": records, "summary": summary, "total_sessions": len(sessions)})

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, course_id):
        rate_limit(scope="learning.attendance", identity=str(request.user.pk), maximum=30)
        with transaction.atomic():
            course, manager = course_access(request.user, course_id, write=True)
            d = request.data
            action = field(d, "action", "title")
            if action == "create":
                require_manager(manager)
                start, late, end = [
                    field(d, x, "time") for x in ["opens_at", "late_at", "closes_at"]
                ]
                if not start <= late < end:
                    raise exceptions.ValidationError(
                        "Cần mở ≤ muộn < đóng / Invalid session times."
                    )
                code = field(d, "code", "title")
                if len(code) < 6:
                    raise exceptions.ValidationError(
                        "Mã tối thiểu 6 ký tự / Code minimum 6 characters."
                    )
                s = AttendanceSession.objects.create(
                    course=course,
                    title=field(d, "title", "title"),
                    code_hash=make_password(code),
                    opens_at=start,
                    late_at=late,
                    closes_at=end,
                )
                AttendanceRecord.objects.bulk_create(
                    [AttendanceRecord(session=s, student_id=i) for i in member_ids(course)]
                )
            else:
                s = get_object_or_404(
                    AttendanceSession.objects.select_for_update(),
                    pk=field(d, "session_id", "int"),
                    course=course,
                )
                if action == "close":
                    require_manager(manager)
                    s.closed = True
                    s.save(update_fields=["closed"])
                elif action == "checkin":
                    if manager or s.closed or not s.opens_at <= timezone.now() <= s.closes_at:
                        raise exceptions.ValidationError(
                            "Ngoài thời gian điểm danh / Session unavailable."
                        )
                    if not check_password(field(d, "code"), s.code_hash):
                        raise exceptions.ValidationError("Mã không đúng / Invalid code.")
                    r, _ = AttendanceRecord.objects.get_or_create(session=s, student=request.user)
                    if r.checked_at is None and not r.corrections:
                        r.checked_at = timezone.now()
                        r.status = "late" if r.checked_at > s.late_at else "present"
                        r.save()
                elif action == "correct":
                    require_manager(manager)
                    student = field(d, "student_id", "uuid")
                    r = get_object_or_404(AttendanceRecord, session=s, student_id=student)
                    status = field(d, "status", "title")
                    if status not in ["present", "late", "absent"]:
                        raise exceptions.ValidationError("Invalid status")
                    r.corrections.append(
                        {
                            "from": r.status,
                            "to": status,
                            "reason": field(d, "reason"),
                            "actor": str(request.user.pk),
                            "at": timezone.now().isoformat(),
                        }
                    )
                    r.status = status
                    r.save()
                else:
                    raise exceptions.ValidationError("Unknown action")
            return Response({"ok": True})


class DiscussionView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, course_id):
        course, manager = course_access(request.user, course_id)
        qs = Discussion.objects.filter(course=course)
        if not manager:
            qs = qs.filter(hidden=False)
        topics = []
        for t in qs.select_related("author").order_by("-pinned", "-created_at")[:100]:
            replies = t.replies.all() if manager else t.replies.filter(hidden=False)
            topics.append(
                {
                    "id": t.id,
                    "title": t.title,
                    "body": t.body,
                    "author": t.author.display_name,
                    "lesson_id": t.lesson_id,
                    "pinned": t.pinned,
                    "locked": t.locked,
                    "hidden": t.hidden,
                    "resolved": t.resolved,
                    "created_at": t.created_at,
                    "replies": list(
                        replies.order_by("created_at").values(
                            "id",
                            "body",
                            "author__display_name",
                            "parent_id",
                            "accepted",
                            "hidden",
                            "created_at",
                        )
                    ),
                }
            )
        notices = LearningNotice.objects.filter(user=request.user, course=course).order_by(
            "-created_at"
        )[:50]
        return Response({"items": topics, "notices": list(notices.values("id", "text", "read_at"))})

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request, course_id):
        rate_limit(scope="learning.discussion", identity=str(request.user.pk), maximum=60)
        with transaction.atomic():
            course, manager = course_access(request.user, course_id, write=True)
            d = request.data
            action = field(d, "action", "title")
            if action == "read":
                LearningNotice.objects.filter(user=request.user, course=course).update(
                    read_at=timezone.now()
                )
            elif action == "create":
                lesson = None
                if d.get("lesson_id"):
                    lesson = get_object_or_404(
                        Lesson, pk=field(d, "lesson_id", "uuid"), chapter__course=course
                    )
                Discussion.objects.create(
                    course=course,
                    lesson=lesson,
                    author=request.user,
                    title=field(d, "title", "title"),
                    body=field(d, "body"),
                )
            else:
                t = get_object_or_404(
                    Discussion.objects.select_for_update(),
                    pk=field(d, "topic_id", "int"),
                    course=course,
                )
                if action == "reply":
                    if t.locked or t.hidden:
                        raise exceptions.ValidationError("Thảo luận đã khóa / Discussion locked.")
                    parent = None
                    if d.get("parent_id"):
                        parent = get_object_or_404(
                            DiscussionReply,
                            pk=field(d, "parent_id", "int"),
                            discussion=t,
                            hidden=False,
                        )
                    DiscussionReply.objects.create(
                        discussion=t, author=request.user, parent=parent, body=field(d, "body")
                    )
                    recipients = {t.author_id, parent.author_id if parent else t.author_id} - {
                        request.user.pk
                    }
                    for uid in recipients:
                        LearningNotice.objects.create(
                            user_id=uid, course=course, text=f"Trả lời / Reply: {t.title}"
                        )
                elif action == "moderate":
                    require_manager(manager)
                    for key in ["pinned", "locked", "hidden", "resolved"]:
                        if key in d:
                            setattr(t, key, field(d, key, "bool"))
                    t.save()
                    if d.get("reply_id"):
                        r = get_object_or_404(
                            DiscussionReply, pk=field(d, "reply_id", "int"), discussion=t
                        )
                        if "accepted" in d:
                            r.accepted = field(d, "accepted", "bool")
                        if "reply_hidden" in d:
                            r.hidden = field(d, "reply_hidden", "bool")
                        r.save()
                else:
                    raise exceptions.ValidationError("Unknown action")
            return Response({"ok": True})


class DownloadsView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request, course_id):
        course, _ = course_access(request.user, course_id, teacher=True)
        start, end = date_range(request.query_params)
        qs = DownloadEvent.objects.filter(
            assignment__course=course, occurred_at__range=(start, end)
        )
        for key, kind in [("assignment_id", "uuid"), ("file_id", "uuid"), ("user_id", "uuid")]:
            if request.query_params.get(key):
                qs = qs.filter(**{key: field(request.query_params, key, kind)})
        rows = list(
            qs.order_by("-occurred_at").values(
                "user__display_name",
                "user__email",
                "assignment__title",
                "file__file_name",
                "kind",
                "occurred_at",
            )[:5000]
        )
        totals = list(
            qs.filter(kind="download")
            .values("user__email", "file__file_name")
            .annotate(count=Count("id"))
        )
        if request.query_params.get("export") == "csv":
            return csv_response(
                [list(rows[0])] + [list(x.values()) for x in rows] if rows else [["user"]],
                "downloads.csv",
            )
        return Response(
            {"items": rows, "totals": totals, "total_events": qs.count(), "limit": 5000}
        )
