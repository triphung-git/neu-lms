import hashlib

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from courses.models import Course, Membership
from identity.models import Role
from identity.services.common import has_role, require_verified
from platform_core.errors import DomainError
from platform_core.events import record_change
from platform_core.pagination import StandardPageNumberPagination

from .constants import SYSTEM_MAX_FILE_SIZE_BYTES
from .models import CourseFilePolicy, FilePurpose, FileStatus, StoredFile
from .serializers import (
    CommitUploadResponseSerializer,
    CommitUploadSerializer,
    CourseFilePolicySerializer,
    PaginatedStoredFileListSerializer,
    StoredFileSerializer,
    UpdateFilePublishSerializer,
    UploadIntentResponseSerializer,
    UploadIntentSerializer,
)
from .services import (
    abort_upload_intent,
    commit_upload,
    create_upload_intent,
    current_actor,
    locked_file,
    manager,
    receive_upload,
)
from .storage import get_storage


class FilesBaseView(APIView):
    def handle_exception(self, exc):
        if isinstance(exc, DomainError) and exc.code == "COURSE_ARCHIVED":
            exc = exceptions.PermissionDenied("Archived course is read-only.")
        return super().handle_exception(exc)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store, private"
        response["X-Content-Type-Options"] = "nosniff"
        return response


def _check_course_access(user, course):
    require_verified(user)
    is_manager = manager(user, course)
    is_member = (
        has_role(user, Role.STUDENT)
        and Membership.objects.filter(
            course=course, student=user, status=Membership.Status.ACTIVE
        ).exists()
    )
    return is_manager, is_member


def readable_file(user, course_id, file_id):
    course = get_object_or_404(Course, pk=course_id)
    item = get_object_or_404(StoredFile, pk=file_id, course=course)
    is_manager, is_member = _check_course_access(user, course)

    if item.material_links.exists():
        from materials.models import Material

        material_published = Material.objects.filter(
            course=course,
            is_hidden=False,
            published_version__material_files__file=item,
        ).exists()
        student_material_read = is_member and item.status == FileStatus.CLEAN and material_published
    else:
        student_material_read = (
            is_member
            and item.status == FileStatus.CLEAN
            and item.purpose == FilePurpose.COURSE_MATERIAL
            and item.is_published
        )

    student_submission_read = (
        is_member
        and item.status == FileStatus.CLEAN
        and item.purpose == FilePurpose.ASSIGNMENT_SUBMISSION
        and item.uploader_id == user.id
    )

    if item.assignment_attachments.exists():
        from assignments.models import Assignment, AssignmentStatus

        assignment_published = Assignment.objects.filter(
            course=course,
            published_at__isnull=False,
            status__in=[
                AssignmentStatus.PUBLISHED,
                AssignmentStatus.CLOSED,
                AssignmentStatus.ARCHIVED,
            ],
            attachments__file=item,
        ).exists()
        student_assignment_read = (
            is_member and item.status == FileStatus.CLEAN and assignment_published
        )
    else:
        student_assignment_read = False

    student_read = student_material_read or student_submission_read or student_assignment_read
    if not (is_manager or student_read) or item.status == FileStatus.DELETED:
        raise exceptions.PermissionDenied("Không có quyền truy cập tệp.")
    return item


