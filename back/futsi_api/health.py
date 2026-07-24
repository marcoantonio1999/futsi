import os

from django.db import connection
from django.http import JsonResponse


RELEASE_MARKER = "faceguard-collaborator-20260724-v4"


def index(request):
    return JsonResponse(
        {
            "name": "Futsi API",
            "status": "ok",
            "health": "/health/",
            "api": "/api/",
        }
    )


def health(request):
    return JsonResponse(
        {
            "status": "ok",
            "release": RELEASE_MARKER,
            "commit": os.getenv("RENDER_GIT_COMMIT", ""),
        }
    )


def db_health(request):
    with connection.cursor() as cursor:
        cursor.execute("select 1")
        cursor.fetchone()
    return JsonResponse(
        {
            "status": "ok",
            "database": "ok",
            "release": RELEASE_MARKER,
            "commit": os.getenv("RENDER_GIT_COMMIT", ""),
        }
    )
