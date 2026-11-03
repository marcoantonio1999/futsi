import json
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from core.exam_models import RecruitmentExam, RecruitmentExamAttempt
from core.exam_second_stage import KEY, QUESTIONS, eligibility
from core.tests.test_recruitment_exams import create_exam, start

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_cache():
    from django.core.cache import cache
    cache.clear()


def first_exam(admin):
    template = json.loads(Path(__file__).parents[1].joinpath('exam_template.json').read_text(encoding='utf-8'))
    return create_exam(admin, template['questions'])


def activate(admin, exam, minutes=40):
    return admin.post(f'/api/recruitment-exams/{exam["id"]}/second-stage/', {'duration_minutes': minutes}, format='json')


def submit_first(exam, **identity):
    result = start(exam, **identity)
    assert result.status_code == 201, result.content
    public = APIClient()
    public.credentials(HTTP_AUTHORIZATION='Exam ' + result.json()['access_token'])
    assert public.post('/api/public-exams/attempt/', {'answers': {q['id']: 0 for q in exam['questions']}}, format='json').status_code == 200
    return RecruitmentExamAttempt.objects.get(access_token=result.json()['access_token'])


def start_second(exam, email='prueba@example.invalid', **extra):
    return APIClient().post(f'/api/public-exams/{exam["public_token"]}/', {
        'start_key': str(uuid.uuid4()), 'email': email, 'consent': True, **extra,
    }, format='json')


def test_full_flow_permissions_link_grade_and_both_results(auth_client):
    admin, _, _ = auth_client(role='collaborator', section_permissions=['veronica_only'])
    exam = first_exam(admin)
    url = f'/api/recruitment-exams/{exam["id"]}/second-stage/'
    assert APIClient().post(url, {}, format='json').status_code in (401, 403)
    second = exam['second_stage']
    assert second['duration_minutes'] == 40 and second['public_token'] != exam['public_token']
    assert activate(admin, exam).json()['second_stage']['id'] == second['id']
    assert len(admin.get('/api/recruitment-exams/').json()['results']) == 1
    first = submit_first(exam)
    public = APIClient()
    info = public.get(f'/api/public-exams/{second["public_token"]}/')
    assert info.json()['second_stage'] and 'answer_key' not in str(info.json())
    result = start_second(second, email=' PRUEBA@example.invalid ')
    assert result.status_code == 201, result.content
    child = RecruitmentExamAttempt.objects.get(access_token=result.json()['access_token'])
    assert child.first_stage_attempt_id == first.id
    assert child.name == first.name and child.phone == first.phone
    assert result.json()['snapshot']['questions'] == QUESTIONS
    assert 'answer_key' not in str(result.json()) and 'grading_key' not in str(result.json())
    public.credentials(HTTP_AUTHORIZATION='Exam ' + result.json()['access_token'])
    answers = {'1': 'Organicé una mejora concreta.', '2': 'Priorizamos y terminamos.', '3': 'Escucharía a la mamá y daría seguimiento.'}
    assert public.post('/api/public-exams/attempt/', {'answers': answers}, format='json').status_code == 200
    assert start(second).status_code == 409
    grades = {'1': {'points': 7, 'reason': 'Acciones; verificar resultado.', 'review': True},
              '2': {'points': 8, 'reason': 'Prioridades y seguimiento.', 'review': False},
              '3': {'points': 9, 'reason': 'Propone seguimiento.', 'review': False}}
    with patch('core.api.exams.grade_open', return_value=(grades, {})) as ai:
        response = admin.post(f'/api/recruitment-exams/{second["id"]}/grade/', {}, format='json')
        assert response.json()['status'] == 'graded'
        assert ai.call_count == 1 and ai.call_args.args[2] == KEY
    data = admin.get(f'/api/recruitment-exams/{exam["id"]}/').json()
    row = data['results'][0]
    assert row['id'] == first.id and row['grading']['score'] == 10
    assert row['second_stage']['status'] == 'eligible'
    linked = row['second_stage']['attempt']
    assert linked['answers'] == answers and linked['grading']['questions'] == grades
    assert linked['complementary_grade'] == {'total': 24, 'scale': 30, 'meets_suggested_priority': True}
    from core.tests.test_exam_export import book
    workbook = book(admin.get('/api/recruitment-exams/export/', {'exam': exam['id']}))
    assert 'Segunda fase' in workbook.sheetnames
    rows = list(workbook['Segunda fase'].values)
    exported = dict(zip(rows[0], rows[1]))
    assert exported['ID primera entrega'] == first.id and exported['Total / 30'] == 24
    assert exported['Proactividad / 10'] == 7 and exported['Respuesta comercial'] == answers['3']
    assert exported['Justificación proactividad'] == grades['1']['reason']
    profiles = admin.get('/api/recruitment-profiles/').json()['results']
    assert [p['id'] for p in profiles] == [first.id]


