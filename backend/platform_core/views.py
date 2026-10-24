from django.http import JsonResponse

from platform_core.exceptions import format_error_envelope
from platform_core.middleware import get_correlation_id


def csrf_failure_view(request, reason: str = ""):
    req_id = getattr(request, "correlation_id", None) or get_correlation_id()
    payload = format_error_envelope(
        code="csrf_failed",
        message="Xác thực CSRF thất bại. Vui lòng thử lại.",
        request_id=req_id,
    )
    return JsonResponse(payload, status=403)


def not_found_view(request, exception=None):
    req_id = getattr(request, "correlation_id", None) or get_correlation_id()
    payload = format_error_envelope(
        code="not_found",
        message="Không tìm thấy tài nguyên yêu cầu.",
        request_id=req_id,
    )
    return JsonResponse(payload, status=404)


def server_error_view(request):
    req_id = getattr(request, "correlation_id", None) or get_correlation_id()
    payload = format_error_envelope(
        code="internal_server_error",
        message="Đã xảy ra lỗi hệ thống không mong muốn.",
        request_id=req_id,
    )
    return JsonResponse(payload, status=500)
