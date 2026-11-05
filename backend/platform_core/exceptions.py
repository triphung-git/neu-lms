import logging
import uuid
from typing import Any

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.response import Response

from platform_core.errors import DomainError
from platform_core.middleware import get_correlation_id

logger = logging.getLogger(__name__)


class CsrfFailed(exceptions.PermissionDenied):
    def __init__(
        self, detail: str = "Xác thực CSRF thất bại. Vui lòng thử lại.", code: str = "csrf_failed"
    ):
        super().__init__(detail=detail, code=code)


class ConflictError(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "Xung đột dữ liệu hoặc trùng lặp yêu cầu."
    default_code = "conflict"


def format_error_envelope(
    code: str,
    message: str,
    details: Any = None,
    request_id: str | None = None,
) -> dict[str, Any]:
    req_id = request_id or get_correlation_id() or str(uuid.uuid4())
    payload = {
        "code": code,
        "message": message,
        "request_id": req_id,
        "correlation_id": req_id,
    }
    if details is not None:
        payload["details"] = details
    return {"error": payload}


def _flatten_validation_errors(data: Any, parent_key: str = "") -> list[dict[str, str]]:
    flattened = []
    if isinstance(data, dict):
        for field, errors in data.items():
            key = f"{parent_key}.{field}" if parent_key else str(field)
            flattened.extend(_flatten_validation_errors(errors, key))
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, (dict, list)):
                flattened.extend(_flatten_validation_errors(item, parent_key))
            else:
                code = getattr(item, "code", "invalid")
                flattened.append(
                    {
                        "field": parent_key or "non_field_errors",
                        "message": str(item),
                        "code": str(code),
                    }
                )
    else:
        code = getattr(data, "code", "invalid")
        flattened.append(
            {
                "field": parent_key or "non_field_errors",
                "message": str(data),
                "code": str(code),
            }
        )
    return flattened


