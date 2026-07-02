import os

os.environ.setdefault("DB_ENGINE", "sqlite")
os.environ.setdefault("ALLOW_SQLITE", "true")
os.environ.setdefault("DJANGO_DEBUG", "true")
os.environ.setdefault("FUTSI_ENV", "test")
os.environ.setdefault("ALLOW_DESTRUCTIVE_SEED", "true")
os.environ.setdefault("DJANGO_TEST_FAST_PASSWORD_HASHERS", "true")

import pytest
from django.core.management import call_command
from rest_framework.test import APIClient


@pytest.fixture(scope="session")
def seeded_db(django_db_setup, django_db_blocker):
    with django_db_blocker.unblock():
        call_command("seed_demo", "--reset", verbosity=0)


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def login_client(seeded_db):
    def _login(username, password):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"username": username, "password": password},
            format="json",
        )
        assert response.status_code == 200, response.content
        client.credentials(HTTP_AUTHORIZATION=f"Token {response.json()['token']}")
        return client, response.json()["user"]

    return _login


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


@pytest.fixture
def admin_client(login_client):
    client, _user = login_client("admin", "admin12345")
    return client
