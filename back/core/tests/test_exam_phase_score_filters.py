import uuid
import pytest
from django.utils import timezone
from core.exam_models import RecruitmentExamAttempt
from core.tests.test_exam_profiles import attempt
from core.tests.test_exam_second_stage import first_exam
from core.tests.test_exam_result_dates import ids, export_ids

pytestmark = pytest.mark.django_db


def test_combined_phase_minimums_and_export(auth_client):
    client, _, _ = auth_client(); exam = first_exam(client)
    good = attempt(exam, 1, 8); low_first = attempt(exam, 2, 7); low_second = attempt(exam, 3, 9)
    no_second = attempt(exam, 4, 10); pending = attempt(exam, 5, 9)
    malformed = attempt(exam, 6, 9)
    for first, points, status in [(good,[8,8,8],'graded'), (low_first,[10,10,10],'graded'),
                                  (low_second,[8,8,7],'graded'), (pending,[10,10,10],'pending'),
                                  (malformed,[10,10,None],'graded')]:
        RecruitmentExamAttempt.objects.create(exam_id=exam['second_stage']['id'], first_stage_attempt=first,
            start_key=uuid.uuid4(),name=first.name,email=first.email,phone=first.phone,submitted_at=timezone.now(),
            snapshot={'questions':[], 'duration_minutes':60},grading_status=status,
            grading={'questions':{str(i):{'points':p} for i,p in enumerate(points,1)}})
    params={'first_min_score':'8','second_min_score':'24'}
    result=ids(client.get(f'/api/recruitment-exams/{exam["id"]}/',params))
    assert result==[good.id]
    assert export_ids(client.get('/api/recruitment-exams/export/',{'exam':exam['id'],**params}))==result
    assert set(ids(client.get(f'/api/recruitment-exams/{exam["id"]}/',{'second_min_score':'0'})))=={good.id,low_first.id,low_second.id}
    assert no_second.id in ids(client.get(f'/api/recruitment-exams/{exam["id"]}/',{'first_min_score':'10'}))


@pytest.mark.parametrize('params',[{'first_min_score':'11'},{'second_min_score':'31'},{'second_min_score':'nan'},{'first_min_score':'-1'}])
def test_bad_phase_minimums_rejected_for_list_and_export(auth_client,params):
    client,_,_=auth_client();exam=first_exam(client)
    assert client.get(f'/api/recruitment-exams/{exam["id"]}/',params).status_code==400
    assert client.get('/api/recruitment-exams/export/',{'exam':exam['id'],**params}).status_code==400
