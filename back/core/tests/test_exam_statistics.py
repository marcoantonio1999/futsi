from datetime import datetime,timezone as dtz
import json
import re
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from core.exam_models import RecruitmentExam,RecruitmentExamAttempt
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam

pytestmark=pytest.mark.django_db
URL='/api/recruitment-exams/statistics/'


@pytest.fixture(autouse=True)
def frozen(monkeypatch):
    monkeypatch.setattr('core.api.exam_statistics.timezone.now',lambda:datetime(2026,10,23,8,tzinfo=dtz.utc))


def test_delivery_dates_timezone_scores_and_read_only(auth_client):
    c,_,_=auth_client(role='collaborator',section_permissions=['veronica_only']);e=create_exam(c)
    for index,(submitted,score,status) in enumerate([
        ('2026-10-22T06:20:00+00:00',0,'graded'),('2026-10-23T05:59:00+00:00',10,'graded'),
        ('2026-10-22T08:00:00+00:00',None,'pending'),('2026-10-22T09:00:00+00:00',None,'error'),
        ('2026-10-22T05:59:59+00:00',8,'graded'),('2026-10-23T06:00:00+00:00',8,'graded')]):
        a=attempt(e,index,score);timestamp=datetime.fromisoformat(submitted)
        from datetime import timedelta
        RecruitmentExamAttempt.objects.filter(pk=a.pk).update(submitted_at=timestamp,started_at=timestamp-timedelta(minutes=15),grading_status=status)
    unfinished=attempt(e,90,None,False)
    RecruitmentExamAttempt.objects.filter(pk=unfinished.pk).update(started_at=datetime(2026,10,22,7,tzinfo=dtz.utc))
    with CaptureQueriesContext(connection) as queries:
        response=c.get(URL+'?since=2026-10-22&until=2026-10-22')
    assert response.status_code==200,response.content
    data=response.json();s=data['summary']
    assert (s['delivered'],s['graded'],s['pending_grading'],s['grading_errors'])==(4,2,1,1)
    assert s['average_score']==5 and s['lowest_score']==0 and s['highest_score']==10
    assert s['average_seconds']==900
    assert data['averages']['received']==dict(total=4,daily=4,weekly=28,monthly=120)
    assert data['daily']==[dict(day='2026-10-22',total=4)]
    assert [r['total'] for r in data['distribution']]==[1,0,0,0,1]
    assert data['per_exam'][0]['average_score']==5
    unfinished.refresh_from_db();assert unfinished.submitted_at is None and unfinished.grading=={}
    assert len(queries)<15
    sql=' '.join(q['sql'].lower() for q in queries)
    assert 'update ' not in sql and 'insert ' not in sql and 'delete ' not in sql
    assert '"answers"' not in sql and '"cv_text"' not in sql
    # JSON predicates identify offline imports, but never select whole snapshots.
    assert not re.search(r'(select |, )"recruitment_exam_attempts"\."snapshot"(?=,| from)',sql)
    assert 'access_token' not in json.dumps(data) and 'email' not in json.dumps(data)


def test_zero_days_included_and_exam_scope(auth_client):
    c,_,_=auth_client();e=create_exam(c);other=create_exam(c)
    a=attempt(e);RecruitmentExamAttempt.objects.filter(pk=a.pk).update(submitted_at=datetime(2026,10,22,12,tzinfo=dtz.utc))
    b=attempt(other);RecruitmentExamAttempt.objects.filter(pk=b.pk).update(submitted_at=datetime(2026,10,22,12,tzinfo=dtz.utc))
    data=c.get(URL+f'?since=2026-10-16&until=2026-10-22&exam={e["id"]}').json()
    assert data['days']==7 and data['summary']['delivered']==1
    assert data['averages']['received']['weekly']==1 and len(data['daily'])==7
    assert [r['total'] for r in data['daily']]==[0,0,0,0,0,0,1]
    assert len(data['per_exam'])==1


def test_no_data_null_score_and_vero_creator_not_admin(auth_client):
    vero,_,_=auth_client(role='collaborator',section_permissions=['veronica_only']);e=create_exam(vero)
    admin,_,_=auth_client();create_exam(admin)
    data=admin.get(URL).json()
    assert data['summary']['delivered']==0 and data['summary']['average_score'] is None
    assert data['summary']['average_seconds'] is None and data['per_exam']==[]
    assert data['averages']['created_by_vero']['total']==1 and data['summary']['exams_created']==2
    a=attempt(e);RecruitmentExamAttempt.objects.filter(pk=a.pk).update(grading={'score':None})
    data=admin.get(URL).json()
    assert data['summary']['graded']==0 and data['summary']['invalid_grades']==1


