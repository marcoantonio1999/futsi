from unittest.mock import patch
import pytest
from core.veronica_access import veronica_route_allowed


@pytest.mark.django_db
def test_veronica_only_login_and_allowed_channel(auth_client):
    client, data, user = auth_client(role="collaborator", section_permissions=["veronica_only"])
    assert data["section_permissions"] == ["veronica_only"]
    assert client.get('/api/auth/me/').status_code == 200
    with patch('core.api.veronica.VeronicaConsoleView.forward') as forward:
        from rest_framework.response import Response
        forward.return_value = Response({"conversations": []})
        for operation in ('inbox', 'channels', 'history', 'templates', 'auto-pdf'):
            assert client.get('/api/veronica/' + operation + '/').status_code == 200
        assert client.post('/api/veronica/send/', {}, format='json').status_code == 200
        assert client.post('/api/veronica/contact/', {'conversation_id': 1, 'name': 'Santiago'}, format='json').status_code == 200
        assert b'Santiago' in forward.call_args.kwargs['body']
        assert client.post('/api/veronica/contact-filters/', {'conversation_id': 1, 'platform': 'OCC', 'vacancy_type': 'Coach'}, format='json').status_code == 200
        assert b'vacancy_type' in forward.call_args.kwargs['body']
        assert client.post('/api/veronica/auto-pdf/', {'enabled': 'false', 'caption': 'Pausa'}, format='multipart').status_code == 200
    filters = client.get('/api/veronica/filter-options/')
    assert filters.status_code == 200 and filters.data['platforms'] == ['Computrabajo', 'Indeed', 'OCC']
    assert client.post('/api/veronica/filter-options/', {'dimension': 'platform', 'label': 'LinkedIn'}, format='json').status_code == 200
    assert not user.is_staff and not user.is_superuser
    assert client.post('/api/auth/logout/').status_code == 204
    assert client.get('/api/auth/me/').status_code == 401


@pytest.mark.django_db
def test_restricted_user_cannot_read_or_modify_other_sections(auth_client):
    client, _, user = auth_client(role="collaborator", section_permissions=["veronica_only"])
    for path in ('/api/sites/', '/api/users/', '/api/students/', '/api/charges/', '/api/payments/',
                 '/api/dashboard/summary/', '/api/whatsapp-conversations/', '/api/voice-calls/',
                 '/api/whatsapp-automation-settings/current/', '/api/reports/accounting.xlsx'):
        for method in ('get', 'post', 'patch', 'delete'):
            assert getattr(client, method)(path).status_code == 403, (method, path)
    assert client.patch('/api/auth/me/', {'role': 'admin', 'section_permissions': []}, format='json').status_code == 403
    user.refresh_from_db()
    assert user.role == 'collaborator' and user.section_permissions == ['veronica_only']


@pytest.mark.django_db
def test_unassigned_collaborator_cannot_use_veronica(auth_client):
    client, _, _ = auth_client(role="collaborator", section_permissions=[])
    assert client.get('/api/veronica/inbox/').status_code == 403


def test_allowlist_is_exact():
    assert veronica_route_allowed('/api/veronica/channels/', 'GET')
    assert veronica_route_allowed('/api/veronica/channels/', 'HEAD')
    for method in ('POST', 'PATCH', 'DELETE'):
        assert not veronica_route_allowed('/api/veronica/channels/', method)
    assert not veronica_route_allowed('/api/veronica/channels/other/', 'GET')
    assert not veronica_route_allowed('/api/veronica/anything/', 'GET')
    assert not veronica_route_allowed('/api/veronica/inbox/', 'DELETE')
    assert not veronica_route_allowed('/api/auth/me/', 'PATCH')


@pytest.mark.django_db
def test_veronica_statistics_include_only_recruitment_and_human_replies(auth_client):
    from datetime import timedelta
    from django.utils import timezone
    from core.models import WhatsAppConversation, WhatsAppMessage
    client, _, _ = auth_client(role='collaborator', section_permissions=['veronica_only'])
    now = timezone.now()
    for address, kind in [('meta:1255168474339309', 'veronica_manual'), ('meta:1100529023150528', 'veronica_manual'), ('whatsapp:+525574858165', 'academy')]:
        chat = WhatsAppConversation.objects.create(to_address=address, contact_phone='+525512345678', context={'kind': kind})
        incoming = WhatsAppMessage.objects.create(conversation=chat, direction='inbound', body='Hola')
        reply = WhatsAppMessage.objects.create(conversation=chat, direction='outbound', body='Hola', response_source='human_dashboard')
        WhatsAppMessage.objects.filter(pk=incoming.pk).update(created_at=now - timedelta(minutes=5))
        WhatsAppMessage.objects.filter(pk=reply.pk).update(created_at=now)
    result = client.get('/api/veronica/weekly-stats/')
    assert result.status_code == 200
    assert result.data['summary']['total'] == 2
    assert result.data['summary']['average_response_seconds'] == 300
    selected = client.get('/api/veronica/weekly-stats/', {'channel': 'meta:1255168474339309'})
    assert selected.data['summary']['total'] == 1
    assert client.get('/api/veronica/weekly-stats/', {'channel': 'whatsapp:+525574858165'}).data['summary']['total'] == 0
    assert client.get('/api/veronica/weekly-stats/', {'week_start': 'invalid'}).status_code == 400
    assert client.post('/api/veronica/weekly-stats/', {}).status_code == 403