def test_threshold_and_incomplete_data_never_become_zero(auth_client):
    admin, _, _ = auth_client()
    exam = first_exam(admin); second = activate(admin, exam).json()['second_stage']
    first = submit_first(exam)
    for points, expected in [(8, 'eligible'), (7.999, 'below_threshold')]:
        for item in first.grading['questions'].values(): item['points'] = points
        first.save()
        assert eligibility(first)['status'] == expected
    assert start(second).status_code == 403
    first.grading['questions'].pop('5'); first.save()
    assert eligibility(first)['status'] == 'incomplete'
    assert start(second).status_code == 403
    first.grading_status = 'pending'; first.save()
    assert eligibility(first)['status'] == 'incomplete'


def test_ambiguous_email_and_unknown_email_denied(auth_client):
    admin, _, _ = auth_client(); exam = first_exam(admin)
    second = activate(admin, exam).json()['second_stage']
    first = submit_first(exam)
    assert start_second(second, email='desconocido@example.invalid').status_code == 403
    assert start_second(second, email='invalid').status_code == 400
    assert start_second(second, consent=False).status_code == 400
    # A historic duplicate email is ambiguous even when phone numbers differ.
    first.pk = None; first.start_key = uuid.uuid4(); first.access_token = 'historic-duplicate'; first.phone = '5500000001'; first.save(force_insert=True)
    assert start_second(second).status_code == 403
    assert RecruitmentExamAttempt.objects.filter(exam_id=second['id']).count() == 0


def test_second_stage_uses_email_only_even_when_names_or_phones_differ(auth_client):
    admin, _, _ = auth_client(); exam = first_exam(admin); second = exam['second_stage']
    first = submit_first(exam)
    result = start_second(second, name='Otro Nombre', phone='5500009999')
    assert result.status_code == 201, result.content
    child = RecruitmentExamAttempt.objects.get(access_token=result.json()['access_token'])
    assert child.first_stage_attempt_id == first.id and child.name == first.name and child.phone == first.phone
    assert start_second(second, phone='5500008888').status_code == 409


def test_second_stage_does_not_reject_different_email_with_same_historical_phone(auth_client):
    admin, _, _ = auth_client(); exam = first_exam(admin); second = exam['second_stage']
    first = submit_first(exam)
    first.pk = None; first.start_key = uuid.uuid4(); first.access_token = 'historical-other-email'
    first.email = 'otra@example.invalid'; first.name = 'Otra Persona'; first.save(force_insert=True)
    assert start_second(second).status_code == 201
    assert start_second(second, email='otra@example.invalid').status_code == 201


def test_existing_second_exam_instructions_change_without_rewriting_history(auth_client):
    admin, _, _ = auth_client(); exam = first_exam(admin); second = exam['second_stage']
    submit_first(exam)
    old = 'Segunda fase. Usa el mismo correo y teléfono de tu primera evaluación.'
    RecruitmentExam.objects.filter(pk=second['id']).update(instructions=old)
    public = APIClient(); info = public.get(f'/api/public-exams/{second["public_token"]}/').json()
    assert 'mismo correo de tu primera' in info['instructions'] and 'teléfono' not in info['instructions']
    started = start_second(second).json()
    assert 'mismo correo de tu primera' in started['snapshot']['instructions']
    assert RecruitmentExam.objects.get(pk=second['id']).instructions == old


def test_automatic_link_requires_complete_distinct_recognized_questions(auth_client):
    admin, _, user = auth_client(); custom = create_exam(admin)
    assert custom['second_stage'] is None and activate(admin, custom).status_code == 400
    template = json.loads(Path(__file__).parents[1].joinpath('exam_template.json').read_text(encoding='utf-8'))
    questions = template['questions']
    questions[19] = questions[4].copy()  # Duplicate sales question, missing another.
    parent = RecruitmentExam.objects.create(title='Plantilla alterada', questions=questions, created_by=user)
    listed = admin.get('/api/recruitment-exams/').json()['results']
    assert next(e for e in listed if e['id'] == parent.id)['second_stage'] is None
    assert RecruitmentExam.objects.filter(first_stage=parent).count() == 0


