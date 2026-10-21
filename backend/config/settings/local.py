import os

from .base import *  # noqa: F403

# Explicit local module; production does not import these settings.
DEBUG = True
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = os.environ.get("EMAIL_HOST", "127.0.0.1")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "11025"))
