import uuid
from datetime import timedelta
import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import RecruitmentExam, RecruitmentExamAttempt

pytestmark = pytest.mark.django_db


def create_exam(client, questions=None):
    r = client.post('/api/recruitment-exams/', {'title': 'Prueba de evaluación', 'duration_minutes': 40,
        'questions': questions or [{'kind': 'choice', 'prompt': 'Selecciona una opción.', 'options': ['Primera', 'Segunda']}, {'kind': 'open', 'prompt': 'Explica tu propuesta.'}]}, format='json')
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
