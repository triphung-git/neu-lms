from django.core.exceptions import ImproperlyConfigured

from config.environment import csv_values, required

from .base import *  # noqa: F403
from .base import DATABASES, SECRET_KEY

if len(SECRET_KEY) < 50 or len(set(SECRET_KEY)) < 5 or SECRET_KEY.startswith("dev-"):
    raise ImproperlyConfigured("Production requires a strong, dedicated DJANGO_SECRET_KEY.")

ALLOWED_HOSTS = csv_values("DJANGO_ALLOWED_HOSTS")
if not ALLOWED_HOSTS or any("*" in host for host in ALLOWED_HOSTS):
    raise ImproperlyConfigured("Production requires explicit DJANGO_ALLOWED_HOSTS.")

# TLS must be verified against the database provider's CA, not merely encrypted.
DATABASES["default"]["OPTIONS"]["sslmode"] = "verify-full"
DATABASES["default"]["OPTIONS"]["sslrootcert"] = required("PGSSLROOTCERT")
SECURE_SSL_REDIRECT = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = False
# Preload enrollment is a domain-level operational decision, not a code default.
# Keep other security warnings blocking; this one is intentionally deferred to B23.
SILENCED_SYSTEM_CHECKS = ["security.W021"]
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True

# Only set SECURE_PROXY_SSL_HEADER in a deployment configuration whose trusted
# reverse proxy strips client-supplied forwarding headers. It is not trusted here.
