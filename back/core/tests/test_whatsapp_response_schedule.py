from datetime import datetime, time
from zoneinfo import ZoneInfo
import pytest
from rest_framework.test import APIClient
from core.models import WhatsAppResponseSchedule, WhatsAppConversation, WhatsAppMessage, WhatsAppHumanResponseEvent
from core.whatsapp.response_schedule import working_seconds, get_schedule
from core.tests.factories import make_site

pytestmark = pytest.mark.django_db
URL = '/api/whatsapp-conversations/response-schedule/'
ZONE = ZoneInfo('America/Mexico_City')


def stamp(value):
    return datetime.fromisoformat(value).replace(tzinfo=ZONE)


@pytest.mark.parametrize('start,end,days,seconds', [
    ('2026-10-29T19:30','2026-10-30T09:30',list(range(7)),3600),
    ('2026-10-29T20:00','2026-10-30T09:00',list(range(7)),0),
    ('2026-10-29T22:00','2026-10-30T10:00',list(range(7)),3600),
    ('2026-10-30T19:30','2026-11-02T09:30',list(range(5)),3600),
    ('2026-10-31T09:00','2026-11-01T20:00',list(range(5)),0),
    ('2026-10-30T09:00','2026-10-30T20:00',list(range(7)),39600),
    ('2026-10-30T09:00','2026-10-30T08:00',list(range(7)),0),
    ('2026-10-26T09:00','2026-11-09T09:00',list(range(5)),396000),
])
def test_working_clock(start,end,days,seconds):
    schedule=WhatsAppResponseSchedule(days=days,starts_at=time(9),ends_at=time(20))
    assert working_seconds(stamp(start),stamp(end),schedule)==seconds


def test_default_and_admin_update_are_separate_from_bot(auth_client):
    from core.models import WhatsAppAutomationSettings, AuditLog
    client,_,_=auth_client()
    bot=WhatsAppAutomationSettings.objects.create(business_address='meta:123456789',business_hours_end=time(18))
    defaults=client.get(URL).json()
    assert defaults=={'days':list(range(7)),'starts_at':'09:00','ends_at':'20:00','timezone':str(ZONE),'can_edit':True}
    saved=client.patch(URL,{'days':[4,0],'starts_at':'10:00','ends_at':'19:00'},format='json')
    assert saved.status_code==200 and saved.json()['days']==[0,4]
    assert client.get(URL).json()['starts_at']=='10:00'
    bot.refresh_from_db(); assert bot.business_hours_end==time(18)
    assert AuditLog.objects.filter(action='whatsapp_response_schedule_updated').count()==1


@pytest.mark.parametrize('data', [
    {'days':[],'starts_at':'09:00','ends_at':'20:00'},
    {'days':[7],'starts_at':'09:00','ends_at':'20:00'},
    {'days':[1,1],'starts_at':'09:00','ends_at':'20:00'},
    {'days':[1],'starts_at':'20:00','ends_at':'09:00'},
    {'days':[1],'starts_at':'25:00','ends_at':'20:00'},
    {'days':[1],'starts_at':'09:00'},
])
def test_invalid_schedule_does_not_save(auth_client,data):
    client,_,_=auth_client()
    before=client.get(URL).json()
    assert client.patch(URL,data,format='json').status_code==400
    assert client.get(URL).json()==before


def test_public_cannot_read_or_edit():
    client=APIClient()
    assert client.get(URL).status_code in (401,403)
    assert client.patch(URL,{},format='json').status_code in (401,403)


def test_restricted_admin_cannot_edit_global_schedule(auth_client):
    client,_,_=auth_client(role='admin',section_permissions=['veronica_only'])
    assert client.patch(URL,{'days':[0],'starts_at':'09:00','ends_at':'20:00'},format='json').status_code==403


def test_history_counts_working_time_without_changing_saved_events(auth_client):
    client,_,_=auth_client()
    site=make_site()
    chat=WhatsAppConversation.objects.create(site=site,to_address='meta:123456789',from_address='whatsapp:+525500000000',contact_phone='+525500000000')
    message=WhatsAppMessage.objects.create(conversation=chat,direction='inbound',body='¿Me das información?')
    start,end=stamp('2026-10-29T19:30'),stamp('2026-10-30T09:30')
    event=WhatsAppHumanResponseEvent.objects.create(conversation=chat,first_inbound_message=message,first_inbound_at=start,responded_at=end,response_seconds=50400,human_attention_expected=True)
    data=client.get('/api/whatsapp-conversations/weekly-stats/',{'week_start':'2026-10-26','scope':'all'}).json()
    assert data['longest_waits'][0]['response_seconds']==3600
    assert data['summary']['average_response_seconds']==3600
    assert data['response_schedule']['ends_at']=='20:00'
    event.refresh_from_db(); assert event.response_seconds==50400
    assert event.first_inbound_at==start and event.responded_at==end
