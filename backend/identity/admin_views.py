from django.db.models import Q
from django.http import Http404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from identity.admin_serializers import (
    AdminAccountDetailSerializer,
    AdminAccountListItemSerializer,
    AdminAccountRoleGrantResponseSerializer,
    AdminAccountRoleGrantSerializer,
    AdminAccountRoleRevokeResponseSerializer,
    AdminAccountStateResponseSerializer,
    AdminAccountStateUpdateSerializer,
    AdminPasswordResetResponseSerializer,
    AdminReauthSerializer,
    AdminTeacherApprovalResponseSerializer,
    AdminTeacherRejectResponseSerializer,
    AdminTeacherRequestItemSerializer,
)
from identity.models import Role, RoleGrant, RoleRequest, User
from identity.services.accounts import admin_initiate_password_reset, set_account_active
from identity.services.common import digest, has_role
from identity.services.passwords import rate_limit
from identity.services.roles import (
    approve_teacher_request,
    close_request,
    grant_admin_role,
    revoke_role,
)
from identity.views import AuthenticatedAuthView
from platform_core.errors import DomainError
from platform_core.pagination import StandardPageNumberPagination


class IsAdminUser(BasePermission):
    """Allows access only to authenticated, active users with an active ADMIN role grant."""

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return bool(user and user.is_authenticated and has_role(user, Role.ADMIN))


class AdminBaseView(AuthenticatedAuthView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            # Shared across endpoints, aliases and API workers; outside business transactions.
            rate_limit(scope="admin.mutation", identity=str(request.user.id), maximum=60)
            if "current_password" in request.data:
                rate_limit(scope="admin.reauth", identity=str(request.user.id), maximum=10)


def validated(serializer_class, data):
    serializer = serializer_class(data=data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


class AdminAccountListView(AdminBaseView):
    pagination_class = StandardPageNumberPagination

    @extend_schema(
        parameters=[
            OpenApiParameter("search", str, description="Search by email or display name"),
            OpenApiParameter(
                "role", str, description="Filter by active role: student, teacher, admin"
            ),
            OpenApiParameter("is_active", bool, description="Filter by active status"),
            OpenApiParameter("email_verified", bool, description="Filter by email verified status"),
            OpenApiParameter("page", int, description="Page number"),
            OpenApiParameter("page_size", int, description="Number of results per page"),
        ],
        responses={200: AdminAccountListItemSerializer(many=True)},
        tags=["admin"],
    )
    def get(self, request):
        queryset = (
            User.objects.prefetch_related("role_grants", "verifiedemail")
            .all()
            .order_by("-created_at", "email")
        )

        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(email__icontains=search) | Q(display_name__icontains=search)
            )

        role = request.query_params.get("role", "").strip()
        if role:
            queryset = queryset.filter(role_grants__role=role, role_grants__revoked_at__isnull=True)

        is_active_param = request.query_params.get("is_active")
        if is_active_param is not None:
            if is_active_param.lower() in ("true", "1"):
                queryset = queryset.filter(is_active=True)
            elif is_active_param.lower() in ("false", "0"):
                queryset = queryset.filter(is_active=False)

        verified_param = request.query_params.get("email_verified")
        if verified_param is not None:
            if verified_param.lower() in ("true", "1"):
                queryset = queryset.filter(verifiedemail__verified_at__isnull=False)
            elif verified_param.lower() in ("false", "0"):
                queryset = queryset.filter(verifiedemail__verified_at__isnull=True)

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)

        results = []
        for user in page:
            active_roles = [g.role for g in user.role_grants.all() if g.revoked_at is None]
            ve = getattr(user, "verifiedemail", None)
            is_verified = bool(ve and ve.verified_at and ve.email_digest == digest(user.email))
            results.append(
                {
                    "id": user.id,
                    "email": user.email,
                    "display_name": user.display_name,
                    "is_active": user.is_active,
                    "email_verified": is_verified,
                    "roles": sorted(active_roles),
                    "created_at": user.created_at,
                    "updated_at": user.updated_at,
                }
            )

        serializer = AdminAccountListItemSerializer(results, many=True)
        return paginator.get_paginated_response(serializer.data)


