from rest_framework.routers import DefaultRouter

from .views import CourseViewSet

router = DefaultRouter(trailing_slash=False)

router.register(
    "courses",
    CourseViewSet,
    basename="course",
)

urlpatterns = router.urls
