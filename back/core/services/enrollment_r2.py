"""Private R2 objects. Keys remain server-side; failures never expose signed URLs."""
import datetime
import hashlib
import hmac
import os
import re
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

PREFIX = 'r2://'
MAX_BYTES = 20_000_000


def enabled():
    return os.getenv('ENROLLMENT_STORAGE_PROVIDER', '').lower() == 'r2'


def config():
    account = os.environ.get('ENROLLMENT_R2_ACCOUNT_ID', '')
    bucket = os.environ.get('ENROLLMENT_R2_BUCKET', '')
    key = os.environ.get('ENROLLMENT_R2_ACCESS_KEY_ID', '')
    secret = os.environ.get('ENROLLMENT_R2_SECRET_ACCESS_KEY', '')
    if not re.fullmatch(r'[a-f0-9]{32}', account) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', bucket) or not key or not secret:
        raise RuntimeError('R2 de Inscripciones no está configurado.')
    return account, bucket, key, secret


def reference(key):
    return PREFIX + config()[1] + '/' + key


def object_key(path):
    prefix = PREFIX + config()[1] + '/'
    if not path.startswith(prefix):
        raise ValueError('Referencia de R2 no permitida.')
    key = path[len(prefix):]
    if not key or '..' in key.split('/') or key.startswith('/') or '\\' in key:
        raise ValueError('Referencia de R2 no válida.')
    return key


def signed_url(path, method='GET', *, expires=120, headers=None):
    account, bucket, access, secret = config()
    key = object_key(path)
    host = account + '.r2.cloudflarestorage.com'
    uri = '/' + bucket + '/' + quote(key, safe='/~')
    now = datetime.datetime.now(datetime.timezone.utc)
    day, stamp = now.strftime('%Y%m%d'), now.strftime('%Y%m%dT%H%M%SZ')
    scope = day + '/auto/s3/aws4_request'
    signed_headers = {'host': host, **{k.lower(): ' '.join(str(v).split()) for k, v in (headers or {}).items()}}
    names = ';'.join(sorted(signed_headers))
    query = urlencode(sorted({'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': access + '/' + scope,
        'X-Amz-Date': stamp, 'X-Amz-Expires': str(expires), 'X-Amz-SignedHeaders': names}.items()), quote_via=quote, safe='~')
    canonical = '\n'.join([method, uri, query, ''.join(k + ':' + signed_headers[k] + '\n' for k in sorted(signed_headers)), names, 'UNSIGNED-PAYLOAD'])
    to_sign = 'AWS4-HMAC-SHA256\n' + stamp + '\n' + scope + '\n' + hashlib.sha256(canonical.encode()).hexdigest()
    signing_key = ('AWS4' + secret).encode()
    for part in [day, 'auto', 's3', 'aws4_request']:
        signing_key = hmac.new(signing_key, part.encode(), hashlib.sha256).digest()
    signature = hmac.new(signing_key, to_sign.encode(), hashlib.sha256).hexdigest()
    return 'https://' + host + uri + '?' + query + '&X-Amz-Signature=' + signature


def request(path, method='GET', *, headers=None, content=None):
    try:
        with urlopen(Request(signed_url(path, method, headers=headers), method=method, data=content, headers=headers or {}), timeout=60) as response:
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise RuntimeError('El archivo supera el límite permitido.')
            return data
    except (HTTPError, URLError, TimeoutError, OSError):
        # Do not chain urllib errors: their repr may contain a bearer URL.
        raise RuntimeError('No se pudo acceder al almacenamiento privado R2.') from None


def upload(path, content, mime):
    request(path, 'PUT', headers={'Content-Type': mime, 'Cache-Control': 'private, no-store', 'If-None-Match': '*'}, content=content)
    return path


def copy(source, destination, mime):
    object_key(destination)
    headers = {'x-amz-copy-source': '/' + config()[1] + '/' + quote(object_key(source), safe='/'),
        'x-amz-metadata-directive': 'REPLACE', 'Content-Type': mime, 'Cache-Control': 'private, no-store',
        'cf-copy-destination-if-none-match': '*'}
    result = request(destination, 'PUT', headers=headers, content=b'')
    if b'<Error>' in result:
        raise RuntimeError('No se pudo confirmar la copia privada en R2.')


def delete(path):
    request(path, 'DELETE')
    return True
