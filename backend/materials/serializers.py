from rest_framework import serializers

from files.models import CourseFilePolicy
from identity.models import Role
from identity.services.common import has_role

from .models import (
    Material,
    MaterialFile,
    MaterialType,
    MaterialVersion,
    MaterialVisibility,
)


class MaterialFileManifestItemSerializer(serializers.ModelSerializer):
    """Chi tiết một tệp tin trong manifest của phiên bản học liệu."""

    file_id = serializers.UUIDField(source="file.id", read_only=True)
    extraction_status = serializers.SerializerMethodField()
    extraction_error = serializers.SerializerMethodField()
    extraction_page_count = serializers.SerializerMethodField()
    download_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()

    class Meta:
        model = MaterialFile
        fields = [
            "id",
            "file_id",
            "position",
            "label",
            "file_name",
            "file_size",
            "mime_type",
            "sha256_hash",
            "download_url",
            "preview_url",
            "extraction_status",
            "extraction_error",
            "extraction_page_count",
            "created_at",
        ]
        read_only_fields = fields

    def get_extraction_status(self, obj) -> str:
        result = obj.extractions.order_by("-created_at").first()
        return result.status if result else "pending"

    def get_extraction_error(self, obj) -> str:
        result = obj.extractions.order_by("-created_at").first()
        return "Trích xuất chưa thành công." if result and result.status == "failed" else ""

    def get_extraction_page_count(self, obj) -> int:
        result = obj.extractions.order_by("-created_at").first()
        return result.page_count if result else 0

    def get_download_url(self, obj: MaterialFile) -> str:
        course_id = obj.material_version.material.course_id
        return f"/api/v1/courses/{course_id}/files/{obj.file_id}/download"

    def get_preview_url(self, obj: MaterialFile) -> str | None:
        policy = CourseFilePolicy.objects.filter(
            course_id=obj.material_version.material.course_id
        ).first()
        ext = obj.file_name.rsplit(".", 1)[-1].lower()
        if (policy and not policy.preview_allowed) or ext not in {
            "pdf",
            "png",
            "jpg",
            "jpeg",
            "gif",
            "webp",
        }:
            return None
        course_id = obj.material_version.material.course_id
        return f"/api/v1/courses/{course_id}/files/{obj.file_id}/preview"


class MaterialVersionDetailSerializer(serializers.ModelSerializer):
    """Chi tiết phiên bản học liệu kèm danh sách tệp tin đóng băng trong manifest."""

    material_id = serializers.UUIDField(source="material.id", read_only=True)
    material_title = serializers.CharField(source="material.title", read_only=True)
    created_by_name = serializers.CharField(source="created_by.display_name", read_only=True)
    files = MaterialFileManifestItemSerializer(source="material_files", many=True, read_only=True)

    class Meta:
        model = MaterialVersion
        fields = [
            "id",
            "material_id",
            "material_title",
            "version_number",
            "title",
            "description",
            "changelog",
            "lifecycle_status",
            "processing_status",
            "is_published",
            "finalized_at",
            "published_at",
            "manifest_hash",
            "total_size_bytes",
            "file_count",
            "policy_snapshot",
            "summary",
            "summary_confirmed_at",
            "created_by_name",
            "created_at",
            "updated_at",
            "files",
        ]
        read_only_fields = fields


class MaterialVersionSummarySerializer(serializers.ModelSerializer):
    """Tóm tắt ngắn gọn phiên bản học liệu dùng trong danh sách."""

    class Meta:
        model = MaterialVersion
        fields = [
            "id",
            "version_number",
            "title",
            "changelog",
            "lifecycle_status",
            "processing_status",
            "is_published",
            "file_count",
            "total_size_bytes",
            "published_at",
            "finalized_at",
            "created_at",
        ]
        read_only_fields = fields


