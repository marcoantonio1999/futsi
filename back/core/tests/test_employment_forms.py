import uuid
import pytest
from django.core.cache import cache
from rest_framework.test import APIClient
from core.exam_models import RecruitmentApplication,RecruitmentProfile,RecruitmentExam
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam,start
from core.employment_forms import FORM_URL,FIELDS

pytestmark=pytest.mark.django_db


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear();yield;cache.clear()


def payload(**fields):
    return dict(submit_key=str(uuid.uuid4()),consent=True,fields={
        'nombres':'Persona','apellido_paterno':'Ficticia','correo':'persona1@example.invalid','telefono':'5500000001',
        'puesto_solicitado':'Prueba de evaluación','firma_solicitante':'Persona Ficticia',**fields})


def submit(data=None):
    return APIClient().post('/api/public-employment-form/',data or payload(),format='json')


def test_standalone_form_receipt_is_idempotent_and_never_leaks_data(auth_client):
    data=payload();response=submit(data)
    assert response.status_code==201,response.content
    assert set(response.json())=={'received','receipt','submitted_at'}
    assert submit(data).json()==response.json()
    assert RecruitmentApplication.objects.count()==1
    data['fields']['correo']='another@example.invalid'
    assert submit(data).status_code==409
    public=APIClient().get('/api/public-employment-form/').json()
    assert public['sections'] and 'results' not in public
    assert APIClient().get('/api/recruitment-applications/').status_code in (401,403)
    c,_,_=auth_client()
    assert c.get('/api/recruitment-applications/').json()['count']==1
    assert c.get('/api/recruitment-applications/').json()['public_url']==FORM_URL


def test_same_fields_as_pdf_plus_email_and_signature():
    keys={f['key'] for f in FIELDS}
    assert len(keys)==len(FIELDS)==80
    assert {'nombres','correo','enfermedad_cronica','empleo_4_separacion','estudio_actual_grado','firma_solicitante'}<=keys


@pytest.mark.parametrize('changes',[
    {'consent':False},{'fields':{}},{'fields':{'file':'binary'}},{'submit_key':'not-uuid'},
    {'website':'spam.invalid'},{'fields':payload(correo='bad')['fields']},
    {'fields':payload(telefono='a')['fields']},{'fields':payload(nombres='x'*181)['fields']},
    {'fields':payload(enfermedad_cronica='Dato ficticio')['fields']},
])
def test_invalid_inputs_never_create_records(changes):
    data=payload();data.update(changes)
    assert submit(data).status_code==400
    assert not RecruitmentApplication.objects.exists()


def test_explicit_optional_sensitive_consent_is_recorded():
    data=payload(enfermedad_cronica='Dato ficticio');data['sensitive_consent']=True
    assert submit(data).status_code==201
    assert RecruitmentApplication.objects.get().fields['_sensitive_consent']=='yes'


def test_matching_after_exam_preserves_cv_score_and_existing_form(auth_client):
    c,_,user=auth_client();e=create_exam(c);a=attempt(e)
    RecruitmentProfile.objects.create(attempt=a,updated_by=user,cv_text='Excel Python',form_text='Formato anterior validado')
    data=payload();data['exam_token']=e['public_token']
    assert submit(data).status_code==201
    row=RecruitmentApplication.objects.get();assert row.attempt_id==a.pk and row.link_status=='linked'
    a.refresh_from_db();assert a.grading['score']==8
    p=RecruitmentProfile.objects.get();assert p.cv_text=='Excel Python' and p.form_text=='Formato anterior validado'


def test_form_first_then_exam_links_at_submission_without_polling(auth_client):
    c,_,_=auth_client();e=create_exam(c,[{'kind':'choice','prompt':'Una pregunta','options':['Uno','Dos']}])
    assert submit(payload(correo='prueba@example.invalid',telefono='5500000000',software='Excel Python')).status_code==201
    row=RecruitmentApplication.objects.get();assert row.attempt_id is None
    access=start(e).json()['access_token']
    r=APIClient().post('/api/public-exams/attempt/',{'answers':{'1':0}},format='json',HTTP_AUTHORIZATION='Exam '+access)
    assert r.status_code==200,r.content
    row.refresh_from_db();assert row.attempt_id and row.link_status=='linked'
    p=RecruitmentProfile.objects.get();assert p.updated_by_id is None and p.form_fields['software']=='Excel Python'
    assert c.get('/api/recruitment-profiles/?form_q=Python').json()['count']==1


def test_ambiguous_or_mismatched_contact_requires_review_and_manual_confirmation(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e)
    b=attempt(e,2);b.email=a.email;b.save()
    data=payload(telefono='5500000002');submit(data)
    row=RecruitmentApplication.objects.get();assert not row.attempt_id and row.link_status=='review'
    detail=c.get(f'/api/recruitment-applications/{row.id}/').json();assert len(detail['candidates'])==2
    assert c.post(f'/api/recruitment-applications/{row.id}/',{'attempt_id':b.id},format='json').status_code==200
    row.refresh_from_db();assert row.attempt_id==b.id
    assert c.post(f'/api/recruitment-applications/{row.id}/',{'attempt_id':a.id},format='json').status_code==409


def test_other_vacancy_never_auto_matches_and_admin_filters_text(auth_client):
    c,_,_=auth_client();e=create_exam(c);attempt(e)
    assert submit(payload(puesto_solicitado='Otra vacante',software='Excel Python')).status_code==201
    assert RecruitmentApplication.objects.get().attempt_id is None
    result=c.get('/api/recruitment-applications/?q=python&position=Otra&status=pending').json()
    assert result['count']==1 and 'fields' not in result['results'][0]
    row=result['results'][0]
    detail=c.get(f'/api/recruitment-applications/{row["id"]}/').json()
    assert detail['fields']['software']=='Excel Python'
    assert c.get('/api/recruitment-applications/?q=imposible').json()['count']==0


def test_wrong_exam_token_position_and_unauthorized_admin(auth_client):
    c,_,_=auth_client();e=create_exam(c)
    data=payload(puesto_solicitado='Otro puesto');data['exam_token']=e['public_token']
    assert submit(data).status_code==400
    data['exam_token']='does-not-exist';assert submit(data).status_code==404
    restricted,_,_=auth_client(role='collaborator',section_permissions=['court_communications_only'])
    assert restricted.get('/api/recruitment-applications/').status_code==403
    vero,_,_=auth_client(role='collaborator',section_permissions=['veronica_only'])
    assert vero.get('/api/recruitment-applications/').status_code==200
    assert vero.post('/api/recruitment-applications/',{},format='json').status_code==403


def test_form_text_overflow_and_non_string_rejected():
    assert submit(payload(software={'nested':'object'})).status_code==400
    data=payload();data['file']='%PDF';assert submit(data).status_code==400