def custom_exception_handler(exc: Exception, context: dict[str, Any]) -> Response:
    request = context.get("request")
    request_id = (
        getattr(request, "correlation_id", None) or get_correlation_id() or str(uuid.uuid4())
    )

    headers = {}

    # 1. Django Http404 & PermissionDenied translation
    if isinstance(exc, Http404):
        exc = exceptions.NotFound(*(exc.args))
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied(*(exc.args))

    # 2. DomainError translation
    if isinstance(exc, DomainError):
        code = exc.code
        if code == "IDEMPOTENCY_CONFLICT":
            return Response(
                format_error_envelope(
                    code="idempotency_conflict",
                    message="Yêu cầu trùng lặp hoặc xung đột idempotency.",
                    request_id=request_id,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        elif code == "DEDUPE_CONFLICT":
            return Response(
                format_error_envelope(
                    code="conflict",
                    message="Xung đột dữ liệu hoặc bản ghi trùng lặp.",
                    request_id=request_id,
                ),
                status=status.HTTP_409_CONFLICT,
            )
        elif code == "FORBIDDEN":
            return Response(
                format_error_envelope(
                    code="permission_denied",
                    message="Bạn không có quyền thực hiện thao tác này.",
                    request_id=request_id,
                ),
                status=status.HTTP_403_FORBIDDEN,
            )
        elif code == "LAST_ACTIVE_ADMIN":
            return Response(
                format_error_envelope(
                    code="last_active_admin",
                    message=(
                        "Không thể thu hồi hoặc khóa tài khoản quản trị viên hoạt động cuối cùng."
                    ),
                    request_id=request_id,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )
        elif code == "SESSION_EXPIRED":
            return Response(
                format_error_envelope(
                    code="session_expired",
                    message="Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.",
                    request_id=request_id,
                ),
                status=status.HTTP_401_UNAUTHORIZED,
            )
        elif code in ("SESSION_REVOKED", "SESSION_INVALID"):
            return Response(
                format_error_envelope(
                    code="session_revoked" if code == "SESSION_REVOKED" else "session_invalid",
                    message="Phiên làm việc đã bị thu hồi hoặc không còn hiệu lực.",
                    request_id=request_id,
                ),
                status=status.HTTP_401_UNAUTHORIZED,
            )
        elif code == "ACCOUNT_INACTIVE":
            return Response(
                format_error_envelope(
                    code="account_inactive",
                    message="Tài khoản đã bị vô hiệu hóa.",
                    request_id=request_id,
                ),
                status=status.HTTP_401_UNAUTHORIZED,
            )
        else:
            domain_messages = {
                "EMAIL_ALREADY_REGISTERED": "Email này đã được đăng ký trong hệ thống.",
                "INVALID_STUDENT_EMAIL_DOMAIN": (
                    "Email sinh viên phải đúng định dạng số hiệu sinh viên NEU (@st.neu.edu.vn)."
                ),
                "ROLE_NOT_REQUESTABLE": (
                    "Vai trò yêu cầu không hợp lệ. Chỉ chấp nhận sinh viên hoặc giảng viên."
                ),
                "ROLE_ALREADY_GRANTED": "Người dùng đã được cấp vai trò này.",
                "ONE_PENDING_ROLE_REQUEST": (
                    "Người dùng đã có một yêu cầu đang chờ xử lý cho vai trò này."
                ),
                "TOKEN_INVALID_OR_EXPIRED": "Mã xác thực không hợp lệ hoặc đã hết hạn.",
                "EMAIL_NOT_VERIFIED": "Email chưa được xác thực.",
                "EMAIL_MISMATCH": "Email xác thực không khớp với tài khoản.",
                "CANNOT_CANCEL_REQUEST": "Không thể hủy yêu cầu vai trò này.",
                "FORBIDDEN_REGISTRATION_FIELDS": (
                    "Không được phép cung cấp trường đặc quyền khi đăng ký."
                ),
                "INVALID_DISPLAY_NAME": "Tên hiển thị không hợp lệ.",
                "INVALID_ROLE_TRANSITION": (
                    "Trạng thái yêu cầu vai trò không cho phép thao tác này."
                ),
                "STUDENT_EMAIL_REQUIRED": "Yêu cầu email sinh viên NEU hợp lệ.",
                "REAUTH_REQUIRED": "Thao tác nhạy cảm yêu cầu xác thực lại mật khẩu hiện tại.",
                "INVALID_CREDENTIALS": "Mật khẩu xác thực lại không chính xác.",
                "ACCOUNT_NOT_FOUND": "Không tìm thấy tài khoản người dùng.",
                "ROLE_GRANT_NOT_FOUND": "Không tìm thấy bản ghi cấp vai trò.",
                "ROLE_POLICY_VIOLATION": (
                    "Vai trò yêu cầu không thể cấp trực tiếp ngoài quy trình quy định."
                ),
                "TEACHER_APPROVAL_WORKFLOW_REQUIRED": (
                    "Vai trò giảng viên phải thông qua quy trình xét duyệt yêu cầu giảng viên."
                ),
                "STUDENT_VERIFICATION_WORKFLOW_REQUIRED": (
                    "Vai trò sinh viên phải thông qua quy trình xác thực email sinh viên NEU."
                ),
            }
            msg = domain_messages.get(code, f"Thao tác không hợp lệ: {code}.")
            return Response(
                format_error_envelope(
                    code=code.lower(),
                    message=msg,
                    request_id=request_id,
                ),
                status=status.HTTP_400_BAD_REQUEST,
            )

    # 3. DRF APIExceptions
    if isinstance(exc, exceptions.APIException):
        status_code = exc.status_code
        err_code = "error"
        message = (
            str(exc.detail) if isinstance(exc.detail, str) else "Đã xảy ra lỗi khi xử lý yêu cầu."
        )
        details = None

        if isinstance(exc, exceptions.NotAuthenticated):
            status_code = status.HTTP_401_UNAUTHORIZED
            err_code = "authentication_required"
            message = "Yêu cầu xác thực để thực hiện thao tác này."
        elif isinstance(exc, exceptions.AuthenticationFailed):
            status_code = status.HTTP_401_UNAUTHORIZED
            code_attr = getattr(exc, "code", None)
            codes = exc.get_codes() if hasattr(exc, "get_codes") else None
            detail_val = exc.detail

            if (
                code_attr == "session_expired"
                or codes == "session_expired"
                or (isinstance(detail_val, dict) and detail_val.get("code") == "session_expired")
            ):
                err_code = "session_expired"
                message = "Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại."
            elif (
                code_attr == "session_revoked"
                or codes == "session_revoked"
                or (isinstance(detail_val, dict) and detail_val.get("code") == "session_revoked")
            ):
                err_code = "session_revoked"
                message = "Phiên làm việc đã bị thu hồi hoặc không còn hiệu lực."
            elif (
                code_attr == "account_inactive"
                or codes == "account_inactive"
                or (isinstance(detail_val, dict) and detail_val.get("code") == "account_inactive")
            ):
                err_code = "account_inactive"
                message = "Tài khoản đã bị vô hiệu hóa."
            elif (
                code_attr == "session_invalid"
                or codes == "session_invalid"
                or (isinstance(detail_val, dict) and detail_val.get("code") == "session_invalid")
            ):
                err_code = "session_invalid"
                message = "Phiên làm việc không hợp lệ."
            else:
                err_code = "authentication_required"
                message = (
                    str(detail_val)
                    if isinstance(detail_val, str)
                    else "Thông tin xác thực không hợp lệ."
                )
        elif isinstance(exc, exceptions.PermissionDenied):
            status_code = status.HTTP_403_FORBIDDEN
            detail_str = str(exc.detail)
            code_attr = getattr(exc, "code", None)
            codes = exc.get_codes() if hasattr(exc, "get_codes") else None
            if (
                isinstance(exc, CsrfFailed)
                or code_attr == "csrf_failed"
                or codes == "csrf_failed"
                or "CSRF" in detail_str
                or "csrf" in detail_str.lower()
            ):
                err_code = "csrf_failed"
                message = "Xác thực CSRF thất bại. Vui lòng thử lại."
            else:
                err_code = "permission_denied"
                message = "Bạn không có quyền thực hiện thao tác này."
        elif isinstance(exc, exceptions.ValidationError):
            status_code = status.HTTP_400_BAD_REQUEST
            err_code = "validation_error"
            message = "Dữ liệu yêu cầu không hợp lệ."
            details = _flatten_validation_errors(exc.detail)
        elif isinstance(exc, (exceptions.ParseError, exceptions.UnsupportedMediaType)):
            status_code = status.HTTP_400_BAD_REQUEST
            err_code = "malformed_request"
            message = "Dữ liệu gửi lên không đúng định dạng JSON hoặc không được hỗ trợ."
        elif isinstance(exc, exceptions.NotFound):
            status_code = status.HTTP_404_NOT_FOUND
            err_code = "not_found"
            message = "Không tìm thấy tài nguyên yêu cầu."
        elif isinstance(exc, exceptions.MethodNotAllowed):
            status_code = status.HTTP_405_METHOD_NOT_ALLOWED
            err_code = "method_not_allowed"
            method = request.method if request else "HTTP"
            message = f"Phương thức {method} không được hỗ trợ cho endpoint này."
        elif isinstance(exc, exceptions.Throttled):
            status_code = status.HTTP_429_TOO_MANY_REQUESTS
            err_code = "throttled"
            wait = exc.wait
            if wait:
                headers["Retry-After"] = str(int(wait))
                message = f"Quá nhiều yêu cầu. Vui lòng thử lại sau {int(wait)} giây."
            else:
                message = "Quá nhiều yêu cầu. Vui lòng thử lại sau."
        elif isinstance(exc, ConflictError):
            status_code = status.HTTP_409_CONFLICT
            err_code = "conflict"
            message = str(exc.detail)
        else:
            err_code = getattr(exc, "default_code", "error")
            message = str(exc.detail) if isinstance(exc.detail, str) else "Yêu cầu không hợp lệ."

        return Response(
            format_error_envelope(
                code=err_code,
                message=message,
                details=details,
                request_id=request_id,
            ),
            status=status_code,
            headers=headers,
        )

    # 4. Uncaught Server Errors (500)
    logger.exception(
        "Unhandled server error: %s (request_id=%s)",
        exc,
        request_id,
        exc_info=True,
    )
    return Response(
        format_error_envelope(
            code="internal_server_error",
            message="Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.",
            request_id=request_id,
        ),
        status=status.HTTP_500_INTERNAL_SERVER_ERROR,
    )
