"""Verify release dependencies and authenticated production endpoints without printing secrets."""
import argparse
import json
import os
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--env-file", required=True)
parser.add_argument("--prepare-storage", action="store_true")
parser.add_argument("--api", default="https://futsi.onrender.com/api")
args = parser.parse_args()
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "back"))
from dotenv import load_dotenv
load_dotenv(args.env_file, override=False)
os.environ["DJANGO_SETTINGS_MODULE"] = "futsi_api.settings"
import django
django.setup()
from django.conf import settings
from django.db import connection
from core.services import enrollment_storage as storage

if args.prepare_storage:
    from urllib.error import HTTPError
    try:
        storage.ensure_private_bucket()
        print("private_storage_ready")
    except HTTPError as exc:
        data = json.loads(exc.read())
        print(json.dumps({"storage_status": exc.code, "message": data.get("message"), "error": data.get("error")}))
        raise SystemExit(1)
    raise SystemExit(0)

with connection.cursor() as cursor:
    cursor.execute("SELECT name FROM django_migrations WHERE app='core' ORDER BY applied DESC LIMIT 2")
    print(json.dumps({"migrations": [r[0] for r in cursor.fetchall()], "whatsapp_url": settings.WHATSAPP_SERVICE_URL}))
from rest_framework.authtoken.models import Token
token = Token.objects.filter(user__role="admin", user__is_active=True).first()
if not token:
    raise SystemExit("No existing administrator session available for authenticated verification.")
import requests
headers = {"Authorization": "Token " + token.key}
for path in ("/player-enrollments/catalog/", "/player-enrollments/", "/whatsapp-conversations/contact-audit/?scope=all"):
    response = requests.get(args.api + path, headers=headers, timeout=60)
    print(json.dumps({"endpoint": path, "status": response.status_code}))
    response.raise_for_status()
    data = response.json()
    if "contact-audit" in path:
        assert data["total"] == sum(data["categories"].values())
        print(json.dumps({"contact_total": data["total"], "categories": data["categories"]}))
print("production_read_checks_passed")
