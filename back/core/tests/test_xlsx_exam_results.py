"""External totals are not fabricated online answers or delivery dates."""
from datetime import datetime, timezone as dtz
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam
from core.tests.test_exam_export import book
from core.exam_models import RecruitmentExamAttempt
import pytest

pytestmark=pytest.mark.django_db

def test_totals_only_display_export_statistics_and_no_regrading(auth_client,monkeypatch):
    monkeypatch.setattr('core.api.exam_statistics.timezone.now',lambda:datetime(2026,10,23,18,tzinfo=dtz.utc))
    c,_,_=auth_client(role='collaborator',section_permissions=['veronica_only']);e=create_exam(c)
    a=attempt(e,1,8.5)
    snapshot={'title':e['title'],'duration_minutes':60,'questions':[], 'offline_import':{
        'source':'xlsx_results','completed_on':None,'imported_at':'2026-10-23T18:00:00Z',
        'correct_count':34,'question_count':40,'answers_available':False}}
    RecruitmentExamAttempt.objects.filter(pk=a.pk).update(snapshot=snapshot,email='',phone='',answers={},grading_key={},
        grading={'score':8.5,'scale':10,'review':False},started_at=datetime(2026,10,23,18,tzinfo=dtz.utc),submitted_at=datetime(2026,10,23,18,tzinfo=dtz.utc))
    before=list(RecruitmentExamAttempt.objects.values())
    data=c.get(f'/api/recruitment-exams/{e["id"]}/').json()['results'][0]
    assert data['submitted'] is True and data['submitted_at'] is None and data['started_at'] is None
    assert data['elapsed_seconds'] is None and not data['over_time']
    assert data['offline_import']['correct_count']==34 and data['snapshot']['questions']==[]
    w=book(c.get('/api/recruitment-exams/export/'))
    sheet=w['Evaluaciones']
    assert sheet['L2'].value==8.5 and sheet['O2'].value=='Carga de Excel'
    assert all(sheet[f'{col}2'].value is None for col in 'DEFGHIJ')
    assert '34 aciertos de 40' in sheet['N2'].value and w['Respuestas'].max_row==1
    stats=c.get('/api/recruitment-exams/statistics/').json()
    assert stats['summary']['imported_without_date']==1 and stats['summary']['delivered']==0
    assert stats['summary']['started']==0 and stats['summary']['average_seconds'] is None
    assert stats['averages']['received']['total']==0
    assert c.get('/api/recruitment-profiles/').status_code==200
    assert c.post(f'/api/recruitment-exams/{e["id"]}/grade/',{},format='json').json()['processed'] is False
    assert before==list(RecruitmentExamAttempt.objects.values())
