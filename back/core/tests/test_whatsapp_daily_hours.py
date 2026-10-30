from datetime import time
import pytest
from core.models import WhatsAppSiteResponseSchedule
from core.whatsapp.response_schedule import working_seconds, is_working, weekly_hours
from core.tests.test_whatsapp_response_schedule import stamp, URL
from core.tests.factories import make_site

pytestmark=pytest.mark.django_db


def hours():
    result={str(d):[{'start':'09:00','end':'20:00'}] for d in range(5)}
    return {**result,'5':[{'start':'10:00','end':'14:00'}],'6':[{'start':'11:00','end':'13:00'}]}


@pytest.mark.parametrize('start,end,seconds',[
    ('2026-10-30T19:00','2026-11-02T11:00',9*3600),
    ('2026-10-31T09:00','2026-10-31T15:00',4*3600),
    ('2026-11-01T09:00','2026-11-01T15:00',2*3600),
    ('2026-10-26T09:00','2026-11-09T09:00',122*3600),
])
def test_different_saturday_sunday_and_full_weeks(start,end,seconds):
    schedule=WhatsAppSiteResponseSchedule(weekly_hours=hours())
    assert working_seconds(stamp(start),stamp(end),schedule)==seconds
    assert is_working(stamp('2026-10-31T10:00'),schedule)
    assert not is_working(stamp('2026-10-31T14:00'),schedule)


def test_breaks_are_not_working_time_and_closed_day_counts_zero():
    data=hours();data['4']=[{'start':'09:00','end':'12:00'},{'start':'14:00','end':'18:00'}];data['6']=[]
    schedule=WhatsAppSiteResponseSchedule(weekly_hours=data)
    assert working_seconds(stamp('2026-10-30T11:00'),stamp('2026-10-30T15:00'),schedule)==7200
    assert not is_working(stamp('2026-10-30T13:00'),schedule)
    assert working_seconds(stamp('2026-11-01T09:00'),stamp('2026-11-01T20:00'),schedule)==0


def test_api_saves_all_days_independently_and_preserves_other_court(auth_client):
    from core.tests.test_court_communications_access import restricted_client,FRANCO_ACADEMY
    a,b=make_site(),make_site();client=restricted_client(auth_client,a,FRANCO_ACADEMY)
    data=hours();data['0']=[{'start':'14:00','end':'18:00'},{'start':'09:00','end':'12:00'}]
    saved=client.patch(URL,{'weekly_hours':data},format='json')
    assert saved.status_code==200,saved.content
    assert saved.json()['weekly_hours']['0'][0]['start']=='09:00'
    assert client.get(URL).json()['weekly_hours']['5']==[{'start':'10:00','end':'14:00'}]
    assert client.get(URL).json()['weekly_hours']['6']==[{'start':'11:00','end':'13:00'}]
    assert client.patch(f'{URL}?site={b.id}',{'weekly_hours':data},format='json').status_code==403
    assert not WhatsAppSiteResponseSchedule.objects.filter(site=b).exists()
    assert client.patch(URL,{'days':[0],'starts_at':'09:00','ends_at':'20:00'},format='json').status_code==400
    assert client.get(URL).json()['weekly_hours']['5']==data['5']


@pytest.mark.parametrize('invalid',[
    [{'start':'10:00','end':'14:00'},{'start':'13:00','end':'18:00'}],
    [{'start':'20:00','end':'09:00'}],
    [{'start':'09:00','end':'25:00'}],
    [{'start':'9:00','end':'12:00'}],
    [{'start':'09:00','end':'12:00','site':99}],
    [{'start':True,'end':'12:00'}],
    [{'start':'09:00','end':'10:00'}]*5,
])
def test_invalid_intervals_do_not_overwrite_saved_hours(auth_client,invalid):
    c,_,_=auth_client();site=make_site();url=f'{URL}?site={site.id}'
    c.patch(url,{'weekly_hours':hours()},format='json')
    before=c.get(url).json();data=hours();data['5']=invalid
    assert c.patch(url,{'weekly_hours':data},format='json').status_code==400
    assert c.get(url).json()==before


def test_legacy_schedule_is_preserved_until_edited():
    schedule=WhatsAppSiteResponseSchedule(days=[4,5],starts_at=time(10),ends_at=time(17))
    assert schedule.weekly_hours is None
    assert weekly_hours(schedule)['5']==[{'start':'10:00','end':'17:00'}]
    assert weekly_hours(schedule)['6']==[]
