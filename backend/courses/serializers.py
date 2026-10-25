from rest_framework import serializers

from .models import Chapter, Course, Lesson


class CourseSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(
        source="teacher.display_name",
        read_only=True,
    )
    active_member_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Course

        fields = [
            "id",
            "code",
            "name",
            "term",
            "description",
            "teacher",
            "teacher_name",
            "status",
            "enrollment_open",
            "archived_at",
            "active_member_count",
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "teacher",
            "teacher_name",
            "status",
            "archived_at",
            "active_member_count",
            "created_at",
            "updated_at",
        ]

    def validate_code(self, value):
        code = value.strip().upper()
        queryset = Course.objects.filter(code__iexact=code)

        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)

        if queryset.exists():
            raise serializers.ValidationError("Mã môn học đã tồn tại.")

        return code

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Tên môn học không được để trống.")
        return value

    def validate_term(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Học kỳ không được để trống.")
        return value

    def validate_description(self, value):
        return value.strip()


class ChapterSerializer(serializers.ModelSerializer):
    class Meta:
        model = Chapter
        fields = ["id", "course", "title", "position", "created_at", "updated_at"]
        read_only_fields = ["id", "course", "position", "created_at", "updated_at"]

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Tiêu đề chương không được để trống.")
        return value


class LessonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Lesson
        fields = [
            "id",
            "chapter",
            "title",
            "description",
            "position",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "chapter", "position", "created_at", "updated_at"]

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Tiêu đề bài học không được để trống.")
        return value

    def validate_description(self, value):
        return value.strip()


class ReorderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)

    def validate_ids(self, value):
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Danh sách có phần tử bị trùng.")
        return value


class CourseTransferSerializer(serializers.Serializer):
    teacher_id = serializers.UUIDField()
