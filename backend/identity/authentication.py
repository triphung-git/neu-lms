from django.conf import settings
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from rest_framework.authentication import BaseAuthentication, CSRFCheck
from rest_framework.exceptions import AuthenticationFailed

from identity.services.sessions import touch_session
from platform_core.errors import DomainError
from platform_core.exceptions import CsrfFailed


class UserSessionAuthentication(BaseAuthentication):
    """
    Session authentication enforcing UserSession metadata on every authenticated request.
    Verifies user active status, idle (<= 30m) & absolute (<= 12h) expiration,
    revocation, auth_version staleness, and CSRF protection on unsafe methods.
    """

    def authenticate(self, request):
        cookie_name = getattr(settings, "SESSION_COOKIE_NAME", "sessionid")
        session_key = request.COOKIES.get(cookie_name)
        if not session_key:
            return None

        try:
            metadata = touch_session(session_key=session_key)
        except DomainError as err:
            if err.code == "SESSION_EXPIRED":
                raise AuthenticationFailed(
                    "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.",
                    code="session_expired",
                ) from err
            elif err.code == "SESSION_REVOKED":
                raise AuthenticationFailed(
                    "Phiên làm việc đã bị thu hồi hoặc không còn hiệu lực.",
                    code="session_revoked",
                ) from err
            elif err.code == "ACCOUNT_INACTIVE":
                raise AuthenticationFailed(
                    "Tài khoản đã bị vô hiệu hóa.",
                    code="account_inactive",
                ) from err
            else:
                raise AuthenticationFailed(
                    "Phiên làm việc không hợp lệ.",
                    code="session_invalid",
                ) from err

        user = metadata.user
        if not user.is_active:
            raise AuthenticationFailed(
                "Tài khoản đã bị vô hiệu hóa.",
                code="account_inactive",
            )

        if request.method not in ("GET", "HEAD", "OPTIONS", "TRACE"):
            self.enforce_csrf(request)

        return (user, metadata)

    def enforce_csrf(self, request):
        def dummy_get_response(r):
            return None

        check = CSRFCheck(dummy_get_response)
        check.process_request(request)
        reason = check.process_view(request, None, (), {})
        if reason:
            raise CsrfFailed(f"CSRF Failed: {reason}")


class UserSessionAuthenticationScheme(OpenApiAuthenticationExtension):
    target_class = "identity.authentication.UserSessionAuthentication"
    name = "SessionCookieAuth"

    def get_security_requirement(self, auto_schema):
        return [{"SessionCookieAuth": [], "CSRFToken": []}]

    def get_security_definition(self, auto_schema):
        cookie_name = getattr(settings, "SESSION_COOKIE_NAME", "sessionid")
        return {
            "type": "apiKey",
            "in": "cookie",
            "name": cookie_name,
            "description": "Stateful session cookie managed by the server.",
        }
