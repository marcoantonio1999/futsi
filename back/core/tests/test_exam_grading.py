from unittest.mock import patch
import pytest
from django.conf import settings
from rest_framework.test import APIClient
from core.models import RecruitmentExam, RecruitmentExamAttempt
from core.exam_grading import GradingError, grade_open
from core.tests.test_recruitment_exams import create_exam, start

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_cache():
    from django.core.cache import cache
    cache.clear()


def submit(e, answers):
    a = start(e).json()
    c = APIClient(); c.credentials(HTTP_AUTHORIZATION='Exam ' + a['access_token'])
    return c, c.post('/api/public-exams/attempt/', {'answers': answers}, format='json')


def test_new_exam_requires_complete_key(auth_client):
    c, _, _ = auth_client()
    assert c.post('/api/recruitment-exams/', {'title': 'Sin clave', 'questions': [{'kind': 'open', 'prompt': 'Texto'}]}, format='json').status_code == 400


def test_choice_auto_grades_once_and_key_never_public(auth_client):
    c, _, _ = auth_client()
    e = create_exam(c, [{'kind': 'choice', 'prompt': 'Dos más dos', 'options': ['4', '7']}])
    with patch('core.api.exams.grade_open') as ai:
        public, r = submit(e, {'1': 0})
        assert r.status_code == 200
        a = RecruitmentExamAttempt.objects.get()
        assert a.grading['score'] == 10 and a.grading_status == 'graded'
        for response in (r, public.get('/api/public-exams/attempt/')):
            for secret in ('answer_key', 'grading_key', 'grading', 'correct_answer'):
                assert secret not in str(response.json())
        public.post('/api/public-exams/attempt/', {'answers': {'1': 1}}, format='json')
        a.refresh_from_db(); assert a.grading['score'] == 10
        assert not ai.called
    assert c.post(f'/api/recruitment-exams/{e["id"]}/grade/', {}, format='json').json()['processed'] is False


def test_open_bulk_persists_and_skips_graded(auth_client):
    c, user, _ = auth_client(role='collaborator', section_permissions=['veronica_only'])
    e = create_exam(c); submit(e, {'1': 0, '2': 'Texto ficticio'})
    with patch('core.api.exams.grade_open', return_value=({'2': {'points': 8, 'reason': 'Cumple parcialmente', 'review': True}}, {'input_tokens': 20, 'output_tokens': 10})) as ai:
        endpoint = f'/api/recruitment-exams/{e["id"]}/grade/'
        r = c.post(endpoint, {}, format='json'); assert r.status_code == 200, r.content
        assert r.json()['processed'] and r.json()['remaining'] == 0
        a = RecruitmentExamAttempt.objects.get()
        assert a.grading['score'] == 9 and a.grading['review'] and a.graded_by_id is not None
        assert c.post(endpoint, {}, format='json').json()['processed'] is False
        assert ai.call_count == 1


def test_failure_documented_not_retried_and_other_contact_can_continue(auth_client):
    c, _, _ = auth_client(); e = create_exam(c); submit(e, {'1': 1, '2': 'Texto'})
    with patch('core.api.exams.grade_open', side_effect=GradingError('OpenAI HTTP 503. No se reintentó.')) as ai:
        endpoint = f'/api/recruitment-exams/{e["id"]}/grade/'
        assert c.post(endpoint, {}, format='json').json()['status'] == 'error'
        assert c.post(endpoint, {}, format='json').json()['processed'] is False
        assert ai.call_count == 1
        a = RecruitmentExamAttempt.objects.get()
        assert a.grading_status == 'error' and '503' in a.grading['error'] and 'score' not in a.grading


def test_claim_prevents_duplicate_call(auth_client):
    c, _, _ = auth_client(); e = create_exam(c); submit(e, {'1': 1, '2': 'Texto'})
    RecruitmentExamAttempt.objects.update(grading_status='processing')
    with patch('core.api.exams.grade_open') as ai:
        r = c.post(f'/api/recruitment-exams/{e["id"]}/grade/', {}, format='json')
        assert r.json()['processing'] == 1 and not ai.called


