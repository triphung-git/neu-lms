from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AdminCourseTransferView,
    CourseChapterDetailView,
    CourseChapterReorderView,
    CourseChaptersView,
    CourseLessonDetailView,
    CourseLessonReorderView,
    CourseLessonsView,
    CourseViewSet,
)

router = DefaultRouter(trailing_slash=False)

router.register(
    "courses",
    CourseViewSet,
    basename="course",
)

urlpatterns = [
    path("admin/courses/<uuid:course_id>/transfer", AdminCourseTransferView.as_view()),
    path("courses/<uuid:course_id>/chapters", CourseChaptersView.as_view()),
    path("courses/<uuid:course_id>/chapters/reorder", CourseChapterReorderView.as_view()),
    path(
        "courses/<uuid:course_id>/chapters/<uuid:chapter_id>",
        CourseChapterDetailView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/chapters/<uuid:chapter_id>/lessons",
        CourseLessonsView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/chapters/<uuid:chapter_id>/lessons/reorder",
        CourseLessonReorderView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/chapters/<uuid:chapter_id>/lessons/<uuid:lesson_id>",
        CourseLessonDetailView.as_view(),
    ),
    *router.urls,
]
