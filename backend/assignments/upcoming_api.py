from datetime import timedelta

from django.db.models import Case, DateTimeField, Exists, F, OuterRef, Q, Subquery, When
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from courses.models import Course, Membership
from courses.services import require_active_student

from .models import (
    Assignment,
    AssignmentReopenWindow,
    AssignmentStatus,
    ReopenWindowTarget,
    SubmissionRevision,
)


class UpcomingRow(serializers.Serializer):
    id = serializers.UUIDField()
    course_id = serializers.UUIDField()
    course_name = serializers.CharField(source="course.name")
    title = serializers.CharField()
    deadline = serializers.DateTimeField()


class UpcomingResult(serializers.Serializer):
    total = serializers.IntegerField()
    items = UpcomingRow(many=True)


class UpcomingView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: UpcomingResult})
    def get(self, request):
        student = request.user
        require_active_student(student)

        now = timezone.now()
        until = now + timedelta(days=7)

        submitted = SubmissionRevision.objects.filter(
            assignment_id=OuterRef("pk"),
            student=student,
        )

        # Dùng cùng thứ tự ưu tiên cửa sổ mở lại như check_student_eligibility.
        window = (
            AssignmentReopenWindow.objects.filter(
                assignment_id=OuterRef("pk"),
                is_active=True,
                start_at__lte=now,
                end_at__gte=now,
            )
            .filter(
                Q(target_type=ReopenWindowTarget.ALL)
                | Q(target_type=ReopenWindowTarget.STUDENT, student=student)
            )
            .order_by("scope", "-target_type", "-end_at")
        )

        upcoming = (
            Assignment.objects.filter(
                course__memberships__student=student,
                course__memberships__status=Membership.Status.ACTIVE,
                course__status=Course.Status.OPEN,
                status=AssignmentStatus.PUBLISHED,
                published_at__isnull=False,
                manually_closed_at__isnull=True,
            )
            .filter(~Exists(submitted))
            .annotate(
                deadline=Case(
                    When(due_at__gte=now, then=F("due_at")),
                    default=Subquery(window.values("end_at")[:1]),
                    output_field=DateTimeField(),
                )
            )
            .filter(deadline__gte=now, deadline__lte=until)
            .select_related("course")
            .order_by("deadline", "pk")
        )

        return Response(
            {
                "total": upcoming.count(),
                "items": UpcomingRow(upcoming[:5], many=True).data,
            }
        )
