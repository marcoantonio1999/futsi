import pytest
from core.exam_models import RecruitmentProfile
from core.recruitment_form_filters import age_value, salary_value, duration_months, reported_experience
from core.tests.test_exam_profiles import attempt
from core.tests.test_recruitment_exams import create_exam

pytestmark=pytest.mark.django_db


@pytest.mark.parametrize('text,expected', [('31',31),('31 años',31),('Prefiero no responder',None),('25-30',None),('0',None)])
def test_age(text,expected):
    assert age_value(text)==expected


@pytest.mark.parametrize('text,expected', [('$12,500.50 mensuales',12500.5),('15 mil pesos',15000),('15000',15000),('12,000 a 15,000',None),('500 por semana',None),('No aplica',None)])
def test_salary(text,expected):
    assert salary_value(text)==expected


@pytest.mark.parametrize('text,expected', [('2 años 6 meses',30),('1 año y 3 meses',15),('6 meses',6),('1.5 años',18),('2',None),('2 a 3 años',None),('No aplica',None)])
def test_duration(text,expected):
    assert duration_months(text)==expected


def test_experience_is_sum_of_known_durations_and_unknown_never_zero():
    assert reported_experience({'empleo_1_compania':'Empresa','empleo_1_tiempo_servicio':'2 años','empleo_2_compania':'Otra','empleo_2_tiempo_servicio':'6 meses'})==30
    assert reported_experience({'empleo_1_compania':'Empresa','empleo_1_tiempo_servicio':'2 años','empleo_2_compania':'Otra','empleo_2_tiempo_servicio':'No aplica'}) is None
    assert reported_experience({'empleo_1_compania':'No aplica','empleo_1_tiempo_servicio':'No aplica'}) is None


def test_form_filters_combine_and_do_not_assume_unknown_values(auth_client):
    c,_,user=auth_client();exam=create_exam(c)
    for i,fields in enumerate([{'edad':'29 años','sueldo_deseado':'$15,000 mensuales','empleo_1_compania':'Empresa','empleo_1_tiempo_servicio':'2 años 6 meses'},
                               {'edad':'40','sueldo_deseado':'15 mil pesos'},
                               {'edad':'Prefiero no responder','sueldo_deseado':'15000'},
                               {'edad':'29','sueldo_deseado':'10,000 a 20,000'},{}],1):
        a=attempt(exam,i,8);RecruitmentProfile.objects.create(attempt=a,form_fields=fields,form_text='solicitud',updated_by=user)
    params={'edad_min':'25','edad_max':'35','sueldo_min':'14000','sueldo_max':'16000','experiencia_min':'2','experiencia_max':'3'}
    response=c.get('/api/recruitment-profiles/',params)
    assert response.status_code==200
    assert [p['name'] for p in response.json()['results']]==['Persona Ficticia 1']
    assert response.json()['count']==1


@pytest.mark.parametrize('params',[{'edad_min':'nan'},{'edad_min':'1.5'},{'edad_min':'121'},
                                    {'edad_min':'40','edad_max':'30'},{'sueldo_min':'-1'},
                                    {'sueldo_min':'20000','sueldo_max':'10000'}])
def test_invalid_ranges_rejected(auth_client,params):
    c,_,_=auth_client()
    assert c.get('/api/recruitment-profiles/',params).status_code==400
