import pytest

from core.models import Guardian, Student
from core.tests.factories import make_guardian, make_site, make_user

pytestmark = [pytest.mark.api, pytest.mark.django_db]


@pytest.mark.parametrize('guardian_payload', [{}, {'guardian': None}, {'guardian': ''}])
def test_create_and_list_student_without_guardian(auth_client, guardian_payload):
    site = make_site()
    client, _, _ = auth_client(role='site_coordinator', primary_site=site)
    count = Guardian.objects.count()
    response = client.post('/api/students/', {'full_name': 'Alumno sin tutor', 'site': site.pk, **guardian_payload}, format='multipart') if guardian_payload == {'guardian': ''} else client.post('/api/students/', {'full_name': 'Alumno sin tutor', 'site': site.pk, **guardian_payload}, format='json')
    assert response.status_code == 201, response.content
    student = Student.objects.get(pk=response.json()['id'])
    assert student.guardian_id is None
    assert Guardian.objects.count() == count
    listed = client.get('/api/students/').json()
    assert any(row['id'] == student.pk and row['guardian'] is None for row in listed)
    assert client.get(f'/api/students/{student.pk}/').status_code == 200


def test_guardian_can_be_assigned_and_removed_later(auth_client):
    site = make_site()
    client, _, _ = auth_client(role='site_coordinator', primary_site=site)
    student = Student.objects.create(site=site, full_name='Pendiente de tutor')
    guardian = make_guardian()
    response = client.patch(f'/api/students/{student.pk}/', {'guardian': guardian.pk}, format='json')
    assert response.status_code == 200, response.content
    student.refresh_from_db()
    assert student.guardian_id == guardian.pk
    response = client.patch(f'/api/students/{student.pk}/', {'guardian': None}, format='json')
    assert response.status_code == 200, response.content
    student.refresh_from_db()
    assert student.guardian_id is None


def test_guardian_account_cannot_see_unassigned_students(auth_client):
    site = make_site()
    user = make_user(role='guardian', primary_site=site)
    make_guardian(user=user)
    student = Student.objects.create(site=site, full_name='Sin asignar')
    client, _, _ = auth_client(user=user)
    assert all(row['id'] != student.pk for row in client.get('/api/students/').json())
    assert client.get(f'/api/students/{student.pk}/').status_code == 404
