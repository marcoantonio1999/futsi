from datetime import datetime, time
from zoneinfo import ZoneInfo
import pytest
from rest_framework.test import APIClient
from core.models import WhatsAppResponseSchedule, WhatsAppSiteResponseSchedule, WhatsAppConversation, WhatsAppMessage, WhatsAppHumanResponseEvent
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
    site=make_site(); url=f'{URL}?site={site.id}'
    bot=WhatsAppAutomationSettings.objects.create(business_address='meta:123456789',business_hours_end=time(18))
    defaults=client.get(url).json()
    assert defaults=={'days':list(range(7)),'starts_at':'09:00','ends_at':'20:00','weekly_hours':{str(d):[{'start':'09:00','end':'20:00'}] for d in range(7)},'timezone':str(ZONE),'can_edit':True,'site':site.id,'site_name':site.name}
    saved=client.patch(url,{'days':[4,0],'starts_at':'10:00','ends_at':'19:00'},format='json')
    assert saved.status_code==200 and saved.json()['days']==[0,4]
    assert client.get(url).json()['starts_at']=='10:00'
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
    site=make_site(); url=f'{URL}?site={site.id}'
    before=client.get(url).json()
    assert client.patch(url,data,format='json').status_code==400
    assert client.get(url).json()==before


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
    assert data['time_basis']=='site_business_hours'
    event.refresh_from_db(); assert event.response_seconds==50400
    assert event.first_inbound_at==start and event.responded_at==end


def test_each_court_can_edit_only_its_own_hours(auth_client):
    from core.tests.test_court_communications_access import restricted_client, FRANCO_ACADEMY
    a,b=make_site(),make_site()
    first=restricted_client(auth_client,a,FRANCO_ACADEMY)
    second=restricted_client(auth_client,b,'meta:987654321')
    payload={'days':[0,1,2,3,4],'starts_at':'10:00','ends_at':'17:00'}
    assert first.patch(URL,payload,format='json').status_code==200
    assert first.get(URL).json()['ends_at']=='17:00'
    assert second.get(URL).json()['ends_at']=='20:00'
    assert first.get(URL,{'site':b.id}).status_code==403
    assert first.patch(f'{URL}?site={b.id}',payload,format='json').status_code==403
    assert first.patch(URL,{**payload,'site':b.id},format='json').status_code==400
    assert not WhatsAppSiteResponseSchedule.objects.filter(site=b).exists()


def test_missing_admin_selection_and_legacy_global_are_not_used(auth_client):
    client,_,_=auth_client(); site=make_site()
    WhatsAppResponseSchedule.objects.update_or_create(pk=1,defaults={'days':[0],'starts_at':time(1),'ends_at':time(2)})
    assert client.get(URL).status_code==400
    assert client.get(URL,{'site':site.id}).json()['starts_at']=='09:00'
    assert not WhatsAppSiteResponseSchedule.objects.exists()


def test_aggregate_history_uses_each_channels_site_not_one_global_clock(auth_client):
    from core.models import WhatsAppAutomationSettings
    client,_,_=auth_client(); a,b=make_site(),make_site()
    WhatsAppSiteResponseSchedule.objects.create(site=b,days=list(range(7)),starts_at=time(10),ends_at=time(17))
    start,end=stamp('2026-10-29T19:30'),stamp('2026-10-30T10:30')
    chats=[]
    for site,address in [(a,'meta:123456789'),(b,'meta:987654321')]:
        WhatsAppAutomationSettings.objects.create(site=site,business_address=address)
        chat=WhatsAppConversation.objects.create(site=a,to_address=address,from_address='whatsapp:+525500000000',contact_phone='+525500000000')
        message=WhatsAppMessage.objects.create(conversation=chat,direction='inbound',body='¿Información?')
        WhatsAppHumanResponseEvent.objects.create(conversation=chat,first_inbound_message=message,first_inbound_at=start,responded_at=end,response_seconds=54000,human_attention_expected=True)
        chats.append(chat.id)
    report=client.get('/api/whatsapp-conversations/weekly-stats/',{'week_start':'2026-10-26','scope':'all'}).json()
    durations={row['conversation_id']:row['response_seconds'] for row in report['longest_waits']}
    assert durations=={chats[0]:7200,chats[1]:1800}
    assert report['summary']['average_response_seconds']==4500


def test_notifications_use_own_site_schedule(auth_client):
    from unittest.mock import patch
    from core.tests.test_whatsapp_notifications import chat, NOW, URL as ALERT_URL
    client,_,_=auth_client(); a,b=make_site(),make_site()
    one,_=chat(a,'meta:123456789',age=3)
    two,_=chat(b,'meta:987654321',age=3)
    WhatsAppSiteResponseSchedule.objects.create(site=b,days=list(range(7)),starts_at=time(13),ends_at=time(20))
    with patch('core.api.whatsapp_notifications.timezone.now',return_value=NOW):
        data=client.get(ALERT_URL).json()
    assert [r['conversation_id'] for r in data['items'] if r['kind']=='pending']==[one.id]
