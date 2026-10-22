from django.urls import include, path

from health.views import LivenessView, ReadinessView


urlpatterns = [
    path(
        "api/v1/",
        include("lms.urls"),
    ),
    path(
        "api/v1/health/live",
        LivenessView.as_view(),
        name="health-live",
    ),
    path(
        "api/v1/health/ready",
        ReadinessView.as_view(),
        name="health-ready",
    ),
]