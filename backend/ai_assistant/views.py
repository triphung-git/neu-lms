import uuid

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import exceptions, serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from courses.models import Course
from files.models import FilePurpose, FileStatus
from identity.models import Role
from identity.services.common import has_role, require_verified
from identity.services.passwords import rate_limit
from materials.models import (
    Material,
    MaterialFileExtraction,
    MaterialVersionStatus,
    ProcessingStatus,
)
from materials.statuses import ExtractionStatus
from platform_core.events import record_change
from platform_core.exceptions import ConflictError

from .chat_history import ChatTurnSerializer, visible_turns
from .chat_safety import ABSTENTION, grounded_answer, require_chat_access
from .hybrid_retrieval import retrieve_course_chunks_hybrid
from .llm import generate_course_answer, generate_material_summary
from .models import ChatConversation, MaterialSummaryDraft
from .serializers import (
    CourseChatRequestSerializer,
    CourseChatResponseSerializer,
    MaterialSummaryDraftReviewSerializer,
    MaterialSummaryDraftSerializer,
)


class CourseAIChatView(APIView):
    @extend_schema(
        request=CourseChatRequestSerializer,
        responses={200: CourseChatResponseSerializer},
        tags=["ai"],
    )
    def post(self, request, course_id):
        serializer = CourseChatRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        course = require_chat_access(request.user, course_id)
        data = serializer.validated_data
        conversation, _ = ChatConversation.objects.get_or_create(user=request.user, course=course)
        generation = conversation.generation
        request_id = data.get("request_id", uuid.uuid4())
        existing = conversation.turns.filter(request_id=request_id).first()
        if existing:
            if existing.question != data["question"]:
                raise ConflictError("Mã yêu cầu đã được dùng cho câu hỏi khác.")
            if existing not in visible_turns(conversation):
                raise ConflictError("Nguồn của câu trả lời cũ không còn khả dụng. Hãy hỏi lại.")
            return Response(_chat_response(course, existing.answer, existing.citations))
        rate_limit(scope="ai.course.chat", identity=str(request.user.id), maximum=30)
        chunks = retrieve_course_chunks_hybrid(
            course, data["question"], top_k=max(1, min(settings.AI_RAG_TOP_K, 10))
        )
        history = data.get("history")
        if history is None:
            history = []
            for turn in visible_turns(conversation, limit=4):
                history.extend(
                    [
                        {"role": "user", "content": turn.question[:2000]},
                        {"role": "assistant", "content": turn.answer[:2000]},
                    ]
                )
        answer, citations = ABSTENTION, []
        if chunks:
            answer, citations = grounded_answer(
                generate_course_answer(data["question"], chunks, history=history), chunks
            )
        # Provider calls run outside transactions. Re-check access before saving/replying.
        require_chat_access(request.user, course_id)
        with transaction.atomic():
            conversation = ChatConversation.objects.select_for_update().get(pk=conversation.pk)
            if conversation.generation != generation:
                raise ConflictError("Hội thoại đã được xóa trong lúc xử lý. Hãy gửi lại câu hỏi.")
            turn, _ = conversation.turns.get_or_create(
                request_id=request_id,
                defaults={"question": data["question"], "answer": answer, "citations": citations},
            )
            if turn.question != data["question"]:
                raise ConflictError("Mã yêu cầu đã được dùng cho câu hỏi khác.")
            # Fail closed if publication/clean state changed while calling the provider.
            if turn.citations and turn not in visible_turns(conversation):
                turn.answer, turn.citations = ABSTENTION, []
                turn.save(update_fields=["answer", "citations"])
            keep = list(conversation.turns.order_by("-id").values_list("id", flat=True)[:50])
            conversation.turns.exclude(id__in=keep).delete()
        return Response(_chat_response(course, turn.answer, turn.citations))


def _chat_response(course, answer, citations):
    return {
        "answer": answer,
        "citations": citations,
        "course": {"id": str(course.id), "code": course.code, "name": course.name},
    }


class CourseChatHistoryView(APIView):
    @extend_schema(responses={200: ChatTurnSerializer(many=True)}, tags=["ai"])
    def get(self, request, course_id):
        course = require_chat_access(request.user, course_id)
        conversation = ChatConversation.objects.filter(user=request.user, course=course).first()
        return Response(
            ChatTurnSerializer(visible_turns(conversation) if conversation else [], many=True).data
        )

    @extend_schema(responses={204: None}, tags=["ai"])
    def delete(self, request, course_id):
        course = require_chat_access(request.user, course_id)
        with transaction.atomic():
            conversation, _ = ChatConversation.objects.get_or_create(
                user=request.user, course=course
            )
            conversation = ChatConversation.objects.select_for_update().get(pk=conversation.pk)
            conversation.generation += 1
            conversation.save(update_fields=["generation"])
            conversation.turns.all().delete()
        return Response(status=204)


