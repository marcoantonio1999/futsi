"""Private enrollment files; only the authenticated API serves these objects."""
import json
from hashlib import sha256
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from .supabase_storage import supabase_url, storage_headers, delete_private_file

BUCKET = "player-enrollment-private"
MAX_BYTES = 20_000_000


def ensure_private_bucket():
    endpoint = f"{supabase_url()}/storage/v1/bucket/{BUCKET}"
    try:
        with urlopen(Request(endpoint, headers=storage_headers()), timeout=30) as response:
            bucket = json.loads(response.read())
    except HTTPError as exc:
        # Storage returns 400 (rather than 404) for a missing bucket.
        error = json.loads(exc.read() or b"{}")
        missing = exc.code == 404 or (exc.code == 400 and error.get("message") == "Bucket not found")
        if not missing:
            raise
        payload = json.dumps({"id": BUCKET, "name": BUCKET, "public": False,
                              "file_size_limit": MAX_BYTES,
                              "allowed_mime_types": ["image/jpeg", "image/png", "application/pdf"]}).encode()
        with urlopen(Request(f"{supabase_url()}/storage/v1/bucket", data=payload,
                             headers=storage_headers("application/json"), method="POST"), timeout=30):
            pass
        return
    if bucket.get("public") is not False:
        raise RuntimeError("El bucket de inscripciones debe ser privado.")


def object_endpoint(path, authenticated=False):
    prefix = "authenticated/" if authenticated else ""
    return f"{supabase_url()}/storage/v1/object/{prefix}{BUCKET}/{quote(path, safe='/')}"


def upload_document(path, content, mime):
    with urlopen(Request(object_endpoint(path), data=content, method="POST",
                         headers=storage_headers(mime, upsert=True)), timeout=60):
        pass
    return path


def read_document(path):
    with urlopen(Request(object_endpoint(path, authenticated=True), headers=storage_headers()), timeout=60) as response:
        data = response.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise RuntimeError("El archivo almacenado excede el límite permitido.")
    return data


def verify_document(path, expected_hash):
    if sha256(read_document(path)).hexdigest() != expected_hash:
        raise RuntimeError("No coincide la integridad del documento en Storage.")


def delete_document(path):
    return delete_private_file(BUCKET, path)
