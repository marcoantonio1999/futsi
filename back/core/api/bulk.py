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
from core.api.veronica_filters import ensure_imported

class BulkView(APIView):
    permission_classes = [CanUseVeronica]

    def allowed(self, request, kind):
        return kind == 'veronica' or (not is_veronica_only(request.user) and request.user.role in {'admin', 'owner', 'dev'})

    def get(self, request, kind, operation):
        if not self.allowed(request, kind):
            return Response({'detail': 'Sin acceso a este canal.'}, status=403)
        if operation not in {'channels', 'catalog', 'list', 'detail', 'connections', 'contacts', 'contact-detail'}:
            return Response(status=405)
        if kind != 'academy' and operation in {'contacts', 'contact-detail'}:
            return Response(status=403)
        keys = ('channel', 'id', 'offset', 'after', 'contact_id', 'q', 'relationship', 'interest', 'confidence', 'priority',
                'consent_source', 'campaign_source', 'review_state', 'no_contact', 'needs_review', 'sensitive',
                'age', 'since', 'until', 'min_messages', 'ordinal_from', 'ordinal_to', 'outreach', 'sort', 'limit', 'selectable_only',
                'league_role', 'league_relevance', 'team')
        return self.forward(kind, operation, query={k: request.query_params[k] for k in keys if k in request.query_params})

    def post(self, request, kind, operation):
        if not self.allowed(request, kind):
            return Response({'detail': 'Sin acceso a este canal.'}, status=403)
        if operation == 'import':
            try:
                result = import_recipients(
                    request.FILES.get('file'), request.data.get('text', ''), request.data.get('column'),
                    request.data.get('template_parameters'),
                )
                if kind == 'veronica':
                    result['added_filter_options'] = ensure_imported(result.get('filters', {}), request.user)
                # Large analyzed workbooks are filtered client-side and must not
                # depend on every uploaded number already existing in the service.
                if result.get('phones') and len(result['phones']) <= 1000 and request.data.get('channel'):
                    lookup = self.forward(kind, 'names', data={'actor_id': request.user.pk,
                        'channel': request.data['channel'], 'phones': result['phones']})
                    if lookup.status_code != 200:
                        return lookup
                    result['names'] = {**lookup.data.get('names', {}), **result.get('names', {})}
                    for contact in result.get('file_contacts', []):
                        contact['name'] = result['names'].get(contact['phone'], contact.get('name', ''))
                return Response(result)
            except (ValueError, TypeError) as exc:
                # Authored validation messages are safe; never expose parser internals.
                return Response({'detail': str(exc) or 'No se pudo leer el archivo.'}, status=400)
            except Exception:
                return Response({'detail': 'Archivo inválido. Usa un Excel .xlsx sin contraseña, CSV o TXT.'}, status=400)
        if operation not in {'create', 'start', 'cancel', 'contact-select', 'contact-update'} or not isinstance(request.data, dict):
            return Response(status=405)
        if kind != 'academy' and operation in {'contact-select', 'contact-update'}:
            return Response(status=403)
        allowed = {'create': ('request_id', 'channel', 'title', 'name', 'language', 'parameters', 'recipient_parameters', 'phones', 'names', 'filters', 'contact_ids'),
                   'start': ('id', 'consent', 'review_confirmed'), 'cancel': ('id',),
                   'contact-select': ('channel', 'contact_ids'),
                   'contact-update': ('channel', 'contact_id', 'name', 'priority', 'notes', 'manually_blocked')}
        data = {k: request.data[k] for k in allowed[operation] if k in request.data}
        if kind == 'veronica' and operation == 'create':
            try:
                ensure_imported(data.get('filters', {}), request.user)
            except ValueError as exc:
                return Response({'detail': str(exc)}, status=400)
        data['actor_id'] = request.user.pk
        return self.forward(kind, operation, data=data)

    def forward(self, kind, operation, query=None, data=None):
        base = str(settings.WHATSAPP_SERVICE_URL or '').rstrip('/')
        url = urlsplit(base)
        token = settings.WHATSAPP_SERVICE_TOKEN
        local_service = (
            url.scheme == 'http'
            and url.hostname in {'127.0.0.1', 'localhost'}
            and not getattr(settings, 'IS_PRODUCTION', False)
        )
        if (url.scheme != 'https' and not local_service) or not url.hostname or url.username or url.password or url.query or url.fragment or not token:
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
