from django.db.models import Count, Q
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from courses.models import Course
from files.models import FilePurpose, FileStatus, StoredFile

from .admin_views import AdminBaseView
from .models import Role, RoleRequest, User


class AdminOverviewNumbers(serializers.Serializer):
    active_users = serializers.IntegerField()
    inactive_users = serializers.IntegerField()
    open_courses = serializers.IntegerField()
    archived_courses = serializers.IntegerField()
    infected_material_files = serializers.IntegerField(min_value=0)
    scanning_material_files = serializers.IntegerField(min_value=0)
    pending_teacher_requests = serializers.IntegerField(min_value=0)


class AdminOverviewView(AdminBaseView):
    @extend_schema(responses={200: AdminOverviewNumbers})
    def get(self, request):
        accounts = User.objects.aggregate(
            active_users=Count("pk", filter=Q(is_active=True)),
            inactive_users=Count("pk", filter=Q(is_active=False)),
        )

        courses = Course.objects.aggregate(
            open_courses=Count("pk", filter=Q(status=Course.Status.OPEN)),
            archived_courses=Count(
                "pk",
                filter=Q(status=Course.Status.ARCHIVED),
            ),
        )

        materials = StoredFile.objects.filter(
            purpose=FilePurpose.COURSE_MATERIAL,
            status__in=[FileStatus.INFECTED, FileStatus.SCANNING],
        ).aggregate(
            infected_material_files=Count(
                "pk",
                filter=Q(status=FileStatus.INFECTED),
            ),
            scanning_material_files=Count(
                "pk",
                filter=Q(status=FileStatus.SCANNING),
            ),
        )

        pending_teacher_requests = RoleRequest.objects.filter(
            role=Role.TEACHER,
            status=RoleRequest.Status.PENDING,
        ).count()

        return Response(
            {
                **accounts,
                **courses,
                **materials,
                "pending_teacher_requests": pending_teacher_requests,
            }
        )
