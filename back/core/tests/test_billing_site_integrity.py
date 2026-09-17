import pytest
from core.models import Payment
from core.tests.factories import make_site, make_student, make_user, make_charge, make_payment

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def test_admin_cannot_create_cross_site_student_charge(api_client):
    site, student = make_site(), make_student()
    api_client.force_authenticate(make_user())
    response = api_client.post('/api/charges/', {'site': site.pk, 'student': student.pk, 'concept': 'Prueba', 'amount': '100', 'due_date': '2026-09-16'}, format='json')
    assert response.status_code == 400


@pytest.mark.parametrize('field', ['site', 'student'])
def test_partial_charge_update_checks_existing_values(api_client, field):
    charge = make_charge()
    foreign = make_student()
    api_client.force_authenticate(make_user())
    response = api_client.patch(f'/api/charges/{charge.pk}/', {field: foreign.site_id if field == 'site' else foreign.pk}, format='json')
    assert response.status_code == 400


@pytest.mark.parametrize('role', ['cashier', 'admin'])
def test_legacy_inconsistent_charge_cannot_receive_payment(api_client, role):
    site, student = make_site(), make_student()
    charge = make_charge(site=site, student=student)
    api_client.force_authenticate(make_user(role=role, primary_site=site))
    before = Payment.objects.count()
    response = api_client.post('/api/payments/', {'charge': charge.pk, 'method': 'cash', 'amount': '10'}, format='json')
    assert response.status_code == 400
    assert Payment.objects.count() == before


def test_payment_cannot_be_moved_to_other_charge(api_client):
    charge = make_charge()
    payment = make_payment(charge=charge)
    other = make_charge(site=charge.site)
    api_client.force_authenticate(make_user())
    response = api_client.patch(f'/api/payments/{payment.pk}/', {'charge': other.pk}, format='json')
    assert response.status_code == 400
    payment.refresh_from_db()
    assert payment.charge_id == charge.pk


def test_charge_with_payment_cannot_change_customer_even_same_site(api_client):
    charge = make_charge()
    make_payment(charge=charge)
    other = make_student(site=charge.site)
    api_client.force_authenticate(make_user())
    assert api_client.patch(f'/api/charges/{charge.pk}/', {'student': other.pk}, format='json').status_code == 400


def test_cashier_without_site_cannot_receive_payment(api_client):
    charge = make_charge()
    api_client.force_authenticate(make_user(role='cashier'))
    assert api_client.post('/api/payments/', {'charge': charge.pk, 'method': 'cash', 'amount': '10'}, format='json').status_code == 400


def test_demo_never_assigns_cashier_payments_to_another_site(monkeypatch):
    from django.core.management import call_command
    from django.db.models import F
    monkeypatch.setenv('FUTSI_ENV', 'test')
    monkeypatch.setenv('DJANGO_DEBUG', 'true')
    call_command('seed_demo', verbosity=0)
    assert Payment.objects.filter(received_by__role='cashier').exists()
    assert not Payment.objects.filter(received_by__role='cashier').exclude(site_id=F('received_by__primary_site_id')).exists()
