from django.db import connection
from django.http import JsonResponse


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
    with connection.cursor() as cursor:
        cursor.execute("select 1")
        cursor.fetchone()
    return JsonResponse({"status": "ok"})