class AdminAccountDetailView(AdminBaseView):
    @extend_schema(responses={200: AdminAccountDetailSerializer}, tags=["admin"])
    def get(self, request, id):
        user = (
            User.objects.prefetch_related("role_grants", "rolerequest_set", "verifiedemail")
            .filter(id=id)
            .first()
        )
        if not user:
            raise Http404("Không tìm thấy tài khoản người dùng.")

        roles_data = []
        for g in user.role_grants.all().order_by("-granted_at"):
            roles_data.append(
                {
                    "id": g.id,
                    "role": g.role,
                    "granted_at": g.granted_at,
                    "granted_by": g.granted_by_id,
                    "grant_source": g.grant_source,
                    "revoked_at": g.revoked_at,
                    "revoke_reason": g.revoke_reason or "",
                }
            )

        requests_data = []
        for r in user.rolerequest_set.all().order_by("-requested_at"):
            requests_data.append(
                {
                    "id": r.id,
                    "role": r.role,
                    "status": r.status,
                    "requested_at": r.requested_at,
                    "reviewed_at": r.reviewed_at,
                    "reviewed_by": r.reviewed_by_id,
                    "review_reason": r.review_reason or "",
                }
            )

        ve = getattr(user, "verifiedemail", None)
        is_verified = bool(ve and ve.verified_at and ve.email_digest == digest(user.email))
        verified_at = ve.verified_at if is_verified else None

        detail_data = {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "is_active": user.is_active,
            "email_verified": is_verified,
            "verified_at": verified_at,
            "roles": roles_data,
            "role_requests": requests_data,
            "created_at": user.created_at,
            "updated_at": user.updated_at,
        }
        return Response(AdminAccountDetailSerializer(detail_data).data, status=200)


class AdminAccountStateView(AdminBaseView):
    @extend_schema(
        request=AdminAccountStateUpdateSerializer,
        responses={200: AdminAccountStateResponseSerializer},
        tags=["admin"],
    )
    def post(self, request, id):
        if not User.objects.filter(id=id).exists():
            raise Http404("Không tìm thấy tài khoản người dùng.")
        data = validated(AdminAccountStateUpdateSerializer, request.data)
        user = set_account_active(
            actor_id=request.user.id,
            user_id=id,
            active=data["is_active"],
            current_password=data.get("current_password"),
            enforce_reauth=True,
        )
        return Response({"id": user.id, "is_active": user.is_active}, status=200)


class AdminAccountLockView(AdminBaseView):
    @extend_schema(
        request=AdminReauthSerializer,
        responses={200: AdminAccountStateResponseSerializer},
        tags=["admin"],
    )
    def post(self, request, id):
        if not User.objects.filter(id=id).exists():
            raise Http404("Không tìm thấy tài khoản người dùng.")
        data = validated(AdminReauthSerializer, request.data)
        user = set_account_active(
            actor_id=request.user.id,
            user_id=id,
            active=False,
            current_password=data.get("current_password"),
            enforce_reauth=True,
        )
        return Response({"id": user.id, "is_active": user.is_active}, status=200)


class AdminAccountUnlockView(AdminBaseView):
    @extend_schema(
        request=None,
        responses={200: AdminAccountStateResponseSerializer},
        tags=["admin"],
    )
    def post(self, request, id):
        if not User.objects.filter(id=id).exists():
            raise Http404("Không tìm thấy tài khoản người dùng.")
        user = set_account_active(
            actor_id=request.user.id,
            user_id=id,
            active=True,
            enforce_reauth=False,
        )
        return Response({"id": user.id, "is_active": user.is_active}, status=200)


class AdminAccountRolesView(AdminBaseView):
    @extend_schema(
        request=AdminAccountRoleGrantSerializer,
        responses={200: AdminAccountRoleGrantResponseSerializer},
        tags=["admin"],
    )
    def post(self, request, id):
        user = User.objects.filter(id=id).first()
        if not user:
            raise Http404("Không tìm thấy tài khoản người dùng.")

        data = validated(AdminAccountRoleGrantSerializer, request.data)
        role = data["role"]

        if role == Role.ADMIN:
            grant = grant_admin_role(
                actor_id=request.user.id,
                user_id=id,
                current_password=data.get("current_password"),
                enforce_reauth=True,
            )
        elif role == Role.TEACHER:
            pending_req = RoleRequest.objects.filter(
                user=user, role=Role.TEACHER, status=RoleRequest.Status.PENDING
            ).first()
            if pending_req:
                grant = approve_teacher_request(actor_id=request.user.id, request_id=pending_req.id)
            else:
                raise DomainError("TEACHER_APPROVAL_WORKFLOW_REQUIRED")
        elif role == Role.STUDENT:
            raise DomainError("STUDENT_VERIFICATION_WORKFLOW_REQUIRED")
        else:
            raise DomainError("ROLE_POLICY_VIOLATION")

        return Response(
            {
                "id": grant.id,
                "user_id": grant.user_id,
                "role": grant.role,
                "granted_at": grant.granted_at,
            },
            status=200,
        )


class AdminAccountRoleRevokeView(AdminBaseView):
    @extend_schema(
        request=AdminReauthSerializer,
        responses={200: AdminAccountRoleRevokeResponseSerializer},
        tags=["admin"],
    )
    def post(self, request, id, grant_id):
        if not User.objects.filter(id=id).exists():
            raise Http404("Không tìm thấy tài khoản người dùng.")
        grant = RoleGrant.objects.filter(id=grant_id).first()
        if not grant or grant.user_id != id:
            raise Http404("Không tìm thấy bản ghi cấp vai trò.")

        data = validated(AdminReauthSerializer, request.data)
        revoked = revoke_role(
            actor_id=request.user.id,
            grant_id=grant_id,
            current_password=data.get("current_password"),
            enforce_reauth=True,
        )
        return Response(
            {"id": revoked.id, "role": revoked.role, "revoked_at": revoked.revoked_at},
            status=200,
        )


