"""Admin-only gateway: credentials and provider requests stay on the server."""
import json
import uuid
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from core.veronica_access import CanUseVeronica


class VeronicaConsoleView(APIView):
    permission_classes = [CanUseVeronica]

    def get(self, request, operation):
        if operation not in {'inbox', 'history', 'templates'}:
            return Response({'detail': 'Operación no permitida.'}, status=405)
        query = {k: request.query_params[k] for k in ('q', 'offset', 'conversation_id', 'before', 'after') if k in request.query_params}
        return self.forward(operation, query=query)

    def post(self, request, operation):
        if operation == 'contact':
            payload = {k: request.data.get(k) for k in ('conversation_id', 'name')}
            return self.forward(operation, body=json.dumps(payload).encode(), content_type='application/json')
        if operation == 'send':
            if not isinstance(request.data, dict):
                return Response({'detail': 'Solicitud inválida.'}, status=400)
            allowed = ('phone', 'kind', 'body', 'template_name', 'language', 'request_id', 'media_token')
            payload = {k: request.data[k] for k in allowed if k in request.data}
            payload['actor_id'] = request.user.pk
            return self.forward(operation, body=json.dumps(payload).encode(), content_type='application/json')
        if operation == 'upload':
            file = request.FILES.get('file')
            if not file or file.size > 5 * 1024 * 1024 or not file.name.lower().endswith('.pdf'):
                return Response({'detail': 'Selecciona un PDF de máximo 5 MB.'}, status=400)
            content = file.read(5 * 1024 * 1024 + 1)
            if len(content) > 5 * 1024 * 1024 or not content.startswith(b'%PDF-'):
                return Response({'detail': 'El archivo no es un PDF válido.'}, status=400)
            import re
            filename = re.sub(r'[^\w .-]', '_', file.name)[:100]
            boundary = 'futsi' + uuid.uuid4().hex
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                'Content-Type: application/pdf\r\n\r\n').encode() + content + f'\r\n--{boundary}--\r\n'.encode()
            return self.forward(operation, body=body, content_type='multipart/form-data; boundary=' + boundary)
        return Response({'detail': 'Operación no permitida.'}, status=405)

    def forward(self, operation, query=None, body=None, content_type=None):
        base = str(settings.WHATSAPP_SERVICE_URL or '').rstrip('/')
        token = settings.WHATSAPP_SERVICE_TOKEN
        parsed = urlsplit(base)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not token:
            return Response({'detail': 'Configura WHATSAPP_SERVICE_URL y WHATSAPP_SERVICE_TOKEN en el backend de Futsi.'}, status=503)
        headers = {'Authorization': 'Bearer ' + token}
        if content_type:
            headers['Content-Type'] = content_type
        url = base + '/api/internal/veronica/' + operation + '/'
        if query:
            url += '?' + urlencode(query)
        try:
            with urlopen(Request(url, data=body, headers=headers, method='POST' if body is not None else 'GET'), timeout=45) as response:
                return Response(json.load(response))
        except HTTPError as exc:
            if exc.code == 404:
                detail = 'El servicio no tiene esta sección o conversación. Comprueba que esté desplegada la versión de Verónica.'
            elif exc.code in (401, 403):
                detail = 'Futsi no tiene acceso al servicio de Verónica. Revisa el token entre servidores.'
            else:
                detail = 'El servicio rechazó la operación. Revisa la ventana de 24 horas, plantilla y archivo.'
                try:
                    error = json.loads(exc.read(8192))
                    if isinstance(error.get('detail'), str):
                        detail = error['detail'][:500]
                except (ValueError, AttributeError):
                    pass
            return Response({'detail': detail}, status=exc.code if exc.code in (400, 404, 409) else 503)
        except (URLError, OSError, ValueError):
            return Response({'detail': 'No se pudo confirmar la operación. Si era un envío, consulta el historial antes de volver a enviarlo.'}, status=503)
