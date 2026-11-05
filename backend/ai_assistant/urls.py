from django.urls import path

from .views import (
    CourseAIChatView,
    CourseChatHistoryView,
    TeacherAISummaryDraftCreateView,
    TeacherAISummaryDraftListView,
    TeacherAISummaryDraftReviewView,
)

urlpatterns = [
    path(
        "ai/courses/<uuid:course_id>/chat/history",
        CourseChatHistoryView.as_view(),
        name="ai-chat-history",
    ),
    path(
        "ai/teacher/summary-drafts",
        TeacherAISummaryDraftListView.as_view(),
        name="ai-teacher-summary-drafts",
    ),
    path(
        "ai/courses/<uuid:course_id>/materials/<uuid:material_id>/summary-drafts",
        TeacherAISummaryDraftCreateView.as_view(),
        name="ai-material-summary-draft-create",
    ),
    path(
        "ai/teacher/summary-drafts/<uuid:draft_id>/review",
        TeacherAISummaryDraftReviewView.as_view(),
        name="ai-teacher-summary-draft-review",
    ),
    path(
        "ai/courses/<uuid:course_id>/chat",
        CourseAIChatView.as_view(),
        name="ai-course-chat",
    ),
]