def test_existing_first_stage_continues_while_second_link_appears(auth_client):
    admin, _, user = auth_client()
    template = json.loads(Path(__file__).parents[1].joinpath('exam_template.json').read_text(encoding='utf-8'))
    parent = RecruitmentExam.objects.create(title='Examen existente', questions=template['questions'],
        answer_key={q['id']: 0 for q in template['questions']}, created_by=user)
    exam = {'id': parent.id, 'public_token': parent.public_token, 'questions': parent.questions}
    ongoing = start(exam).json()
    first_token = parent.public_token
    listed = admin.get('/api/recruitment-exams/').json()['results']
    second = next(e for e in listed if e['id'] == parent.id)['second_stage']
    assert second and second['public_token'] != first_token
    assert admin.get('/api/recruitment-exams/').json()['results'][0]['second_stage']['id'] == second['id']
    parent.refresh_from_db()
    assert parent.accepting and parent.public_token == first_token
    public = APIClient(); public.credentials(HTTP_AUTHORIZATION='Exam ' + ongoing['access_token'])
    answers = {q['id']: 0 for q in parent.questions}
    assert public.post('/api/public-exams/attempt/', {'answers': answers}, format='json').status_code == 200
    assert start(second).status_code == 201
    assert RecruitmentExam.objects.filter(first_stage=parent).count() == 1


def test_second_duration_only_changes_future_attempts(auth_client):
    admin, _, _ = auth_client(); exam = first_exam(admin)
    second = exam['second_stage']; submit_first(exam)
    original = start(second).json()
    assert original['snapshot']['duration_minutes'] == 40
    url = f'/api/recruitment-exams/{second["id"]}/'
    assert admin.post(url, {'duration_minutes': 25}, format='json').status_code == 200
    assert admin.post(url, {'duration_minutes': True}, format='json').status_code == 400
    assert admin.post(f'/api/recruitment-exams/{exam["id"]}/', {'duration_minutes': 25}, format='json').status_code == 400
    public = APIClient(); public.credentials(HTTP_AUTHORIZATION='Exam ' + original['access_token'])
    assert public.get('/api/public-exams/attempt/').json()['snapshot']['duration_minutes'] == 40
    submit_first(exam, name='Otra Persona', email='otra@example.invalid', phone='5512345678')
    later = start(second, name='Otra Persona', email='otra@example.invalid', phone='5512345678')
    assert later.status_code == 201 and later.json()['snapshot']['duration_minutes'] == 25


def test_closed_second_link_blocks_new_starts_but_not_existing_attempt(auth_client):
    admin, _, _ = auth_client(); exam = first_exam(admin)
    second = activate(admin, exam).json()['second_stage']; submit_first(exam)
    result = start(second); assert result.status_code == 201
    admin.post(f'/api/recruitment-exams/{second["id"]}/', {'accepting': False}, format='json')
    assert start(second).status_code == 410
    public = APIClient(); public.credentials(HTTP_AUTHORIZATION='Exam ' + result.json()['access_token'])
    assert public.post('/api/public-exams/attempt/', {'answers': {'1':'a', '2':'b', '3':'c'}}, format='json').status_code == 200


def test_expired_second_stage_is_closed_and_can_be_graded_when_admin_opens_results(auth_client):
    from datetime import timedelta
    from django.utils import timezone
    admin, _, _ = auth_client(); exam = first_exam(admin)
    second = activate(admin, exam).json()['second_stage']; submit_first(exam)
    result = start(second).json()
    public = APIClient(); public.credentials(HTTP_AUTHORIZATION='Exam ' + result['access_token'])
    public.post('/api/public-exams/attempt/', {'action':'draft', 'answers': {'1':'Respuesta guardada'}}, format='json')
    child = RecruitmentExamAttempt.objects.get(access_token=result['access_token'])
    RecruitmentExamAttempt.objects.filter(pk=child.pk).update(started_at=timezone.now()-timedelta(minutes=41))
    row = admin.get(f'/api/recruitment-exams/{exam["id"]}/').json()['results'][0]
    assert row['second_stage']['attempt']['submitted_at'] is not None
    assert row['second_stage']['attempt']['answers'] == {'1':'Respuesta guardada'}
    with patch('core.api.exams.grade_open', return_value=({'1':{'points':5,'reason':'Parcial','review':True}}, {})):
        assert admin.post(f'/api/recruitment-exams/{second["id"]}/grade/', {}, format='json').json()['status'] == 'graded'
    child.refresh_from_db()
    assert child.grading['questions']['2']['points'] == 0 and child.grading['questions']['3']['points'] == 0
