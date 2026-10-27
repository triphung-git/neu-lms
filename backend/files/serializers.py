from rest_framework import serializers

from .constants import (
    SYSTEM_MAX_COURSE_QUOTA_BYTES,
    SYSTEM_MAX_FILE_SIZE_BYTES,
)
from .models import CourseFilePolicy, FilePurpose, StoredFile


class CourseFilePolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseFilePolicy
        fields = [
            "id",
            "course_id",
            "allowed_extensions",
            "max_file_size_bytes",
            "max_files_per_assignment",
            "course_quota_bytes",
            "used_quota_bytes",
            "reserved_quota_bytes",
            "version",
            "preview_allowed",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "version",
            "id",
            "course_id",
            "used_quota_bytes",
            "reserved_quota_bytes",
            "created_at",
            "updated_at",
        ]

    def validate_max_file_size_bytes(self, value):
        if value <= 0:
            raise serializers.ValidationError("Kích thước tệp tối đa phải lớn hơn 0.")
        if value > SYSTEM_MAX_FILE_SIZE_BYTES:
            max_mb = SYSTEM_MAX_FILE_SIZE_BYTES // (1024 * 1024)
            raise serializers.ValidationError(
                f"Kích thước tệp tối đa không được vượt quá trần hệ thống ({max_mb}MB)."
            )
        return value

    def validate_course_quota_bytes(self, value):
        if value <= 0:
            raise serializers.ValidationError("Dung lượng môn học tối đa phải lớn hơn 0.")
        if value > SYSTEM_MAX_COURSE_QUOTA_BYTES:
            max_gb = SYSTEM_MAX_COURSE_QUOTA_BYTES // (1024 * 1024 * 1024)
            raise serializers.ValidationError(
                f"Dung lượng môn học không được vượt quá trần hệ thống ({max_gb}GB)."
            )
        return value

    def validate_max_files_per_assignment(self, value):
        if not (1 <= value <= 10):
            raise serializers.ValidationError("Số tệp tối đa cho một lần nộp phải từ 1 đến 10.")
        return value

    def validate_allowed_extensions(self, value):
        if not isinstance(value, list) or len(value) == 0:
            raise serializers.ValidationError("Danh sách định dạng cho phép không được rỗng.")
        cleaned = []
        for ext in value:
            clean_ext = str(ext).lstrip(".").strip().lower()
            if clean_ext in {
                "pdf",
                "docx",
                "xlsx",
                "pptx",
                "zip",
                "png",
                "jpg",
                "jpeg",
                "gif",
                "webp",
            }:
                cleaned.append(clean_ext)
        if not cleaned:
            raise serializers.ValidationError("Không có định dạng hợp lệ nào được chọn.")
        return list(dict.fromkeys(cleaned))


class UploadIntentSerializer(serializers.Serializer):
    file_name = serializers.CharField(max_length=255, required=True)
    file_size = serializers.IntegerField(min_value=1, required=True)
    purpose = serializers.ChoiceField(
        choices=FilePurpose.choices,
        default=FilePurpose.COURSE_MATERIAL,
        required=False,
    )


class UploadIntentResponseSerializer(serializers.Serializer):
    file_id = serializers.UUIDField()
    file_name = serializers.CharField()
    file_size = serializers.IntegerField()
    storage_path = serializers.CharField()
    status = serializers.CharField()
    purpose = serializers.CharField(required=False)
    expires_in_seconds = serializers.IntegerField(default=900)
    expires_at = serializers.DateTimeField()


class CommitUploadSerializer(serializers.Serializer):
    client_checksum = serializers.CharField(
        max_length=64,
        required=False,
        allow_blank=True,
        default="",
    )


class CommitUploadResponseSerializer(serializers.Serializer):
    file_id = serializers.UUIDField(source="id")
    file_name = serializers.CharField()
    file_size = serializers.IntegerField()
    status = serializers.CharField()
    sha256_hash = serializers.CharField()


class StoredFileSerializer(serializers.ModelSerializer):
    uploader_name = serializers.CharField(source="uploader.display_name", read_only=True)

    class Meta:
        model = StoredFile
        fields = [
            "id",
            "course_id",
            "uploader_id",
            "uploader_name",
            "file_name",
            "file_size",
            "status",
            "purpose",
            "is_published",
            "sha256_hash",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class PaginatedStoredFileListSerializer(serializers.Serializer):
    items = StoredFileSerializer(many=True)
    pagination = serializers.DictField()


class UpdateFilePublishSerializer(serializers.Serializer):
    is_published = serializers.BooleanField(required=True)