class MaterialDetailSerializer(serializers.ModelSerializer):
    """Chi tiết học liệu kèm thông tin phiên bản công bố và danh sách các phiên bản."""

    course_id = serializers.UUIDField(source="course.id", read_only=True)
    course_code = serializers.CharField(source="course.code", read_only=True)
    chapter_title = serializers.CharField(source="chapter.title", read_only=True)
    lesson_title = serializers.CharField(source="lesson.title", read_only=True)
    published_version = MaterialVersionDetailSerializer(read_only=True)
    latest_version = serializers.SerializerMethodField()
    visibility = serializers.SerializerMethodField()
    total_versions = serializers.SerializerMethodField()

    class Meta:
        model = Material
        fields = [
            "id",
            "course_id",
            "course_code",
            "chapter",
            "chapter_title",
            "lesson",
            "lesson_title",
            "title",
            "description",
            "tags",
            "material_type",
            "is_hidden",
            "visibility",
            "published_version",
            "latest_version",
            "total_versions",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def to_representation(self, obj):
        data = super().to_representation(obj)
        request = self.context.get("request")
        if request and not (
            has_role(request.user, Role.TEACHER) and obj.course.teacher_id == request.user.id
        ):
            published = obj.published_version
            data["latest_version"] = (
                MaterialVersionSummarySerializer(published).data if published else None
            )
            data["total_versions"] = 1 if published else 0
        return data

    def get_visibility(self, obj: Material) -> str:
        if obj.is_hidden:
            return MaterialVisibility.HIDDEN
        if obj.published_version_id:
            return MaterialVisibility.PUBLISHED
        return MaterialVisibility.DRAFT

    def get_latest_version(self, obj: Material) -> dict | None:
        latest = obj.versions.order_by("-version_number").first()
        if not latest:
            return None
        return MaterialVersionSummarySerializer(latest).data

    def get_total_versions(self, obj: Material) -> int:
        return obj.versions.count()


class MaterialListItemSerializer(serializers.ModelSerializer):
    """Mục học liệu hiển thị trong danh sách phân trang."""

    course_id = serializers.UUIDField(source="course.id", read_only=True)
    course_code = serializers.CharField(source="course.code", read_only=True)
    chapter_title = serializers.CharField(source="chapter.title", read_only=True)
    lesson_title = serializers.CharField(source="lesson.title", read_only=True)
    visibility = serializers.SerializerMethodField()
    published_version_number = serializers.SerializerMethodField()
    latest_version_number = serializers.SerializerMethodField()
    file_count = serializers.SerializerMethodField()
    total_size_bytes = serializers.SerializerMethodField()

    class Meta:
        model = Material
        fields = [
            "id",
            "course_id",
            "course_code",
            "chapter",
            "chapter_title",
            "lesson",
            "lesson_title",
            "title",
            "tags",
            "material_type",
            "is_hidden",
            "visibility",
            "published_version_number",
            "latest_version_number",
            "file_count",
            "total_size_bytes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def to_representation(self, obj):
        data = super().to_representation(obj)
        request = self.context.get("request")
        if request and not (
            has_role(request.user, Role.TEACHER) and obj.course.teacher_id == request.user.id
        ):
            data["latest_version_number"] = data["published_version_number"]
        return data

    def get_visibility(self, obj: Material) -> str:
        if obj.is_hidden:
            return MaterialVisibility.HIDDEN
        if obj.published_version_id:
            return MaterialVisibility.PUBLISHED
        return MaterialVisibility.DRAFT

    def get_published_version_number(self, obj: Material) -> int | None:
        return obj.published_version.version_number if obj.published_version else None

    def get_latest_version_number(self, obj: Material) -> int:
        latest = obj.versions.order_by("-version_number").first()
        return latest.version_number if latest else 1

    def get_file_count(self, obj: Material) -> int:
        target = obj.published_version or obj.versions.order_by("-version_number").first()
        return target.file_count if target else 0

    def get_total_size_bytes(self, obj: Material) -> int:
        target = obj.published_version or obj.versions.order_by("-version_number").first()
        return target.total_size_bytes if target else 0


class MaterialCreateRequestSerializer(serializers.Serializer):
    """Payload tạo học liệu mới."""

    title = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    material_type = serializers.ChoiceField(
        choices=MaterialType.choices, default=MaterialType.DOCUMENT
    )
    tags = serializers.ListField(
        child=serializers.CharField(max_length=50), required=False, default=list
    )
    chapter_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    lesson_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    initial_file_ids = serializers.ListField(
        child=serializers.UUIDField(), required=False, default=list
    )


class MaterialUpdateRequestSerializer(serializers.Serializer):
    """Payload cập nhật metadata học liệu."""

    title = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    material_type = serializers.ChoiceField(choices=MaterialType.choices, required=False)
    tags = serializers.ListField(child=serializers.CharField(max_length=50), required=False)
    chapter_id = serializers.UUIDField(required=False, allow_null=True)
    lesson_id = serializers.UUIDField(required=False, allow_null=True)
    is_hidden = serializers.BooleanField(required=False)


class MaterialVersionCreateRequestSerializer(serializers.Serializer):
    """Payload tạo revision (phiên bản nháp mới)."""

    changelog = serializers.CharField(required=False, allow_blank=True, default="")
    clone_from_version_id = serializers.UUIDField(required=False, allow_null=True, default=None)


class MaterialFileAddRequestSerializer(serializers.Serializer):
    """Payload thêm tệp vào manifest của phiên bản nháp."""

    file_id = serializers.UUIDField()
    label = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    position = serializers.IntegerField(min_value=1, required=False, default=None)


class MaterialPublishRequestSerializer(serializers.Serializer):
    """Payload công bố phiên bản học liệu."""

    version_id = serializers.UUIDField()


class PaginationInfoSerializer(serializers.Serializer):
    """Metadata phân trang chuẩn toàn hệ thống."""

    page = serializers.IntegerField()
    page_size = serializers.IntegerField()
    total_items = serializers.IntegerField()
    total_pages = serializers.IntegerField()
    has_next = serializers.BooleanField()
    has_previous = serializers.BooleanField()


class PaginatedMaterialListSerializer(serializers.Serializer):
    """Dữ liệu phân trang danh sách học liệu chuẩn StandardPageNumberPagination."""

    items = MaterialListItemSerializer(many=True)
    pagination = PaginationInfoSerializer()


class MaterialSearchMatchSerializer(serializers.Serializer):
    """Chi tiết điểm khớp tìm kiếm trong tệp hoặc metadata."""

    file_id = serializers.UUIDField(allow_null=True)
    file_name = serializers.CharField(allow_blank=True)
    mime_type = serializers.CharField(allow_blank=True)
    page_number = serializers.IntegerField(allow_null=True)
    snippet = serializers.CharField()
    match_type = serializers.CharField()


class MaterialSearchResultSerializer(serializers.Serializer):
    """Kết quả tìm kiếm học liệu với provenance và điểm xếp hạng."""

    id = serializers.UUIDField()
    course_id = serializers.UUIDField()
    course_name = serializers.CharField()
    course_code = serializers.CharField()
    title = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    tags = serializers.ListField(child=serializers.CharField())
    material_type = serializers.CharField()
    chapter_id = serializers.UUIDField(allow_null=True)
    chapter_title = serializers.CharField(allow_null=True)
    lesson_id = serializers.UUIDField(allow_null=True)
    lesson_title = serializers.CharField(allow_null=True)
    version_id = serializers.UUIDField(allow_null=True)
    version_number = serializers.IntegerField()
    is_hidden = serializers.BooleanField()
    published_at = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    rank = serializers.FloatField()
    matches = MaterialSearchMatchSerializer(many=True)


class PaginatedMaterialSearchResultSerializer(serializers.Serializer):
    """Dữ liệu phân trang kết quả tìm kiếm học liệu chuẩn StandardPageNumberPagination."""

    items = MaterialSearchResultSerializer(many=True)
    pagination = PaginationInfoSerializer()
