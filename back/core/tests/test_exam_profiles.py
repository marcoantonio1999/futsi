import uuid
import pytest
from django.utils import timezone
from rest_framework.test import APIClient
from core.exam_models import RecruitmentExam, RecruitmentExamAttempt, RecruitmentProfile
from core.tests.test_recruitment_exams import create_exam

pytestmark=pytest.mark.django_db


def attempt(exam, index=1, score=8, submitted=True):
    return RecruitmentExamAttempt.objects.create(exam_id=exam['id'],start_key=uuid.uuid4(),
        name=f'Persona Ficticia {index}',email=f'persona{index}@example.invalid',phone=f'5500{index:06d}',
        submitted_at=timezone.now() if submitted else None,
        snapshot={'duration_minutes':60,'questions':[]},
        grading_status='graded' if score is not None else 'pending',grading={'score':score} if score is not None else {})


def test_sorted_scores_apply_before_pagination_and_pending_is_not_zero(auth_client):
    client,_,_=auth_client();exam=create_exam(client)
    for index in range(65): attempt(exam,index,round(index/7,2))
    attempt(exam,90,None)
    endpoint=f'/api/recruitment-exams/{exam["id"]}/?ordering=score_desc'
    data=client.get(endpoint).json()
    assert data['count']==66 and len(data['results'])==50
    scores=[r['grading']['score'] for r in data['results']]
    assert scores==sorted(scores,reverse=True) and scores[0]>9
    last=client.get(endpoint+'&page=2').json()['results'][-1]
    assert last['grading_status']=='pending'
    low=client.get(endpoint.replace('desc','asc')).json()['results'][0]
    assert low['grading']['score']==0


def test_top_ten_rounds_up_and_includes_ties_not_pending(auth_client):
    c,_,_=auth_client();e=create_exam(c)
    for i in range(11): attempt(e,i,10 if i<3 else 8)
    attempt(e,99,None)
    result=c.get(f'/api/recruitment-exams/{e["id"]}/?top=10').json()
    assert result['count']==3 and result['filters']['graded_count']==11
    assert result['filters']['top_threshold']==10
    assert all(a['grading']['score']==10 for a in result['results'])
    assert c.get('/api/recruitment-profiles/?top=10').status_code==400
    assert c.get(f'/api/recruitment-profiles/?top=10&exam={e["id"]}').json()['count']==3


def test_empty_top_has_no_fake_score(auth_client):
    c,_,_=auth_client();e=create_exam(c);attempt(e,score=None)
    data=c.get(f'/api/recruitment-exams/{e["id"]}/?top=10').json()
    assert data['results']==[] and data['filters']['top_threshold'] is None
    a=RecruitmentExamAttempt.objects.get()
    a.grading_status='graded';a.grading={'score':None};a.save()
    assert c.get(f'/api/recruitment-exams/{e["id"]}/?top=10').json()['results']==[]


def test_profile_literal_keywords_all_any_accent_and_punctuation(auth_client):
    c,_,_=auth_client();e=create_exam(c)
    a,b,d=[attempt(e,i) for i in range(1,4)]
    for row,body in [(a,'EXCEL, Python y atención al cliente, C++ y .NET'),(b,'Excelente atención al cliente'),(d,'Excel básico')]:
        assert c.post(f'/api/recruitment-profiles/{row.id}/',{'cv_text':body,'position':'Analista'},format='json').status_code==200
    r=c.get('/api/recruitment-profiles/?keywords=excel,python').json()
    assert [v['id'] for v in r['results']]==[a.id]
    assert r['results'][0]['matched_keywords']==['excel','python']
    assert 'cv_text' not in r['results'][0] and 'snapshot' not in r['results'][0]
    assert c.get('/api/recruitment-profiles/?keywords=excel,python&keyword_mode=any').json()['count']==2
    assert c.get('/api/recruitment-profiles/?keywords=ATENCION AL CLIENTE').json()['count']==2
    assert c.get('/api/recruitment-profiles/',{'keywords':'C++,.NET'}).json()['count']==1
    assert c.get('/api/recruitment-profiles/?keywords=.*').json()['count']==0


def test_text_profile_updates_preserve_attempt_and_form_filters(auth_client):
    c,_,_=auth_client(role='collaborator',section_permissions=['veronica_only']);e=create_exam(c);a=attempt(e)
    before=(a.grading,a.answers,a.submitted_at)
    endpoint=f'/api/recruitment-profiles/{a.id}/'
    data={'position':'Analista Python','cv_text':'Excel','form_text':'Escolaridad: Licenciatura','form_fields':{'software':'Excel'}}
    assert c.post(endpoint,data,format='json').status_code==200
    assert c.get('/api/recruitment-profiles/?position=Python&form_q=licenciatura&has_form=yes&has_cv=yes').json()['count']==1
    assert c.get(endpoint).json()['cv_text']=='Excel'
    a.refresh_from_db();assert (a.grading,a.answers,a.submitted_at)==before
    for invalid in [{'cv_text':'x'*80001},{'file':'data:application/pdf;base64,x'},{'form_fields':{'x':['bad']}}]:
        assert c.post(endpoint,invalid,format='json').status_code==400
    assert c.get(endpoint).json()['cv_text']=='Excel'


