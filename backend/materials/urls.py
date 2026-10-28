from django.urls import path

from .views import (
    CourseMaterialDetailView,
    CourseMaterialFileDownloadView,
    CourseMaterialFilePreviewView,
    CourseMaterialHideView,
    CourseMaterialPublishView,
    CourseMaterialsListView,
    CourseMaterialsSearchView,
    CourseMaterialUnhideView,
    CourseMaterialVersionDetailView,
    CourseMaterialVersionFileDetailView,
    CourseMaterialVersionFilesView,
    CourseMaterialVersionFinalizeView,
    CourseMaterialVersionRetryView,
    CourseMaterialVersionsView,
    GlobalMaterialDetailView,
    GlobalMaterialsSearchView,
)

urlpatterns = [
    path(
        "courses/<uuid:course_id>/materials/<uuid:id>/versions/<uuid:version_id>/retry",
        CourseMaterialVersionRetryView.as_view(),
    ),
    path("materials/search", GlobalMaterialsSearchView.as_view()),
    path("materials/<uuid:id>", GlobalMaterialDetailView.as_view()),
    path("courses/<uuid:course_id>/materials/search", CourseMaterialsSearchView.as_view()),
    path("courses/<uuid:course_id>/materials", CourseMaterialsListView.as_view()),
    path("courses/<uuid:course_id>/materials/<uuid:id>", CourseMaterialDetailView.as_view()),
    path(
        "courses/<uuid:course_id>/materials/<uuid:id>/versions",
        CourseMaterialVersionsView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/materials/<uuid:id>/versions/<uuid:version_id>",
        CourseMaterialVersionDetailView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/materials/<uuid:id>/versions/<uuid:version_id>/files",
        CourseMaterialVersionFilesView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/materials/<uuid:id>/versions/<uuid:version_id>/files/<uuid:file_id>",
        CourseMaterialVersionFileDetailView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/materials/<uuid:id>/versions/<uuid:version_id>/finalize",
        CourseMaterialVersionFinalizeView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/materials/<uuid:id>/publish",
        CourseMaterialPublishView.as_view(),
    ),
    path("courses/<uuid:course_id>/materials/<uuid:id>/hide", CourseMaterialHideView.as_view()),
    path("courses/<uuid:course_id>/materials/<uuid:id>/unhide", CourseMaterialUnhideView.as_view()),
    path(
        "courses/<uuid:course_id>/materials/<uuid:id>/files/<uuid:file_id>/download",
        CourseMaterialFileDownloadView.as_view(),
    ),
    path(
        "courses/<uuid:course_id>/materials/<uuid:id>/files/<uuid:file_id>/preview",
        CourseMaterialFilePreviewView.as_view(),
    ),
]
