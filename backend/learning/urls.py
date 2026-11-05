from django.urls import path

from .appeal_api import AppealsView
from .course_api import (
    AttendanceView,
    CourseActionView,
    CourseHubView,
    DiscussionView,
    DownloadsView,
    EnrollmentView,
    ProgressView,
)
from .group_api import GroupFileView, GroupsView
from .group_appeal_api import GroupAppealsView
from .library_api import DraftDeleteView, LibraryDetailView, LibraryView
from .report_api import ReportsView

urlpatterns = [
    path("enrollment", EnrollmentView.as_view()),
    path("library", LibraryView.as_view()),
    path("library/<int:id>", LibraryDetailView.as_view()),
    path("drafts/<uuid:draft_id>", DraftDeleteView.as_view()),
    path("reports", ReportsView.as_view()),
    path("group-files/<int:id>", GroupFileView.as_view()),
    path("courses/<uuid:course_id>", CourseHubView.as_view()),
    path("courses/<uuid:course_id>/actions", CourseActionView.as_view()),
    path("courses/<uuid:course_id>/progress", ProgressView.as_view()),
    path("courses/<uuid:course_id>/attendance", AttendanceView.as_view()),
    path("courses/<uuid:course_id>/discussion", DiscussionView.as_view()),
    path("courses/<uuid:course_id>/downloads", DownloadsView.as_view()),
    path("courses/<uuid:course_id>/appeals", AppealsView.as_view()),
    path("courses/<uuid:course_id>/group-appeals", GroupAppealsView.as_view()),
    path("courses/<uuid:course_id>/groups", GroupsView.as_view()),
]
