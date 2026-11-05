import os
import ssl
from copy import deepcopy

from django.core.exceptions import ImproperlyConfigured

from config.environment import csv_values, required

from .base import *  # noqa: F403
from .base import DATABASES, SECRET_KEY, validate_origin

if len(SECRET_KEY) < 50 or len(set(SECRET_KEY)) < 5 or SECRET_KEY.startswith("dev-"):
    raise ImproperlyConfigured("Production requires a strong, dedicated DJANGO_SECRET_KEY.")

ALLOWED_HOSTS = csv_values("DJANGO_ALLOWED_HOSTS")
if not ALLOWED_HOSTS or any("*" in host for host in ALLOWED_HOSTS):
    raise ImproperlyConfigured("Production requires explicit DJANGO_ALLOWED_HOSTS.")

DATABASES = deepcopy(DATABASES)

# TLS must be verified against the database provider's CA, not merely encrypted.
sslrootcert_path = required("PGSSLROOTCERT")
if not os.path.exists(sslrootcert_path):
    raise ImproperlyConfigured(
        f"Database CA root certificate not found at '{sslrootcert_path}'. "
        "Mount the certificate authority bundle into the container via volume or secret."
    )
try:
    ssl.create_default_context(cafile=sslrootcert_path)
except (OSError, ssl.SSLError) as error:
    raise ImproperlyConfigured("Database CA root certificate is unreadable or invalid.") from error
DATABASES["default"]["OPTIONS"]["sslmode"] = "verify-full"
DATABASES["default"]["OPTIONS"]["sslrootcert"] = sslrootcert_path

# HTTPS redirect and HSTS policy
SECURE_SSL_REDIRECT = True
# Healthcheck endpoints (liveness & readiness) called by local container probes or internal
# load balancer probes over plain HTTP must not be redirected to HTTPS.
SECURE_REDIRECT_EXEMPT = [r"^api/v1/health/"]

SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = False
# Preload enrollment is a domain-level operational decision, not a code default.
# Keep other security warnings blocking; this one is intentionally deferred to B23.
SILENCED_SYSTEM_CHECKS = ["security.W021"]
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Trusted reverse proxy support (e.g. AWS ALB, Traefik, Cloudflare, Nginx terminating SSL).
# When enabled via DJANGO_BEHIND_TRUSTED_PROXY=true, Django trusts X-Forwarded-Proto.
if os.environ.get("DJANGO_BEHIND_TRUSTED_PROXY", "false").lower() in ("true", "1", "yes"):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    USE_X_FORWARDED_HOST = True

PUBLIC_APP_ORIGIN = validate_origin(os.environ.get("PUBLIC_APP_ORIGIN", "https://lms.neu.edu.vn"))
if not PUBLIC_APP_ORIGIN.startswith("https://"):
    raise ImproperlyConfigured(
        f"Production requires HTTPS for PUBLIC_APP_ORIGIN, got '{PUBLIC_APP_ORIGIN}'."
    )
