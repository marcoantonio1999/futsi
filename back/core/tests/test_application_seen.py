import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from core.exam_models import RecruitmentApplication, RecruitmentProfile
from core.tests.test_employment_forms import payload,submit
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam

pytestmark=pytest.mark.django_db
BASE='/api/recruitment-applications/'


def test_seen_explicit_persistent_reversible_and_idempotent(auth_client):
    c,_,user=auth_client(role='collaborator',section_permissions=['veronica_only'])
    assert submit().status_code==201
    row=RecruitmentApplication.objects.get();url=BASE+f'{row.pk}/'
    original={key:getattr(row,key) for key in ['fields','search_text','position','submitted_at','link_status','attempt_id','exam_id']}
    for data in [c.get(BASE).json()['results'][0],c.get(url).json()]:
        assert data['seen'] is False and data['seen_at'] is None and data['seen_by'] is None
    row.refresh_from_db();assert row.seen_at is None  # Opening detail never marks automatically.
    result=c.post(url,{'seen':True},format='json');assert result.status_code==200,result.content
    assert result.json()['seen'] and result.json()['seen_by']==user.username
    stamp=result.json()['seen_at'];assert stamp
    other,_,_=auth_client()
    assert other.post(url,{'seen':True},format='json').json()['seen_at']==stamp
    row.refresh_from_db();assert row.seen_by_id==user.pk
    assert {key:getattr(row,key) for key in original}==original
    assert c.get(BASE+'?seen=yes').json()['count']==1
    assert c.get(BASE+'?seen=no').json()['count']==0
    assert c.get(url).json()['seen_at']==stamp
    assert c.post(url,{'seen':False},format='json').status_code==200
    row.refresh_from_db();assert row.seen_at is None and row.seen_by_id is None
    assert c.get(BASE+'?seen=no').json()['count']==1
    assert c.get(BASE+'?seen=yes').json()['count']==0
    assert not RecruitmentProfile.objects.exists()


def test_marking_preserves_exam_grade_cv_and_form_link(auth_client):
    c,_,u=auth_client();e=create_exam(c);a=attempt(e)
    profile=RecruitmentProfile.objects.create(attempt=a,updated_by=u,cv_text='CV previo',form_text='Formato previo')
    submit(payload());row=RecruitmentApplication.objects.get()
    assert row.attempt_id==a.pk
    original=a.answers.copy(),a.grading.copy(),profile.cv_text,profile.form_text,row.fields.copy()
    assert c.post(BASE+f'{row.pk}/',{'seen':True},format='json').status_code==200
    a.refresh_from_db();profile.refresh_from_db();row.refresh_from_db()
    assert (a.answers,a.grading,profile.cv_text,profile.form_text,row.fields)==original
    assert row.attempt_id==a.pk and row.link_status=='linked'


@pytest.mark.parametrize('body',[{'seen':'true'},{'seen':1},{'seen':None},{'seen':True,'attempt_id':1},{'seen':True,'seen_by':1},{'seen':True,'fields':{}},{'seen':True,'seen_at':'2026-01-01'}])
def test_invalid_or_mixed_writes_rejected(auth_client,body):
    c,_,_=auth_client();submit();row=RecruitmentApplication.objects.get()
    assert c.post(BASE+f'{row.pk}/',body,format='json').status_code==400
    row.refresh_from_db();assert row.seen_at is None and row.seen_by_id is None


@pytest.mark.parametrize('role,permissions',[('collaborator',[]),('admin',['court_communications_only']),('admin',['player_enrollments_only']),('coach',[])])
def test_seen_private_permissions(auth_client,role,permissions):
    submit();row=RecruitmentApplication.objects.get()
    c,_,_=auth_client(role=role,section_permissions=permissions)
    assert c.post(BASE+f'{row.pk}/',{'seen':True},format='json').status_code==403
    row.refresh_from_db();assert row.seen_at is None


def test_public_cannot_set_seen_and_list_has_no_n_plus_one(auth_client):
    submit();row=RecruitmentApplication.objects.get()
    assert APIClient().post(BASE+f'{row.pk}/',{'seen':True},format='json').status_code in (401,403)
    data=payload();data['seen']=True;assert submit(data).status_code==400
    c,_,u=auth_client()
    for _ in range(12):submit(payload())
    RecruitmentApplication.objects.update(seen_by=u,seen_at=row.submitted_at)
    with CaptureQueriesContext(connection) as queries:result=c.get(BASE)
    assert result.status_code==200 and len(result.json()['results'])==13
    assert all(r['seen'] and r['seen_by']==u.username for r in result.json()['results'])
    assert len(queries)<=5
    assert c.get(BASE+'?seen=invalid').status_code==400
    assert c.post(BASE+'999999/',{'seen':True},format='json').status_code==404