def test_import_unique_phone_preview_then_commit_preserves_cv(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e)
    endpoint='/api/recruitment-profiles/import/'
    body={'form_fields':{'telefono':'+52 '+a.phone,'puesto_solicitado':'Auxiliar','software':'Excel'},'form_text':'Datos de prueba'}
    preview=c.post(endpoint,body,format='json').json()
    assert preview['match_status']=='matched' and preview['candidate']['id']==a.id and not RecruitmentProfile.objects.exists()
    saved=c.post(endpoint,{**body,'commit':True},format='json')
    assert saved.status_code==200 and saved.json()['profile']['position']=='Auxiliar'
    c.post(f'/api/recruitment-profiles/{a.id}/',{'cv_text':'Python','position':'Puesto confirmado'},format='json')
    c.post(endpoint,{**body,'commit':True},format='json')
    assert RecruitmentProfile.objects.count()==1
    p=RecruitmentProfile.objects.get();assert p.cv_text=='Python' and p.position=='Puesto confirmado'


def test_duplicate_contact_across_exams_is_ambiguous_and_never_auto_merged(auth_client):
    c,_,_=auth_client();e=create_exam(c);other=create_exam(c)
    a=attempt(e);b=attempt(other)
    body={'form_fields':{'telefono':a.phone},'form_text':'Prueba'}
    r=c.post('/api/recruitment-profiles/import/',body,format='json').json()
    assert r['match_status']=='ambiguous'
    assert c.post('/api/recruitment-profiles/import/',{**body,'commit':True},format='json').status_code==409
    assert not RecruitmentProfile.objects.exists()
    r=c.post('/api/recruitment-profiles/import/',{**body,'exam':e['id'],'commit':True},format='json')
    assert r.status_code==200 and r.json()['profile']['id']==a.id
    assert not RecruitmentProfile.objects.filter(attempt=b).exists()


def test_conflicting_identifiers_and_reference_phones_are_not_auto_matched(auth_client):
    c,_,_=auth_client();e=create_exam(c);a,b=attempt(e),attempt(e,2)
    endpoint='/api/recruitment-profiles/import/'
    for fields in [{'telefono':a.phone,'email':b.email},{'telefono':a.phone,'email':'otra@example.invalid'}]:
        assert c.post(endpoint,{'form_fields':fields},format='json').json()['match_status'] in ['ambiguous','conflict']
        assert c.post(endpoint,{'form_fields':fields,'commit':True},format='json').status_code==409
    body={'form_fields':{'empleo_1_telefono':a.phone},'form_text':f'Empresa: {a.phone}'}
    assert c.post(endpoint,body,format='json').json()['match_status']=='unmatched'
    assert c.post(endpoint,{**body,'attempt_id':b.id,'commit':True},format='json').status_code==200
    assert not RecruitmentProfile.objects.filter(attempt=a).exists()


def test_plain_text_contacts_and_incomplete_exams(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e);pending=attempt(e,2,submitted=False)
    response=c.post('/api/recruitment-profiles/import/',{'form_text':f'Correo: {a.email}\nTelefono: {a.phone}'},format='json')
    assert response.json()['match_status']=='matched'
    assert c.get(f'/api/recruitment-profiles/{pending.id}/').status_code==404
    assert c.post('/api/recruitment-profiles/import/',{'form_text':'texto','attempt_id':pending.id,'commit':True},format='json').status_code==404


def test_summary_does_not_load_documents_or_cause_per_person_queries(auth_client):
    from django.db import connection
    from django.test.utils import CaptureQueriesContext
    from core.api.exam_profiles import submitted_rows,profile_data
    from core.exam_profiles import filtered_attempts
    c,_,user=auth_client();e=create_exam(c)
    for i in range(3):
        RecruitmentProfile.objects.create(attempt=attempt(e,i),updated_by=user,cv_text='Excel '*10000,
                                          cv_search='excel '*10000,form_text='private form',form_fields={'x':'private'})
    rows,filters=filtered_attempts(submitted_rows(),{'keywords':'excel'},profiles=True)
    with CaptureQueriesContext(connection) as queries:
        data=[profile_data(a,terms=filters['matched_keywords']) for a in rows]
    assert len(queries)==1 and len(data)==3
    assert all(p['has_cv'] and p['matched_keywords']==['excel'] for p in data)
    assert 'cv_text' not in str(data) and 'form_fields' not in str(data)


@pytest.mark.parametrize('params',[{'min_score':'nan'},{'min_score':11},{'page':'abc'},{'ordering':'invalid'},{'keywords':','.join('term'+str(i) for i in range(21))}])
def test_invalid_filters_rejected(auth_client,params):
    c,_,_=auth_client()
    assert c.get('/api/recruitment-profiles/',params).status_code==400


@pytest.mark.parametrize('role,permissions',[('collaborator',[]),('collaborator',['court_communications_only']),('admin',['player_enrollments_only'])])
def test_restricted_users_and_public_never_access_profiles(auth_client,role,permissions):
    c,_,_=auth_client(role=role,section_permissions=permissions)
    for client in (c,APIClient()):
        assert client.get('/api/recruitment-profiles/').status_code in [401,403]
        assert client.post('/api/recruitment-profiles/import/',{},format='json').status_code in [401,403]
