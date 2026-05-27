from django.db import connection
from django.http import JsonResponse


def health(request):
    with connection.cursor() as cursor:
        cursor.execute("select 1")
        cursor.fetchone()
    return JsonResponse({"status": "ok"})
