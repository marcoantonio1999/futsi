import os

os.environ.setdefault("DB_ENGINE", "sqlite")
os.environ.setdefault("ALLOW_SQLITE", "true")
os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ.setdefault("FUTSI_ENV", "test")
os.environ.setdefault("DJANGO_TEST_FAST_PASSWORD_HASHERS", "true")

import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def auth_client(db):
    def _login(user=None, role="admin", password="test12345", **overrides):
        from core.tests.factories import make_user

        if user is None:
            user = make_user(role=role, password=password, **overrides)
        else:
            user.set_password(password)
            user.save(update_fields=["password"])

        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"username": user.username, "password": password},
            format="json",
        )
        assert response.status_code == 200, response.content
        client.credentials(HTTP_AUTHORIZATION=f"Token {response.json()['token']}")
        return client, response.json()["user"], user

    return _login
