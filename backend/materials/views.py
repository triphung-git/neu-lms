import logging
from typing import Any

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_datetime
from django.utils.http import content_disposition_header
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from courses.models import Course, Membership
from files.models import StoredFile
from identity.models import Role
from identity.services.common import has_role, require_verified
from platform_core.errors import DomainError
from platform_core.exceptions import ConflictError
from platform_core.idempotency import ResultReference, execute_once
from platform_core.pagination import StandardPageNumberPagination

from .models import (
    Material,
    MaterialFile,
    MaterialVersion,
    MaterialVisibility,
)
from .search import search_materials
from .serializers import (
    MaterialCreateRequestSerializer,
    MaterialDetailSerializer,
    MaterialFileAddRequestSerializer,
    MaterialFileManifestItemSerializer,
    MaterialListItemSerializer,
    MaterialPublishRequestSerializer,
    MaterialUpdateRequestSerializer,
    MaterialVersionCreateRequestSerializer,
    MaterialVersionDetailSerializer,
    MaterialVersionSummarySerializer,
    PaginatedMaterialListSerializer,
    PaginatedMaterialSearchResultSerializer,
)
from .services import (
    _check_teacher_course_permission,
    add_file_to_version,
    create_material,
    create_material_version,
    delete_material,
    finalize_material_version,
    get_material_file_for_delivery,
    hide_material,
    publish_material_version,
    remove_file_from_version,
    retry_material_version,
    unhide_material,
    update_material,
)

logger = logging.getLogger(__name__)


class MaterialsBaseView(APIView):
    """Base API View cho phân hệ Học liệu: chuẩn hóa mã lỗi và bảo vệ security headers."""

    def dispatch(self, request, *args, **kwargs):
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            with transaction.atomic():
                return super().dispatch(request, *args, **kwargs)
        return super().dispatch(request, *args, **kwargs)

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in {"GET", "HEAD", "OPTIONS"} and "course_id" in kwargs:
            course = get_object_or_404(Course, pk=kwargs["course_id"])
            _check_teacher_course_permission(course, request.user)
            if "id" in kwargs and request.headers.get("If-Match"):
                item = get_object_or_404(
                    Material.objects.select_for_update(), pk=kwargs["id"], course=course
                )
                try:
                    expected = parse_datetime(request.headers["If-Match"].strip('"'))
                except ValueError:
                    expected = None
                if expected != item.updated_at:
                    raise ConflictError("Học liệu đã thay đổi. Tải lại trước khi thao tác.")

    def handle_exception(self, exc: Exception) -> Response:
        if isinstance(exc, DjangoValidationError):
            detail = exc.message_dict if hasattr(exc, "message_dict") else exc.messages
            exc = exceptions.ValidationError(detail)
        elif isinstance(exc, DjangoPermissionDenied):
            exc = exceptions.PermissionDenied(str(exc))
        elif isinstance(exc, DomainError):
            if exc.code in {"IDEMPOTENCY_CONFLICT", "IDEMPOTENCY_IN_PROGRESS"}:
                return super().handle_exception(exc)
            if exc.code == "COURSE_ARCHIVED":
                exc = exceptions.PermissionDenied("Môn học đã lưu trữ và ở chế độ chỉ đọc.")
            elif exc.code == "ACCOUNT_INACTIVE":
                exc = exceptions.AuthenticationFailed("Tài khoản đã bị vô hiệu hóa.")
            else:
                exc = exceptions.ValidationError(str(exc))
        return super().handle_exception(exc)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store, private"
        response["X-Content-Type-Options"] = "nosniff"
        return response


def _check_course_manager(user: Any, course: Course) -> None:
    """Xác thực giảng viên phụ trách môn học và tài khoản đã được xác thực an toàn."""
    require_verified(user)
    if not (has_role(user, Role.TEACHER) and course.teacher_id == user.id):
        raise exceptions.PermissionDenied(
            "Chỉ giảng viên phụ trách môn học mới có quyền thực hiện thao tác này."
        )


def _check_course_access(user: Any, course: Course) -> tuple[bool, bool]:
    """Phân giải quyền: (is_manager, is_student_member)."""
    require_verified(user)
    is_mgr = has_role(user, Role.TEACHER) and course.teacher_id == user.id
    is_stu = (
        has_role(user, Role.STUDENT)
        and Membership.objects.filter(
            course=course, student=user, status=Membership.Status.ACTIVE
        ).exists()
    )
    return is_mgr, is_stu


