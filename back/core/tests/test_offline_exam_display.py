"""Date-only manual imports must not invent durations or resolve ambiguous marks."""
from datetime import datetime, timezone as dtz, timedelta
import pytest
from core.exam_models import RecruitmentExamAttempt
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam

pytestmark = pytest.mark.django_db

def offline(exam, index=1, review=False):
    a = attempt(exam, index, None if review else 8)
    anchor = datetime(2026,10,22,6,tzinfo=dtz.utc)
    snapshot = {**a.snapshot, 'offline_import': {'source':'pdf_manual',
        'completed_on':'2026-10-22', 'imported_at':'2026-10-23T01:00:00Z',
        'ambiguous_answers': {'1':['A','B']} if review else {}}}
    RecruitmentExamAttempt.objects.filter(pk=a.pk).update(started_at=anchor,submitted_at=anchor,
        snapshot=snapshot,grading_status='review' if review else 'graded',
        grading={'review':True,'error':'PDF con dos opciones; requiere revisión.'} if review else {'score':8})
    a.refresh_from_db()
    return a

def test_private_result_hides_date_only_time_anchors(auth_client):
    c,_,_=auth_client(role='collaborator',section_permissions=['veronica_only'])
    e=create_exam(c);a=offline(e,review=True)
    before=(a.snapshot,a.answers,a.grading,a.started_at,a.submitted_at)
    response=c.get(f'/api/recruitment-exams/{e["id"]}/')
    assert response.status_code==200
    row=response.json()['results'][0]
    assert row['started_at'] is None and row['elapsed_seconds'] is None and row['deadline_at'] is None
    assert row['timed_out'] is False and row['over_time'] is False
    assert row['submitted_at'] and row['offline_import']['completed_on']=='2026-10-22'
    assert row['offline_import']['ambiguous_answers']=={'1':['A','B']}
    assert row['grading_status']=='review' and 'score' not in row['grading']
    a.refresh_from_db();assert before==(a.snapshot,a.answers,a.grading,a.started_at,a.submitted_at)

def test_batch_grading_never_grades_ambiguous_import(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=offline(e,review=True)
    response=c.post(f'/api/recruitment-exams/{e["id"]}/grade/',{},format='json')
    assert response.status_code==200 and response.json()['processed'] is False
    a.refresh_from_db();assert a.grading_status=='review' and 'score' not in a.grading

def test_statistics_count_offline_dates_but_exclude_unknown_durations(auth_client,monkeypatch):
    monkeypatch.setattr('core.api.exam_statistics.timezone.now',lambda:datetime(2026,10,23,8,tzinfo=dtz.utc))
    c,_,_=auth_client();e=create_exam(c)
    offline(e,1);offline(e,2,review=True)
    normal=attempt(e,3,9)
    end=datetime(2026,10,22,14,tzinfo=dtz.utc)
    RecruitmentExamAttempt.objects.filter(pk=normal.pk).update(started_at=end-timedelta(minutes=30),submitted_at=end)
    data=c.get('/api/recruitment-exams/statistics/?since=2026-10-22&until=2026-10-22').json()
    assert data['summary']['delivered']==3 and data['summary']['imported_offline']==2
    assert data['summary']['started']==1 and data['summary']['average_seconds']==1800
    assert data['summary']['graded']==2 and data['summary']['pending_grading']==1
    assert data['summary']['grading_errors']==0 and data['daily']==[{'day':'2026-10-22','total':3}]
    RecruitmentExamAttempt.objects.filter(pk=normal.pk).delete()
    data=c.get('/api/recruitment-exams/statistics/?since=2026-10-22&until=2026-10-22').json()
    assert data['summary']['average_seconds'] is None and data['summary']['started']==0
