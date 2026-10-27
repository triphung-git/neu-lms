from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AdminCourseTransferView,
    CourseCatalogView,
    CourseChapterDetailView,
    CourseChapterReorderView,
    CourseChaptersView,
    CourseEnrollmentRequestCancelView,
    CourseEnrollView,
    CourseLessonDetailView,
    CourseLessonReorderView,
    CourseLessonsView,
    CourseMemberReEnrollView,
    CourseMembersView,
    CourseMemberWithdrawView,
    CourseSummaryView,
    CourseViewSet,
    StudentMyEnrollmentRequestsView,
    TeacherCourseEnrollmentRequestsView,
    TeacherEnrollmentRequestApproveView,
    TeacherEnrollmentRequestRejectView,
)

router = DefaultRouter(trailing_slash=False)

router.register(
    "courses",
    CourseViewSet,
    basename="course",
)

urlpatterns = [
    path("courses/summary", CourseSummaryView.as_view()),
    path("courses/catalog", CourseCatalogView.as_view()),
    path("courses/enrollment-requests/my", StudentMyEnrollmentRequestsView.as_view()),
    path("courses/<uuid:course_id>/enroll", CourseEnrollView.as_view()),
    path(
        "courses/enrollment-requests/<uuid:request_id>/cancel",
        CourseEnrollmentRequestCancelView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/enrollment-requests",
        TeacherCourseEnrollmentRequestsView.as_view(),
    ),
    path(
        "courses/enrollment-requests/<uuid:request_id>/approve",
        TeacherEnrollmentRequestApproveView.as_view(),
    ),
    path(
        "courses/enrollment-requests/<uuid:request_id>/reject",
        TeacherEnrollmentRequestRejectView.as_view(),
    ),
    path("courses/<uuid:course_id>/members", CourseMembersView.as_view()),
    path(
        "courses/<uuid:course_id>/members/<uuid:student_id>/withdraw",
        CourseMemberWithdrawView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/members/<uuid:student_id>/re-enroll",
        CourseMemberReEnrollView.as_view(),
    ),
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