def _require_course_teacher(user, course):
    if not user.is_active:
        raise exceptions.PermissionDenied("Tài khoản đã bị vô hiệu hóa.")
    require_verified(user)
    if course.status != Course.Status.OPEN:
        raise exceptions.PermissionDenied("Môn học đã lưu trữ, không thể thay đổi bản nháp AI.")
    if not (has_role(user, Role.TEACHER) and course.teacher_id == user.id):
        raise exceptions.PermissionDenied(
            "Chỉ giảng viên phụ trách học phần mới có quyền sử dụng chức năng này."
        )


def _summary_draft_data(draft):
    return {
        "id": draft.id,
        "course_id": draft.course_id,
        "course_code": draft.course.code,
        "course_name": draft.course.name,
        "material_id": draft.material_id,
        "material_title": draft.material.title,
        "material_version_id": draft.material_version_id,
        "version_number": draft.material_version.version_number,
        "summary": draft.summary,
        "source_file_names": draft.source_file_names,
        "status": draft.status,
        "created_at": draft.created_at,
        "reviewed_at": draft.reviewed_at,
    }


class TeacherAISummaryDraftListView(APIView):
    """List summary drafts belonging only to courses owned by the current teacher."""

    @extend_schema(
        responses={200: MaterialSummaryDraftSerializer(many=True)},
        parameters=[OpenApiParameter("course_id", str), OpenApiParameter("page", int)],
        tags=["ai"],
    )
    def get(self, request):
        user = request.user
        if not user.is_active:
            raise exceptions.PermissionDenied("Tài khoản đã bị vô hiệu hóa.")
        require_verified(user)
        if not has_role(user, Role.TEACHER):
            raise exceptions.PermissionDenied("Chỉ giảng viên mới có quyền xem bản nháp AI.")

        drafts = (
            MaterialSummaryDraft.objects.filter(course__teacher_id=user.id)
            .select_related("course", "material", "material_version")
            .order_by("-created_at", "id")
        )
        course_id = request.query_params.get("course_id")
        if course_id:
            course_id = serializers.UUIDField().run_validation(course_id)
            drafts = drafts.filter(course_id=course_id)
        page = serializers.IntegerField(min_value=1).run_validation(
            request.query_params.get("page", 1)
        )
        drafts = drafts[(page - 1) * 100 : page * 100]
        payload = [_summary_draft_data(draft) for draft in drafts]
        return Response(MaterialSummaryDraftSerializer(payload, many=True).data)


class TeacherAISummaryDraftCreateView(APIView):
    """Generate a pending summary from clean extracted text; never publish automatically."""

    @extend_schema(
        request=None,
        responses={
            200: MaterialSummaryDraftSerializer,
            201: MaterialSummaryDraftSerializer,
        },
        tags=["ai"],
    )
    def post(self, request, course_id, material_id):
        user = request.user
        if not user.is_active:
            raise exceptions.PermissionDenied("Tài khoản đã bị vô hiệu hóa.")
        course = get_object_or_404(Course, pk=course_id)
        _require_course_teacher(user, course)
        material = get_object_or_404(
            Material.objects.select_related("course"),
            pk=material_id,
            course=course,
            is_hidden=False,
        )
        version = (
            material.versions.filter(lifecycle_status=MaterialVersionStatus.FINALIZED)
            .order_by("-version_number")
            .first()
        )
        if version is None:
            raise exceptions.ValidationError(
                "Học liệu chưa có phiên bản đã đóng băng để tạo tóm tắt."
            )
        if version.processing_status != ProcessingStatus.READY:
            raise exceptions.ValidationError(
                "Học liệu chưa trích xuất xong. Hãy chờ pipeline B08–B09 hoàn tất."
            )

        pending_queryset = MaterialSummaryDraft.objects.filter(
            material_version=version,
            status=MaterialSummaryDraft.Status.PENDING,
        ).select_related("course", "material", "material_version")
        pending = pending_queryset.first()
        if pending:
            return Response(MaterialSummaryDraftSerializer(_summary_draft_data(pending)).data)

        # Mirror the indexing eligibility checks: a successful extraction alone is
        # not sufficient. Its clean file must be a course-material file owned by
        # this course and must still match the immutable version manifest/checksums.
        extractions = list(
            MaterialFileExtraction.objects.filter(
                material_version=version,
                status=ExtractionStatus.SUCCESS,
                stored_file__status=FileStatus.CLEAN,
                stored_file__purpose=FilePurpose.COURSE_MATERIAL,
                stored_file__course=course,
                material_file__material_version=version,
                material_file__file_id=F("stored_file_id"),
            )
            .filter(file_hash=F("material_file__sha256_hash"))
            .filter(file_hash=F("stored_file__sha256_hash"))
            .exclude(file_hash="")
            .select_related("stored_file")
            .order_by("created_at", "id")
        )
        sources = []
        total_chars = 0
        for extraction in extractions:
            extracted_text = extraction.extracted_text.strip()
            if not extracted_text:
                continue
            total_chars += len(extracted_text)
            sources.append(
                {
                    "file_name": extraction.stored_file.file_name,
                    "text": extracted_text,
                }
            )

        if not sources:
            raise exceptions.ValidationError("Không có văn bản từ tệp đã quét sạch để tạo tóm tắt.")
        if total_chars > 40000:
            raise exceptions.ValidationError(
                "Tổng văn bản trích xuất vượt 40.000 ký tự. "
                "Hãy tách học liệu thành các phần nhỏ hơn."
            )

        rate_limit(
            scope="ai.summary.generate",
            identity=str(user.id),
            maximum=12,
        )
        summary = generate_material_summary(material.title, sources)
        source_file_names = list(dict.fromkeys(source["file_name"] for source in sources))

        try:
            with transaction.atomic():
                # Re-check the version under a row lock so an old revision cannot become
                # the source of a new draft while another revision is being finalized.
                locked_material = Material.objects.select_for_update().get(pk=material.pk)
                latest_version_id = (
                    locked_material.versions.filter(
                        lifecycle_status=MaterialVersionStatus.FINALIZED
                    )
                    .order_by("-version_number")
                    .values_list("id", flat=True)
                    .first()
                )
                if latest_version_id != version.id:
                    raise ConflictError(
                        "Phiên bản học liệu vừa thay đổi. "
                        "Hãy tạo lại bản nháp từ phiên bản mới nhất."
                    )

                draft = MaterialSummaryDraft.objects.create(
                    course=course,
                    material=material,
                    material_version=version,
                    created_by=user,
                    summary=summary,
                    source_file_names=source_file_names,
                )
                record_change(
                    actor=user,
                    action="materials.ai_summary_draft_created",
                    resource_type="material_version",
                    resource_id=version.id,
                    metadata={
                        "course_id": str(course.id),
                        "material_id": str(material.id),
                        "version_id": str(version.id),
                    },
                )
        except IntegrityError:
            pending = pending_queryset.first()
            if pending is None:
                raise
            return Response(MaterialSummaryDraftSerializer(_summary_draft_data(pending)).data)

        draft = MaterialSummaryDraft.objects.select_related(
            "course", "material", "material_version"
        ).get(pk=draft.pk)
        return Response(
            MaterialSummaryDraftSerializer(_summary_draft_data(draft)).data,
            status=status.HTTP_201_CREATED,
        )


