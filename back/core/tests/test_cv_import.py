import pytest
from rest_framework.test import APIClient
from core.cv_import import cv_contacts,cv_digest
from core.exam_models import RecruitmentProfile
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam

pytestmark=pytest.mark.django_db
URL='/api/recruitment-profiles/import-cv/'


def cv(a,body='Experiencia en Excel, Python y SQL.'):
    return f'{a.name}\nCorreo: {a.email}\nCelular: +52 {a.phone}\nPERFIL\n{body}\nEXPERIENCIA LABORAL\nReferencias: jefe@example.invalid, 5599999999'


def test_extracts_only_header_contacts_not_reference_employer_or_id():
    text='Persona Ficticia\nRFC: 5500000000\nNSS: 5511111111\nEmail: QA@example.invalid\nTel: +52 (55) 0012-3456\n55 0012 3456\nExperiencia laboral\nEmpresa anterior\njefe@example.invalid\n5533333333'
    assert cv_contacts(text)==(['qa@example.invalid'],['5500123456'])
    assert cv_contacts('Persona Ficticia\nEXPERIENCIA\nJefe: boss@example.invalid\nTel: 5500000000')==([],[])


def test_preview_then_automatic_update_only_cv_preserving_other_data(auth_client):
    c,_,user=auth_client(role='collaborator',section_permissions=['veronica_only']);e=create_exam(c);a=attempt(e)
    p=RecruitmentProfile.objects.create(attempt=a,updated_by=user,cv_text='CV anterior',cv_search='cv anterior',position='Puesto confirmado',form_text='Formato existente',form_fields={'software':'Excel'})
    body=cv(a)
    r=c.post(URL,{'cv_text':body,'exam':e['id']},format='json');assert r.status_code==200,r.content
    preview=r.json();assert preview['match_status']=='matched' and preview['candidate']['id']==a.pk
    p.refresh_from_db();assert p.cv_text=='CV anterior'
    result=c.post(URL,{'cv_text':body,'exam':e['id'],'commit':True,'expected_cv_hash':preview['expected_cv_hash']},format='json')
    assert result.json()=={'saved':True,'unchanged':False,'attempt_id':a.pk}
    p.refresh_from_db();a.refresh_from_db()
    assert p.cv_text==body and p.cv_search.startswith('persona ficticia')
    assert p.position=='Puesto confirmado' and p.form_text=='Formato existente' and p.form_fields=={'software':'Excel'}
    assert a.grading['score']==8 and a.answers=={}
    assert c.get('/api/recruitment-profiles/?keywords=python').json()['count']==1
    again=c.post(URL,{'cv_text':body,'commit':True,'expected_cv_hash':cv_digest(body)},format='json')
    assert again.json()['unchanged'] is True


def test_can_create_cv_on_existing_exam_profile_without_any_binary(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e)
    before=c.post(URL,{'cv_text':cv(a)},format='json').json()
    assert not RecruitmentProfile.objects.exists()
    assert c.post(URL,{'cv_text':cv(a),'commit':True,'expected_cv_hash':before['expected_cv_hash']},format='json').status_code==200
    assert RecruitmentProfile.objects.get().cv_text==cv(a)


def test_shared_contacts_across_postulations_require_scope(auth_client):
    c,_,_=auth_client();e=create_exam(c);other=create_exam(c);a=attempt(e);attempt(other)
    r=c.post(URL,{'cv_text':cv(a)},format='json').json()
    assert r['match_status']=='ambiguous' and r['candidate'] is None
    assert c.post(URL,{'cv_text':cv(a),'commit':True,'expected_cv_hash':cv_digest('')},format='json').status_code==409
    assert c.post(URL,{'cv_text':cv(a),'exam':e['id']},format='json').json()['match_status']=='matched'
    assert not RecruitmentProfile.objects.exists()


@pytest.mark.parametrize('mode',['no_contact','no_match','conflict','multiple_emails','multiple_phones'])
def test_non_unique_or_missing_contacts_never_write(auth_client,mode):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e);b=attempt(e,2)
    body={'no_contact':a.name+'\nExcel Python',
          'no_match':'Correo: missing@example.invalid\n5555555555',
          'conflict':f'Correo: {a.email}\nTel: {b.phone}',
          'multiple_emails':f'{a.email}\n{b.email}',
          'multiple_phones':f'{a.phone}\n{b.phone}'}[mode]
    result=c.post(URL,{'cv_text':body},format='json').json()
    assert result['match_status'] in {'unmatched','conflict','ambiguous_contacts'}
    assert result['candidate'] is None
    assert c.post(URL,{'cv_text':body,'commit':True,'expected_cv_hash':cv_digest('')},format='json').status_code==409
    assert not RecruitmentProfile.objects.exists()


