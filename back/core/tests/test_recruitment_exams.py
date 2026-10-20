import uuid
from datetime import timedelta
import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import RecruitmentExam, RecruitmentExamAttempt

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def isolated_exam_throttle_cache():
    from django.core.cache import cache
    cache.clear()
    yield
    cache.clear()


def create_exam(client, questions=None):
    questions = questions or [{'kind': 'choice', 'prompt': 'Selecciona una opción.', 'options': ['Primera', 'Segunda']}, {'kind': 'open', 'prompt': 'Explica tu propuesta.'}]
    r = client.post('/api/recruitment-exams/', {'title': 'Prueba de evaluación', 'duration_minutes': 40,
        'questions': questions, 'answer_key': {str(i): 0 if q['kind'] == 'choice' else 'Criterios ficticios.' for i, q in enumerate(questions, 1)}}, format='json')
    assert r.status_code == 201, r.content
    return r.json()


def start(exam, client=None, **extra):
    client = client or APIClient()
    return client.post(f'/api/public-exams/{exam["public_token"]}/', {'start_key': str(uuid.uuid4()),
        'name': 'Persona Ficticia', 'email': 'prueba@example.invalid', 'phone': '5500000000', 'consent': True, **extra}, format='json')


def test_end_to_end_and_immutable_submission(auth_client):
    admin, _, _ = auth_client()
    e = create_exam(admin)
    public = APIClient()
    info = public.get(f'/api/public-exams/{e["public_token"]}/').json()
    assert 'questions' not in info and 'public_token' not in info
    a = start(e).json()
    assert a['submitted_at'] is None
    public.credentials(HTTP_AUTHORIZATION='Exam ' + a['access_token'])
    r = public.post('/api/public-exams/attempt/', {'answers': {'1': 1, '2': 'Mi respuesta.'}, 'started_at': '2099-01-01'}, format='json')
    assert r.status_code == 200 and r.json()['elapsed_seconds'] >= 0
    assert r.json()['started_at'] == a['started_at']
    again = public.post('/api/public-exams/attempt/', {'answers': {'1': 0, '2': 'Cambio'}}, format='json')
    assert again.json() == r.json()
    row = admin.get(f'/api/recruitment-exams/{e["id"]}/').json()['results'][0]
    assert row['answers'] == {'1': 1, '2': 'Mi respuesta.'} and row['email'] == 'prueba@example.invalid'
    assert 'access_token' not in row


@pytest.mark.parametrize('role,permissions,allowed', [('collaborator', ['veronica_only'], True), ('admin', [], True), ('guardian', [], False), ('collaborator', [], False), ('site_coordinator', ['court_communications_only'], False), ('admin', ['player_enrollments_only'], False)])
def test_admin_permissions(auth_client, role, permissions, allowed):
    client, _, _ = auth_client(role=role, section_permissions=permissions)
    assert client.get('/api/recruitment-exams/').status_code == (200 if allowed else 403)
    if allowed:
        assert client.get('/api/recruitment-exams/template/').status_code == 200


def test_public_cannot_read_admin_or_other_attempt(auth_client):
    admin, _, _ = auth_client()
    e = create_exam(admin)
    a = start(e).json()
    c = APIClient()
    assert c.get('/api/recruitment-exams/').status_code in (401, 403)
    assert c.get('/api/public-exams/attempt/').status_code == 404
    c.credentials(HTTP_AUTHORIZATION='Exam ' + a['access_token'] + 'x')
    assert c.get('/api/public-exams/attempt/').status_code == 404


def test_resume_idempotent_start_and_closed_link(auth_client):
    admin, _, _ = auth_client()
    e = create_exam(admin)
    key = str(uuid.uuid4())
    a = start(e, start_key=key).json()
    assert start(e, start_key=key).json()['access_token'] == a['access_token']
    assert RecruitmentExamAttempt.objects.count() == 1
    admin.post(f'/api/recruitment-exams/{e["id"]}/', {'accepting': False}, format='json')
    assert start(e).status_code == 410
    assert start(e, start_key=key).status_code == 200
    c = APIClient(); c.credentials(HTTP_AUTHORIZATION='Exam ' + a['access_token'])
    assert c.post('/api/public-exams/attempt/', {'answers': {'1': 0, '2': 'Texto'}}, format='json').status_code == 200


