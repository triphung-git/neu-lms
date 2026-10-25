from django.urls import include, path
from drf_spectacular.views import SpectacularJSONAPIView

from health.views import LivenessView, ReadinessView
from identity import views as auth_views

urlpatterns = [
    path("api/v1/", include("courses.urls")),
    path("api/v1/auth/csrf", auth_views.CsrfView.as_view()),
    path("api/v1/auth/login", auth_views.LoginView.as_view()),
    path("api/v1/auth/me", auth_views.MeView.as_view()),
    path("api/v1/auth/logout", auth_views.LogoutView.as_view()),
    path("api/v1/auth/logout-all", auth_views.LogoutAllView.as_view()),
    path("api/v1/auth/password/change", auth_views.ChangePasswordView.as_view()),
    path("api/v1/auth/password/request-reset", auth_views.ResetRequestView.as_view()),
    path("api/v1/auth/password/reset", auth_views.ResetConfirmView.as_view()),
    path("api/v1/health/live", LivenessView.as_view(), name="health-live"),
    path("api/v1/health/ready", ReadinessView.as_view(), name="health-ready"),
    path("api/v1/schema", SpectacularJSONAPIView.as_view(), name="schema-json"),
]

handler404 = "platform_core.views.not_found_view"
handler500 = "platform_core.views.server_error_view"
