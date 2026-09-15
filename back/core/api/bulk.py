"""Authenticated gateway: the path fixes Vero's scope, never a client payload."""
import json
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from django.conf import settings
from rest_framework.response import Response
from rest_framework.views import APIView
from core.veronica_access import CanUseVeronica, is_veronica_only
from core.api.bulk_import import import_recipients

class BulkView(APIView):
    permission_classes = [CanUseVeronica]

    def allowed(self, request, kind):
        return kind == 'veronica' or (not is_veronica_only(request.user) and request.user.role in {'admin', 'owner', 'dev'})

    def get(self, request, kind, operation):
        if not self.allowed(request, kind):
            return Response({'detail': 'Sin acceso a este canal.'}, status=403)
        if operation not in {'channels', 'catalog', 'list', 'detail'}:
            return Response(status=405)
        return self.forward(kind, operation, query={k: request.query_params[k] for k in ('channel', 'id', 'offset', 'after') if k in request.query_params})

    def post(self, request, kind, operation):
        if not self.allowed(request, kind):
            return Response({'detail': 'Sin acceso a este canal.'}, status=403)
        if operation == 'import':
            try:
                return Response(import_recipients(request.FILES.get('file'), request.data.get('text', ''), request.data.get('column')))
            except (ValueError, TypeError) as exc:
                # Authored validation messages are safe; never expose parser internals.
                return Response({'detail': str(exc) or 'No se pudo leer el archivo.'}, status=400)
            except Exception:
                return Response({'detail': 'Archivo inválido. Usa un Excel .xlsx sin contraseña, CSV o TXT.'}, status=400)
        if operation not in {'create', 'start', 'cancel'} or not isinstance(request.data, dict):
            return Response(status=405)
        allowed = {'create': ('request_id', 'channel', 'title', 'name', 'language', 'parameters', 'phones', 'names'), 'start': ('id', 'consent'), 'cancel': ('id',)}
        data = {k: request.data[k] for k in allowed[operation] if k in request.data}
        data['actor_id'] = request.user.pk
        return self.forward(kind, operation, data=data)

    def forward(self, kind, operation, query=None, data=None):
        base = str(settings.WHATSAPP_SERVICE_URL or '').rstrip('/')
        url = urlsplit(base)
        token = settings.WHATSAPP_SERVICE_TOKEN
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment or not token:
            return Response({'detail': 'Falta conectar Futsi con el servicio de WhatsApp.'}, status=503)
        endpoint = base + f'/api/internal/bulk/{kind}/{operation}/'
        if query:
            endpoint += '?' + urlencode(query)
        req = Request(endpoint, data=json.dumps(data).encode() if data is not None else None,
            headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
        try:
            with urlopen(req, timeout=45) as response:
                return Response(json.load(response))
        except HTTPError as exc:
            detail = 'El servicio no pudo completar la operación. Revisa su despliegue y conexión.'
            if exc.code in (400, 409):
                try:
                    detail = json.loads(exc.read(8192)).get('detail', detail)
                except ValueError:
                    pass
            return Response({'detail': detail}, status=exc.code if exc.code in (400, 404, 409) else 503)
        except (URLError, OSError, ValueError):
            return Response({'detail': 'Sin respuesta del servidor. Consulta el lote antes de volver a confirmar; no se reenvía automáticamente.'}, status=503)