def test_legacy_key_can_be_added_once_without_changing_answers(auth_client):
    c, _, _ = auth_client(); e = create_exam(c); public, _ = submit(e, {'1': 1, '2': 'Original'})
    RecruitmentExam.objects.update(answer_key={}); RecruitmentExamAttempt.objects.update(grading_key={})
    endpoint = f'/api/recruitment-exams/{e["id"]}/'
    assert c.post(endpoint, {'answer_key': e['answer_key']}, format='json').status_code == 200
    assert c.post(endpoint, {'answer_key': {'1': 1, '2': 'Otra'}}, format='json').status_code == 400
    assert public.get('/api/public-exams/attempt/').json()['answers']['2'] == 'Original'


def test_grading_denies_public_and_unrelated_roles(auth_client):
    c, _, _ = auth_client(); e = create_exam(c)
    endpoint = f'/api/recruitment-exams/{e["id"]}/grade/'
    assert APIClient().post(endpoint, {}, format='json').status_code in (401, 403)
    other, _, _ = auth_client(role='guardian')
    assert other.post(endpoint, {}, format='json').status_code == 403


def test_missing_key_does_not_call_provider():
    from django.test import override_settings
    with override_settings(OPENAI_API_KEY='', WHATSAPP_SERVICE_URL='', WHATSAPP_SERVICE_TOKEN=''), patch('urllib.request.build_opener') as transport:
        with pytest.raises(GradingError): grade_open([], {}, {})
        assert not transport.called


def test_fixed_ai_smoke_test_is_private_and_bounded(auth_client):
    from django.core.cache import cache
    cache.clear()
    endpoint = '/api/recruitment-exams/test-grading/'
    assert APIClient().post(endpoint, {}, format='json').status_code in (401, 403)
    c, _, _ = auth_client(role='collaborator', section_permissions=['veronica_only'])
    with patch('core.api.exams.grade_open', return_value=({'1': {'points': 10, 'reason': 'Correcta', 'review': False}}, {})) as ai:
        for _ in range(6): assert c.post(endpoint, {'name': 'Not forwarded'}, format='json').status_code == 200
        assert c.post(endpoint, {}, format='json').status_code == 429
        assert 'Not forwarded' not in str(ai.call_args)


def test_private_bridge_does_not_send_contacts_or_provider_key():
    import io, json
    from django.test import override_settings
    from core.exam_grading import grade_via_service
    payload = {'grades': {'2': {'points': 9, 'reason': 'Casi completa', 'review': False}}, 'model': 'gpt-5.6-luna', 'usage': {'input_tokens': 20}}
    with override_settings(WHATSAPP_SERVICE_URL='https://private.example', WHATSAPP_SERVICE_TOKEN='internal-fictional'):
        with patch('urllib.request.build_opener') as opener:
            opener.return_value.open.return_value = io.BytesIO(json.dumps(payload).encode())
            grades, usage = grade_via_service([{'id': '1', 'kind': 'choice', 'prompt': 'No enviar'}, {'id': '2', 'kind': 'open', 'prompt': 'Pregunta'}], {'1': 0, '2': 'Texto'}, {'1': 0, '2': 'Criterios'})
            sent=json.loads(opener.return_value.open.call_args.args[0].data)
            assert set(sent) == {'questions', 'answers', 'key'} and len(sent['questions']) == 1 and grades['2']['points'] == 9
            payload['grades']['2']['points'] = 11
            opener.return_value.open.return_value = io.BytesIO(json.dumps(payload).encode())
            with pytest.raises(GradingError): grade_via_service([{'id': '2', 'kind': 'open', 'prompt': 'Pregunta'}], {'2': 'Texto'}, {'2': 'Criterios'})