def test_concurrent_manual_edit_is_not_overwritten(auth_client):
    c,_,user=auth_client();e=create_exam(c);a=attempt(e)
    data=c.post(URL,{'cv_text':cv(a)},format='json').json()
    RecruitmentProfile.objects.create(attempt=a,updated_by=user,cv_text='Corrección manual más reciente')
    result=c.post(URL,{'cv_text':cv(a),'commit':True,'expected_cv_hash':data['expected_cv_hash']},format='json')
    assert result.status_code==409
    assert RecruitmentProfile.objects.get().cv_text=='Corrección manual más reciente'


@pytest.mark.parametrize('data',[{}, {'cv_text':' '},{'cv_text':'x'*80001},{'cv_text':{}}, {'cv_text':'CV','file':'%PDF'},{'cv_text':'CV','attempt_id':1},{'cv_text':'CV','exam':'abc'}])
def test_validation_and_text_only_contract(auth_client,data):
    c,_,_=auth_client();assert c.post(URL,data,format='json').status_code==400
    assert not RecruitmentProfile.objects.exists()


def test_no_match_by_name_or_filename_and_unsubmitted_excluded(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e,submitted=False)
    assert c.post(URL,{'cv_text':cv(a)},format='json').json()['match_status']=='unmatched'
    assert c.post(URL,{'cv_text':cv(a),'commit':True,'expected_cv_hash':cv_digest('')},format='json').status_code==409


def test_current_hash_required_before_update(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e)
    assert c.post(URL,{'cv_text':cv(a),'commit':True},format='json').status_code==400


@pytest.mark.parametrize('role,permissions',[('collaborator',[]),('collaborator',['court_communications_only']),('admin',['player_enrollments_only'])])
def test_hr_only_permission(auth_client,role,permissions):
    c,_,_=auth_client(role=role,section_permissions=permissions)
    for client in [c,APIClient()]:
        assert client.post(URL,{'cv_text':'CV'},format='json').status_code in (401,403)


def test_no_contacts_in_footer_or_references():
    emails,phones=cv_contacts('Persona Ficticia\nPerfil profesional\nREFERENCIAS\nref@example.invalid\n5500000000')
    assert not emails and not phones


def test_column_contacts_after_experience_require_exact_name_and_contact(auth_client):
    c,_,_=auth_client(); e=create_exam(c); a=attempt(e)
    body=f'{a.name}\nEXPERIENCIA LABORAL\nGestión de documentos\n' + ('\n\nTrabajo administrativo\n'*30) + f'\nCONTACTO\n{a.email}\n{a.phone}'
    assert c.post(URL,{'cv_text':body},format='json').json()['candidate']['id']==a.id
    # A reference or employer contact cannot identify a differently named applicant.
    other=body.replace(a.name,'Otra Persona Ficticia')
    assert c.post(URL,{'cv_text':other},format='json').json()['match_status']=='unmatched'
    refs=f'{a.name}\nEXPERIENCIA\nTrabajo\nREFERENCIAS\n{a.email}\n{a.phone}'
    assert c.post(URL,{'cv_text':refs},format='json').json()['match_status']=='unmatched'


def test_blank_lines_do_not_hide_header_contacts_and_disagreement_stays_manual(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e)
    body=f'{a.name}\n'+('Perfil profesional\n\n'*25)+f'{a.email}\n{a.phone}'
    assert c.post(URL,{'cv_text':body},format='json').json()['match_status']=='matched'
    body=f'{a.name}\nEXPERIENCIA\nTrabajo\nCONTACTO\nother@example.invalid\n{a.phone}'
    assert c.post(URL,{'cv_text':body},format='json').json()['match_status']!='matched'


def test_email_spacing_and_reference_only_name_do_not_create_wrong_match(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e)
    spaced=a.email.replace('@',' @ ')
    assert c.post(URL,{'cv_text':f'{a.name}\nCorreo: {spaced}\n{a.phone}'},format='json').json()['match_status']=='matched'
    body=f'Otra Persona Ficticia\nEXPERIENCIA\n{a.phone}\nREFERENCIAS\n{a.name}\n{a.email}'
    assert c.post(URL,{'cv_text':body},format='json').json()['match_status']=='unmatched'


def test_invisible_pdf_nul_characters_are_removed_before_saving(auth_client):
    c,_,_=auth_client();e=create_exam(c);a=attempt(e)
    body=cv(a)+'\nMicrosoft\x00 Office'
    data=c.post(URL,{'cv_text':body},format='json').json()
    result=c.post(URL,{'cv_text':body,'commit':True,'expected_cv_hash':data['expected_cv_hash']},format='json')
    assert result.status_code==200
    p=RecruitmentProfile.objects.get(attempt=a)
    assert '\x00' not in p.cv_text and 'Microsoft Office' in p.cv_text
    assert c.post(f'/api/recruitment-profiles/{a.id}/',{'cv_text':'Texto\x00 del CV'},format='json').status_code==200
    p.refresh_from_db();assert p.cv_text=='Texto del CV'
