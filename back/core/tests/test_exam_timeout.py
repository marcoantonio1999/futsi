from datetime import timedelta
from unittest.mock import patch
import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import RecruitmentExam, RecruitmentExamAttempt
from core.tests.test_recruitment_exams import create_exam, start

pytestmark = pytest.mark.django_db


def setup_attempt(auth_client, choice_only=True):
    admin,_,_=auth_client()
    questions=[{'kind':'choice','prompt':'Primera','options':['Sí','No']},
               {'kind':'choice','prompt':'Segunda','options':['Sí','No']}] if choice_only else None
    e=create_exam(admin,questions)
    RecruitmentExam.objects.filter(pk=e['id']).update(duration_minutes=60)
    a=start(e).json()
    c=APIClient(); c.credentials(HTTP_AUTHORIZATION='Exam '+a['access_token'])
    return admin,e,c,a


def expire():
    RecruitmentExamAttempt.objects.update(started_at=timezone.now()-timedelta(minutes=61))


def test_draft_is_saved_without_submitting_or_grading(auth_client):
    _,_,c,_=setup_attempt(auth_client)
    r=c.post('/api/public-exams/attempt/',{'action':'draft','answers':{'1':0}},format='json')
    assert r.status_code==200 and r.json()['answers']=={'1':0} and not r.json()['submitted_at']
    row=RecruitmentExamAttempt.objects.get()
    assert row.grading_status=='pending' and row.answers=={'1':0}


def test_sixty_minute_expiry_uses_saved_answers_and_rejects_late_changes(auth_client):
    _,_,c,_=setup_attempt(auth_client)
    c.post('/api/public-exams/attempt/',{'action':'draft','answers':{'1':0}},format='json')
    expire()
    r=c.post('/api/public-exams/attempt/',{'answers':{'1':1,'2':0}},format='json')
    assert r.status_code==200 and r.json()['timed_out'] and r.json()['submitted_at']
    assert r.json()['elapsed_seconds']==3600 and r.json()['answers']=={'1':0}
    row=RecruitmentExamAttempt.objects.get()
    assert row.grading_status=='graded' and row.grading['score']==5
    assert row.grading['questions']['2']['reason']=='Sin respuesta'
    assert c.get('/api/public-exams/attempt/').json()==r.json()
    assert c.post('/api/public-exams/attempt/',{'action':'draft','answers':{'2':0}},format='json').json()==r.json()


def test_boundary_uses_server_time_not_browser_duration(auth_client):
    _,_,c,_=setup_attempt(auth_client)
    row=RecruitmentExamAttempt.objects.get()
    deadline=row.started_at+timedelta(minutes=60)
    with patch('core.exam_timing.timezone.now',return_value=deadline-timedelta(microseconds=1)):
        r=c.post('/api/public-exams/attempt/',{'action':'draft','answers':{'1':0},'duration_minutes':99999},format='json')
        assert not r.json()['submitted_at']
    with patch('core.exam_timing.timezone.now',return_value=deadline):
        r=c.post('/api/public-exams/attempt/',{'action':'draft','answers':{'1':1}},format='json')
        assert r.json()['timed_out'] and r.json()['answers']=={'1':0}


def test_empty_expired_exam_closes_with_zero_without_inventing_answers(auth_client):
    _,_,c,_=setup_attempt(auth_client)
    expire()
    r=c.get('/api/public-exams/attempt/')
    assert r.json()['timed_out'] and r.json()['answers']=={}
    assert RecruitmentExamAttempt.objects.get().grading['score']==0


def test_admin_results_materialize_disconnected_expired_attempt(auth_client):
    admin,e,_,_=setup_attempt(auth_client)
    expire()
    r=admin.get(f'/api/recruitment-exams/{e["id"]}/')
    assert r.json()['results'][0]['timed_out'] and r.json()['results'][0]['grading_status']=='graded'


def test_unanswered_open_question_is_zero_without_calling_ai(auth_client):
    admin,e,c,_=setup_attempt(auth_client,False)
    c.post('/api/public-exams/attempt/',{'action':'draft','answers':{'1':0,'2':''}},format='json')
    expire(); c.get('/api/public-exams/attempt/')
    with patch('core.api.exams.grade_open') as ai:
        r=admin.post(f'/api/recruitment-exams/{e["id"]}/grade/',{},format='json')
    assert r.json()['status']=='graded' and not ai.called
    assert RecruitmentExamAttempt.objects.get().grading['score']==5


@pytest.mark.parametrize('answers',[{'3':0},{'1':True},{'1':7},{'1':-1}])
def test_invalid_drafts_do_not_change_saved_answers(auth_client,answers):
    _,_,c,_=setup_attempt(auth_client)
    assert c.post('/api/public-exams/attempt/',{'action':'draft','answers':answers},format='json').status_code==400
    assert RecruitmentExamAttempt.objects.get().answers=={}
