from django.urls import path

from .views import (
    CourseFileCommitView,
    CourseFileContentView,
    CourseFileDetailView,
    CourseFileDownloadView,
    CourseFileListView,
    CourseFilePolicyView,
    CourseFilePreviewView,
    CourseFileUploadIntentView,
)

urlpatterns = [
    path("courses/<uuid:course_id>/files/<uuid:file_id>/content", CourseFileContentView.as_view()),
    path("courses/<uuid:course_id>/file-policy", CourseFilePolicyView.as_view()),
    path("courses/<uuid:course_id>/files", CourseFileListView.as_view()),
    path("courses/<uuid:course_id>/files/upload-intent", CourseFileUploadIntentView.as_view()),
    path("courses/<uuid:course_id>/files/<uuid:file_id>", CourseFileDetailView.as_view()),
    path("courses/<uuid:course_id>/files/<uuid:file_id>/commit", CourseFileCommitView.as_view()),
    path(
        "courses/<uuid:course_id>/files/<uuid:file_id>/download",
        CourseFileDownloadView.as_view(),
    ),
    path("courses/<uuid:course_id>/files/<uuid:file_id>/preview", CourseFilePreviewView.as_view()),
]
