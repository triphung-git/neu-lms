from rest_framework import serializers

from .models import Chapter, Course, EnrollmentRequest, Lesson, Membership


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


class CourseSummaryItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()
    term = serializers.CharField()
    status = serializers.CharField()
    enrollment_open = serializers.BooleanField()
    active_member_count = serializers.IntegerField(allow_null=True, required=False)
    teacher_name = serializers.CharField(allow_blank=True, required=False)
    chapter_count = serializers.IntegerField()
    lesson_count = serializers.IntegerField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class CourseSummaryResponseSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["teacher", "student"])

    # Teacher metrics (optional / nullable when role=student)
    total_courses = serializers.IntegerField(required=False, allow_null=True, default=None)
    open_courses = serializers.IntegerField(required=False, allow_null=True, default=None)
    archived_courses = serializers.IntegerField(required=False, allow_null=True, default=None)
    enrollment_open_courses = serializers.IntegerField(
        required=False, allow_null=True, default=None
    )
    total_memberships = serializers.IntegerField(required=False, allow_null=True, default=None)
    distinct_students = serializers.IntegerField(required=False, allow_null=True, default=None)
    pending_submissions = serializers.IntegerField(required=False, allow_null=True, default=None)
    problem_materials = serializers.IntegerField(required=False, allow_null=True, default=None)
    pending_ai_drafts = serializers.IntegerField(required=False, allow_null=True, default=None)

    # Student metrics (optional / nullable when role=teacher)
    total_enrolled_courses = serializers.IntegerField(required=False, allow_null=True, default=None)
    open_enrolled_courses = serializers.IntegerField(required=False, allow_null=True, default=None)
    archived_enrolled_courses = serializers.IntegerField(
        required=False, allow_null=True, default=None
    )
    withdrawn_courses = serializers.IntegerField(required=False, allow_null=True, default=None)
    recent_grades = serializers.IntegerField(required=False, allow_null=True, default=None)
    recent_announcements = serializers.IntegerField(required=False, allow_null=True, default=None)

    # Common metrics
    total_chapters = serializers.IntegerField()
    total_lessons = serializers.IntegerField()
    upcoming_deadlines = serializers.IntegerField(required=False, allow_null=True, default=None)
    recent_courses = CourseSummaryItemSerializer(many=True)
    unavailable_metrics = serializers.ListField(child=serializers.CharField())


class CourseCatalogItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()
    term = serializers.CharField()
    description = serializers.CharField(allow_blank=True)
    teacher_name = serializers.CharField()
    enrollment_open = serializers.BooleanField()
    active_member_count = serializers.IntegerField()
    my_enrollment_status = serializers.CharField()
    pending_request_id = serializers.UUIDField(allow_null=True)
    created_at = serializers.DateTimeField()


class StudentEnrollmentRequestSerializer(serializers.ModelSerializer):
    course_id = serializers.UUIDField(source="course.id", read_only=True)
    course_code = serializers.CharField(source="course.code", read_only=True)
    course_name = serializers.CharField(source="course.name", read_only=True)
    course_term = serializers.CharField(source="course.term", read_only=True)
    teacher_name = serializers.CharField(source="course.teacher.display_name", read_only=True)
    requested_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = EnrollmentRequest
        fields = [
            "id",
            "course_id",
            "course_code",
            "course_name",
            "course_term",
            "teacher_name",
            "status",
            "requested_at",
            "reviewed_at",
            "rejection_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class TeacherEnrollmentRequestSerializer(serializers.ModelSerializer):
    student_id = serializers.UUIDField(source="student.id", read_only=True)
    student_name = serializers.CharField(source="student.display_name", read_only=True)
    student_email = serializers.EmailField(source="student.email", read_only=True)
    reviewed_by_name = serializers.CharField(
        source="reviewed_by.display_name", allow_null=True, read_only=True
    )
    requested_at = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = EnrollmentRequest
        fields = [
            "id",
            "course_id",
            "student_id",
            "student_name",
            "student_email",
            "status",
            "requested_at",
            "reviewed_at",
            "reviewed_by_name",
            "rejection_reason",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class RejectEnrollmentRequestSerializer(serializers.Serializer):
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class AddMemberSerializer(serializers.Serializer):
    student_email = serializers.EmailField()


class CourseMemberSerializer(serializers.ModelSerializer):
    student_id = serializers.UUIDField(source="student.id", read_only=True)
    student_name = serializers.CharField(source="student.display_name", read_only=True)
    student_email = serializers.EmailField(source="student.email", read_only=True)

    class Meta:
        model = Membership
        fields = [
            "id",
            "course_id",
            "student_id",
            "student_name",
            "student_email",
            "status",
            "added_at",
            "updated_at",
        ]
        read_only_fields = fields
