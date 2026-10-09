"""Verify released enrollment access without creating invitations or player records."""
import json
import sys
import requests

password = sys.stdin.read().strip()
base = "https://futsi.onrender.com/api"
origin = "https://marcoantonio1999.github.io"
login = requests.post(base + "/auth/login/", json={"username": "emilio", "password": password}, headers={"Origin": origin}, timeout=40)
login.raise_for_status()
body = login.json()
headers = {"Authorization": "Token " + body["token"]}
user = body["user"]
assert user["username"] == "emilio" and user["role"] == "collaborator"
assert user["primary_site"] is None and user["section_permissions"] == ["player_enrollments_only"]
history = requests.get(base + "/player-enrollments/", headers=headers, timeout=40)
blocked = requests.get(base + "/sites/", headers=headers, timeout=40)
anonymous = requests.get(base + "/player-enrollments/", timeout=40)
assert history.status_code == 200 and blocked.status_code == 403 and anonymous.status_code == 401
assert login.headers.get("Access-Control-Allow-Origin") == origin
requests.post(base + "/auth/logout/", headers=headers, timeout=40).raise_for_status()
print(json.dumps({"login": "ok", "history": history.status_code, "other_areas_blocked": blocked.status_code, "anonymous_blocked": anonymous.status_code, "public_page_origin": "ok"}))
