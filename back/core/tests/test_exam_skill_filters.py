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
    assert rows[1][11] == 4 and rows[1][21:] == ('Ventas y marketing', 9)
    assert w['Evaluaciones'].auto_filter.ref == 'A1:W3'
    assert rows[1][15:21] == (9,) * 6
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


@pytest.mark.parametrize('scope', ['global', 'exam'])
def test_export_always_includes_all_skills_without_filter(auth_client, scope):
    from core.exam_skills import SKILLS
    c, _, _ = auth_client()
    exam = create_exam(c)
    questions = json.loads(Path(__file__).parents[1].joinpath('exam_template.json').read_text(encoding='utf-8'))['questions']
    a = attempt(exam, 1, 7)
    a.snapshot = {'duration_minutes':60, 'questions':questions}
    grades = {str(qid):{'points':index} for index, (_, ids) in enumerate(SKILLS.values()) for qid in ids}
    a.grading = {'score':7, 'questions':grades}; a.save()
    total_only = attempt(exam, 2, 8)
    partial = attempt(exam, 3, 8)
    partial.snapshot = a.snapshot
    partial.grading = {'score':8, 'questions':{k:v for k,v in grades.items() if k != '5'}}; partial.save()
    pending = attempt(exam, 4, None)
    pending.snapshot = a.snapshot; pending.save()
    unfinished = attempt(exam, 5, 10, submitted=False)
    unfinished.snapshot = a.snapshot; unfinished.grading = a.grading; unfinished.save()
    params = {'exam':exam['id']} if scope == 'exam' else {}
    w = book(c.get('/api/recruitment-exams/export/', params))
    rows = list(w['Evaluaciones'].values)
    assert rows[0][15:] == tuple(f'{label} / 10' for label, _ in SKILLS.values())
    by_id = {row[0]: row for row in rows[1:]}
    assert by_id[a.id][11] == 7
    assert by_id[a.id][15:] == (0,1,2,3,4,5)
    assert by_id[total_only.id][15:] == (None,) * 6
    assert by_id[partial.id][15:] == (0,None,2,3,4,5)
    assert by_id[pending.id][15:] == (None,) * 6
    if scope == 'exam':
        assert by_id[unfinished.id][15:] == (None,) * 6
    else:
        assert unfinished.id not in by_id


@pytest.mark.parametrize('invalid', ['not-json', '[]', '{"unknown":{}}', '{"sales":{"min":8,"max":3}}', '{"sales":{"min":true}}', '{"sales":{"min":"nan"}}', '{"sales":{"max":11}}'])
def test_invalid_multi_skill_ranges(auth_client, invalid):
    c, _, _ = auth_client(); exam = create_exam(c)
    params = {'skill_ranges':invalid}
    assert c.get(f'/api/recruitment-exams/{exam["id"]}/', params).status_code == 400
    assert c.get('/api/recruitment-exams/export/', {**params,'exam':exam['id']}).status_code == 400


def test_multiple_skills_require_all_ranges_and_export_all_pages(auth_client):
    from core.exam_skills import SKILLS
    c, _, _ = auth_client(); exam = create_exam(c)
    qs = json.loads(Path(__file__).parents[1].joinpath('exam_template.json').read_text(encoding='utf-8'))['questions']
    ids = []
    for i in range(55):
        a = attempt(exam, i, 7)
        a.snapshot = {'duration_minutes':60, 'questions':qs}
        a.grading = {'score':7,'questions':{q['id']:{'points':8} for q in qs}}
        a.save(); ids.append(a.id)
    # High total and sales score cannot compensate for mathematics outside its range.
    bad = attempt(exam, 60, 10)
    bad.snapshot = a.snapshot
    bad.grading = {'score':10,'questions':{q['id']:{'points':4 if int(q['id']) in SKILLS['mathematics'][1] else 10} for q in qs}}
    bad.save()
    attempt(exam, 61, 10)  # totals-only: never interpreted as zero or full skill score
    params = {'skill_ranges':json.dumps({'mathematics':{'min':7,'max':9},'sales':{'min':8,'max':10}}),'ordering':'score_desc'}
    url = f'/api/recruitment-exams/{exam["id"]}/'
    data = c.get(url, params).json()
    assert data['count'] == 55 and len(data['results']) == 50
    assert data['results'][0]['skill_scores'] == {'mathematics':8,'sales':8}
    assert len(c.get(url,{**params,'page':2}).json()['results']) == 5
    top = c.get(url,{**params,'top':'10'}).json()
    assert top['count'] == 55 and top['filters']['top_threshold'] == 7
    rows = list(book(c.get('/api/recruitment-exams/export/',{**params,'exam':exam['id']}))['Evaluaciones'].values)
    assert len(rows) == 56 and {r[0] for r in rows[1:]} == set(ids)
    assert all(r[15:21] == (8,)*6 for r in rows[1:])
    assert c.get(url,{'skill_ranges':json.dumps({'sales':{}})}).json()['count'] == 56
    assert c.get(url,{**params,'skill':'sales'}).status_code == 400
