import re
import uuid
from contextvars import ContextVar

_correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)

_UUID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def get_correlation_id() -> str | None:
    return _correlation_id.get()


def set_correlation_id(correlation_id: str | None) -> None:
    _correlation_id.set(correlation_id)


class CorrelationIdMiddleware:
    """
    Extracts or generates a standardized, safe correlation/request ID.
    Rejects malformed/unsafe client headers to prevent header injection or reflection.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        header_val = (
            request.headers.get("X-Request-ID") or request.headers.get("X-Correlation-ID") or ""
        ).strip()

        if header_val and _UUID_REGEX.match(header_val):
            correlation_id = header_val.lower()
        else:
            correlation_id = str(uuid.uuid4())

        request.correlation_id = correlation_id
        request.request_id = correlation_id

        token = _correlation_id.set(correlation_id)
        try:
            response = self.get_response(request)
        finally:
            _correlation_id.reset(token)

        response["X-Request-ID"] = correlation_id
        return response
