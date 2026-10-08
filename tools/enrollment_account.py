"""Scoped account provisioning; credentials never enter git or application logs."""
import argparse
import json
import os
from pathlib import Path
import secrets
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--env-file", required=True)
parser.add_argument("--create", action="store_true")
args = parser.parse_args()
from dotenv import dotenv_values
values = dotenv_values(args.env_file)
for key in ("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_SSLMODE", "DJANGO_SECRET_KEY"):
    if values.get(key):
        os.environ[key] = values[key]
os.environ["DB_ENGINE"] = "postgres"
os.environ["DJANGO_SETTINGS_MODULE"] = "futsi_api.settings"
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "back"))
import django
django.setup()
from core.models import User
from django.db import connection
existing = User.objects.filter(username="emilio").first()
if not args.create:
    print(json.dumps({"exists": bool(existing), "role": existing.role if existing else None, "has_site": bool(existing and existing.primary_site_id), "enrollment_table_exists": "player_enrollments" in connection.introspection.table_names()}))
elif existing:
    raise SystemExit("Emilio ya existe; no se modificó su contraseña ni sus permisos.")
else:
    if "player_enrollments" not in connection.introspection.table_names():
        raise SystemExit("Primero se debe desplegar la migración de inscripciones.")
    password = secrets.token_urlsafe(18)
    user = User.objects.create_user(username="emilio", password=password, first_name="Emilio", email="", role="collaborator", primary_site=None, section_permissions=["player_enrollments_only"])
    print(json.dumps({"username": user.username, "password": password, "id": user.pk}))