@pytest.mark.parametrize('answers', [{}, {'1': True, '2': 'Texto'}, {'1': -1, '2': 'Texto'}, {'1': 9, '2': 'Texto'}, {'1': 0, '2': '   '}, {'1': 0, '2': 'Texto', '3': 'Inyectado'}])
def test_answers_validation(auth_client, answers):
    admin, _, _ = auth_client(); e = create_exam(admin); a = start(e).json()
    c = APIClient(); c.credentials(HTTP_AUTHORIZATION='Exam ' + a['access_token'])
    assert c.post('/api/public-exams/attempt/', {'answers': answers}, format='json').status_code == 400
    assert not RecruitmentExamAttempt.objects.get().submitted_at


@pytest.mark.parametrize('override', [{'email': 'mal'}, {'name': 'Nombre'}, {'phone': '1'}, {'consent': False}, {'start_key': 'mal'}])
def test_candidate_validation(auth_client, override):
    admin, _, _ = auth_client(); e = create_exam(admin)
    assert start(e, **override).status_code == 400
    assert not RecruitmentExamAttempt.objects.exists()


def test_snapshot_and_server_elapsed(auth_client):
    admin, _, _ = auth_client(); e = create_exam(admin); a = start(e).json()
    RecruitmentExam.objects.filter(pk=e['id']).update(questions=[{'id': '1', 'kind': 'open', 'prompt': 'Otro examen'}])
    RecruitmentExamAttempt.objects.update(started_at=timezone.now() - timedelta(minutes=41))
    c = APIClient(); c.credentials(HTTP_AUTHORIZATION='Exam ' + a['access_token'])
    r = c.post('/api/public-exams/attempt/', {'answers': {'1': 0, '2': 'Texto'}}, format='json')
    assert r.status_code == 200 and r.json()['over_time'] and len(r.json()['snapshot']['questions']) == 2


def test_template_preserves_all_questions(auth_client):
    admin, _, _ = auth_client()
    template = admin.get('/api/recruitment-exams/template/').json()
    assert len(template['questions']) == 40
    assert [q['id'] for q in template['questions']] == [str(i) for i in range(1, 41)]
    assert all(len(q['options']) == 4 for q in template['questions'])
    assert 'Probarla primero' in template['questions'][35]['options'][3]
    assert not any('correct' in q for q in template['questions'])


@pytest.mark.parametrize('count', [2, 3, 4, 9, 26])
def test_variable_choice_count(auth_client, count):
    admin, _, _ = auth_client()
    options = [f'Opción {i}' for i in range(count)]
    e = create_exam(admin, [{'kind': 'choice', 'prompt': 'Elige', 'options': options}, {'kind': 'open', 'prompt': 'Explica'}])
    a = start(e).json()
    assert len(a['snapshot']['questions'][0]['options']) == count
    assert 'options' not in a['snapshot']['questions'][1]
    c = APIClient(); c.credentials(HTTP_AUTHORIZATION='Exam ' + a['access_token'])
    r = c.post('/api/public-exams/attempt/', {'answers': {'1': count-1, '2': 'Respuesta escrita.'}}, format='json')
    assert r.status_code == 200 and r.json()['answers']['1'] == count-1


@pytest.mark.parametrize('count', [0, 1, 27])
def test_invalid_choice_count(auth_client, count):
    admin, _, _ = auth_client()
    r = admin.post('/api/recruitment-exams/', {'title': 'Prueba', 'questions': [{'kind': 'choice', 'prompt': 'Elige', 'options': ['Texto'] * count}]}, format='json')
    assert r.status_code == 400


@pytest.mark.parametrize('contact', [
    {'email': 'PRUEBA@EXAMPLE.INVALID', 'phone': '5511111111'},
    {'email': 'otro@example.invalid', 'phone': '55 0000-0000'},
    {'email': 'otro@example.invalid', 'phone': '+52 (55) 0000-0000'},
    {'email': 'otro@example.invalid', 'phone': '+52 1 55 0000 0000'},
])
def test_completed_exam_cannot_be_repeated_by_either_contact(auth_client, contact):
    admin, _, _ = auth_client(); e = create_exam(admin); a = start(e).json()
    c = APIClient(); c.credentials(HTTP_AUTHORIZATION='Exam ' + a['access_token'])
    assert c.post('/api/public-exams/attempt/', {'answers': {'1': 0, '2': 'Texto'}}, format='json').status_code == 200
    r = start(e, **contact)
    assert r.status_code == 409 and r.json()['code'] == 'exam_already_completed'
    assert 'No es posible realizarlo dos veces' in r.json()['detail']
    assert 'access_token' not in r.json() and RecruitmentExamAttempt.objects.count() == 1


