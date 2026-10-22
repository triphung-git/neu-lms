from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AuthView,
    CourseViewSet,
    EligibleEmailViewSet,
)


router = DefaultRouter(trailing_slash=False)

router.register(
    "courses",
    CourseViewSet,
    basename="course",
)

router.register(
    "eligible-emails",
    EligibleEmailViewSet,
)

urlpatterns = [
    path(
        "auth/<str:operation>",
        AuthView.as_view(),
    ),
    path(
        "",
        include(router.urls),
    ),
]