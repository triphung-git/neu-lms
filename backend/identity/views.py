from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.middleware.csrf import get_token, rotate_token
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from identity.authentication import UserSessionAuthentication
from identity.services.passwords import (
    change_password,
    login_password,
    rate_limit,
    request_password_reset,
    reset_password,
)
from identity.services.sessions import revoke_all_sessions, revoke_session


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
    idle_expires_at = serializers.DateTimeField()
    absolute_expires_at = serializers.DateTimeField()


def session_data(user, session):
    active_roles = list(
        user.role_grants.filter(revoked_at__isnull=True)
        .order_by("role")
        .values_list("role", flat=True)
    )
    return dict(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        roles=sorted(set(active_roles)),
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