def test_pending_exam_cannot_restart_but_original_resumes(auth_client):
    admin, _, _ = auth_client(); e = create_exam(admin); key = str(uuid.uuid4()); a = start(e, start_key=key).json()
    before = RecruitmentExamAttempt.objects.get().started_at
    r = start(e)
    assert r.status_code == 409 and r.json()['code'] == 'exam_already_started'
    assert start(e, start_key=key).json()['access_token'] == a['access_token']
    assert RecruitmentExamAttempt.objects.get().started_at == before


def test_contact_can_take_a_different_exam(auth_client):
    admin, _, _ = auth_client()
    assert start(create_exam(admin)).status_code == 201
    assert start(create_exam(admin)).status_code == 201


def test_legacy_rollout_attempt_is_normalized_before_duplicate_check(auth_client):
    admin, _, _ = auth_client(); e = create_exam(admin); start(e)
    RecruitmentExamAttempt.objects.update(identity_email='', identity_phone='')
    assert start(e, email='PRUEBA@EXAMPLE.INVALID', phone='5511111111').status_code == 409
    assert RecruitmentExamAttempt.objects.get().identity_phone == '5500000000'


def test_identity_migration_preserves_attempt_data(auth_client):
    import importlib
    from django.apps import apps
    from django.db import connection
    admin, _, _ = auth_client(); e = create_exam(admin); start(e, phone='+52 (55) 0000-0000', email='PRUEBA@example.invalid')
    before = RecruitmentExamAttempt.objects.get()
    RecruitmentExamAttempt.objects.update(identity_email='', identity_phone='')
    from types import SimpleNamespace
    importlib.import_module('core.migrations.0071_exam_identity_guard').fill_identity(apps, SimpleNamespace(connection=connection))
    after = RecruitmentExamAttempt.objects.get()
    assert (after.pk, after.email, after.phone, after.answers, after.started_at) == (before.pk, before.email, before.phone, before.answers, before.started_at)
    assert (after.identity_email, after.identity_phone) == ('prueba@example.invalid', '5500000000')


@pytest.mark.django_db(transaction=True)
def test_concurrent_starts_only_create_one_attempt(auth_client):
    from concurrent.futures import ThreadPoolExecutor
    from django.db import connection, close_old_connections
    if connection.vendor != 'postgresql':
        pytest.skip('Row-level locking is verified on PostgreSQL CI, not SQLite.')
    admin, _, _ = auth_client(); e = create_exam(admin)
    def submit():
        close_old_connections()
        try:
            return start(e).status_code
        finally:
            close_old_connections()
    with ThreadPoolExecutor(max_workers=2) as executor:
        statuses = list(executor.map(lambda _: submit(), range(2)))
    assert sorted(statuses) == [201, 409]
    assert RecruitmentExamAttempt.objects.count() == 1


@pytest.mark.parametrize('roles', [[], [('anon',), ('authenticated',)]])
def test_private_migration_supports_postgres_and_supabase(roles):
    import importlib
    from unittest.mock import MagicMock
    migration = importlib.import_module('core.migrations.0070_recruitment_exams')
    editor = MagicMock()
    editor.connection.vendor = 'postgresql'
    editor.connection.cursor.return_value.__enter__.return_value.fetchall.return_value = roles
    migration.secure_exam_tables(None, editor)
    sql = [call.args[0] for call in editor.execute.call_args_list]
    assert sum('ENABLE ROW LEVEL SECURITY' in q for q in sql) == 2
    assert sum('FROM PUBLIC' in q for q in sql) == 2
    assert sum('FROM "anon"' in q for q in sql) == (2 if roles else 0)
    assert sum('FROM "authenticated"' in q for q in sql) == (2 if roles else 0)
