from rest_framework import serializers

from .models import Course


class CourseSerializer(serializers.ModelSerializer):
    teacher_name = serializers.CharField(
        source="teacher.display_name",
        read_only=True,
    )

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
            "created_at",
            "updated_at",
        ]

        read_only_fields = [
            "id",
            "teacher",
            "teacher_name",
            "status",
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
