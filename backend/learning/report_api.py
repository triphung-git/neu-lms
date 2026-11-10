from datetime import timedelta

from django.http import HttpResponse
from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions
from rest_framework.response import Response

from assignments.models import SubmissionRevision
from courses.models import Course, Membership
from files.models import StoredFile
from identity.models import Role, User
from identity.services.common import has_role

from .common import LearningBase, csv_response, date_range
from .report_excel import build_report_excel
from .models import (
    AttendanceRecord,
    DownloadEvent,
    GradeAppeal,
    GroupGradeAppeal,
    GroupSubmission,
    LessonProgress,
    LibraryDocument,
)


class ReportsView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        if not has_role(request.user, Role.ADMIN):
            raise exceptions.PermissionDenied()
        start, end = date_range(request.query_params)
        downloads = DownloadEvent.objects.filter(occurred_at__range=(start, end), kind="download")
        metrics = {
            "new_users": User.objects.filter(created_at__range=(start, end)).count(),
            "new_courses": Course.objects.filter(created_at__range=(start, end)).count(),
            "enrollments": Membership.objects.filter(added_at__range=(start, end)).count(),
            "submissions": SubmissionRevision.objects.filter(
                submitted_at__range=(start, end)
            ).count(),
            "group_submissions": GroupSubmission.objects.filter(
                submitted_at__range=(start, end)
            ).count(),
            "attendance_checkins": AttendanceRecord.objects.filter(
                checked_at__range=(start, end)
            ).count(),
            "downloads": downloads.count(),
            "completed_lessons": LessonProgress.objects.filter(
                completed_at__range=(start, end)
            ).count(),
            "appeals": (
                GradeAppeal.objects.filter(created_at__range=(start, end)).count()
                + GroupGradeAppeal.objects.filter(created_at__range=(start, end)).count()
            ),
            "library_documents": LibraryDocument.objects.filter(
                created_at__range=(start, end)
            ).count(),
            "current_storage_bytes": StoredFile.objects.exclude(status="deleted").aggregate(
                total=Sum("file_size")
            )["total"]
            or 0,
        }
        trend = list(
            downloads.annotate(day=TruncDate("occurred_at"))
            .values("day")
            .annotate(count=Count("id"))
            .order_by("day")
        )
        counts = {row["day"]: row["count"] for row in trend}
        first, last = timezone.localdate(start), timezone.localdate(end)
        trend = [
            {"day": first + timedelta(days=n), "count": counts.get(first + timedelta(days=n), 0)}
            for n in range((last - first).days + 1)
        ]
        if request.query_params.get("export") == "xlsx":
            response = HttpResponse(
                build_report_excel(metrics, trend, start, end, request.query_params.get("lang", "vi")),
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
            response["Content-Disposition"] = 'attachment; filename="neu-lms-report.xlsx"'
            response["Cache-Control"] = "private, no-store"
            return response
        if request.query_params.get("export") == "csv":
            return csv_response(
                [["metric", "value"]]
                + list(metrics.items())
                + [["download_day", "count"]]
                + [[x["day"], x["count"]] for x in trend],
                "report.csv",
            )
        return Response({"start": start, "end": end, "metrics": metrics, "download_trend": trend})
