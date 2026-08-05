from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import urlparse

import requests


class FutsiClient:
    def __init__(self, api_url: str, station_token: str, reference_proxy_url: str = ""):
        self.api_url = api_url.rstrip("/")
        self.station_token = station_token
        self.reference_proxy_url = reference_proxy_url.strip()
        self.session = requests.Session()
        self.session.headers.update({"X-Futsi-Station-Key": station_token, "User-Agent": "FutsiFaceStation/1.0"})
        self.online = False
        self.last_error = ""

    def _url(self, path: str) -> str:
        return f"{self.api_url}{path}"

    def _request(self, method: str, path: str, **kwargs):
        try:
            response = self.session.request(method, self._url(path), timeout=(8, 60), **kwargs)
            response.raise_for_status()
            self.online = True
            self.last_error = ""
            return response
        except Exception as exc:
            self.online = False
            self.last_error = str(exc)
            raise

    def bootstrap(self) -> dict:
        return self._request("GET", "/api/face-station/bootstrap/").json()

    def heartbeat(self) -> dict:
        return self._request("POST", "/api/face-station/heartbeat/", json={}).json()

    def send_events(self, events: list[dict]) -> dict:
        return self._request("POST", "/api/face-station/events/batch/", json={"events": events}).json()

    def sync_daily_report(self, payload: dict) -> dict:
        return self._request(
            "PUT",
            "/api/face-station/reports/daily/",
            json=payload,
        ).json()

    def register_unknown(self, payload: dict) -> dict:
        return self._request("POST", "/api/face-station/unknowns/register/", json=payload).json()

    def create_student_from_unknown(self, payload: dict) -> dict:
        return self._request(
            "POST",
            "/api/face-station/students/quick-create/",
            json=payload,
        ).json()

    def create_collaborator_from_unknown(self, payload: dict) -> dict:
        return self._request(
            "POST",
            "/api/face-station/collaborators/quick-create/",
            json=payload,
        ).json()

    def download_reference(self, person: dict, target_dir: Path) -> Path:
        target_dir.mkdir(parents=True, exist_ok=True)
        safe_key = re.sub(r"[^a-zA-Z0-9_.-]", "_", person["person_key"])
        target = target_dir / f"{safe_key}.jpg"
        photo_url = str(person["photo_url"])
        if photo_url.startswith("http://") or photo_url.startswith("https://"):
            parsed = urlparse(photo_url)
            photo_url = parsed.path + (f"?{parsed.query}" if parsed.query else "")
        if self.reference_proxy_url:
            person_type = person.get("type") or person.get("person_type")
            person_id = person.get("id") or person.get("remote_id")
            try:
                response = self.session.post(
                    self.reference_proxy_url,
                    json={"person_type": person_type, "person_id": person_id},
                    timeout=(8, 60),
                )
                response.raise_for_status()
                self.online = True
                self.last_error = ""
            except requests.RequestException as proxy_error:
                self.online = False
                self.last_error = str(proxy_error)
                raise
        else:
            response = self._request("GET", photo_url)
        temp = target.with_suffix(".tmp")
        temp.write_bytes(response.content)
        temp.replace(target)
        return target
