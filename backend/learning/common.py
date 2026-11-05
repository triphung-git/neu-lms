import csv
import hashlib
import io
from datetime import timedelta

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.http import content_disposition_header
from rest_framework import exceptions, serializers

from courses.models import Course, Membership
from files.models import FileStatus
from files.storage import get_storage
from files.views import FilesBaseView
from identity.models import Role, User
from identity.services.common import has_role, require_verified


class LearningBase(FilesBaseView):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not request.user.is_authenticated:
            raise exceptions.NotAuthenticated()
        request.user = get_object_or_404(User, pk=request.user.pk, is_active=True)
        require_verified(request.user)


def course_access(user, course_id, *, write=False, teacher=False):
    qs = Course.objects.select_for_update() if write else Course.objects.all()
    course = get_object_or_404(qs, pk=course_id)
    manager = has_role(user, Role.TEACHER) and course.teacher_id == user.pk
    member = (
        has_role(user, Role.STUDENT)
        and Membership.objects.filter(course=course, student=user, status="active").exists()
    )
    if not manager and (teacher or not member):
        raise exceptions.PermissionDenied("Không có quyền truy cập / Access denied.")
    if write and course.status != "open":
        raise exceptions.ValidationError("Môn đã lưu trữ / Course archived.")
    return course, manager


def field(data, key, kind="text", required=True, default=None):
    fields = {
        "text": lambda: serializers.CharField(max_length=10000),
        "title": lambda: serializers.CharField(max_length=200),
        "int": lambda: serializers.IntegerField(min_value=1),
        "uuid": serializers.UUIDField,
        "time": serializers.DateTimeField,
        "bool": serializers.BooleanField,
        "score": lambda: serializers.DecimalField(max_digits=10, decimal_places=2, min_value=0),
    }
    if key not in data and not required:
        return default
    try:
        return fields[kind]().run_validation(data.get(key))
    except exceptions.ValidationError as e:
        raise exceptions.ValidationError({key: e.detail}) from e


def require_manager(manager):
    if not manager:
        raise exceptions.PermissionDenied("Chỉ giảng viên phụ trách / Teacher only.")


def member_ids(course):
    return Membership.objects.filter(course=course, status="active").values_list(
        "student_id", flat=True
    )


def date_range(params):
    end = field(params, "end", "time", False, timezone.now())
    start = field(params, "start", "time", False, end - timedelta(days=30))
    if start > end or end - start > timedelta(days=366):
        raise exceptions.ValidationError("Khoảng ngày tối đa 366 ngày / Maximum 366 days.")
    return start, end


def csv_response(rows, name):
    stream = io.StringIO()
    writer = csv.writer(stream)
    for row in rows:
        writer.writerow(
            [
                ("'" + str(x)) if str(x).startswith(("=", "+", "-", "@", "\t", "\r")) else x
                for x in row
            ]
        )
    response = HttpResponse("\ufeff" + stream.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = content_disposition_header(True, name)
    return response


def deliver(item, preview=False):
    if item.status != FileStatus.CLEAN:
        raise exceptions.PermissionDenied("Tệp chưa an toàn / File not clean.")
    if preview and not item.file_name.lower().endswith(".pdf"):
        raise exceptions.ValidationError("Chỉ xem trước PDF / PDF preview only.")
    storage = get_storage()
    if not storage.exists(item.storage_path):
        raise exceptions.NotFound()
    content = storage.read(item.storage_path)
    if len(content) != item.file_size or hashlib.sha256(content).hexdigest() != item.sha256_hash:
        raise exceptions.PermissionDenied("File integrity check failed.")
    response = HttpResponse(
        content, content_type="application/pdf" if preview else "application/octet-stream"
    )
    response["Content-Disposition"] = content_disposition_header(not preview, item.file_name)
    response["Content-Security-Policy"] = "sandbox; default-src 'none'"
    response["Cache-Control"] = "private, no-store"
    return response
