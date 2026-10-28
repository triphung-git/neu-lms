from django.urls import include, path
from drf_spectacular.views import SpectacularJSONAPIView

from health.views import LivenessView, ReadinessView
from identity import admin_views
from identity import views as auth_views

urlpatterns = [
    path("api/v1/", include("assignments.urls")),
    path("api/v1/", include("courses.urls")),
    path("api/v1/", include("files.urls")),
    path("api/v1/", include("materials.urls")),
    path("api/v1/auth/csrf", auth_views.CsrfView.as_view()),
    path("api/v1/auth/register", auth_views.RegisterView.as_view()),
    path("api/v1/auth/verify-email", auth_views.VerifyEmailView.as_view()),
    path("api/v1/auth/resend-verification", auth_views.ResendVerificationView.as_view()),
    path("api/v1/auth/login", auth_views.LoginView.as_view()),
    path("api/v1/auth/me", auth_views.MeView.as_view()),
    path("api/v1/auth/verification", auth_views.VerificationStatusView.as_view()),
    path("api/v1/auth/role-requests", auth_views.RoleRequestView.as_view()),
    path("api/v1/auth/role-requests/<uuid:id>/cancel", auth_views.RoleRequestCancelView.as_view()),
    path("api/v1/auth/grants", auth_views.GrantsView.as_view()),
    path("api/v1/auth/logout", auth_views.LogoutView.as_view()),
    path("api/v1/auth/logout-all", auth_views.LogoutAllView.as_view()),
    path("api/v1/auth/password/change", auth_views.ChangePasswordView.as_view()),
    path("api/v1/auth/password/request-reset", auth_views.ResetRequestView.as_view()),
    path("api/v1/auth/password/reset", auth_views.ResetConfirmView.as_view()),
    # Admin API
    path("api/v1/admin/accounts", admin_views.AdminAccountListView.as_view()),
    path("api/v1/admin/accounts/<uuid:id>", admin_views.AdminAccountDetailView.as_view()),
    path("api/v1/admin/accounts/<uuid:id>/state", admin_views.AdminAccountStateView.as_view()),
    path("api/v1/admin/accounts/<uuid:id>/lock", admin_views.AdminAccountLockView.as_view()),
    path("api/v1/admin/accounts/<uuid:id>/unlock", admin_views.AdminAccountUnlockView.as_view()),
    path("api/v1/admin/accounts/<uuid:id>/roles", admin_views.AdminAccountRolesView.as_view()),
    path(
        "api/v1/admin/accounts/<uuid:id>/roles/<uuid:grant_id>/revoke",
        admin_views.AdminAccountRoleRevokeView.as_view(),
    ),
    path(
        "api/v1/admin/accounts/<uuid:id>/request-reset",
        admin_views.AdminAccountPasswordResetView.as_view(),
    ),
    path(
        "api/v1/admin/grants/<uuid:grant_id>/revoke",
        admin_views.AdminGrantRevokeView.as_view(),
    ),
    path("api/v1/admin/teacher-requests", admin_views.AdminTeacherRequestListView.as_view()),
    path(
        "api/v1/admin/teacher-requests/<uuid:id>/approve",
        admin_views.AdminTeacherRequestApproveView.as_view(),
    ),
    path(
        "api/v1/admin/teacher-requests/<uuid:id>/reject",
        admin_views.AdminTeacherRequestRejectView.as_view(),
    ),
    path("api/v1/admin/role-requests", admin_views.AdminTeacherRequestListView.as_view()),
    path(
        "api/v1/admin/role-requests/<uuid:id>/approve",
        admin_views.AdminTeacherRequestApproveView.as_view(),
    ),
    path(
        "api/v1/admin/role-requests/<uuid:id>/reject",
        admin_views.AdminTeacherRequestRejectView.as_view(),
    ),
    path("api/v1/health/live", LivenessView.as_view(), name="health-live"),
    path("api/v1/health/ready", ReadinessView.as_view(), name="health-ready"),
    path("api/v1/schema", SpectacularJSONAPIView.as_view(), name="schema-json"),
]

handler404 = "platform_core.views.not_found_view"
handler500 = "platform_core.views.server_error_view"