class CourseFilePolicyView(FilesBaseView):
    @extend_schema(responses={200: CourseFilePolicySerializer})
    def get(self, request, course_id):
        course = get_object_or_404(Course, pk=course_id)
        owner, member = _check_course_access(request.user, course)
        if not (owner or member):
            raise exceptions.PermissionDenied()
        policy, _ = CourseFilePolicy.objects.get_or_create(course=course)
        return Response(CourseFilePolicySerializer(policy).data)

    @extend_schema(request=CourseFilePolicySerializer, responses={200: CourseFilePolicySerializer})
    @transaction.atomic
    def patch(self, request, course_id):
        actor = current_actor(request.user)
        course = get_object_or_404(Course.objects.select_for_update(), pk=course_id)
        if not manager(actor, course) or course.status == Course.Status.ARCHIVED:
            raise exceptions.PermissionDenied(
                "Chỉ giảng viên phụ trách môn đang mở được sửa chính sách."
            )
        policy, _ = CourseFilePolicy.objects.select_for_update().get_or_create(course=course)
        serializer = CourseFilePolicySerializer(policy, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        quota = serializer.validated_data.get("course_quota_bytes", policy.course_quota_bytes)
        if quota < policy.used_quota_bytes + policy.reserved_quota_bytes:
            raise exceptions.ValidationError(
                {"course_quota_bytes": ["Hạn ngạch thấp hơn dung lượng đã dùng/giữ chỗ."]}
            )
        serializer.save(version=policy.version + 1)
        record_change(
            action="files.policy_updated",
            resource_type="course",
            resource_id=course.id,
            actor=actor,
            metadata={"course_id": str(course.id), "version": policy.version},
        )
        return Response(serializer.data)

    @extend_schema(request=CourseFilePolicySerializer, responses={200: CourseFilePolicySerializer})
    def put(self, request, course_id):
        return self.patch(request, course_id)


class CourseFileListView(FilesBaseView):
    @extend_schema(
        operation_id="courses_files_list",
        parameters=[
            OpenApiParameter("purpose", str),
            OpenApiParameter("page", int),
            OpenApiParameter("page_size", int),
        ],
        responses={200: PaginatedStoredFileListSerializer},
    )
    def get(self, request, course_id):
        course = get_object_or_404(Course, pk=course_id)
        owner, member = _check_course_access(request.user, course)
        if not (owner or member):
            raise exceptions.PermissionDenied()
        qs = (
            StoredFile.objects.filter(course=course)
            .exclude(status=FileStatus.DELETED)
            .select_related("uploader")
        )
        if not owner:
            from assignments.models import AssignmentStatus

            qs = qs.filter(status=FileStatus.CLEAN).filter(
                Q(
                    purpose=FilePurpose.COURSE_MATERIAL,
                    is_published=True,
                    material_links__isnull=True,
                )
                | Q(
                    material_links__material_version__published_for_materials__course=course,
                    material_links__material_version__published_for_materials__is_hidden=False,
                )
                | Q(purpose=FilePurpose.ASSIGNMENT_SUBMISSION, uploader=request.user)
                | Q(
                    purpose=FilePurpose.ASSIGNMENT_ATTACHMENT,
                    assignment_attachments__assignment__course=course,
                    assignment_attachments__assignment__published_at__isnull=False,
                    assignment_attachments__assignment__status__in=[
                        AssignmentStatus.PUBLISHED,
                        AssignmentStatus.CLOSED,
                        AssignmentStatus.ARCHIVED,
                    ],
                )
            )
        purpose = request.query_params.get("purpose")
        if purpose:
            if purpose not in FilePurpose.values:
                raise exceptions.ValidationError({"purpose": ["Mục đích không hợp lệ."]})
            qs = qs.filter(purpose=purpose)
        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(qs.distinct().order_by("-created_at", "id"), request)
        return paginator.get_paginated_response(StoredFileSerializer(page, many=True).data)


class CourseFileUploadIntentView(FilesBaseView):
    @extend_schema(request=UploadIntentSerializer, responses={201: UploadIntentResponseSerializer})
    def post(self, request, course_id):
        serializer = UploadIntentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = create_upload_intent(
            actor=request.user,
            course_id=course_id,
            require_assignment_scope=True,
            **serializer.validated_data,
        )
        return Response(UploadIntentResponseSerializer(result).data, status=status.HTTP_201_CREATED)


class CourseFileContentView(FilesBaseView):
    @extend_schema(
        request={"application/octet-stream": {"type": "string", "format": "binary"}},
        responses={204: None},
    )
    def put(self, request, course_id, file_id):
        item = get_object_or_404(StoredFile, pk=file_id, course_id=course_id)
        if not manager(request.user, item.course) or item.uploader_id != request.user.id:
            raise exceptions.PermissionDenied()
        if request.content_type != "application/octet-stream":
            raise exceptions.UnsupportedMediaType(request.content_type)
        content = request._request.read(min(item.file_size, SYSTEM_MAX_FILE_SIZE_BYTES) + 1)
        receive_upload(actor=request.user, file_id=file_id, content=content)
        return Response(status=204)


class CourseFileCommitView(FilesBaseView):
    @extend_schema(request=CommitUploadSerializer, responses={200: CommitUploadResponseSerializer})
    def post(self, request, course_id, file_id):
        get_object_or_404(StoredFile, pk=file_id, course_id=course_id)
        serializer = CommitUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = commit_upload(actor=request.user, file_id=file_id, **serializer.validated_data)
        return Response(CommitUploadResponseSerializer(item).data)


class CourseFileDetailView(FilesBaseView):
    @extend_schema(responses={200: StoredFileSerializer})
    def get(self, request, course_id, file_id):
        return Response(StoredFileSerializer(readable_file(request.user, course_id, file_id)).data)

    @extend_schema(request=UpdateFilePublishSerializer, responses={200: StoredFileSerializer})
    @transaction.atomic
    def patch(self, request, course_id, file_id):
        actor = current_actor(request.user)
        get_object_or_404(StoredFile, pk=file_id, course_id=course_id)
        item, _ = locked_file(file_id)
        if not manager(actor, item.course) or item.course.status == Course.Status.ARCHIVED:
            raise exceptions.PermissionDenied()
        serializer = UpdateFilePublishSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if item.material_links.exists():
            raise exceptions.ValidationError(
                "Tệp đã gắn vào học liệu. Trạng thái công bố phải quản lý qua học liệu."
            )
        if (
            item.assignment_attachments.exists()
            or item.purpose == FilePurpose.ASSIGNMENT_ATTACHMENT
        ):
            raise exceptions.ValidationError(
                "Trạng thái công bố của tệp đính kèm bài tập phải quản lý qua bài tập."
            )
        publish = serializer.validated_data["is_published"]
        if publish and (
            item.status != FileStatus.CLEAN or item.purpose != FilePurpose.COURSE_MATERIAL
        ):
            raise exceptions.ValidationError("Chỉ công bố học liệu đã quét sạch.")
        item.is_published = publish
        item.save(update_fields=["is_published", "updated_at"])
        record_change(
            action="files.publication_updated",
            resource_type="file",
            resource_id=item.id,
            actor=actor,
            metadata={
                "course_id": str(course_id),
                "file_id": str(file_id),
                "is_published": publish,
            },
        )
        return Response(StoredFileSerializer(item).data)

    @extend_schema(responses={204: None})
    def delete(self, request, course_id, file_id):
        item = get_object_or_404(StoredFile, pk=file_id, course_id=course_id)
        if item.material_links.exists():
            raise exceptions.ValidationError(
                "Tệp tin đã được gắn vào học liệu, không thể xóa trực tiếp."
            )
        if item.assignment_attachments.exists():
            from assignments.models import AssignmentStatus

            if item.assignment_attachments.filter(
                assignment__status__in=[
                    AssignmentStatus.PUBLISHED,
                    AssignmentStatus.CLOSED,
                    AssignmentStatus.ARCHIVED,
                ]
            ).exists():
                raise exceptions.ValidationError(
                    "Tệp tin đã gắn vào bài tập đã công bố, không thể xóa."
                )
            raise exceptions.ValidationError(
                "Tệp tin đã được gắn vào bài tập, không thể xóa trực tiếp."
            )
        abort_upload_intent(file_id=file_id, actor=request.user)
        return Response(status=204)


class CourseFileDownloadView(FilesBaseView):
    preview = False

    @extend_schema(responses={200: bytes})
    def get(self, request, course_id, file_id):
        item = readable_file(request.user, course_id, file_id)
        if item.status != FileStatus.CLEAN:
            raise exceptions.PermissionDenied("Tệp chưa quét sạch.")
        media_types = {
            "pdf": "application/pdf",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "gif": "image/gif",
            "webp": "image/webp",
        }
        ext = item.file_name.rsplit(".", 1)[-1].lower()
        if self.preview:
            policy = get_object_or_404(CourseFilePolicy, course_id=course_id)
            if not policy.preview_allowed or ext not in media_types:
                raise exceptions.PermissionDenied("Xem trước không khả dụng.")
        storage = get_storage()
        if not storage.exists(item.storage_path):
            raise exceptions.NotFound()
        content = storage.read(item.storage_path)
        if (
            len(content) != item.file_size
            or hashlib.sha256(content).hexdigest() != item.sha256_hash
        ):
            raise exceptions.PermissionDenied("File integrity check failed.")
        response = HttpResponse(
            content, content_type=media_types.get(ext, "application/octet-stream")
        )
        from django.utils.http import content_disposition_header

        response["Content-Disposition"] = content_disposition_header(
            not self.preview, item.file_name
        )
        response["Content-Security-Policy"] = "sandbox; default-src 'none'"
        return response


class CourseFilePreviewView(CourseFileDownloadView):
    preview = True
