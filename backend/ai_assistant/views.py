import re
from django.conf import settings
from django.shortcuts import get_object_or_404

from drf_spectacular.utils import (
    OpenApiResponse,
    extend_schema
)

from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from courses.models import Course, Membership
from identity.models import Role

from identity.services.common import (
    has_role,
    require_verified
)

from .llm import generate_course_answer

from .hybrid_retrieval import retrieve_course_chunks_hybrid

from .serializers import (
    CourseChatRequestSerializer,
    CourseChatResponseSerializer
)


class CourseAIChatView(APIView):

    """Chatbot truy xuất học liệu trong học phần có quyền truy cập."""

    @extend_schema(
        operation_id="ai_course_chat",

        request=CourseChatRequestSerializer,

        responses={
            200: CourseChatResponseSerializer,
            400: OpenApiResponse(
                description="Dữ liệu câu hỏi không hợp lệ."
            ),
            403: OpenApiResponse(
                description="Không có quyền truy cập học phần."
            ),
            503: OpenApiResponse(
                description="AI chưa được cấu hình."
            )
        }
    )

    def post(self, request, course_id):

        serializer = CourseChatRequestSerializer(
            data=request.data
        )

        serializer.is_valid(
            raise_exception=True
        )

        user = request.user

        if not user.is_active:

            raise exceptions.PermissionDenied(
                "Tài khoản đã bị vô hiệu hóa."
            )

        require_verified(user)

        course = get_object_or_404(
            Course,
            pk=course_id
        )

        is_course_teacher = (
            has_role(user, Role.TEACHER)
            and course.teacher_id == user.id
        )

        is_active_student = (
            has_role(user, Role.STUDENT)

            and Membership.objects.filter(
                course=course,
                student=user,
                status=Membership.Status.ACTIVE
            ).exists()
        )

        if not (
            is_course_teacher
            or is_active_student
        ):

            raise exceptions.PermissionDenied(
                "Bạn không có quyền sử dụng trợ lý AI "
                "của học phần này."
            )

        question = serializer.validated_data["question"]

        top_k = max(
            1,
            min(settings.AI_RAG_TOP_K, 10)
        )

        chunks = retrieve_course_chunks_hybrid(
            course,
            question,
            top_k=top_k
        )

        if not chunks:

            return Response(
                {
                    "answer": (
                        "Mình chưa tìm thấy đoạn học liệu đã "
                        "công bố phù hợp với câu hỏi này. "
                        "Bạn thử diễn đạt cụ thể hơn hoặc kiểm "
                        "tra xem giảng viên đã công bố tài liệu "
                        "của học phần chưa nhé."
                    ),

                    "citations": [],

                    "course": {
                        "id": str(course.id),
                        "code": course.code,
                        "name": course.name
                    }
                },

                status=status.HTTP_200_OK
            )
            
        
        raw_answer = generate_course_answer(
            question,
            chunks
        )

        answer = raw_answer.strip()

        # Detect explicit abstention from the LLM.
        abstention_prefix = "NO_SUPPORT:"

        if answer.startswith(abstention_prefix):
            answer = answer[len(abstention_prefix):].strip()

            # Unsupported questions must not return sources.
            citations = []

        else:
            # Extract source IDs explicitly referenced by the answer.
            cited_ids = set(
                re.findall(r"\bS\d+\b", answer)
            )

            # Only return sources actually cited by the LLM.
            citations = [
                chunk.to_source_dict()
                for chunk in chunks
                if chunk.citation_id in cited_ids
            ]

        return Response(
            {
                "answer": answer,
                "citations": citations,
                "course": {
                    "id": str(course.id),
                    "code": course.code,
                    "name": course.name
                }
            },
            status=status.HTTP_200_OK
        )