class TeacherAISummaryDraftReviewView(APIView):
    """Confirm a teacher-edited summary or discard it; confirmation updates the version only."""

    @extend_schema(
        request=MaterialSummaryDraftReviewSerializer,
        responses={200: MaterialSummaryDraftSerializer},
        tags=["ai"],
    )
    def post(self, request, draft_id):
        serializer = MaterialSummaryDraftReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        decision = serializer.validated_data["status"]

        with transaction.atomic():
            draft = get_object_or_404(
                MaterialSummaryDraft.objects.select_for_update().select_related(
                    "course", "material", "material_version"
                ),
                pk=draft_id,
            )
            _require_course_teacher(request.user, draft.course)
            if draft.status != MaterialSummaryDraft.Status.PENDING:
                raise ConflictError("Bản nháp đã được xử lý trước đó.")

            if decision == MaterialSummaryDraft.Status.CONFIRMED:
                locked_material = Material.objects.select_for_update().get(pk=draft.material_id)
                if locked_material.is_hidden:
                    raise ConflictError("Học liệu đã bị ẩn. Không thể xác nhận bản nháp.")
                # Reject stale/revoked sources before publishing a saved summary.
                if draft.material_version.material_files.exclude(
                    file__status=FileStatus.CLEAN
                ).exists():
                    raise ConflictError("Nguồn học liệu không còn ở trạng thái an toàn.")
                latest_finalized_id = (
                    draft.material.versions.filter(lifecycle_status=MaterialVersionStatus.FINALIZED)
                    .order_by("-version_number")
                    .values_list("id", flat=True)
                    .first()
                )
                if latest_finalized_id != draft.material_version_id:
                    raise ConflictError(
                        "Phiên bản học liệu đã thay đổi. "
                        "Hãy tạo lại bản nháp từ phiên bản mới nhất."
                    )

                version = draft.material_version
                version.summary = serializer.validated_data.get("summary", draft.summary)
                version.summary_confirmed_at = timezone.now()
                version.save(update_fields=["summary", "summary_confirmed_at", "updated_at"])
                draft.summary = version.summary
                action = "materials.ai_summary_confirmed"
            else:
                action = "materials.ai_summary_discarded"

            draft.status = decision
            draft.reviewed_by = request.user
            draft.reviewed_at = timezone.now()
            draft.save(
                update_fields=["summary", "status", "reviewed_by", "reviewed_at", "updated_at"]
            )
            record_change(
                actor=request.user,
                action=action,
                resource_type="material_version",
                resource_id=draft.material_version_id,
                metadata={
                    "course_id": str(draft.course_id),
                    "material_id": str(draft.material_id),
                    "version_id": str(draft.material_version_id),
                },
            )

        draft = MaterialSummaryDraft.objects.select_related(
            "course", "material", "material_version"
        ).get(pk=draft.pk)
        return Response(MaterialSummaryDraftSerializer(_summary_draft_data(draft)).data)
