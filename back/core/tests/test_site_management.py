import pytest
from core.models import Court, Site
from core.tests.factories import make_site, make_student, make_user

pytestmark = [pytest.mark.api, pytest.mark.django_db]


def confirmation(api_client, site):
    response = api_client.get(f'/api/sites/{site.pk}/deletion-preview/')
    assert response.status_code == 200, response.content
    return {'confirmation_token': response.json()['confirmation_token'], 'confirmation_name': site.name, 'accept_permanent': True}


def test_admin_can_create_edit_and_delete_empty_site(api_client):
    api_client.force_authenticate(make_user())
    result = api_client.post('/api/sites/', {'name': 'Sede de prueba', 'code': 'sede-prueba'}, format='json')
    assert result.status_code == 201, result.content
    site_id = result.json()['id']
    url = f'/api/sites/{site_id}/'
    result = api_client.patch(url, {'name': 'Nombre actualizado', 'is_active': False}, format='json')
    assert result.status_code == 200
    assert result.json()['is_active'] is False
    assert api_client.delete(url, {}, format='json').status_code == 400
    assert api_client.delete(url, confirmation(api_client, Site.objects.get(pk=site_id)), format='json').status_code == 200
    assert not Site.objects.filter(pk=site_id).exists()


def test_admin_can_inspect_site_associations_without_changing_data(api_client):
    from core.tests.factories import make_team, make_tournament

    site = make_site(name='Scorpions', code='scorpions')
    student = make_student(site=site)
    court = Court.objects.create(site=site, name='Cancha principal')
    team = make_team(tournament=make_tournament(site=site), name='Scorpions A')
    user = make_user(role='cashier', primary_site=site)
    api_client.force_authenticate(make_user())

    response = api_client.get(f'/api/sites/{site.pk}/associations/')

    assert response.status_code == 200, response.content
    data = response.json()
    assert data['read_only'] is True
    assert data['site']['name'] == 'Scorpions'
    assert data['accounts'] == [{'username': user.username, 'role': 'cashier', 'is_active': True}]
    assert data['students'][0]['id'] == student.pk
    assert data['courts'][0]['id'] == court.pk
    assert data['tournaments'][0]['teams'][0]['id'] == team.pk
    assert Site.objects.filter(pk=site.pk).exists()
    assert type(student).objects.filter(pk=student.pk).exists()


@pytest.mark.parametrize('role', ['collaborator', 'cashier', 'coach', 'site_coordinator'])
def test_non_admin_cannot_inspect_site_associations(api_client, role):
    site = make_site()
    api_client.force_authenticate(make_user(role=role, primary_site=site))
    assert api_client.get(f'/api/sites/{site.pk}/associations/').status_code == 403


@pytest.mark.parametrize('related', ['student', 'court', 'user'])
def test_site_deletion_removes_reviewed_linked_records(api_client, related):
    site = make_site()
    api_client.force_authenticate(make_user())
    if related == 'student':
        record = make_student(site=site)
    elif related == 'court':
        record = Court.objects.create(site=site, name='Cancha')
    else:
        record = make_user(role='cashier', primary_site=site)
    result = api_client.delete(f'/api/sites/{site.pk}/', confirmation(api_client, site), format='json')
    assert result.status_code == 200, result.content
    assert not Site.objects.filter(pk=site.pk).exists()
    assert not type(record).objects.filter(pk=record.pk).exists()


@pytest.mark.parametrize('role', ['collaborator', 'cashier', 'coach', 'site_coordinator'])
def test_non_admin_cannot_change_or_delete_sites(api_client, role):
    site = make_site()
    api_client.force_authenticate(make_user(role=role, primary_site=site))
    assert api_client.post('/api/sites/', {'name': 'No', 'code': 'no'}, format='json').status_code == 403
    assert api_client.patch(f'/api/sites/{site.pk}/', {'name': 'No'}, format='json').status_code == 403
    assert api_client.delete(f'/api/sites/{site.pk}/', {'confirm_name': site.name}, format='json').status_code == 403
    assert Site.objects.filter(pk=site.pk).exists()
    assert api_client.get(f'/api/sites/{site.pk}/deletion-preview/').status_code == 403


