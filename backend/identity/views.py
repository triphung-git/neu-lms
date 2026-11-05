from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.middleware.csrf import get_token, rotate_token
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.authentication import UserSessionAuthentication
from identity.models import RoleGrant, RoleRequest, VerifiedEmail
from identity.services.accounts import (
    register_account,
    resend_email_verification,
    verify_email,
)
from identity.services.common import digest
from identity.services.passwords import (
    change_password,
    login_password,
    rate_limit,
    request_password_reset,
    reset_password,
)
from identity.services.roles import close_request, submit_role_request
from identity.services.sessions import revoke_all_sessions, revoke_session
from platform_core.errors import DomainError


class Credentials(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=1024, write_only=True, trim_whitespace=False)


class PasswordChange(serializers.Serializer):
    current_password = serializers.CharField(
        max_length=1024, write_only=True, trim_whitespace=False
    )
    new_password = serializers.CharField(max_length=1024, write_only=True, trim_whitespace=False)


class ResetRequest(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class ResetConfirm(serializers.Serializer):
    token = serializers.CharField(max_length=128, write_only=True)
    new_password = serializers.CharField(max_length=1024, write_only=True, trim_whitespace=False)


class SessionInfo(serializers.Serializer):
    id = serializers.UUIDField()
    email = serializers.EmailField()
    display_name = serializers.CharField()
    roles = serializers.ListField(
        child=serializers.ChoiceField(choices=["student", "teacher", "admin"])
    )
    email_verified = serializers.BooleanField()
    pending_roles = serializers.ListField(
        child=serializers.ChoiceField(choices=["student", "teacher"])
    )
    idle_expires_at = serializers.DateTimeField()
    absolute_expires_at = serializers.DateTimeField()


class RegisterRequest(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=1024, write_only=True, trim_whitespace=False)
    display_name = serializers.CharField(
        max_length=150, required=False, default="", allow_blank=True
    )
    requested_role = serializers.ChoiceField(choices=["student", "teacher"])


class RegisterResponse(serializers.Serializer):
    id = serializers.UUIDField()
    email = serializers.EmailField()
    display_name = serializers.CharField()
    requested_role = serializers.ChoiceField(choices=["student", "teacher"])
    email_verified = serializers.BooleanField(default=False)


class VerifyEmailRequest(serializers.Serializer):
    token = serializers.CharField(max_length=128)


class VerifyEmailResponse(serializers.Serializer):
    email = serializers.EmailField()
    verified = serializers.BooleanField()
    granted_roles = serializers.ListField(
        child=serializers.ChoiceField(choices=["student", "teacher", "admin"])
    )


class ResendVerificationRequest(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class RoleRequestItem(serializers.Serializer):
    id = serializers.UUIDField()
    role = serializers.ChoiceField(choices=["student", "teacher"])
    status = serializers.ChoiceField(choices=["pending", "approved", "rejected", "cancelled"])
    requested_at = serializers.DateTimeField()
    reviewed_at = serializers.DateTimeField(allow_null=True)
    review_reason = serializers.CharField(allow_blank=True, default="")


class CreateRoleRequest(serializers.Serializer):
    role = serializers.ChoiceField(choices=["student", "teacher"])


class RoleGrantItem(serializers.Serializer):
    id = serializers.UUIDField()
    role = serializers.ChoiceField(choices=["student", "teacher", "admin"])
    grant_source = serializers.CharField()
    granted_at = serializers.DateTimeField()


class VerificationStatusResponse(serializers.Serializer):
    email = serializers.EmailField()
    verified = serializers.BooleanField()
    verified_at = serializers.DateTimeField(allow_null=True)


def is_user_email_verified(user) -> bool:
    try:
        ve = user.verifiedemail
        return ve.verified_at is not None and ve.email_digest == digest(user.email)
    except (VerifiedEmail.DoesNotExist, AttributeError):
        return False


def session_data(user, session):
    active_roles = list(
        user.role_grants.filter(revoked_at__isnull=True)
        .order_by("role")
        .values_list("role", flat=True)
    )
    pending_roles = list(
        RoleRequest.objects.filter(user=user, status=RoleRequest.Status.PENDING)
        .order_by("role")
        .values_list("role", flat=True)
    )
    return dict(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        roles=sorted(set(active_roles)),
        email_verified=is_user_email_verified(user),
        pending_roles=sorted(set(pending_roles)),
        idle_expires_at=session.idle_expires_at,
        absolute_expires_at=session.absolute_expires_at,
    )


def delete_session_cookie(response):
    response.delete_cookie(
        settings.SESSION_COOKIE_NAME,
        path=settings.SESSION_COOKIE_PATH,
        domain=settings.SESSION_COOKIE_DOMAIN,
        samesite=settings.SESSION_COOKIE_SAMESITE,
    )


def validated(serializer, data):
    instance = serializer(data=data)
    instance.is_valid(raise_exception=True)
    return instance.validated_data


def throttle(request, scope, identity=""):
    # Ignore spoofable forwarding headers. Trusted ingress may configure REMOTE_ADDR.
    rate_limit(scope=f"{scope}.ip", identity=request.META.get("REMOTE_ADDR", ""), maximum=30)
    if identity:
        rate_limit(scope=f"{scope}.account", identity=identity.strip().lower(), maximum=10)


class PublicAuthView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            UserSessionAuthentication().enforce_csrf(request)

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response


class AuthenticatedAuthView(APIView):
    permission_classes = [IsAuthenticated]
    authentication_classes = [UserSessionAuthentication]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response["Cache-Control"] = "no-store"
        return response


class CsrfView(PublicAuthView):
    @extend_schema(responses={204: None}, tags=["auth"])
    def get(self, request):
        get_token(request)
        return Response(status=204)


class LoginView(PublicAuthView):
    @extend_schema(request=Credentials, responses=SessionInfo, tags=["auth"])
    def post(self, request):
        throttle(request, "login", str(request.data.get("email", "")))
        data = validated(Credentials, request.data)
        user, (key, session) = login_password(**data)

        # Revoke a previous valid cookie without trusting it as the new principal.
        old = request.COOKIES.get(settings.SESSION_COOKIE_NAME)
        if old and old != key:
            from identity.models import UserSession
            from identity.services.common import digest

            previous = UserSession.objects.filter(key_digest=digest(old), user=user).first()
            if previous:
                revoke_session(actor_id=user.id, session_id=previous.id)

        # Rotate CSRF token on login to prevent session/CSRF fixation
        rotate_token(request)
        new_csrf = get_token(request)

        response = Response(session_data(user, session))
        response.set_cookie(
            settings.SESSION_COOKIE_NAME,
            key,
            max_age=12 * 3600,
            secure=settings.SESSION_COOKIE_SECURE,
            httponly=True,
            samesite=settings.SESSION_COOKIE_SAMESITE,
            path=settings.SESSION_COOKIE_PATH,
            domain=settings.SESSION_COOKIE_DOMAIN,
        )
        response.set_cookie(
            settings.CSRF_COOKIE_NAME,
            new_csrf,
            max_age=settings.CSRF_COOKIE_AGE,
            secure=settings.CSRF_COOKIE_SECURE,
            httponly=settings.CSRF_COOKIE_HTTPONLY,
            samesite=settings.CSRF_COOKIE_SAMESITE,
            path=settings.CSRF_COOKIE_PATH,
            domain=settings.CSRF_COOKIE_DOMAIN,
        )
        return response


class MeView(AuthenticatedAuthView):
    @extend_schema(responses=SessionInfo, tags=["auth"])
    def get(self, request):
        return Response(session_data(request.user, request.auth))


class LogoutView(AuthenticatedAuthView):
    @extend_schema(request=None, responses={204: None}, tags=["auth"])
    def post(self, request):
        revoke_session(actor_id=request.user.id, session_id=request.auth.id)
        response = Response(status=204)
        delete_session_cookie(response)
        return response


class LogoutAllView(LogoutView):
    @extend_schema(request=None, responses={204: None}, tags=["auth"])
    def post(self, request):
        revoke_all_sessions(actor_id=request.user.id, user_id=request.user.id)
        response = Response(status=204)
        delete_session_cookie(response)
        return response


class ChangePasswordView(LogoutView):
    @extend_schema(request=PasswordChange, responses={204: None}, tags=["auth"])
    def post(self, request):
        throttle(request, "password.change", str(request.user.id))
        data = validated(PasswordChange, request.data)
        try:
            change_password(user_id=request.user.id, **data)
        except DjangoValidationError as error:
            raise serializers.ValidationError({"new_password": error.messages}) from None
        response = Response(status=204)
        delete_session_cookie(response)
        return response


class ResetRequestView(PublicAuthView):
    @extend_schema(request=ResetRequest, responses={202: None}, tags=["auth"])
    def post(self, request):
        throttle(request, "password.request", str(request.data.get("email", "")))
        data = validated(ResetRequest, request.data)
        request_password_reset(**data)
        return Response(status=202)


class ResetConfirmView(PublicAuthView):
    @extend_schema(request=ResetConfirm, responses={204: None}, tags=["auth"])
    def post(self, request):
        throttle(request, "password.reset")
        data = validated(ResetConfirm, request.data)
        try:
            reset_password(**data)
        except DjangoValidationError as error:
            raise serializers.ValidationError({"new_password": error.messages}) from None
        return Response(status=204)


class RegisterView(PublicAuthView):
    @extend_schema(request=RegisterRequest, responses={201: RegisterResponse}, tags=["auth"])
    def post(self, request):
        throttle(request, "register", str(request.data.get("email", "")))

        forbidden_fields = {
            "is_staff",
            "is_superuser",
            "role_grant",
            "role_grants",
            "roles",
            "admin",
            "user_id",
            "id",
        }
        if any(field in request.data for field in forbidden_fields):
            raise DomainError("FORBIDDEN_REGISTRATION_FIELDS")

        data = validated(RegisterRequest, request.data)
        try:
            user = register_account(
                email=data["email"],
                password=data["password"],
                display_name=data.get("display_name", ""),
                requested_role=data["requested_role"],
            )
        except DjangoValidationError as error:
            raise serializers.ValidationError({"password": error.messages}) from None

        return Response(
            {
                "id": user.id,
                "email": user.email,
                "display_name": user.display_name,
                "requested_role": data["requested_role"],
                "email_verified": False,
            },
            status=201,
        )


class VerifyEmailView(PublicAuthView):
    @extend_schema(request=VerifyEmailRequest, responses={200: VerifyEmailResponse}, tags=["auth"])
    def post(self, request):
        throttle(request, "verify_email")
        data = validated(VerifyEmailRequest, request.data)
        result = verify_email(token=data["token"])
        return Response(
            {
                "email": result["email"],
                "verified": result["verified"],
                "granted_roles": result["granted_roles"],
            },
            status=200,
        )


class ResendVerificationView(PublicAuthView):
    @extend_schema(request=ResendVerificationRequest, responses={202: None}, tags=["auth"])
    def post(self, request):
        throttle(request, "resend_verification", str(request.data.get("email", "")))
        data = validated(ResendVerificationRequest, request.data)
        resend_email_verification(email=data["email"])
        return Response(status=202)


class RoleRequestView(AuthenticatedAuthView):
    @extend_schema(responses={200: RoleRequestItem(many=True)}, tags=["auth"])
    def get(self, request):
        requests = RoleRequest.objects.filter(user=request.user).order_by("-requested_at")
        serializer = RoleRequestItem(requests, many=True)
        return Response(serializer.data, status=200)

    @extend_schema(request=CreateRoleRequest, responses={201: RoleRequestItem}, tags=["auth"])
    def post(self, request):
        throttle(request, "role_request", str(request.user.id))
        data = validated(CreateRoleRequest, request.data)
        role = data["role"]

        role_req = submit_role_request(user_id=request.user.id, role=role)

        return Response(RoleRequestItem(role_req).data, status=201)


class RoleRequestCancelView(AuthenticatedAuthView):
    @extend_schema(request=None, responses={200: RoleRequestItem}, tags=["auth"])
    def post(self, request, id):
        from django.http import Http404

        throttle(request, "role_request.cancel", str(request.user.id))
        role_req = RoleRequest.objects.filter(id=id).first()
        if not role_req:
            raise Http404("Không tìm thấy yêu cầu vai trò.")

        if role_req.user_id != request.user.id:
            raise DomainError("FORBIDDEN")

        cancelled_req = close_request(actor_id=request.user.id, request_id=id, decision="cancelled")
        return Response(RoleRequestItem(cancelled_req).data, status=200)


class GrantsView(AuthenticatedAuthView):
    @extend_schema(responses={200: RoleGrantItem(many=True)}, tags=["auth"])
    def get(self, request):
        grants = RoleGrant.objects.filter(user=request.user, revoked_at__isnull=True).order_by(
            "granted_at"
        )
        serializer = RoleGrantItem(grants, many=True)
        return Response(serializer.data, status=200)


class VerificationStatusView(AuthenticatedAuthView):
    @extend_schema(responses={200: VerificationStatusResponse}, tags=["auth"])
    def get(self, request):
        ve = getattr(request.user, "verifiedemail", None)
        verified_at = ve.verified_at if (ve and is_user_email_verified(request.user)) else None
        return Response(
            {
                "email": request.user.email,
                "verified": is_user_email_verified(request.user),
                "verified_at": verified_at,
            },
            status=200,
        )
