import uuid
import pytest
from django.utils import timezone
from core.exam_models import RecruitmentExamAttempt
from core.exam_second_stage import QUESTIONS
from core.tests.test_exam_second_stage import first_exam, submit_first
from core.tests.test_exam_export import book

pytestmark=pytest.mark.django_db


@pytest.mark.parametrize('selected',[False,True])
def test_second_stage_in_both_exports_with_filterable_numeric_and_detail_tables(auth_client,selected):
    admin,_,_=auth_client();exam=first_exam(admin);parent=submit_first(exam)
    grades={'1':{'points':8,'reason':'Razón uno','review':True,
                 'criteria':[{'id':'iniciativa','points':2,'reason':'Identifica el problema'}]},
            '2':{'points':7,'reason':'Razón dos','review':False},
            '3':{'points':9,'reason':'Razón tres','review':False}}
    child=RecruitmentExamAttempt.objects.create(exam_id=exam['second_stage']['id'],first_stage_attempt=parent,
       start_key=uuid.uuid4(),name=parent.name,email=parent.email,phone=parent.phone,
       submitted_at=timezone.now(),snapshot={'questions':QUESTIONS,'duration_minutes':60},
       answers={'1':'=Texto literal','2':'Prioricé','3':'Propongo una visita'},
       grading_status='graded',grading={'score':8,'questions':grades,'review':True,'rubric_version':'human_review_v2_20261104'})
    response=admin.get('/api/recruitment-exams/export/',{'exam':exam['id']} if selected else {})
    wb=book(response)
    assert wb.sheetnames==['Evaluaciones','Respuestas','Segunda fase','Respuestas segunda fase']
    assert wb['Evaluaciones'].max_row==2  # The child is not duplicated as a first-stage row.
    for sheet in wb:
        assert sheet.auto_filter.ref is None and len(sheet.tables)==1
        table=next(iter(sheet.tables.values()))
        assert table.autoFilter and table.autoFilter.ref==table.ref
    evaluations=list(wb['Evaluaciones'].values)
    combined=dict(zip(evaluations[0],evaluations[1]))
    assert combined['Primera fase: calificación / 10']==10
    assert combined['Segunda fase: estado']=='Calificado'
    assert combined['Segunda fase: total / 30']==24
    assert combined['Segunda fase: promedio / 10']==8
    assert combined['Segunda fase: proactividad / 10']==8
    assert combined['Segunda fase: responsabilidad / 10']==7
    assert combined['Segunda fase: WhatsApp / 10']==9
    summary=list(wb['Segunda fase'].values)
    result=dict(zip(summary[0],summary[1]))
    assert result['Total / 30']==24 and result['Promedio segunda / 10']==8
    assert result['Primera fase / 10']==10 and result['Respuesta comercial']=='Propongo una visita'
    detail=list(wb['Respuestas segunda fase'].values)
    assert len(detail)==4
    first=dict(zip(detail[0],detail[1]))
    assert first['ID segunda entrega']==child.id and first['Enunciado']==QUESTIONS[0]['prompt']
    assert first['Respuesta del participante']=='=Texto literal' and first['Puntos / 10']==8
    assert first['Criterios de calificación']=='Iniciativa: hasta 3; acciones: hasta 4; resultado: hasta 3.'
    assert 'Iniciativa: 2 puntos. Identifica el problema' in first['Desglose por criterio']
    assert wb['Respuestas segunda fase']['H2'].data_type=='s'