def test_changed_plan_requires_new_confirmation(api_client):
    site = make_site()
    api_client.force_authenticate(make_user())
    payload = confirmation(api_client, site)
    make_student(site=site)
    assert api_client.delete(f'/api/sites/{site.pk}/', payload, format='json').status_code == 409
    assert Site.objects.filter(pk=site.pk).exists()


def test_shared_tutor_keeps_other_child_and_removes_child_without_debt(api_client):
    first = make_student()
    second = make_student(guardian=first.guardian)
    api_client.force_authenticate(make_user())
    result = api_client.delete(f'/api/sites/{first.site_id}/', confirmation(api_client, first.site), format='json')
    assert result.status_code == 200, result.content
    assert not type(first).objects.filter(pk=first.pk).exists()
    second.refresh_from_db()


def test_user_token_revoked_on_deletion(api_client):
    from rest_framework.authtoken.models import Token
    site = make_site()
    user = make_user(primary_site=site)
    token = Token.objects.create(user=user)
    api_client.force_authenticate(make_user())
    result = api_client.delete(f'/api/sites/{site.pk}/', confirmation(api_client, site), format='json')
    assert result.status_code == 200, result.content
    assert not Token.objects.filter(pk=token.pk).exists()
    user.refresh_from_db()
    assert user.primary_site_id is None
    assert not user.is_active


@pytest.mark.parametrize('role', ['adult_player', 'adult_representative', 'guardian', 'coach'])
def test_personal_accounts_are_preserved_and_can_be_reactivated(api_client, role):
    from django.contrib.auth import authenticate
    from core.tests.factories import DEFAULT_PASSWORD
    site = make_site()
    user = make_user(role=role, primary_site=site)
    original_password = user.password
    api_client.force_authenticate(make_user())
    preview = api_client.get(f'/api/sites/{site.pk}/deletion-preview/').json()
    assert preview['accounts'] == []
    assert preview['retained_accounts'] == [{'username': user.username, 'role': user.get_role_display()}]
    result = api_client.delete(f'/api/sites/{site.pk}/', confirmation(api_client, site), format='json')
    assert result.status_code == 200, result.content
    user.refresh_from_db()
    assert user.password == original_password
    assert not user.is_active and user.primary_site_id is None
    assert authenticate(username=user.username, password=DEFAULT_PASSWORD) is None
    user.primary_site = make_site()
    user.is_active = True
    user.save()
    assert authenticate(username=user.username, password=DEFAULT_PASSWORD).pk == user.pk


def test_deletes_all_site_charges_and_payments_but_not_other_site(api_client):
    from core.models import Charge, Payment, User
    from core.tests.factories import make_charge, make_payment
    charge = make_charge()
    payment = make_payment(charge)
    other_charge = make_charge()
    other_payment = make_payment(other_charge)
    cashier_id = payment.received_by_id
    api_client.force_authenticate(make_user())
    preview = api_client.get(f'/api/sites/{charge.site_id}/deletion-preview/').json()
    assert preview['accounts'] == [{'username': payment.received_by.username, 'role': 'Cajero'}]
    result = api_client.delete(f'/api/sites/{charge.site_id}/', confirmation(api_client, charge.site), format='json')
    assert result.status_code == 200, result.content
    assert not Charge.objects.filter(pk=charge.pk).exists()
    assert not Payment.objects.filter(pk=payment.pk).exists()
    assert not User.objects.filter(pk=cashier_id).exists()
    other_charge.refresh_from_db()
    other_payment.refresh_from_db()
    assert other_payment.received_by.is_active


def test_changed_retained_account_requires_new_confirmation(api_client):
    site = make_site()
    user = make_user(role='coach', primary_site=site)
    api_client.force_authenticate(make_user())
    payload = confirmation(api_client, site)
    user.role = 'cashier'
    user.save()
    assert api_client.delete(f'/api/sites/{site.pk}/', payload, format='json').status_code == 409
    user.refresh_from_db()
    assert user.is_active


def test_preserves_accounts_linked_through_profiles_without_primary_site(api_client):
    from core.tests.factories import make_guardian, make_player, make_team
    player_user = make_user(role='adult_player')
    representative = make_user(role='adult_representative')
    guardian_user = make_user(role='guardian')
    team = make_team(representative_user=representative)
    player = make_player(team=team, user=player_user)
    guardian = make_guardian(user=guardian_user)
    student = make_student(site=team.tournament.site, guardian=guardian)
    api_client.force_authenticate(make_user())
    result = api_client.delete(f'/api/sites/{student.site_id}/', confirmation(api_client, student.site), format='json')
    assert result.status_code == 200, result.content
    for user in [player_user, representative, guardian_user]:
        user.refresh_from_db()
        assert not user.is_active and user.primary_site_id is None
    assert not type(player).objects.filter(pk=player.pk).exists()


