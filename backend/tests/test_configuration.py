import os
import subprocess
import sys
from pathlib import Path

import pytest

DEFAULT_CA_BUNDLE = str(Path(__file__).resolve().parent / "fixtures" / "test-ca.crt")


def production_check(**overrides):
    env = {
        **os.environ,
        "DJANGO_SETTINGS_MODULE": "config.settings.production",
        "DJANGO_SECRET_KEY": "test-only-production-check-1234567890-abcdefghijk-ABCDEFGHIJK",
        "DJANGO_ALLOWED_HOSTS": "lms.example.test",
        "PGSSLROOTCERT": DEFAULT_CA_BUNDLE,
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
        ({"PGSSLROOTCERT": "/non-existent/ca.crt"}, "Database CA root certificate not found"),
        (
            {"PUBLIC_APP_ORIGIN": "http://insecure.example.com"},
            "Production requires HTTPS for PUBLIC_APP_ORIGIN",
        ),
        (
            {"PUBLIC_APP_ORIGIN": "ftp://invalid-scheme.example.com"},
            "PUBLIC_APP_ORIGIN scheme must be http or https",
        ),
        (
            {"PUBLIC_APP_ORIGIN": "https://lms.example.test/some/path"},
            "PUBLIC_APP_ORIGIN must not contain path",
        ),
    ],
)
def test_production_rejects_incomplete_or_unsafe_configuration(overrides, expected):
    result = production_check(**overrides)
    assert result.returncode != 0
    assert expected in result.stderr


def test_production_rejects_malformed_certificate(tmp_path):
    cert = tmp_path / "invalid.crt"
    cert.write_text("not a certificate")
    result = production_check(PGSSLROOTCERT=str(cert))
    assert result.returncode != 0
    assert "unreadable or invalid" in result.stderr
