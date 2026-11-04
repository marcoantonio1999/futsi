import json
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from rest_framework.test import APIClient

from core.exam_models import RecruitmentExam, RecruitmentExamAttempt
from core.exam_second_stage import KEY, QUESTIONS, eligibility, phone_access_grant
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


@pytest.mark.parametrize('grading_state', ['zero', 'below_eight', 'missing_question', 'pending', 'missing_breakdown'])
def test_second_stage_accepts_delivered_first_stage_regardless_of_scores(auth_client, grading_state):
    admin, _, _ = auth_client()
    exam = first_exam(admin); second = activate(admin, exam).json()['second_stage']
    first = submit_first(exam)
    if grading_state in {'zero', 'below_eight'}:
        for item in first.grading['questions'].values():
            item['points'] = 0 if grading_state == 'zero' else 7.999
    elif grading_state == 'missing_question':
        first.grading['questions'].pop('5')
    elif grading_state == 'pending':
        first.grading_status = 'pending'
    else:
        first.snapshot['questions'] = []
    first.save()
    progress = eligibility(first)
    assert progress['status'] == 'eligible'
    if grading_state == 'zero':
        assert progress['management'] == progress['sales'] == 0
    if grading_state in {'pending', 'missing_breakdown'}:
        assert progress['management'] is None and progress['sales'] is None
    result = start_second(second, email=' PRUEBA@example.invalid ')
    assert result.status_code == 201, result.content
    child = RecruitmentExamAttempt.objects.get(access_token=result.json()['access_token'])
    assert child.first_stage_attempt_id == first.id
    row = admin.get(f'/api/recruitment-exams/{exam["id"]}/').json()['results'][0]
    assert row['second_stage']['status'] == 'eligible'
    from core.tests.test_exam_export import book
    exported = list(book(admin.get('/api/recruitment-exams/export/', {'exam': exam['id']}))['Segunda fase'].values)
    assert dict(zip(exported[0], exported[1]))['Primera fase'] == 'Entregada'


def test_second_stage_waits_for_first_delivery(auth_client):
    admin, _, _ = auth_client()
    exam = first_exam(admin); second = exam['second_stage']
    started = start(exam)
    first = RecruitmentExamAttempt.objects.get(access_token=started.json()['access_token'])
    assert eligibility(first)['status'] == 'incomplete'
    assert start_second(second).status_code == 403
    assert RecruitmentExamAttempt.objects.filter(exam_id=second['id']).count() == 0


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


def start_second_by_phone(exam, name, phone):
    return APIClient().post(f'/api/public-exams/{exam["public_token"]}/', {
        'start_key': str(uuid.uuid4()), 'identity_method': 'phone',
        'name': name, 'phone': phone, 'consent': True,
    }, format='json')


def test_authorized_historical_candidates_use_name_and_phone_without_email(auth_client):
    admin, _, _ = auth_client()
    exam = first_exam(admin); second = exam['second_stage']
    first = submit_first(exam, name='Persona Histórica Uno', email='uno@example.invalid', phone='5510000001')
    other = submit_first(exam, name='Persona Histórica Dos', email='dos@example.invalid', phone='5510000002')
    unapproved = submit_first(exam, name='Persona Sin Autorización', email='tres@example.invalid', phone='5510000003')
    for row, name, phone in [(first, 'Persona Histórica Uno', '5510000001'), (other, 'Persona Histórica Dos', '5510000002')]:
        snapshot = {**row.snapshot, 'offline_import': {'source': 'xlsx_results'},
                    'second_stage_phone_access': phone_access_grant(name, phone)}
        RecruitmentExamAttempt.objects.filter(pk=row.pk).update(email='', phone='', identity_email='', identity_phone='', snapshot=snapshot)
    info = APIClient().get(f'/api/public-exams/{second["public_token"]}/').json()
    assert info['phone_access'] is True and 'teléfono' in info['instructions']
    assert 'Persona Histórica' not in str(info) and 'digest' not in str(info)
    assert start_second_by_phone(second, 'Persona Histórica Uno', '5510000099').status_code == 403
    assert start_second_by_phone(second, 'Persona Sin Autorización', '5510000003').status_code == 403
    result = start_second_by_phone(second, ' UNO HISTORICA   PERSONA ', '+52 55 1000 0001')
    assert result.status_code == 201, result.content
    child = RecruitmentExamAttempt.objects.get(access_token=result.json()['access_token'])
    assert child.first_stage_attempt_id == first.id and child.email == '' and child.identity_phone == '5510000001'
    assert start_second_by_phone(second, 'Persona Histórica Uno', '5510000001').status_code == 409
    # A second email-less historical participant must not collide with the first.
    result2 = start_second_by_phone(second, 'Persona Histórica Dos', '5510000002')
    assert result2.status_code == 201, result2.content
    assert RecruitmentExamAttempt.objects.get(access_token=result2.json()['access_token']).first_stage_attempt_id == other.id
    assert not RecruitmentExamAttempt.objects.filter(first_stage_attempt=unapproved).exists()


