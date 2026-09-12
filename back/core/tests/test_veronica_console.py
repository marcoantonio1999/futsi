import json
from unittest.mock import patch, MagicMock
import pytest
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from core.models import WhatsAppConversation

BASE='/api/veronica/'

@pytest.mark.django_db
def test_requires_admin(api_client,auth_client):
    assert api_client.get(BASE+'inbox/').status_code in (401,403)
    client,_,_=auth_client(role='site_coordinator')
    with patch('core.api.veronica.urlopen') as send:
        assert client.get(BASE+'inbox/').status_code==403
        assert client.post(BASE+'send/',{},format='json').status_code==403
        send.assert_not_called()

@pytest.mark.django_db
@override_settings(WHATSAPP_SERVICE_URL='https://service.example',WHATSAPP_SERVICE_TOKEN='server-only')
def test_proxy_forces_actor_and_hides_credentials(auth_client):
    client,_,user=auth_client()
    response=MagicMock(); response.__enter__.return_value.read.return_value=b'{"status":"accepted"}'
    with patch('core.api.veronica.urlopen',return_value=response) as send:
        result=client.post(BASE+'send/',{'phone':'525512345678','actor_id':999,'kind':'text','body':'Hola','request_id':'test','api_key':'bad'},format='json')
    assert result.status_code==200
    req=send.call_args.args[0]; data=json.loads(req.data)
    assert data['actor_id']==user.pk
    assert 'api_key' not in data
    assert req.full_url=='https://service.example/api/internal/veronica/send/'
    assert req.get_header('Authorization')=='Bearer server-only'
    assert b'server-only' not in result.content

@pytest.mark.django_db
def test_rejects_non_pdf_before_network(auth_client):
    client,_,_=auth_client()
    with patch('core.api.veronica.urlopen') as send:
        response=client.post(BASE+'upload/',{'file':SimpleUploadedFile('x.pdf',b'not pdf')},format='multipart')
    assert response.status_code==400
    send.assert_not_called()

@pytest.mark.django_db
@override_settings(WHATSAPP_SERVICE_URL='http://unsafe.example',WHATSAPP_SERVICE_TOKEN='test')
def test_requires_https(auth_client):
    client,_,_=auth_client()
    with patch('core.api.veronica.urlopen') as send:
        assert client.get(BASE+'inbox/').status_code==503
    send.assert_not_called()

@pytest.mark.django_db
def test_academy_inbox_excludes_veronica_even_scope_all(auth_client):
    client,_,_=auth_client()
    row=WhatsAppConversation.objects.create(contact_phone='+525512345678',from_address='a',to_address='meta:99999',context={'kind':'veronica_manual'})
    response=client.get('/api/whatsapp-conversations/?scope=all')
    assert response.status_code==200
    data=response.json(); rows=data if isinstance(data,list) else data['results']
    assert all(r['id']!=row.pk for r in rows)
