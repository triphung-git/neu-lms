from rest_framework import serializers


class CourseChatRequestSerializer(serializers.Serializer):
    question = serializers.CharField(
        min_length=3,
        max_length=2000,
        trim_whitespace=True,
        help_text="Câu hỏi cần trợ lý AI trả lời dựa trên học liệu."
    )


class CourseChatCitationSerializer(serializers.Serializer):
    id = serializers.CharField()
    material_id = serializers.UUIDField()
    material_title = serializers.CharField()
    course_code = serializers.CharField()
    course_name = serializers.CharField()
    file_name = serializers.CharField()
    page_number = serializers.IntegerField(allow_null=True)
    excerpt = serializers.CharField()


class CourseChatCourseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()


class CourseChatResponseSerializer(serializers.Serializer):
    answer = serializers.CharField()
    citations = CourseChatCitationSerializer(many=True)
    course = CourseChatCourseSerializer()