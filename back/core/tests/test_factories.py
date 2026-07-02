import pytest

from core.models import AttendanceRecord, Charge, Payment
from core.tests.factories import (
    make_attendance_record,
    make_attendance_session,
    make_charge,
    make_payment,
    make_site,
    make_student,
    make_team,
    make_tournament,
)


@pytest.mark.django_db
def test_factories_create_minimal_billing_and_attendance_graphs():
    site = make_site(code="factory-site")
    student = make_student(site=site)
    charge = make_charge(student=student)
    payment = make_payment(charge)
    session = make_attendance_session(site=site)
    record = make_attendance_record(session=session, student=student)

    assert Charge.objects.filter(id=charge.id, site=site, student=student).exists()
    assert Payment.objects.filter(id=payment.id, charge=charge, student=student).exists()
    assert AttendanceRecord.objects.filter(id=record.id, session=session, student=student).exists()


@pytest.mark.django_db
def test_factories_create_team_charge_when_no_student_is_used():
    tournament = make_tournament()
    team = make_team(tournament=tournament)
    charge = make_charge(team=team)

    assert charge.student is None
    assert charge.team == team
    assert charge.site == tournament.site


def test_auth_client_logs_in_without_seed_demo(auth_client):
    client, payload, user = auth_client(role="cashier", primary_site=make_site())

    response = client.get("/api/auth/me/")

    assert response.status_code == 200
    assert payload["id"] == user.id
    assert response.json()["username"] == user.username
