"""Verify release dependencies and authenticated production endpoints without printing secrets."""
import argparse
import json
import os
import sys
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("--env-file", required=True)
parser.add_argument("--prepare-storage", action="store_true")
parser.add_argument("--controlled-deletion", action="store_true")
parser.add_argument("--controlled-enrollment", action="store_true")
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
catalog = None
for path in ("/player-enrollments/catalog/", "/player-enrollments/", "/whatsapp-conversations/contact-audit/?scope=all"):
    response = requests.get(args.api + path, headers=headers, timeout=60)
    print(json.dumps({"endpoint": path, "status": response.status_code}))
    response.raise_for_status()
    data = response.json()
    if "catalog" in path:
        catalog = data
    if "contact-audit" in path:
        assert data["total"] == sum(data["categories"].values())
        print(json.dumps({"contact_total": data["total"], "categories": data["categories"]}))
if args.controlled_deletion:
    from uuid import uuid4
    from datetime import date
    from core.models import Student, Player
    before = (Student.objects.count(), Player.objects.count())
    site = next(row["id"] for row in catalog["sites"] if row["name"].casefold() == "colegio franco")
    name = "Prueba técnica de publicación " + uuid4().hex[:8]
    response = requests.post(args.api + "/player-enrollments/catalog/", headers=headers,
        json={"kind": "tournament", "site": site, "name": name, "billing_type": "weekly_match", "starts_on": date.today().isoformat(), "expected_weeks": 1}, timeout=60)
    response.raise_for_status()
    tournament = response.json()
    def delete_fixture(kind, record):
        path = args.api + f"/player-enrollments/{kind}/{record['id']}/"
        preview = requests.get(path + "deletion-preview/", headers=headers, timeout=60)
        preview.raise_for_status()
        result = requests.delete(path, headers=headers, json={"confirmation_token": preview.json()["confirmation_token"], "confirmation_name": record["name"]}, timeout=60)
        print(json.dumps({"controlled_deletion": kind, "status": result.status_code}))
        result.raise_for_status()
    try:
        response = requests.post(args.api + "/player-enrollments/catalog/", headers=headers,
            json={"kind": "team", "tournament": tournament["id"], "name": name + " equipo", "representative_name": "", "representative_phone": ""}, timeout=60)
        response.raise_for_status()
        team = response.json()
        print("team_without_representative_or_phone_created")
        if args.controlled_enrollment:
            from core.enrollment_models import PlayerEnrollmentInvitation, PlayerEnrollment
            from io import BytesIO
            from PIL import Image, ImageDraw
            invitation_response = requests.post(args.api + "/player-enrollments/", headers=headers,
                json={"team_id": team["id"], "tournament_id": tournament["id"]}, timeout=60)
            invitation_response.raise_for_status()
            invitation_token = invitation_response.json()["token"]
            invitation = PlayerEnrollmentInvitation.objects.get(token=invitation_token, team_record_id=team["id"])
            try:
                image = Image.new("RGB", (300, 200), "white")
                ImageDraw.Draw(image).line([(20, 100), (100, 30), (150, 160), (270, 70)], fill="black", width=6)
                output = BytesIO(); image.save(output, "PNG"); content = output.getvalue()
                files = {kind: (kind + ".png", content, "image/png") for kind in ("player_photo", "player_signature", "ine_front", "ine_back")}
                files["ine_front"] = ("large-phone-photo.png", content + b"\0" * 3_100_000, "image/png")
                submitted = requests.post(args.api + "/player-enrollments/public/" + invitation_token + "/",
                    data={"name": name, "birth_date": "2000-01-01", "identity_type": "ine", "phone": "5500000000", "phone_secondary": "", "accepted_terms": "true"}, files=files, timeout=120)
                print(json.dumps({"controlled_enrollment_status": submitted.status_code}))
                submitted.raise_for_status()
                enrollment = PlayerEnrollment.objects.get(invitation=invitation)
                assert enrollment.name == name and enrollment.phone_secondary == ""
                for doc in enrollment.documents.all():
                    assert doc.storage_path and not bytes(doc.content)
                    download = requests.get(args.api + f"/player-enrollments/documents/{doc.pk}/", headers=headers, timeout=60)
                    download.raise_for_status()
                    from hashlib import sha256
                    assert sha256(download.content).hexdigest() == doc.sha256
                    assert requests.get(args.api + f"/player-enrollments/documents/{doc.pk}/", timeout=60).status_code == 401
                print("public_enrollment_large_photo_optional_emergency_private_download_passed")
            finally:
                # Only records belonging to this newly generated technical fixture.
                for enrollment in PlayerEnrollment.objects.filter(invitation=invitation, name=name):
                    for doc in enrollment.documents.all():
                        storage.delete_document(doc.storage_path)
                    enrollment.delete()
                invitation.delete()
        from core.models import Match, AttendanceSession
        match = Match.objects.create(tournament_id=tournament["id"], site_id=site, home_team_id=team["id"], away_team_id=team["id"])
        AttendanceSession.objects.create(site_id=site, tournament_id=tournament["id"], team_id=team["id"], match=match,
            session_type="tournament_match", date=match.played_on, captured_by=token.user)
        delete_fixture("teams", team)
    finally:
        delete_fixture("tournaments", tournament)
    assert before == (Student.objects.count(), Player.objects.count()), "Client counts changed during controlled verification."
    print("controlled_deletion_passed_clients_preserved")
print("production_read_checks_passed")

# Verify deployed JS, not just the HTML shell.
import re
front = requests.get("https://futsi.bpoweracademy.mx/", timeout=60)
front.raise_for_status()
assets = re.findall(r'src="(/assets/[^\"]+\.js)"', front.text)
assert assets, "Frontend entry bundle missing."
entry = requests.get("https://futsi.bpoweracademy.mx" + assets[0], timeout=60)
entry.raise_for_status()
print(json.dumps({"frontend_status": front.status_code, "entry_bundle": assets[0]}))
chunks = re.findall(r'\./([A-Za-z0-9_-]+\.js)', entry.text)
for prefix, marker in (("PlayerEnrollment-", "getUserMedia"), ("AdminShell-", "contact-audit")):
    chunk = next(name for name in chunks if name.startswith(prefix))
    body = requests.get("https://futsi.bpoweracademy.mx/assets/" + chunk, timeout=60)
    body.raise_for_status()
    assert marker in body.text, "Frontend has not finished deploying: " + prefix
    print(json.dumps({"deployed_chunk": prefix, "new_feature_verified": marker}))
