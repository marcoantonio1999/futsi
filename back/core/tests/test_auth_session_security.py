from base64 import b64encode
from datetime import timedelta

import pytest
from django.conf import settings
from django.utils import timezone
from rest_framework.authtoken.models import Token

from core.tests.factories import make_user


pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_login_rotates_existing_token_and_rejects_previous_token(api_client):
    user = make_user(role="admin")

    first = api_client.post("/api/auth/login/", {"username": user.username, "password": "test12345"}, format="json")
    second = api_client.post("/api/auth/login/", {"username": user.username, "password": "test12345"}, format="json")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["token"] != second.json()["token"]
    assert "expires_at" in second.json()
    assert Token.objects.filter(user=user).count() == 1

    api_client.credentials(HTTP_AUTHORIZATION=f"Token {first.json()['token']}")
    assert api_client.get("/api/auth/me/").status_code == 401

    api_client.credentials(HTTP_AUTHORIZATION=f"Token {second.json()['token']}")
    assert api_client.get("/api/auth/me/").status_code == 200


def test_expired_token_is_rejected_and_deleted(api_client):
    user = make_user(role="admin")
    token = Token.objects.create(user=user)
    token.created = timezone.now() - timedelta(minutes=settings.API_TOKEN_TTL_MINUTES + 1)
    token.save(update_fields=["created"])

    api_client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    response = api_client.get("/api/auth/me/")

    assert response.status_code == 401
    assert "expir" in response.json()["detail"].lower()
    assert not Token.objects.filter(key=token.key).exists()


def test_logout_invalidates_only_current_token(api_client):
    user = make_user(role="admin")
    response = api_client.post("/api/auth/login/", {"username": user.username, "password": "test12345"}, format="json")
    token = response.json()["token"]

    api_client.credentials(HTTP_AUTHORIZATION=f"Token {token}")
    assert api_client.post("/api/auth/logout/").status_code == 204
    assert api_client.get("/api/auth/me/").status_code == 401


def test_inactive_user_token_is_rejected(api_client):
    user = make_user(role="admin", is_active=False)
    token = Token.objects.create(user=user)

    api_client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    response = api_client.get("/api/auth/me/")

    assert response.status_code == 401


def test_basic_auth_is_not_accepted_for_api(api_client):
    user = make_user(role="admin")
    credentials = b64encode(f"{user.username}:test12345".encode()).decode()

    api_client.credentials(HTTP_AUTHORIZATION=f"Basic {credentials}")
    response = api_client.get("/api/auth/me/")

    assert response.status_code == 401