class CourseMaterialsListView(MaterialsBaseView):
    """Quản lý danh sách và tạo học liệu mới cho môn học."""

    @extend_schema(
        operation_id="courses_materials_list",
        parameters=[
            OpenApiParameter("chapter_id", str, required=False, description="Lọc theo chương"),
            OpenApiParameter(
                "search", str, required=False, description="Tìm kiếm theo tiêu đề/tag"
            ),
            OpenApiParameter(
                "visibility", str, required=False, description="Lọc theo visibility (chỉ GV)"
            ),
        ],
        responses={200: PaginatedMaterialListSerializer},
    )
    def get(self, request, course_id):
        course = get_object_or_404(Course, pk=course_id)
        is_mgr, is_stu = _check_course_access(request.user, course)
        if not (is_mgr or is_stu):
            raise exceptions.PermissionDenied(
                "Bạn không có quyền truy cập học liệu của môn học này."
            )

        qs = Material.objects.filter(course=course).select_related(
            "course", "chapter", "lesson", "published_version"
        )

        if is_stu and not is_mgr:
            # Sinh viên chỉ thấy học liệu đã xuất bản và không bị ẩn
            qs = qs.filter(is_hidden=False, published_version__isnull=False)
        else:
            # Giảng viên có thể lọc theo visibility
            vis = request.query_params.get("visibility")
            if vis == MaterialVisibility.HIDDEN:
                qs = qs.filter(is_hidden=True)
            elif vis == MaterialVisibility.PUBLISHED:
                qs = qs.filter(is_hidden=False, published_version__isnull=False)
            elif vis == MaterialVisibility.DRAFT:
                qs = qs.filter(published_version__isnull=True)

        from uuid import UUID

        for field in ["chapter_id", "lesson_id"]:
            value = request.query_params.get(field)
            if value:
                try:
                    qs = qs.filter(**{field: UUID(value)})
                except ValueError as exc:
                    raise exceptions.ValidationError({field: "Mã không hợp lệ."}) from exc
        if request.query_params.get("tag"):
            qs = qs.filter(tags__contains=[request.query_params["tag"].strip()])

        search = request.query_params.get("search")
        if search:
            search_str = search.strip()
            qs = qs.filter(Q(title__icontains=search_str) | Q(description__icontains=search_str))

        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(qs.order_by("-created_at", "id"), request)
        return paginator.get_paginated_response(
            MaterialListItemSerializer(page, many=True, context={"request": request}).data
        )

    @extend_schema(
        request=MaterialCreateRequestSerializer,
        responses={201: MaterialDetailSerializer},
    )
    def post(self, request, course_id):
        course = get_object_or_404(Course, pk=course_id)
        _check_course_manager(request.user, course)

        serializer = MaterialCreateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        def mutate():
            mat, ver = create_material(
                course=course,
                teacher=request.user,
                title=data["title"],
                description=data.get("description", ""),
                material_type=data.get("material_type", "document"),
                tags=data.get("tags", []),
                chapter_id=data.get("chapter_id"),
                lesson_id=data.get("lesson_id"),
                initial_file_ids=data.get("initial_file_ids", []),
            )
            return ResultReference("material", mat.id)

        key = request.headers.get("Idempotency-Key")
        if key:
            ref = execute_once(
                scope="user:" + str(request.user.id),
                operation="materials.create",
                key=key,
                payload={
                    "course_id": str(course_id),
                    "data": {
                        k: [str(v) for v in value] if isinstance(value, list) else str(value)
                        for k, value in data.items()
                    },
                },
                mutation=mutate,
            )
            mat = get_object_or_404(Material, pk=ref.resource_id, course=course)
        else:
            mat = get_object_or_404(Material, pk=mutate().resource_id)

        return Response(
            MaterialDetailSerializer(mat, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class CourseMaterialDetailView(MaterialsBaseView):
    """Xem chi tiết, cập nhật metadata và xóa học liệu."""

    @extend_schema(responses={200: MaterialDetailSerializer})
    def get(self, request, course_id, id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        is_mgr, is_stu = _check_course_access(request.user, course)
        if not (is_mgr or is_stu):
            raise exceptions.PermissionDenied("Bạn không có quyền truy cập học liệu này.")

        if is_stu and not is_mgr and (mat.is_hidden or not mat.published_version_id):
            raise exceptions.PermissionDenied("Học liệu không khả dụng.")

        return Response(MaterialDetailSerializer(mat, context={"request": request}).data)

    @extend_schema(
        request=MaterialUpdateRequestSerializer,
        responses={200: MaterialDetailSerializer},
    )
    def patch(self, request, course_id, id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        _check_course_manager(request.user, course)

        serializer = MaterialUpdateRequestSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        kwargs: dict[str, Any] = {}
        if "title" in data:
            kwargs["title"] = data["title"]
        if "description" in data:
            kwargs["description"] = data["description"]
        if "material_type" in data:
            kwargs["material_type"] = data["material_type"]
        if "tags" in data:
            kwargs["tags"] = data["tags"]
        if "chapter_id" in data:
            kwargs["chapter_id"] = data["chapter_id"]
        if "lesson_id" in data:
            kwargs["lesson_id"] = data["lesson_id"]
        if "is_hidden" in data:
            kwargs["is_hidden"] = data["is_hidden"]

        updated = update_material(mat, request.user, **kwargs)
        return Response(MaterialDetailSerializer(updated).data)

    @extend_schema(responses={204: None})
    def delete(self, request, course_id, id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        _check_course_manager(request.user, course)

        delete_material(mat, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CourseMaterialVersionsView(MaterialsBaseView):
    """Danh sách các phiên bản và tạo phiên bản nháp mới cho học liệu."""

    @extend_schema(responses={200: MaterialVersionSummarySerializer(many=True)})
    def get(self, request, course_id, id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        _check_course_manager(request.user, course)

        versions = mat.versions.all().order_by("-version_number")
        return Response(MaterialVersionSummarySerializer(versions, many=True).data)

    @extend_schema(
        request=MaterialVersionCreateRequestSerializer,
        responses={201: MaterialVersionDetailSerializer},
    )
    def post(self, request, course_id, id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        _check_course_manager(request.user, course)

        serializer = MaterialVersionCreateRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        clone_ver = None
        clone_id = data.get("clone_from_version_id")
        if clone_id:
            clone_ver = get_object_or_404(MaterialVersion, pk=clone_id, material=mat)

        def mutate():
            ver = create_material_version(
                material=mat,
                teacher=request.user,
                changelog=data.get("changelog", ""),
                clone_from_version=clone_ver,
            )
            return ResultReference("material_version", str(ver.id))

        key = request.headers.get("Idempotency-Key")
        if key:
            result = execute_once(
                key=key,
                scope="user:" + str(request.user.pk),
                operation="materials.create_version",
                payload={"material_id": str(mat.pk), "data": {k: str(v) for k, v in data.items()}},
                mutation=mutate,
            )
        else:
            result = mutate()
        ver = get_object_or_404(MaterialVersion, pk=result.resource_id, material=mat)
        return Response(MaterialVersionDetailSerializer(ver).data, status=status.HTTP_201_CREATED)


class CourseMaterialVersionDetailView(MaterialsBaseView):
    """Chi tiết một phiên bản học liệu kèm danh sách tệp manifest."""

    @extend_schema(responses={200: MaterialVersionDetailSerializer})
    def get(self, request, course_id, id, version_id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        is_mgr, is_stu = _check_course_access(request.user, course)
        if not (is_mgr or is_stu):
            raise exceptions.PermissionDenied("Bạn không có quyền truy cập phiên bản này.")

        ver = get_object_or_404(MaterialVersion, pk=version_id, material=mat)
        if is_stu and not is_mgr:
            # Sinh viên chỉ được xem phiên bản công bố và khi học liệu không bị ẩn
            if mat.is_hidden or mat.published_version_id != ver.id:
                raise exceptions.PermissionDenied("Phiên bản học liệu không khả dụng.")

        return Response(MaterialVersionDetailSerializer(ver).data)


class CourseMaterialVersionFilesView(MaterialsBaseView):
    """Thêm tệp tin vào manifest của phiên bản nháp."""

    @extend_schema(
        request=MaterialFileAddRequestSerializer,
        responses={201: MaterialFileManifestItemSerializer},
    )
    def post(self, request, course_id, id, version_id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        ver = get_object_or_404(MaterialVersion, pk=version_id, material=mat)
        _check_course_manager(request.user, course)

        serializer = MaterialFileAddRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        stored_file = get_object_or_404(StoredFile, pk=data["file_id"], course=course)
        mf = add_file_to_version(
            material_version=ver,
            stored_file=stored_file,
            teacher=request.user,
            label=data.get("label", ""),
            position=data.get("position"),
        )
        return Response(MaterialFileManifestItemSerializer(mf).data, status=status.HTTP_201_CREATED)


class CourseMaterialVersionFileDetailView(MaterialsBaseView):
    """Xóa tệp tin khỏi manifest của phiên bản nháp."""

    @extend_schema(responses={204: None})
    def delete(self, request, course_id, id, version_id, file_id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        ver = get_object_or_404(MaterialVersion, pk=version_id, material=mat)
        _check_course_manager(request.user, course)

        mf = get_object_or_404(MaterialFile, material_version=ver, file_id=file_id)
        remove_file_from_version(
            material_version=ver,
            material_file_id=mf.id,
            teacher=request.user,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class CourseMaterialVersionFinalizeView(MaterialsBaseView):
    """Đóng băng manifest của phiên bản nháp, tính toán sha256 và snapshot policy."""

    @extend_schema(request=None, responses={200: MaterialVersionDetailSerializer})
    def post(self, request, course_id, id, version_id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        ver = get_object_or_404(MaterialVersion, pk=version_id, material=mat)
        _check_course_manager(request.user, course)

        finalized_ver = finalize_material_version(ver, request.user)
        return Response(MaterialVersionDetailSerializer(finalized_ver).data)


class CourseMaterialPublishView(MaterialsBaseView):
    """Công bố một phiên bản đã đóng băng làm con trỏ công bố chính thức."""

    @extend_schema(
        request=MaterialPublishRequestSerializer,
        responses={200: MaterialDetailSerializer},
    )
    def post(self, request, course_id, id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        _check_course_manager(request.user, course)

        serializer = MaterialPublishRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        version_id = serializer.validated_data["version_id"]

        ver = get_object_or_404(MaterialVersion, pk=version_id, material=mat)
        published_mat = publish_material_version(
            material=mat,
            material_version=ver,
            teacher=request.user,
        )
        return Response(MaterialDetailSerializer(published_mat).data)


class CourseMaterialHideView(MaterialsBaseView):
    """Ẩn học liệu khỏi sinh viên."""

    @extend_schema(request=None, responses={200: MaterialDetailSerializer})
    def post(self, request, course_id, id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        _check_course_manager(request.user, course)

        hidden_mat = hide_material(mat, request.user)
        return Response(MaterialDetailSerializer(hidden_mat).data)


class CourseMaterialUnhideView(MaterialsBaseView):
    """Mở lại học liệu đã ẩn nếu đã có phiên bản công bố."""

    @extend_schema(request=None, responses={200: MaterialDetailSerializer})
    def post(self, request, course_id, id):
        course = get_object_or_404(Course, pk=course_id)
        mat = get_object_or_404(Material, pk=id, course=course)
        _check_course_manager(request.user, course)

        unhidden_mat = unhide_material(mat, request.user)
        return Response(MaterialDetailSerializer(unhidden_mat).data)


class CourseMaterialFileDownloadView(MaterialsBaseView):
    """Tải xuống tệp tin học liệu có kiểm tra quyền và tính toàn vẹn."""

    preview = False

    @extend_schema(responses={200: bytes})
    def get(self, request, course_id, id, file_id):
        mf, content = get_material_file_for_delivery(
            actor=request.user,
            course_id=course_id,
            material_id=id,
            file_id=file_id,
            is_preview=self.preview,
        )

        media_types = {
            "pdf": "application/pdf",
            "png": "image/png",
            "jpg": "image/jpeg",
            "jpeg": "image/jpeg",
            "gif": "image/gif",
            "webp": "image/webp",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "txt": "text/plain; charset=utf-8",
        }
        ext = mf.file_name.rsplit(".", 1)[-1].lower() if "." in mf.file_name else ""
        content_type = media_types.get(ext, mf.mime_type or "application/octet-stream")

        response = HttpResponse(content, content_type=content_type)
        response["Content-Disposition"] = content_disposition_header(not self.preview, mf.file_name)
        response["Content-Security-Policy"] = "sandbox; default-src 'none'"
        return response


class CourseMaterialFilePreviewView(CourseMaterialFileDownloadView):
    """Xem trước tệp tin học liệu trong sandbox an toàn."""

    preview = True


class CourseMaterialsSearchView(MaterialsBaseView):
    """Tìm kiếm học liệu trong phạm vi một môn học với phân rã provenance và phân quyền."""

    @extend_schema(
        operation_id="courses_materials_search",
        parameters=[
            OpenApiParameter(
                "q", str, required=False, description="Từ khóa tìm kiếm (tối đa 200 ký tự)"
            ),
            OpenApiParameter(
                "type", str, required=False, description="Lọc theo loại tệp (all, pdf, docx, txt)"
            ),
            OpenApiParameter("chapter_id", str, required=False, description="Lọc theo mã chương"),
            OpenApiParameter("tag", str, required=False, description="Lọc theo thẻ"),
            OpenApiParameter(
                "sort_by",
                str,
                required=False,
                description="Sắp xếp: relevance, newest, title_asc, title_desc",
            ),
        ],
        responses={200: PaginatedMaterialSearchResultSerializer},
    )
    def get(self, request, course_id):
        course = get_object_or_404(Course, pk=course_id)
        is_mgr, is_stu = _check_course_access(request.user, course)
        if not (is_mgr or is_stu):
            raise exceptions.PermissionDenied(
                "Bạn không có quyền truy cập học liệu của môn học này."
            )

        q = request.query_params.get("q", "")
        file_type = request.query_params.get("type")
        chapter_id = request.query_params.get("chapter_id")
        tag = request.query_params.get("tag")
        sort_by = request.query_params.get("sort_by", "relevance")

        results = search_materials(
            user=request.user,
            q=q,
            course_id=str(course_id),
            file_type=file_type,
            chapter_id=chapter_id,
            tag=tag,
            sort_by=sort_by,
        )

        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(results, request)
        return paginator.get_paginated_response(page)


class GlobalMaterialsSearchView(MaterialsBaseView):
    """Tìm kiếm học liệu trên tất cả các môn học người dùng có quyền tham gia/giảng dạy."""

    @extend_schema(
        operation_id="materials_search_global",
        parameters=[
            OpenApiParameter(
                "q", str, required=False, description="Từ khóa tìm kiếm (tối đa 200 ký tự)"
            ),
            OpenApiParameter(
                "course_id", str, required=False, description="Lọc theo môn học cụ thể"
            ),
            OpenApiParameter(
                "type", str, required=False, description="Lọc theo loại tệp (all, pdf, docx, txt)"
            ),
            OpenApiParameter("chapter_id", str, required=False, description="Lọc theo mã chương"),
            OpenApiParameter("tag", str, required=False, description="Lọc theo thẻ"),
            OpenApiParameter(
                "sort_by",
                str,
                required=False,
                description="Sắp xếp: relevance, newest, title_asc, title_desc",
            ),
        ],
        responses={200: PaginatedMaterialSearchResultSerializer},
    )
    def get(self, request):
        require_verified(request.user)

        q = request.query_params.get("q", "")
        course_id = request.query_params.get("course_id")
        file_type = request.query_params.get("type")
        chapter_id = request.query_params.get("chapter_id")
        tag = request.query_params.get("tag")
        sort_by = request.query_params.get("sort_by", "relevance")

        results = search_materials(
            user=request.user,
            q=q,
            course_id=course_id,
            file_type=file_type,
            chapter_id=chapter_id,
            tag=tag,
            sort_by=sort_by,
        )

        paginator = StandardPageNumberPagination()
        page = paginator.paginate_queryset(results, request)
        return paginator.get_paginated_response(page)


class GlobalMaterialDetailView(MaterialsBaseView):
    """Xem chi tiết học liệu tra cứu trực tiếp theo ID (hỗ trợ deep link sinh viên/giảng viên)."""

    @extend_schema(
        operation_id="materials_retrieve_global",
        responses={200: MaterialDetailSerializer},
    )
    def get(self, request, id):
        require_verified(request.user)
        mat = get_object_or_404(
            Material.objects.select_related("course", "chapter", "lesson", "published_version"),
            pk=id,
        )
        is_mgr, is_stu = _check_course_access(request.user, mat.course)
        if not (is_mgr or is_stu):
            raise exceptions.PermissionDenied("Bạn không có quyền truy cập học liệu này.")

        if is_stu and not is_mgr and (mat.is_hidden or not mat.published_version_id):
            raise exceptions.PermissionDenied("Học liệu không khả dụng.")

        return Response(MaterialDetailSerializer(mat, context={"request": request}).data)


class CourseMaterialVersionRetryView(MaterialsBaseView):
    @extend_schema(request=None, responses={200: MaterialVersionDetailSerializer})
    def post(self, request, course_id, id, version_id):
        version = get_object_or_404(
            MaterialVersion, pk=version_id, material_id=id, material__course_id=course_id
        )
        result = retry_material_version(version, request.user)
        return Response(MaterialVersionDetailSerializer(result).data)
