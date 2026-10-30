from datetime import timedelta

import pytest
from django.utils import timezone

from core.exam_models import RecruitmentExamAttempt
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam
from core.tests.test_exam_export import book

pytestmark = pytest.mark.django_db


def timed(exam, index, seconds, source=None):
    row = attempt(exam, index)
    start = timezone.now() - timedelta(hours=2)
    snapshot = {'duration_minutes': 60, 'questions': []}
    if source:
        snapshot['offline_import'] = {'source': source, 'completed_on': '2026-10-20'}
    RecruitmentExamAttempt.objects.filter(pk=row.pk).update(
        started_at=start, submitted_at=start + timedelta(seconds=seconds), snapshot=snapshot,
    )
    return row


def test_minutes_boundaries_export_pagination_and_unknown_times(auth_client):
    client, _, _ = auth_client()
    exam = create_exam(client)
    timed(exam, 1, 599)
    first = timed(exam, 2, 600)
    last = timed(exam, 3, 1200)
    timed(exam, 4, 1201)
    timed(exam, 5, 900, 'pdf_manual')
    timed(exam, 6, 900, 'xlsx_results')
    attempt(exam, 7, submitted=False)
    params = {'min_minutes': '10', 'max_minutes': '20', 'ordering': 'score_desc'}
    response = client.get(f'/api/recruitment-exams/{exam["id"]}/', params)
    assert response.status_code == 200, response.content
    assert [row['id'] for row in response.json()['results']] == [first.pk, last.pk]
    workbook = book(client.get('/api/recruitment-exams/export/', {'exam': exam['id'], **params}))
    assert [row[0] for row in list(workbook['Evaluaciones'].values)[1:]] == [first.pk, last.pk]


def test_fractional_minutes_and_single_bound(auth_client):
    client, _, _ = auth_client()
    exam = create_exam(client)
    short = timed(exam, 1, 90)
    timed(exam, 2, 91)
    data = client.get(f'/api/recruitment-exams/{exam["id"]}/', {'max_minutes': '1.5'}).json()
    assert [row['id'] for row in data['results']] == [short.pk]
    assert client.get(f'/api/recruitment-exams/{exam["id"]}/', {'min_minutes': '0'}).json()['count'] == 2


@pytest.mark.parametrize('params', [
    {'min_minutes': '-1'}, {'max_minutes': 'NaN'}, {'min_minutes': 'inf'},
    {'max_minutes': 'abc'}, {'min_minutes': '30', 'max_minutes': '10'},
    {'max_minutes': '9999999999999999999999999'},
])
def test_invalid_duration_rejected_by_list_and_export(auth_client, params):
    client, _, _ = auth_client()
    exam = create_exam(client)
    assert client.get(f'/api/recruitment-exams/{exam["id"]}/', params).status_code == 400
    assert client.get('/api/recruitment-exams/export/', {'exam': exam['id'], **params}).status_code == 400
