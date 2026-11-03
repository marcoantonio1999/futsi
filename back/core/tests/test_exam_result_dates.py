import pytest

from core.tests.test_exam_export import book
from core.tests.test_exam_profile_dates import dated
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam

pytestmark = pytest.mark.django_db


def ids(response):
    assert response.status_code == 200, response.content
    return [item['id'] for item in response.json()['results']]


def export_ids(response):
    return [row[0] for row in list(book(response)['Evaluaciones'].values)[1:]]


def test_evaluation_dates_match_mexico_city_and_imported_exam_dates(auth_client):
    client, _, _ = auth_client(role='collaborator', section_permissions=['veronica_only'])
    exam = create_exam(client)
    before = dated(exam, 1, '2026-11-04T05:59:59+00:00')
    first = dated(exam, 2, '2026-11-04T06:00:00+00:00')
    last = dated(exam, 3, '2026-11-05T05:59:59+00:00', score=6)
    after = dated(exam, 4, '2026-11-05T06:00:00+00:00')
    pdf = dated(exam, 5, '2026-11-08T12:00:00+00:00', 'pdf_manual', '2026-11-04')
    unknown = dated(exam, 6, '2026-11-04T12:00:00+00:00', 'xlsx_results', None)
    ongoing = attempt(exam, 7, None, submitted=False)
    endpoint = f'/api/recruitment-exams/{exam["id"]}/'
    export = '/api/recruitment-exams/export/'
    dates = {'date_from': '2026-11-04', 'date_to': '2026-11-04'}

    result = ids(client.get(endpoint, dates))
    assert set(result) == {first.id, last.id, pdf.id}
    assert export_ids(client.get(export, {'exam': exam['id'], **dates})) == result
    assert set(ids(client.get(endpoint, {'date_to': '2026-11-03'}))) == {before.id}
    assert set(ids(client.get(endpoint, {'date_from': '2026-11-05'}))) == {after.id}
    assert set(ids(client.get(endpoint, {**dates, 'min_score': '7'}))) == {first.id, pdf.id}
    assert ids(client.get(endpoint, {**dates, 'q': 'Persona Ficticia 5'})) == [pdf.id]
    assert set(ids(client.get(endpoint))) == {before.id, first.id, last.id, after.id, pdf.id, unknown.id, ongoing.id}
    assert ids(client.get(endpoint, {**dates, 'status': 'unsubmitted'})) == []


def test_date_filter_export_covers_all_pages_and_preserves_top_ten_cohort(auth_client):
    client, _, _ = auth_client()
    exam = create_exam(client)
    high = dated(exam, 1, '2026-11-03T18:00:00+00:00', score=10)
    for index in range(2, 58):
        dated(exam, index, '2026-11-04T18:00:00+00:00', score=8)
    endpoint = f'/api/recruitment-exams/{exam["id"]}/'
    export = '/api/recruitment-exams/export/'
    dates = {'date_from': '2026-11-04', 'date_to': '2026-11-04', 'ordering': 'name'}
    first = client.get(endpoint, {**dates, 'page': 1})
    second = client.get(endpoint, {**dates, 'page': 2})
    assert first.json()['count'] == 56
    assert len(ids(first)) == 50 and len(ids(second)) == 6
    assert export_ids(client.get(export, {'exam': exam['id'], **dates})) == ids(first) + ids(second)
    assert high.id not in ids(first) + ids(second)
    # Ranking is calculated before date filtering, as in the existing profiles filters.
    ranked = client.get(endpoint, {**dates, 'top': '10'}).json()
    assert ranked['filters']['graded_count'] == 57
    assert ranked['filters']['top_threshold'] == 8
    assert ranked['count'] == 56


@pytest.mark.parametrize('dates', [
    {'date_from': '2026-02-30'}, {'date_to': '2026-13-01'},
    {'date_from': '20261104'}, {'date_from': '2026-11-05', 'date_to': '2026-11-04'},
])
def test_invalid_evaluation_and_export_dates_are_rejected(auth_client, dates):
    client, _, _ = auth_client()
    exam = create_exam(client)
    assert client.get(f'/api/recruitment-exams/{exam["id"]}/', dates).status_code == 400
    assert client.get('/api/recruitment-exams/export/', {'exam': exam['id'], **dates}).status_code == 400
