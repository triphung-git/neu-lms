from rest_framework import serializers


class CourseChatHistoryMessageSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=("user", "assistant"))
    content = serializers.CharField(
        min_length=1,
        max_length=2000,
        trim_whitespace=True,
    )


class CourseChatRequestSerializer(serializers.Serializer):
    request_id = serializers.UUIDField(required=False)
    question = serializers.CharField(
        min_length=3,
        max_length=2000,
        trim_whitespace=True,
        help_text="Câu hỏi cần trợ lý AI trả lời dựa trên học liệu.",
    )
    history = CourseChatHistoryMessageSerializer(
        many=True,
        required=False,
        allow_empty=True,
        max_length=8,
        help_text=(
            "Tối đa 8 lượt hội thoại gần nhất; "
            "chỉ dùng để hiểu ngữ cảnh, không phải nguồn dữ kiện "
            "để trả lời."
        ),
    )


class CourseChatCitationSerializer(serializers.Serializer):
    version_id = serializers.UUIDField(required=False)
    file_id = serializers.UUIDField(required=False)
    file_hash = serializers.CharField(required=False)
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


class MaterialSummaryDraftSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    course_id = serializers.UUIDField(read_only=True)
    course_code = serializers.CharField(read_only=True)
    course_name = serializers.CharField(read_only=True)
    material_id = serializers.UUIDField(read_only=True)
    material_title = serializers.CharField(read_only=True)
    material_version_id = serializers.UUIDField(read_only=True)
    version_number = serializers.IntegerField(read_only=True)
    summary = serializers.CharField(read_only=True)
    source_file_names = serializers.ListField(
        child=serializers.CharField(),
        read_only=True,
    )
    status = serializers.ChoiceField(
        choices=("pending", "confirmed", "discarded"),
        read_only=True,
    )
    created_at = serializers.DateTimeField(read_only=True)
    reviewed_at = serializers.DateTimeField(allow_null=True, read_only=True)


class MaterialSummaryDraftReviewSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=("confirmed", "discarded"))
    summary = serializers.CharField(
        required=False,
        allow_blank=False,
        min_length=3,
        max_length=20000,
        trim_whitespace=True,
    )
