"""Cấu hình dành riêng cho chạy local bằng SQLite."""

import os


local_defaults = {
    "DJANGO_SECRET_KEY": "local-only-do-not-deploy",
    "PGDATABASE": "unused",
    "PGUSER": "unused",
    "PGPASSWORD": "unused",
    "PGHOST": "localhost",
}

for key, value in local_defaults.items():
    os.environ.setdefault(key, value)


from .base import *  # noqa: E402,F403


DEBUG = True

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",  # noqa: F405
    }
}

ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
    "testserver",
]

EMAIL_BACKEND = (
    "django.core.mail.backends.console.EmailBackend"
)