from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from unittest.mock import MagicMock, patch

import pytest
from core.models import WhatsAppConversation, WhatsAppMessage, WhatsAppHumanResponseEvent
from core.services.whatsapp_reporting_period import rolling_period
from core.services.whatsapp_contact_audit import period_contact_audit
from core.tests.factories import make_site

NOW = datetime(2026, 10, 12, 18, tzinfo=ZoneInfo('America/Mexico_City'))

@pytest.mark.parametrize('key,days', [('day',1),('three_days',3),('week',7),('month',30)])
@pytest.mark.django_db
def test_stats_exact_rolling_window(auth_client, key, days):
    site = make_site()
    start = NOW-timedelta(days=days)
    for index,time in enumerate((start-timedelta(seconds=1), start, NOW-timedelta(seconds=1), NOW)):
        chat = WhatsAppConversation.objects.create(site=site, to_address='meta:123456789', contact_phone=f'+52550000000{index}', from_address=f'whatsapp:+52550000000{index}')
        message = WhatsAppMessage.objects.create(conversation=chat, direction='inbound', body='Prueba')
        WhatsAppHumanResponseEvent.objects.create(conversation=chat, first_inbound_message=message, first_inbound_at=time)
    client, _, _ = auth_client(role='admin')
    with patch('core.services.whatsapp_reporting_period.timezone.now', return_value=NOW):
        response=client.get('/api/whatsapp-conversations/weekly-stats/', {'scope':'all','range':key})
    assert response.status_code==200, response.content
    result=response.json()
    assert result['summary']['total']==2
    assert result['period_days']==days
    assert datetime.fromisoformat(result['period_start'])==start
    assert datetime.fromisoformat(result['period_end'])==NOW

def test_legacy_and_invalid_period():
    from rest_framework.exceptions import ValidationError
    assert rolling_period({}) is None
    with pytest.raises(ValidationError):
        rolling_period({'range':'invalid'})

@patch('core.services.whatsapp_contact_audit.connection')
@patch('core.services.whatsapp_contact_audit._directory_phone_id', return_value='123')
def test_contact_period_normalizes_and_counts_only_active_pairs(phone_id, db):
    chats=MagicMock()
    chats.filter.return_value.order_by.return_value.values_list.return_value.distinct.return_value=[('meta:123','+5215500000001'),('meta:123','+525500000001'),('meta:123','+525500000002')]
    db.introspection.table_names.return_value=['whatsapp_contact_datasets','whatsapp_contact_records']
    db.cursor.return_value.__enter__.return_value.fetchall.return_value=[('test','123','+525500000001','Prospecto'),('test','123','+525500000009','Alumno confirmado')]
    result=period_contact_audit(chats,NOW-timedelta(days=3),NOW)
    assert result['total']==2
    assert result['categories']['prospect']==1
    assert result['categories']['unclassified']==1
    assert sum(result['categories'].values())==2
