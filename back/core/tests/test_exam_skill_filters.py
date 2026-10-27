import json
from pathlib import Path
import pytest
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam
from core.tests.test_exam_export import book

pytestmark = pytest.mark.django_db


def test_skill_order_range_top_export_and_missing_breakdown(auth_client):
    c, _, _ = auth_client(role='collaborator', section_permissions=['veronica_only'])
    exam = create_exam(c)
    template = json.loads(Path(__file__).parents[1].joinpath('exam_template.json').read_text(encoding='utf-8'))
    questions = [dict(q, id=str(100 + int(q['id']))) for q in template['questions']]
    ids = []
    for i, (total, points) in enumerate([(10, 2), (4, 9), (6, 9), (8, None)]):
        a = attempt(exam, i, total)
        a.snapshot = {'duration_minutes':60, 'questions':questions}
        a.grading = {'score':total, 'questions':{q['id']:{'points':points} for q in questions} if points is not None else {}}
        a.save(); ids.append(a.id)
    unknown = attempt(exam, 9, 10)
    endpoint = f'/api/recruitment-exams/{exam["id"]}/'
    params = {'skill':'sales', 'ordering':'score_desc'}
    data = c.get(endpoint, params).json()
    assert data['count'] == 4
    assert [r['id'] for r in data['results']] == [ids[1], ids[2], ids[0], ids[3]]
    assert [r['skill_score'] for r in data['results']] == [9, 9, 2, None]
    assert data['filters']['skill_label'] == 'Ventas y marketing'
    assert c.get(endpoint, {**params, 'min_score':'8'}).json()['count'] == 2
    assert c.get(endpoint, {**params, 'max_score':'3'}).json()['results'][0]['id'] == ids[0]
    top = c.get(endpoint, {**params, 'top':'10'}).json()
    assert top['count'] == 2 and top['filters']['top_threshold'] == 9
    w = book(c.get('/api/recruitment-exams/export/', {**params, 'exam':exam['id'], 'top':'10'}))
    rows = list(w['Evaluaciones'].values)
    assert [r[0] for r in rows[1:]] == [ids[1], ids[2]]
    assert rows[1][11] == 4 and rows[1][15:] == ('Ventas y marketing', 9)
    assert w['Evaluaciones'].auto_filter.ref == 'A1:Q3'
    assert c.get(endpoint, {'skill':'invented'}).status_code == 400
    assert c.get('/api/recruitment-exams/export/', {'exam':exam['id'], 'skill':'invented'}).status_code == 400
    assert c.get(endpoint).json()['count'] == 5


def test_incomplete_invalid_and_unsubmitted_are_not_skill_zero():
    from core.exam_skills import attempt_skills
    template = json.loads(Path(__file__).parents[1].joinpath('exam_template.json').read_text(encoding='utf-8'))
    qs = [q for q in template['questions'] if q['id'] in ['5', '20']]
    for points in [None, True, float('nan'), 11, -1]:
        assert attempt_skills(qs, 'graded', {'5':{'points':0}, '20':{'points':points}})['sales'][0] is None
    assert attempt_skills(qs, 'pending', {'5':{'points':10}, '20':{'points':10}})['sales'][0] is None
    assert attempt_skills(qs, 'graded', {'5':{'points':0}, '20':{'points':0}})['sales'][0] == 0
