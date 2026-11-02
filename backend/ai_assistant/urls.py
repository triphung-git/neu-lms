from django.urls import path

from .views import CourseAIChatView


urlpatterns = [
    path(
        "ai/courses/<uuid:course_id>/chat",
        CourseAIChatView.as_view(),
        name="ai-course-chat",
    ),
]