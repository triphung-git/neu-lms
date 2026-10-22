import uuid

from django.contrib.auth import (
    authenticate,
    login,
    logout,
    update_session_auth_hash,
)
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.exceptions import ValidationError as ApiValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Course, EligibleEmail, Membership, User
from .serializers import (
    CourseSerializer,
    EligibleEmailSerializer,
    MembershipSerializer,
    UserSerializer,
)


def is_admin(user):
    return user.is_superuser or user.role == "admin"


@method_decorator(csrf_protect, name="dispatch")
class AuthView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, operation):
        if operation == "csrf":
            return Response({
                "csrfToken": get_token(request),
            })

        if operation == "me" and request.user.is_authenticated:
            return Response(UserSerializer(request.user).data)

        return Response(
            {"detail": "Chưa đăng nhập."},
            status=401,
        )

    def post(self, request, operation):
        email = str(
            request.data.get("email", "")
        ).strip().lower()

        password = request.data.get("password")

        if operation in ("login", "register"):
            if not isinstance(password, str):
                raise ApiValidationError(
                    "Vui lòng nhập mật khẩu."
                )

        # Đăng nhập
        if operation == "login":
            account = User.objects.filter(
                email__iexact=email
            ).first()

            user = authenticate(
                request,
                username=account.username if account else email,
                password=password,
            )

            if not user:
                return Response(
                    {
                        "detail": (
                            "Thông tin đăng nhập không hợp lệ "
                            "hoặc tài khoản đã khóa."
                        )
                    },
                    status=400,
                )

            login(request, user)

            return Response(
                UserSerializer(user).data
            )

        # Đăng ký
        if operation == "register":
            try:
                with transaction.atomic():
                    eligible = (
                        EligibleEmail.objects
                        .select_for_update()
                        .filter(email__iexact=email)
                        .first()
                    )

                    already_registered = User.objects.filter(
                        email__iexact=email
                    ).exists()

                    if not eligible or already_registered:
                        raise ApiValidationError(
                            "Email không đủ điều kiện đăng ký "
                            "hoặc đã được sử dụng."
                        )

                    user = User(
                        username=uuid.uuid4().hex,
                        email=email,
                        first_name=eligible.full_name,
                        role=eligible.role,
                    )

                    validate_password(password, user)
                    user.set_password(password)
                    user.save()

            except ValidationError as exc:
                raise ApiValidationError(
                    exc.messages
                ) from exc

            except IntegrityError as exc:
                raise ApiValidationError(
                    "Email đã được sử dụng."
                ) from exc

            return Response(
                UserSerializer(user).data,
                status=201,
            )

        # Các thao tác còn lại yêu cầu đăng nhập
        if not request.user.is_authenticated:
            return Response(
                {"detail": "Chưa đăng nhập."},
                status=401,
            )

        # Đăng xuất
        if operation == "logout":
            logout(request)
            return Response(status=204)

        # Đổi mật khẩu
        if operation == "password":
            old_password = request.data.get("old_password", "")
            new_password = request.data.get("new_password", "")

            if (
                not isinstance(old_password, str)
                or not isinstance(new_password, str)
                or not request.user.check_password(old_password)
            ):
                raise ApiValidationError(
                    "Mật khẩu hiện tại không đúng."
                )

            try:
                validate_password(
                    new_password,
                    request.user,
                )

            except ValidationError as exc:
                raise ApiValidationError(
                    exc.messages
                ) from exc

            request.user.set_password(new_password)

            request.user.save(
                update_fields=["password"]
            )

            update_session_auth_hash(
                request,
                request.user,
            )

            return Response({
                "detail": "Đã đổi mật khẩu."
            })

        return Response(status=404)


class EligibleEmailViewSet(viewsets.ModelViewSet):
    serializer_class = EligibleEmailSerializer

    queryset = EligibleEmail.objects.order_by("id")

    http_method_names = [
        "get",
        "post",
        "delete",
        "head",
        "options",
    ]

    def check_permissions(self, request):
        super().check_permissions(request)

        if not is_admin(request.user):
            raise PermissionDenied()


class CourseViewSet(viewsets.ModelViewSet):
    serializer_class = CourseSerializer
    permission_classes = [IsAuthenticated]

    http_method_names = [
        "get",
        "post",
        "patch",
        "head",
        "options",
    ]

    def get_queryset(self):
        user = self.request.user
        courses = Course.objects.order_by("id")

        if is_admin(user):
            return courses

        if user.role == "teacher":
            return courses.filter(
                teacher=user
            )

        return courses.filter(
            memberships__student=user,
            memberships__status="active",
        )

    def require_manager(self, course):
        user = self.request.user

        if not is_admin(user) and course.teacher_id != user.pk:
            raise PermissionDenied()

    def perform_create(self, serializer):
        if self.request.user.role != "teacher":
            raise PermissionDenied(
                "Chỉ giảng viên tạo môn học trong phiên bản này."
            )

        serializer.save(
            teacher=self.request.user
        )

    def perform_update(self, serializer):
        course = serializer.instance
        self.require_manager(course)

        if course.status != "open":
            raise ApiValidationError(
                "Môn học đã lưu trữ."
            )

        serializer.save()

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        course = self.get_object()

        self.require_manager(course)

        course.status = "archived"
        course.save(update_fields=["status"])

        return Response(
            self.get_serializer(course).data
        )

    @action(detail=True, methods=["get", "post"])
    def members(self, request, pk=None):
        course = self.get_object()

        self.require_manager(course)

        if request.method == "GET":
            members = (
                course.memberships
                .select_related("student")
                .order_by("id")
            )

            return Response(
                MembershipSerializer(
                    members,
                    many=True,
                ).data
            )

        if course.status != "open":
            raise ApiValidationError(
                "Môn học đã lưu trữ."
            )

        email = str(
            request.data.get("email", "")
        ).strip()

        student = User.objects.filter(
            email__iexact=email,
            role="student",
            is_active=True,
        ).first()

        if not student:
            raise ApiValidationError(
                "Không tìm thấy tài khoản sinh viên đang hoạt động."
            )

        member, created = Membership.objects.get_or_create(
            course=course,
            student=student,
        )

        if not created:
            raise ApiValidationError(
                "Sinh viên đã có trong danh sách môn học."
            )

        return Response(
            MembershipSerializer(member).data,
            status=status.HTTP_201_CREATED,
        )