def test_cross_site_cashier_payment_survives_deleted_cashier(api_client):
    from core.tests.factories import make_charge, make_payment
    site = make_site()
    coach = make_user(role='coach', primary_site=site)
    cashier = make_user(role='cashier', primary_site=site)
    other_payment = make_payment(make_charge(), received_by=cashier)
    api_client.force_authenticate(make_user())
    result = api_client.delete(f'/api/sites/{site.pk}/', confirmation(api_client, site), format='json')
    assert result.status_code == 200, result.content
    coach.refresh_from_db()
    assert not type(cashier).objects.filter(pk=cashier.pk).exists()
    other_payment.refresh_from_db()
    assert not coach.is_active and coach.primary_site_id is None
    assert other_payment.received_by_id is None


def test_shared_guardian_debt_and_abonos_survive_and_remain_visible(api_client):
    from decimal import Decimal
    from core.models import Charge, Student, Payment
    from core.tests.factories import make_guardian, make_charge, make_payment, make_discount
    from core.domain_serializers.money import charge_balance
    site = make_site()
    guardian_user = make_user(role='guardian', primary_site=site)
    guardian = make_guardian(user=guardian_user)
    child = make_student(site=site, guardian=guardian)
    sibling = make_student(guardian=guardian)
    charge = make_charge(student=child, amount=1000)
    cashier = make_user(role='cashier', primary_site=site)
    payment = make_payment(charge, received_by=cashier, amount=200)
    discount = make_discount(charge=charge, requested_by=cashier, status='approved', amount=100)
    paid = make_charge(student=child, status='paid')
    api_client.force_authenticate(make_user())
    detail = api_client.get(f'/api/sites/{site.pk}/deletion-preview/').json()
    assert detail['blockers'] == []
    assert Decimal(detail['preserved_debts'][0]['balance']) == Decimal('700')
    payload = confirmation(api_client, site)
    response = api_client.delete(f'/api/sites/{site.pk}/', payload, format='json')
    assert response.status_code == 200, response.content
    assert not Site.objects.filter(pk=site.pk).exists()
    assert not Student.objects.filter(pk=child.pk).exists()
    assert not Charge.objects.filter(pk=paid.pk).exists()
    sibling.refresh_from_db()
    guardian_user.refresh_from_db()
    assert guardian_user.is_active and guardian_user.primary_site_id == sibling.site_id
    charge.refresh_from_db(); payment.refresh_from_db(); discount.refresh_from_db()
    assert charge.student_id is None and charge.site_id is None
    assert charge.retained_guardian_id == guardian.pk
    assert charge.original_student_name == child.full_name
    assert charge_balance(charge) == Decimal('700')
    assert payment.site_id is None and payment.received_by_id is None
    api_client.force_authenticate(guardian_user)
    response = api_client.get(f'/api/charges/{charge.pk}/')
    assert response.status_code == 200, response.content
    assert response.json()['student_name'] == child.full_name
    assert api_client.get(f'/api/payments/{payment.pk}/').status_code == 200
    api_client.force_authenticate(make_user(role='guardian'))
    assert api_client.get(f'/api/charges/{charge.pk}/').status_code == 404
    assert api_client.get(f'/api/payments/{payment.pk}/').status_code == 404
    api_client.force_authenticate(make_user(role='cashier'))
    assert api_client.get(f'/api/charges/{charge.pk}/').status_code == 404
    assert api_client.get(f'/api/payments/{payment.pk}/').status_code == 404
    api_client.force_authenticate(make_user())
    response = api_client.post('/api/payments/', {'charge': charge.pk, 'method': 'card', 'channel': 'card_link', 'amount': '700'}, format='json')
    assert response.status_code == 201, response.content
    api_client.force_authenticate(guardian_user)
    response = api_client.post(f"/api/payments/{response.json()['id']}/simulate-webhook/")
    assert response.status_code == 200, response.content
    charge.refresh_from_db()
    assert charge.status == 'paid'
