from unittest.mock import patch
import pytest
from rest_framework.response import Response
from rest_framework.test import APIClient
from core.models import User


@pytest.mark.django_db
def test_uvm_directory_only_admin_scope():
    client = APIClient()
    user = User.objects.create_user(username='uvm-access-admin', password='test', role='admin')
    client.force_authenticate(user)
    with patch('core.api.bulk.BulkView.forward', return_value=Response({'contacts': []})) as forward:
        response = client.get('/api/whatsapp-bulk/contacts/', {'channel': 'meta:1187630384444567', 'relationship': 'Prospecto', 'no_contact': 'false', 'outreach': 'new', 'league_role': 'Capitán', 'league_relevance': 'Prospecto de liga', 'team': 'Toros'})
        assert response.status_code == 200
        assert forward.call_args.kwargs['query']['relationship'] == 'Prospecto'
        assert forward.call_args.kwargs['query']['league_role'] == 'Capitán'
        assert forward.call_args.kwargs['query']['league_relevance'] == 'Prospecto de liga'
        assert forward.call_args.kwargs['query']['team'] == 'Toros'
        assert client.get('/api/veronica/bulk/contacts/').status_code == 403
        client.post('/api/whatsapp-bulk/contact-update/', {'channel': 'uvm', 'contact_id': 1, 'actor_id': 999, 'name': 'Ejemplo', 'priority': 'Alta', 'notes': '', 'manually_blocked': False}, format='json')
        assert forward.call_args.kwargs['data']['actor_id'] == user.pk


@pytest.mark.django_db
def test_uvm_directory_rejects_non_admin_and_anonymous():
    client = APIClient()
    for operation in ('contacts', 'contact-detail'):
        assert client.get('/api/whatsapp-bulk/'+operation+'/').status_code in (401, 403)
    user = User.objects.create_user(username='uvm-access-cashier', password='test', role='cashier')
    client.force_authenticate(user)
    with patch('core.api.bulk.BulkView.forward') as forward:
        assert client.get('/api/whatsapp-bulk/contacts/').status_code == 403
        assert client.post('/api/whatsapp-bulk/contact-select/', {}, format='json').status_code == 403
        forward.assert_not_called()


@pytest.mark.django_db
def test_veronica_only_cannot_read_or_edit_uvm(auth_client):
    client, _, _ = auth_client(role='collaborator', section_permissions=['veronica_only'])
    with patch('core.api.bulk.BulkView.forward') as forward:
        for prefix in ('/api/veronica/bulk/', '/api/whatsapp-bulk/'):
            for operation in ('contacts', 'contact-detail'):
                assert client.get(prefix+operation+'/', {'channel': 'uvm'}).status_code == 403
            for operation in ('contact-select', 'contact-update'):
                assert client.post(prefix+operation+'/', {'channel': 'uvm'}, format='json').status_code == 403
        forward.assert_not_called()
