import os
from pathlib import Path

from config.environment import csv_values, required

BASE_DIR = Path(__file__).resolve().parent.parent.parent
SECRET_KEY = required("DJANGO_SECRET_KEY")
DEBUG = False
ALLOWED_HOSTS = csv_values("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1")
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

AUTH_USER_MODEL = "identity.User"
INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "django.contrib.sessions",
    "rest_framework",
    "drf_spectacular",
    "health",
    "identity",
    "platform_core",
]
# HTTP authentication/session middleware is introduced with the B03 login flow.
AUTHENTICATION_BACKENDS = []
SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_AGE = 30 * 60
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
MIDDLEWARE = [
    "platform_core.middleware.CorrelationIdMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
CSRF_FAILURE_VIEW = "platform_core.views.csrf_failure_view"
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "identity.authentication.UserSessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "platform_core.exceptions.custom_exception_handler",
    "DEFAULT_PAGINATION_CLASS": "platform_core.pagination.StandardPageNumberPagination",
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
}
SPECTACULAR_SETTINGS = {
    "TITLE": "NEU LMS API",
    "DESCRIPTION": "Hợp đồng API chuẩn của nền tảng NEU LMS",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    "SCHEMA_PATH_PREFIX": r"/api/v1",
    "SCHEMA_PATH_PREFIX_TRIM": False,
    "COMPONENT_SPLIT_REQUEST": True,
    "APPEND_COMPONENTS": {
        "securitySchemes": {
            "SessionCookieAuth": {
                "type": "apiKey",
                "in": "cookie",
                "name": "sessionid",
                "description": "Session cookie được quản lý bởi máy chủ trong UserSession store.",
            },
            "CSRFToken": {
                "type": "apiKey",
                "in": "header",
                "name": "X-CSRFToken",
                "description": (
                    "Token CSRF bắt buộc cho các thao tác thay đổi dữ liệu "
                    "(POST, PUT, PATCH, DELETE)."
                ),
            },
        },
        "schemas": {
            "ErrorEnvelope": {
                "type": "object",
                "required": ["error"],
                "properties": {
                    "error": {
                        "type": "object",
                        "required": ["code", "message", "request_id", "correlation_id"],
                        "properties": {
                            "code": {
                                "type": "string",
                                "description": "Mã lỗi định danh máy (machine-readable)",
                                "example": "validation_error",
                            },
                            "message": {
                                "type": "string",
                                "description": "Thông báo lỗi an toàn bằng tiếng Việt",
                                "example": "Dữ liệu yêu cầu không hợp lệ.",
                            },
                            "details": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "field": {"type": "string"},
                                        "message": {"type": "string"},
                                        "code": {"type": "string"},
                                    },
                                },
                                "nullable": True,
                            },
                            "request_id": {
                                "type": "string",
                                "format": "uuid",
                                "description": "Correlation / Request UUID",
                            },
                            "correlation_id": {
                                "type": "string",
                                "format": "uuid",
                                "description": "Correlation / Request UUID",
                            },
                        },
                    },
                },
            },
        },
    },
}
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": required("PGDATABASE"),
        "USER": required("PGUSER"),
        "PASSWORD": required("PGPASSWORD"),
        "HOST": required("PGHOST"),
        "PORT": os.environ.get("PGPORT", "5432"),
        "CONN_MAX_AGE": 0,
        "OPTIONS": {
            "connect_timeout": 3,
            "options": "-c statement_timeout=2000",
            "sslmode": os.environ.get("PGSSLMODE", "disable"),
        },
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LANGUAGE_CODE = "vi"
TIME_ZONE = "Asia/Ho_Chi_Minh"
USE_I18N = True
USE_TZ = True
APPEND_SLASH = False
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / ".static"
CSRF_TRUSTED_ORIGINS = csv_values("DJANGO_CSRF_TRUSTED_ORIGINS") or csv_values(
    "CSRF_TRUSTED_ORIGINS"
)
SESSION_COOKIE_NAME = "sessionid"
SESSION_COOKIE_PATH = "/"
SESSION_COOKIE_DOMAIN = None
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = os.environ.get("DJANGO_SESSION_COOKIE_SECURE", "false").lower() in (
    "true",
    "1",
    "yes",
)

CSRF_COOKIE_NAME = "csrftoken"
CSRF_COOKIE_PATH = "/"
CSRF_COOKIE_DOMAIN = None
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SECURE = os.environ.get("DJANGO_CSRF_COOKIE_SECURE", "false").lower() in (
    "true",
    "1",
    "yes",
)
CSRF_COOKIE_AGE = 31449600

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
PUBLIC_APP_ORIGIN = os.environ.get("PUBLIC_APP_ORIGIN", "http://localhost:5173")
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "noreply@neu.edu.vn")
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "127.0.0.1")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "11025"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "false").lower() in ("true", "1", "yes")
EMAIL_USE_SSL = os.environ.get("EMAIL_USE_SSL", "false").lower() in ("true", "1", "yes")
EMAIL_TIMEOUT = int(os.environ.get("EMAIL_TIMEOUT", "10"))
