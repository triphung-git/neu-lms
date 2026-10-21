from unittest.mock import patch

import pytest
from django.db import OperationalError, connection
from django.urls import reverse
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory
from rest_framework.views import APIView


def test_liveness_without_database_access(client):
    # pytest-django blocks database access in this unmarked test.
    response = client.get(reverse("health-live"))
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response["Cache-Control"] == "no-store"


@pytest.mark.django_db
def test_readiness_checks_real_postgresql(client):
    assert connection.vendor == "postgresql"
    with connection.cursor() as cursor:
        cursor.execute("SHOW server_version_num")
        assert 170000 <= int(cursor.fetchone()[0]) < 180000
    response = client.get(reverse("health-ready"))
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {"database": "ok"}}
    assert response["Cache-Control"] == "no-store"


def test_database_failure_is_503_without_leaking_details(client, caplog):
    private_detail = "postgresql://private-user:private-password@private-host/db"
    with patch("health.views.connection.cursor", side_effect=OperationalError(private_detail)):
        response = client.get(reverse("health-ready"))
        assert client.get(reverse("health-live")).status_code == 200
    assert response.status_code == 503
    assert response.json() == {
        "status": "unavailable",
        "checks": {"database": "unavailable"},
    }
    assert response["Cache-Control"] == "no-store"
    assert private_detail not in response.content.decode()
    assert private_detail not in caplog.text


@pytest.mark.parametrize("name", ["health-live", "health-ready"])
def test_health_disallows_mutations(client, name):
    assert client.post(reverse(name), {}).status_code == 405


def test_unknown_route_is_not_a_fake_success(client):
    assert client.get("/api/v1/not-implemented").status_code == 404


def test_new_api_views_deny_anonymous_by_default():
    class FutureBusinessView(APIView):
        def get(self, request):
            return Response({"private": True})

    response = FutureBusinessView.as_view()(APIRequestFactory().get("/private"))
    assert response.status_code == 403