class AdminGrantRevokeView(AdminBaseView):
    @extend_schema(
        request=AdminReauthSerializer,
        responses={200: AdminAccountRoleRevokeResponseSerializer},
        tags=["admin"],
    )
    def post(self, request, grant_id):
        grant = RoleGrant.objects.filter(id=grant_id).first()
        if not grant:
            raise Http404("Không tìm thấy bản ghi cấp vai trò.")

        data = validated(AdminReauthSerializer, request.data)
        revoked = revoke_role(
            actor_id=request.user.id,
            grant_id=grant_id,
            current_password=data.get("current_password"),
            enforce_reauth=True,
        )
        return Response(
            {"id": revoked.id, "role": revoked.role, "revoked_at": revoked.revoked_at},
            status=200,
        )


class AdminTeacherRequestListView(AdminBaseView):
    pagination_class = StandardPageNumberPagination

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "status",
                str,
                description="Filter by status: pending, approved, rejected, cancelled, all",
            ),
            OpenApiParameter("search", str, description="Search by user email or display name"),
            OpenApiParameter("page", int, description="Page number"),
            OpenApiParameter("page_size", int, description="Number of results per page"),
        ],
        responses={200: AdminTeacherRequestItemSerializer(many=True)},
        tags=["admin"],
    )
    def get(self, request):
        queryset = (
            RoleRequest.objects.filter(role=Role.TEACHER)
            .select_related("user")
            .order_by("-requested_at", "-id")
        )

        status_param = request.query_params.get("status", "pending").strip().lower()
        if status_param and status_param != "all":
            queryset = queryset.filter(status=status_param)

        search = request.query_params.get("search", "").strip()
        if search:
            queryset = queryset.filter(
                Q(user__email__icontains=search) | Q(user__display_name__icontains=search)
            )

        paginator = self.pagination_class()
        page = paginator.paginate_queryset(queryset, request, view=self)

        results = []
        for req in page:
            results.append(
                {
                    "id": req.id,
                    "user_id": req.user_id,
                    "user_email": req.user.email,
                    "user_display_name": req.user.display_name,
                    "role": req.role,
                    "status": req.status,
                    "requested_at": req.requested_at,
                    "reviewed_at": req.reviewed_at,
                    "reviewed_by": req.reviewed_by_id,
                    "review_reason": req.review_reason or "",
                }
            )

        serializer = AdminTeacherRequestItemSerializer(results, many=True)
        return paginator.get_paginated_response(serializer.data)


class AdminTeacherRequestApproveView(AdminBaseView):
    @extend_schema(
        request=None,
        responses={200: AdminTeacherApprovalResponseSerializer},
        tags=["admin"],
    )
    def post(self, request, id):
        req = RoleRequest.objects.filter(id=id).first()
        if not req:
            raise Http404("Không tìm thấy yêu cầu vai trò.")

        grant = approve_teacher_request(actor_id=request.user.id, request_id=id)
        return Response(
            {
                "id": grant.id,
                "user_id": grant.user_id,
                "role": grant.role,
                "status": "approved",
                "granted_at": grant.granted_at,
            },
            status=200,
        )


class AdminTeacherRequestRejectView(AdminBaseView):
    @extend_schema(
        request=None,
        responses={200: AdminTeacherRejectResponseSerializer},
        tags=["admin"],
    )
    def post(self, request, id):
        req = RoleRequest.objects.filter(id=id).first()
        if not req:
            raise Http404("Không tìm thấy yêu cầu vai trò.")

        if req.role != Role.TEACHER:
            raise DomainError("WRONG_ROLE_REQUEST")

        rejected = close_request(actor_id=request.user.id, request_id=id, decision="rejected")
        return Response(
            {"id": rejected.id, "status": rejected.status, "reviewed_at": rejected.reviewed_at},
            status=200,
        )


class AdminAccountPasswordResetView(AdminBaseView):
    @extend_schema(
        request=None,
        responses={202: AdminPasswordResetResponseSerializer},
        tags=["admin"],
    )
    def post(self, request, id):
        if not User.objects.filter(id=id).exists():
            raise Http404("Không tìm thấy tài khoản người dùng.")

        admin_initiate_password_reset(actor_id=request.user.id, user_id=id)
        return Response(
            {"message": "Đã tiếp nhận yêu cầu gửi liên kết đặt lại mật khẩu qua email."},
            status=status.HTTP_202_ACCEPTED,
        )
