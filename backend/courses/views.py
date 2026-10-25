from django.db import IntegrityError, transaction
from django.db.models import Q
from rest_framework import mixins, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated

from identity.models import Role
from identity.services.common import has_role

from .models import Course, Membership
from .serializers import CourseSerializer


class CourseViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = CourseSerializer
    permission_classes = [IsAuthenticated]

    # Chỉ triển khai xem và tạo trong bước này.
    http_method_names = [
        "get",
        "post",
        "head",
        "options",
    ]

    def get_queryset(self):
        # Phục vụ sinh OpenAPI mà không cần người dùng đăng nhập.
        if getattr(self, "swagger_fake_view", False):
            return Course.objects.none()

        user = self.request.user

        if not user or not user.is_authenticated:
            return Course.objects.none()

        queryset = Course.objects.select_related("teacher").order_by("-created_at", "id")

        # Admin được xem toàn bộ môn học.
        if has_role(user, Role.ADMIN):
            return queryset

        # Ban đầu không cho xem môn nào.
        visible = Q(pk__in=[])

        # Giảng viên xem môn mình phụ trách.
        if has_role(user, Role.TEACHER):
            visible |= Q(teacher=user)

        # Sinh viên xem môn mình đang tham gia.
        if has_role(user, Role.STUDENT):
            visible |= Q(
                memberships__student=user,
                memberships__status=Membership.Status.ACTIVE,
            )

        # Một tài khoản có thể vừa là teacher vừa là student.
        return queryset.filter(visible).distinct()

    def perform_create(self, serializer):
        user = self.request.user

        if not has_role(user, Role.TEACHER):
            raise PermissionDenied("Bạn cần vai trò giảng viên để tạo môn học.")

        try:
            with transaction.atomic():
                serializer.save(teacher=user)

        except IntegrityError as exc:
            # Xử lý trường hợp hai yêu cầu cùng tạo một mã môn.
            raise ValidationError(
                {"code": ["Không thể tạo môn học với mã này. Hãy kiểm tra mã môn đã tồn tại."]}
            ) from exc
