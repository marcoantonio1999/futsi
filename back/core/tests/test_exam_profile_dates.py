from datetime import datetime, timezone as dtz

import pytest
from rest_framework.test import APIClient

from core.exam_models import RecruitmentExamAttempt
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam

pytestmark = pytest.mark.django_db


def dated(exam, index, utc, source=None, completed=None, score=8):
    row = attempt(exam, index, score)
    snapshot = row.snapshot.copy()
    if source:
        snapshot['offline_import'] = {'source': source, 'completed_on': completed}
    RecruitmentExamAttempt.objects.filter(pk=row.pk).update(submitted_at=datetime.fromisoformat(utc), snapshot=snapshot)
    row.refresh_from_db()
    return row


def test_profile_dates_are_inclusive_cdmx_and_do_not_invent_offline_dates(auth_client):
    c, _, _ = auth_client(role='collaborator', section_permissions=['veronica_only'])
    exam = create_exam(c)
    before = dated(exam, 1, '2026-11-04T05:59:59+00:00')  # 3 Nov 23:59:59 CDMX
    first = dated(exam, 2, '2026-11-04T06:00:00+00:00')   # 4 Nov 00:00 CDMX
    last = dated(exam, 3, '2026-11-05T05:59:59+00:00')    # 4 Nov 23:59:59 CDMX
    after = dated(exam, 4, '2026-11-05T06:00:00+00:00')   # 5 Nov 00:00 CDMX
    pdf = dated(exam, 5, '2026-11-08T12:00:00+00:00', 'pdf_manual', '2026-11-04')
    unknown = dated(exam, 6, '2026-11-04T12:00:00+00:00', 'xlsx_results', None)
    missing = dated(exam, 7, '2026-11-04T12:00:00+00:00', 'pdf_manual', None)
    before_db = list(RecruitmentExamAttempt.objects.order_by('id').values('id', 'submitted_at', 'snapshot', 'grading'))
    endpoint = '/api/recruitment-profiles/'
    response = c.get(endpoint, {'date_from': '2026-11-04', 'date_to': '2026-11-04'})
    assert response.status_code == 200, response.content
    data = response.json()
    assert {r['id'] for r in data['results']} == {first.id, last.id, pdf.id}
    assert all(r['exam_date'] == '2026-11-04' for r in data['results'])
    assert {r['id'] for r in c.get(endpoint, {'date_to': '2026-11-03'}).json()['results']} == {before.id}
    assert {r['id'] for r in c.get(endpoint, {'date_from': '2026-11-05'}).json()['results']} == {after.id}
    assert c.get(endpoint, {'date_from': '2026-11-04', 'date_to': '2026-11-04', 'q': 'Persona Ficticia 5'}).json()['count'] == 1
    all_rows = {r['id']: r for r in c.get(endpoint).json()['results']}
    assert all_rows[before.id]['exam_date'] == '2026-11-03'
    assert all_rows[pdf.id]['exam_date'] == '2026-11-04'
    assert all_rows[unknown.id]['exam_date'] is None and all_rows[missing.id]['exam_date'] is None
    assert c.get(f'{endpoint}{pdf.id}/').json()['exam_date'] == '2026-11-04'
    assert before_db == list(RecruitmentExamAttempt.objects.order_by('id').values('id', 'submitted_at', 'snapshot', 'grading'))


@pytest.mark.parametrize('params', [
    {'date_from': '2026-02-30'}, {'date_to': '2026-13-01'}, {'date_from': '20261104'},
    {'date_from': '2026-11-05', 'date_to': '2026-11-04'},
])
def test_invalid_profile_dates_are_rejected(auth_client, params):
    c, _, _ = auth_client()
    assert c.get('/api/recruitment-profiles/', params).status_code == 400
    assert APIClient().get('/api/recruitment-profiles/', params).status_code in (401, 403)


def test_profile_dates_combine_with_exam_and_existing_top_ten_semantics(auth_client):
    c, _, _ = auth_client(); exam = create_exam(c); other = create_exam(c)
    high = dated(exam, 1, '2026-11-03T18:00:00+00:00', score=10)
    dated(exam, 2, '2026-11-04T18:00:00+00:00', score=9)
    other_row = dated(other, 3, '2026-11-03T18:00:00+00:00', score=10)
    result = c.get('/api/recruitment-profiles/', {'exam': exam['id'], 'top': '10', 'date_from': '2026-11-03', 'date_to': '2026-11-03'}).json()
    assert [r['id'] for r in result['results']] == [high.id]
    assert result['filters']['graded_count'] == 2
    assert other_row.id not in [r['id'] for r in result['results']]
    assert c.get('/api/recruitment-profiles/', {'exam': exam['id'], 'top': '10', 'date_from': '2026-11-04', 'date_to': '2026-11-04'}).json()['count'] == 0