def test_name_only_exception_captures_phone_and_flags_identity_for_review(auth_client):
    admin, _, _ = auth_client()
    exam = first_exam(admin); second = exam['second_stage']
    first = submit_first(exam, name='Persona Sin Teléfono', email='antes@example.invalid', phone='5510000030')
    snapshot = {**first.snapshot, 'offline_import': {'source': 'xlsx_results'},
                'second_stage_phone_access': phone_access_grant('Persona Sin Teléfono', name_only=True)}
    RecruitmentExamAttempt.objects.filter(pk=first.pk).update(email='', phone='', identity_email='', identity_phone='', snapshot=snapshot)
    assert start_second_by_phone(second, 'Persona Distinta', '5510000031').status_code == 403
    response = start_second_by_phone(second, 'Telefono Persona Sin', '5510000031')
    assert response.status_code == 201, response.content
    child = RecruitmentExamAttempt.objects.get(access_token=response.json()['access_token'])
    assert child.first_stage_attempt_id == first.id and child.phone == '5510000031'
    assert child.snapshot['second_stage_identity_review'] is True
    row = next(row for row in admin.get(f'/api/recruitment-exams/{exam["id"]}/').json()['results'] if row['id'] == first.id)
    assert row['second_stage']['attempt']['identity_review'] is True
    from core.tests.test_exam_export import book
    exported = list(book(admin.get('/api/recruitment-exams/export/', {'exam': exam['id']}))['Segunda fase'].values)
    assert dict(zip(exported[0], exported[1]))['Identidad por verificar'] == 'Sí'


def test_phone_access_requires_unique_grant_and_first_delivery(auth_client):
    admin, _, _ = auth_client()
    exam = first_exam(admin); second = exam['second_stage']
    started = start(exam, name='Persona Pendiente', email='pendiente@example.invalid', phone='5510000004')
    first = RecruitmentExamAttempt.objects.get(access_token=started.json()['access_token'])
    first.snapshot['second_stage_phone_access'] = phone_access_grant('Persona Pendiente', '5510000004')
    first.save(update_fields=['snapshot'])
    assert start_second_by_phone(second, 'Persona Pendiente', '5510000004').status_code == 403
    first.submitted_at = first.started_at; first.save(update_fields=['submitted_at'])
    duplicate = submit_first(exam, name='Otra Persona', email='otra@example.invalid', phone='5510000005')
    duplicate.snapshot['second_stage_phone_access'] = first.snapshot['second_stage_phone_access']
    duplicate.save(update_fields=['snapshot'])
    assert start_second_by_phone(second, 'Persona Pendiente', '5510000004').status_code == 403
    assert RecruitmentExamAttempt.objects.filter(exam_id=second['id']).count() == 0


def test_phone_exception_and_email_share_one_attempt(auth_client):
    admin, _, _ = auth_client()
    exam = first_exam(admin); second = exam['second_stage']
    first = submit_first(exam, name='Persona Autorizada', email='persona@example.invalid', phone='5510000006')
    first.snapshot['second_stage_phone_access'] = phone_access_grant('Persona Autorizada', '5510000006')
    first.save(update_fields=['snapshot'])
    assert start_second_by_phone(second, 'Persona Autorizada', '5510000006').status_code == 201
    assert start_second(second, email='persona@example.invalid').status_code == 409


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
