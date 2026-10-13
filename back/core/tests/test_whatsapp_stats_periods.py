from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from core.models import WhatsAppConversation, WhatsAppMessage, WhatsAppHumanResponseEvent

pytestmark = [pytest.mark.api, pytest.mark.django_db]
URL = '/api/whatsapp-conversations/weekly-stats/'


@pytest.mark.parametrize('days, expected', [(1, 1), (2, 2), (3, 3), (7, 7)])
def test_selected_period_filters_stats_and_classifications(auth_client, days, expected):
    zone = ZoneInfo('America/Mexico_City')
    conversation = WhatsAppConversation.objects.create(contact_phone='+525500000001',
        from_address='whatsapp:+525500000001', to_address='whatsapp:+14155238886', status='active', current_step='faq')
    # Start Thursday for non-weekly periods, Monday for the legacy week.
    start_day = 5 if days == 7 else 8
    for day in range(5, 16):
        stamp = datetime(2026, 10, day, 12, tzinfo=zone)
        message = WhatsAppMessage.objects.create(conversation=conversation, provider_sid=f'period-{day}',
            direction='inbound', body='Solicito información', contact_type='prospect')
        WhatsAppMessage.objects.filter(pk=message.pk).update(created_at=stamp)
        WhatsAppHumanResponseEvent.objects.create(conversation=conversation, first_inbound_message=message,
            first_inbound_at=stamp, human_attention_expected=True, response_seconds=60,
            responded_at=stamp, response_channel='dashboard')
    client, _, _ = auth_client(role='admin')
    response = client.get(URL, {'scope':'all', 'week_start':'2026-10-08', 'period_days':days})
    assert response.status_code == 200
    data = response.json()
    assert data['period_days'] == days
    assert data['week_start'] == f'2026-10-{start_day:02}'
    assert data['week_end'] == f'2026-10-{start_day+days-1:02}'
    assert data['summary']['total'] == expected
    assert data['classifications']['prospect'] == expected
    assert len(data['longest_waits']) == expected


@pytest.mark.parametrize('value', ['0','32','-1','2.5','abc'])
def test_invalid_period_is_rejected(auth_client, value):
    client, _, _ = auth_client(role='admin')
    assert client.get(URL, {'period_days':value}).status_code == 400


def test_default_period_remains_weekly(auth_client):
    client, _, _ = auth_client(role='admin')
    response = client.get(URL, {'week_start':'2026-10-08'})
    assert response.status_code == 200
    assert response.json()['period_days'] == 7
    assert response.json()['week_start'] == '2026-10-05'


def test_thirty_day_period_crosses_month_without_week_rounding(auth_client):
    client, _, _ = auth_client(role='admin')
    response = client.get(URL, {'scope': 'all', 'week_start': '2026-09-20', 'period_days': 30})
    assert response.status_code == 200
    assert response.json()['period_days'] == 30
    assert response.json()['week_start'] == '2026-09-20'
    assert response.json()['week_end'] == '2026-10-19'