@pytest.mark.parametrize('query',['since=oops','since=2026-10-23&until=2026-10-22','until=2026-10-24','since=2024-01-01','exam=abc','exam=-1','exam=999999'])
def test_invalid_filters(auth_client,query):
    c,_,_=auth_client();assert c.get(URL+'?'+query).status_code==400


@pytest.mark.parametrize('role,permissions',[('collaborator',[]),('admin',['court_communications_only']),('admin',['player_enrollments_only']),('coach',[])])
def test_private_permissions(auth_client,role,permissions):
    c,_,_=auth_client(role=role,section_permissions=permissions);assert c.get(URL).status_code==403


def test_public_and_post_rejected(auth_client):
    assert APIClient().get(URL).status_code in (401,403)
    c,_,_=auth_client(role='collaborator',section_permissions=['veronica_only'])
    assert c.post(URL,{},format='json').status_code in (403,405)


def test_skill_breakdown_uses_snapshot_points_not_overall_score(auth_client):
    from pathlib import Path
    from core.exam_skills import SKILLS
    template=json.loads((Path(__file__).parents[1]/'exam_template.json').read_text(encoding='utf-8'))
    assert sorted(n for _,ids in SKILLS.values() for n in ids)==list(range(1,41))
    c,_,_=auth_client();e=create_exam(c)
    math_ids={str(n) for n in SKILLS['mathematics'][1]}
    for index in range(2):
        a=attempt(e,index,9)
        grades={q['id']:{'points':(10 if index else 0) if q['id'] in math_ids else 8} for q in template['questions']}
        RecruitmentExamAttempt.objects.filter(pk=a.pk).update(snapshot={'questions':template['questions']},grading={'score':9,'questions':grades})
    # Total-only import and pending result have known questions, no area score.
    for index in range(2,4):
        a=attempt(e,index,9 if index==2 else None)
        RecruitmentExamAttempt.objects.filter(pk=a.pk).update(snapshot={'questions':template['questions']})
    # Same IDs/title are insufficient when the question itself is different.
    a=attempt(e,4,10)
    RecruitmentExamAttempt.objects.filter(pk=a.pk).update(snapshot={'questions':[dict(template['questions'][1],prompt='Otra pregunta')]})
    data=c.get(URL+f'?exam={e["id"]}').json()
    skills={s['id']:s for s in data['skills']['results']}
    math=skills['mathematics']
    assert (math['delivered'],math['graded'],math['without_breakdown'])==(4,2,2)
    assert (math['average_score'],math['lowest_score'],math['highest_score'])==(5,0,10)
    assert math['question_count']==14 and math['per_exam'][0]['average_score']==5
    assert skills['sales']['average_score']==8
    assert data['skills']['unclassified']==1
    assert data['summary']['average_score']==9.25


@pytest.mark.parametrize('bad',[None,True,'10',-1,11])
def test_incomplete_or_invalid_area_never_becomes_zero(auth_client,bad):
    from pathlib import Path
    template=json.loads((Path(__file__).parents[1]/'exam_template.json').read_text(encoding='utf-8'))
    c,_,_=auth_client();e=create_exam(c);a=attempt(e)
    # IDs may change: match the actual question, then read its saved ID's points.
    q=dict(template['questions'][1],id='renumbered')
    RecruitmentExamAttempt.objects.filter(pk=a.pk).update(snapshot={'questions':[q]},grading={'score':8,'questions':{'renumbered':{'points':bad}}})
    skill=c.get(URL).json()['skills']['results'][0]
    assert skill['average_score'] is None and skill['without_breakdown']==1
    RecruitmentExamAttempt.objects.filter(pk=a.pk).update(grading={'score':8,'questions':{'renumbered':{'points':6}}})
    assert c.get(URL).json()['skills']['results'][0]['average_score']==6


def test_skill_breakdown_respects_date_and_exam_filters(auth_client):
    from pathlib import Path
    template=json.loads((Path(__file__).parents[1]/'exam_template.json').read_text(encoding='utf-8'))
    c,_,_=auth_client();e=create_exam(c);other=create_exam(c)
    for index,(exam,when) in enumerate([(e,'2026-10-22'),(e,'2026-10-20'),(other,'2026-10-22')]):
        a=attempt(exam,index)
        RecruitmentExamAttempt.objects.filter(pk=a.pk).update(submitted_at=datetime.fromisoformat(when+'T12:00:00+00:00'),snapshot={'questions':template['questions']},grading={'score':8,'questions':{q['id']:{'points':8} for q in template['questions']}})
    data=c.get(URL+f'?exam={e["id"]}&since=2026-10-22&until=2026-10-22').json()
    assert all(s['graded']==1 and s['average_score']==8 for s in data['skills']['results'])
