from rest_framework import serializers


class AdminAccountRoleItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    role = serializers.ChoiceField(choices=["student", "teacher", "admin"])
    granted_at = serializers.DateTimeField()
    granted_by = serializers.UUIDField(allow_null=True)
    grant_source = serializers.CharField()
    revoked_at = serializers.DateTimeField(allow_null=True)
    revoke_reason = serializers.CharField(allow_blank=True, default="")


class AdminAccountRoleRequestItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    role = serializers.ChoiceField(choices=["student", "teacher"])
    status = serializers.ChoiceField(choices=["pending", "approved", "rejected", "cancelled"])
    requested_at = serializers.DateTimeField()
    reviewed_at = serializers.DateTimeField(allow_null=True)
    reviewed_by = serializers.UUIDField(allow_null=True)
    review_reason = serializers.CharField(allow_blank=True, default="")


class AdminAccountListItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    email = serializers.EmailField()
    display_name = serializers.CharField()
    is_active = serializers.BooleanField()
    email_verified = serializers.BooleanField()
    roles = serializers.ListField(child=serializers.CharField())
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class AdminAccountDetailSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    email = serializers.EmailField()
    display_name = serializers.CharField()
    is_active = serializers.BooleanField()
    email_verified = serializers.BooleanField()
    verified_at = serializers.DateTimeField(allow_null=True)
    roles = AdminAccountRoleItemSerializer(many=True)
    role_requests = AdminAccountRoleRequestItemSerializer(many=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class AdminAccountStateUpdateSerializer(serializers.Serializer):
    is_active = serializers.BooleanField()
    current_password = serializers.CharField(
        max_length=1024, required=False, write_only=True, allow_blank=True, trim_whitespace=False
    )


class AdminAccountStateResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    is_active = serializers.BooleanField()


class AdminAccountRoleGrantSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["admin", "teacher", "student"])
    current_password = serializers.CharField(
        max_length=1024, required=False, write_only=True, allow_blank=True, trim_whitespace=False
    )


class AdminAccountRoleGrantResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    user_id = serializers.UUIDField()
    role = serializers.CharField()
    granted_at = serializers.DateTimeField()


class AdminReauthSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        max_length=1024, required=False, write_only=True, allow_blank=True, trim_whitespace=False
    )


class AdminAccountRoleRevokeResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    role = serializers.CharField()
    revoked_at = serializers.DateTimeField()


class AdminTeacherRequestItemSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    user_id = serializers.UUIDField()
    user_email = serializers.EmailField()
    user_display_name = serializers.CharField()
    role = serializers.CharField()
    status = serializers.CharField()
    requested_at = serializers.DateTimeField()
    reviewed_at = serializers.DateTimeField(allow_null=True)
    reviewed_by = serializers.UUIDField(allow_null=True)
    review_reason = serializers.CharField(allow_blank=True, default="")


class AdminTeacherApprovalResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    user_id = serializers.UUIDField()
    role = serializers.CharField()
    status = serializers.CharField()
    granted_at = serializers.DateTimeField()


class AdminTeacherRejectResponseSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.CharField()
    reviewed_at = serializers.DateTimeField()


class AdminPasswordResetResponseSerializer(serializers.Serializer):
    message = serializers.CharField()
