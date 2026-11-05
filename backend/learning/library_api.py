from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import exceptions
from rest_framework.response import Response

from ai_assistant.models import MaterialSummaryDraft
from courses.models import Membership
from files.models import CourseFilePolicy, StoredFile
from identity.models import Role
from identity.services.common import has_role
from platform_core.models import AuditEvent

from .common import LearningBase, course_access, deliver, field
from .models import LibraryDocument


def accessible(user):
    qs = LibraryDocument.objects.select_related("file", "owner")
    if has_role(user, Role.ADMIN):
        return qs
    courses = Membership.objects.filter(student=user, status="active").values_list(
        "course_id", flat=True
    )
    return qs.filter(
        Q(owner=user)
        | (
            Q(hidden=False, file__status="clean")
            & (Q(visibility="school") | Q(visibility="course", file__course_id__in=courses))
        )
    )


class LibraryView(LearningBase):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        qs = accessible(request.user)
        q = request.query_params.get("q", "")[:200]
        if q:
            qs = qs.filter(Q(title__icontains=q) | Q(tags__icontains=q) | Q(category__icontains=q))
        if request.query_params.get("mine") == "true":
            qs = qs.filter(owner=request.user)
        page = field(request.query_params, "page", "int", False, 1)
        return Response(
            {
                "count": qs.count(),
                "page": page,
                "items": [
                    {
                        "id": x.id,
                        "title": x.title,
                        "description": x.description,
                        "category": x.category,
                        "tags": x.tags,
                        "visibility": x.visibility,
                        "hidden": x.hidden,
                        "owner": x.owner.display_name,
                        "file_name": x.file.file_name,
                        "course_id": x.file.course_id,
                        "can_edit": x.owner_id == request.user.pk
                        or has_role(request.user, Role.ADMIN),
                    }
                    for x in qs.order_by("-created_at")[(page - 1) * 30 : page * 30]
                ],
            }
        )

    @extend_schema(request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    @transaction.atomic
    def post(self, request):
        d = request.data
        doc = None
        if d.get("id"):
            doc = get_object_or_404(
                LibraryDocument.objects.select_for_update(), pk=field(d, "id", "int")
            )
            if doc.owner_id != request.user.pk and not has_role(request.user, Role.ADMIN):
                raise exceptions.PermissionDenied()
        else:
            if not has_role(request.user, Role.TEACHER):
                raise exceptions.PermissionDenied()
            item = get_object_or_404(
                StoredFile.objects.select_for_update(),
                pk=field(d, "file_id", "uuid"),
                uploader=request.user,
                status="clean",
                purpose="course_material",
            )
            course_access(request.user, item.course_id, write=True, teacher=True)
            doc = LibraryDocument(owner=request.user, file=item)
        doc.title = field(d, "title", "title")
        doc.description = str(d.get("description", ""))[:10000]
        doc.category = str(d.get("category", ""))[:100]
        doc.tags = str(d.get("tags", ""))[:300]
        visibility = field(d, "visibility", "title")
        if visibility not in ["private", "course", "school"]:
            raise exceptions.ValidationError("Invalid visibility")
        doc.visibility = visibility
        doc.hidden = field(d, "hidden", "bool", False, False)
        doc.save()
        return Response({"id": doc.id}, status=201)


class LibraryDetailView(LearningBase):
    @extend_schema(operation_id="learning_library_file", responses={200: bytes})
    def get(self, request, id):
        doc = get_object_or_404(accessible(request.user), pk=id)
        preview = request.query_params.get("preview") == "true"
        if (
            preview
            and CourseFilePolicy.objects.filter(
                course_id=doc.file.course_id, preview_allowed=False
            ).exists()
        ):
            raise exceptions.PermissionDenied("Xem trước đã tắt / Preview disabled.")
        return deliver(doc.file, preview)

    @extend_schema(responses={204: None})
    @transaction.atomic
    def delete(self, request, id):
        doc = get_object_or_404(LibraryDocument.objects.select_for_update(), pk=id)
        if doc.owner_id != request.user.pk and not has_role(request.user, Role.ADMIN):
            raise exceptions.PermissionDenied()
        doc.delete()  # StoredFile retained; never delete a shared physical object here.
        return Response(status=204)


class DraftDeleteView(LearningBase):
    @extend_schema(responses={204: None})
    @transaction.atomic
    def delete(self, request, draft_id):
        draft = get_object_or_404(MaterialSummaryDraft.objects.select_for_update(), pk=draft_id)
        course_access(request.user, draft.course_id, write=True, teacher=True)
        AuditEvent.objects.create(
            actor=request.user,
            action="ai.summary_draft.deleted",
            resource_type="summary_draft",
            resource_id=draft.pk,
            metadata={"course_id": str(draft.course_id)},
        )
        draft.delete()
        return Response(status=204)
