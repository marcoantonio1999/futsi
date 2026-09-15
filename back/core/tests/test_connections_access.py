from unittest.mock import patch
import pytest
from rest_framework.response import Response


@pytest.mark.django_db
def test_connections_scope_is_fixed_by_route(auth_client):
    client, _, _ = auth_client(role='collaborator', section_permissions=['veronica_only'])
    with patch('core.api.bulk.BulkView.forward', return_value=Response({'connections': []})) as forward:
        assert client.get('/api/veronica/bulk/connections/?kind=academy').status_code == 200
        assert forward.call_args.args == ('veronica', 'connections')
        assert forward.call_args.kwargs['query'] == {}
        forward.reset_mock()
        assert client.get('/api/whatsapp-bulk/connections/').status_code == 403
        assert client.post('/api/veronica/bulk/connections/', {}, format='json').status_code in (403, 405)
        forward.assert_not_called()


@pytest.mark.django_db
def test_admin_can_read_both_connections_without_write(auth_client):
    client, _, _ = auth_client(role='admin')
    with patch('core.api.bulk.BulkView.forward', return_value=Response({'connections': []})):
        for prefix in ('/api/veronica/bulk/', '/api/whatsapp-bulk/'):
            assert client.get(prefix+'connections/').status_code == 200
            assert client.post(prefix+'connections/', {}, format='json').status_code == 405


@pytest.mark.django_db
def test_other_roles_cannot_read_connections(auth_client):
    for role in ('collaborator', 'site_coordinator'):
        client, _, _ = auth_client(role=role)
        assert client.get('/api/whatsapp-bulk/connections/').status_code == 403
        assert client.get('/api/veronica/bulk/connections/').status_code == 403
