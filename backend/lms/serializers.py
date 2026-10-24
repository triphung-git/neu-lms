from rest_framework import serializers

from .models import Course, EligibleEmail, Membership, User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User

        fields = [
            "id",
            "email",
            "first_name",
            "role",
            "is_active",
        ]

        read_only_fields = fields


class EligibleEmailSerializer(serializers.ModelSerializer):
    def validate_email(self, value):
        email = value.strip().lower()

        if EligibleEmail.objects.filter(email__iexact=email).exists():
            raise serializers.ValidationError("Email đã có trong danh sách.")

        return email

    class Meta:
        model = EligibleEmail

        fields = [
            "id",
            "email",
            "full_name",
            "role",
        ]


class CourseSerializer(serializers.ModelSerializer):
    def validate_code(self, value):
        code = value.strip().upper()
        query = Course.objects.filter(code__iexact=code)

        if self.instance:
            query = query.exclude(pk=self.instance.pk)

        if query.exists():
            raise serializers.ValidationError("Mã môn học đã tồn tại.")

        return code

    class Meta:
        model = Course

        fields = [
            "id",
            "code",
            "name",
            "term",
            "description",
            "teacher",
            "status",
        ]

        read_only_fields = [
            "teacher",
            "status",
        ]


class MembershipSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(
        source="student.email",
        read_only=True,
    )

    full_name = serializers.CharField(
        source="student.first_name",
        read_only=True,
    )

    class Meta:
        model = Membership

        fields = [
            "id",
            "course",
            "student",
            "email",
            "full_name",
            "status",
            "added_at",
        ]

        read_only_fields = fields
