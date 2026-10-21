import os
import subprocess
import sys

import pytest


def production_check(**overrides):
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings.production",
        "DJANGO_SECRET_KEY": "test-only-production-check-1234567890-abcdefghijk-ABCDEFGHIJK",
        "DJANGO_ALLOWED_HOSTS": "lms.example.test",
        "PGSSLROOTCERT": "/test-only/provider-ca.pem",
        **overrides,
    }
    return subprocess.run(
        [sys.executable, "manage.py", "check", "--deploy", "--fail-level", "WARNING"],
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )


def test_production_deployment_checks_pass():
    result = production_check()
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"DJANGO_SECRET_KEY": ""}, "DJANGO_SECRET_KEY"),
        ({"DJANGO_SECRET_KEY": "dev-local-not-for-production"}, "dedicated DJANGO_SECRET_KEY"),
        ({"DJANGO_ALLOWED_HOSTS": "*"}, "explicit DJANGO_ALLOWED_HOSTS"),
        ({"DJANGO_ALLOWED_HOSTS": ""}, "explicit DJANGO_ALLOWED_HOSTS"),
        ({"PGPASSWORD": ""}, "PGPASSWORD"),
        ({"PGSSLROOTCERT": ""}, "PGSSLROOTCERT"),
    ],
)
def test_production_rejects_incomplete_or_unsafe_configuration(overrides, expected):
    result = production_check(**overrides)
    assert result.returncode != 0
    assert expected in result.stderr
