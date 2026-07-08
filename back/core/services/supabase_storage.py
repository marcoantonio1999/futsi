from __future__ import annotations

import mimetypes
import os
import tempfile
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from django.conf import settings
from dotenv import load_dotenv


load_dotenv(Path(settings.BASE_DIR) / ".env.local")


def storage_uri(bucket: str, object_path: str) -> str:
    return f"supabase://{bucket}/{object_path.lstrip('/')}"


def parse_storage_uri(uri: str) -> tuple[str, str] | None:
    if not uri.startswith("supabase://"):
        return None
    bucket_and_path = uri[len("supabase://") :]
    bucket, _, object_path = bucket_and_path.partition("/")
    if not bucket or not object_path:
        return None
    return bucket, object_path


def supabase_url() -> str:
    value = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not value:
        project_ref = os.getenv("SUPABASE_PROJECT_REF", "uqvjilgskrqehkdpkhvq")
        value = f"https://{project_ref}.supabase.co"
    return value


def service_role_key() -> str:
    value = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not value:
        raise RuntimeError("Falta SUPABASE_SERVICE_ROLE_KEY para acceder a Storage privado.")
    return value


def storage_headers(content_type: str | None = None, upsert: bool = False) -> dict[str, str]:
    key = service_role_key()
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
    }
    if content_type:
        headers["Content-Type"] = content_type
    if upsert:
        headers["x-upsert"] = "true"
    return headers


def upload_private_file(bucket: str, object_path: str, local_path: str | Path, upsert: bool = True) -> str:
    path = Path(local_path)
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    encoded_path = "/".join(quote(part) for part in object_path.replace("\\", "/").split("/"))
    endpoint = f"{supabase_url()}/storage/v1/object/{bucket}/{encoded_path}"
    request = Request(
        endpoint,
        data=path.read_bytes(),
        method="POST",
        headers=storage_headers(content_type=content_type, upsert=upsert),
    )
    try:
        with urlopen(request, timeout=60) as response:
            if response.status >= 400:
                raise RuntimeError(f"Supabase Storage respondio {response.status}.")
    except HTTPError as exc:
        raise RuntimeError(f"Supabase Storage upload fallo con HTTP {exc.code}: {exc.read().decode('utf-8', errors='ignore')}") from exc
    return storage_uri(bucket, object_path)


def download_private_file(bucket: str, object_path: str, suffix: str = ".jpg") -> str:
    encoded_path = "/".join(quote(part) for part in object_path.replace("\\", "/").split("/"))
    endpoint = f"{supabase_url()}/storage/v1/object/authenticated/{bucket}/{encoded_path}"
    request = Request(endpoint, method="GET", headers=storage_headers())
    try:
        with urlopen(request, timeout=60) as response:
            payload = response.read()
    except HTTPError as exc:
        raise RuntimeError(f"Supabase Storage download fallo con HTTP {exc.code}: {exc.read().decode('utf-8', errors='ignore')}") from exc

    ref_file = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    ref_file.write(payload)
    ref_file.close()
    return ref_file.name


def delete_private_file(bucket: str, object_path: str) -> bool:
    encoded_path = "/".join(quote(part) for part in object_path.replace("\\", "/").split("/"))
    endpoint = f"{supabase_url()}/storage/v1/object/{bucket}/{encoded_path}"
    request = Request(endpoint, method="DELETE", headers=storage_headers())
    try:
        with urlopen(request, timeout=60) as response:
            return response.status < 400
    except HTTPError as exc:
        if exc.code == 404:
            return False
        raise RuntimeError(f"Supabase Storage delete fallo con HTTP {exc.code}: {exc.read().decode('utf-8', errors='ignore')}") from exc
