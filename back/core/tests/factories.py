from __future__ import annotations

from decimal import Decimal
from itertools import count
from datetime import timedelta

from django.utils import timezone

from core.models import (
    AuditLog,
    AttendanceRecord,
    AttendanceSession,
    AttendanceSessionType,
    AttendanceStatus,
    CashMovement,
    CashMovementType,
    Charge,
    ChargeStatus,
    Discount,
    DiscountStatus,
    Expense,
    ExpenseStatus,
    Guardian,
    Invoice,
    InvoiceKind,
    Match,
    Payment,
    PaymentChannel,
    PaymentMethod,
    PaymentStatus,
    Player,
    Round,
    Site,
    StaffPaymentKind,
    StaffPaymentRequest,
    Student,
    StudentAssessment,
    StudentStatus,
    StudentTournamentRegistration,
    StudentValueAssessment,
    Team,
    Tournament,
    TournamentBillingType,
    User,
)


_sequence = count(1)
DEFAULT_PASSWORD = "test12345"


def _next(label: str) -> str:
    return f"{label}-{next(_sequence)}"


def make_site(**overrides) -> Site:
    token = _next("site")
    data = {
        "name": f"QA Site {token}",
        "code": token,
        "address": "QA generated site",
    }
    data.update(overrides)
    return Site.objects.create(**data)


def make_user(role: str = "admin", primary_site: Site | None = None, password: str = DEFAULT_PASSWORD, **overrides) -> User:
    token = _next("user")
    data = {
        "username": token,
        "email": f"{token}@futsi.test",
        "first_name": "QA",
        "last_name": role.replace("_", " ").title(),
        "role": role,
        "primary_site": primary_site,
        "is_staff": role in {"admin", "owner", "dev"},
        "is_superuser": role in {"admin", "owner"},
    }
    data.update(overrides)
    user = User.objects.create_user(password=password, **data)
    return user


def make_guardian(user: User | None = None, **overrides) -> Guardian:
    token = _next("guardian")
    data = {
        "user": user,
        "full_name": f"QA Guardian {token}",
        "phone": f"55{next(_sequence):08d}"[:10],
        "email": f"{token}@futsi.test",
    }
    data.update(overrides)
    return Guardian.objects.create(**data)


def make_student(site: Site | None = None, guardian: Guardian | None = None, **overrides) -> Student:
    site = site or make_site()
    guardian = guardian or make_guardian()
    token = _next("student")
    data = {
        "site": site,
        "guardian": guardian,
        "full_name": f"QA Student {token}",
        "category": "Sub-10",
        "group_name": "QA Group",
        "status": StudentStatus.ACTIVE,
    }
    data.update(overrides)
    return Student.objects.create(**data)


def make_tournament(site: Site | None = None, **overrides) -> Tournament:
    site = site or make_site()
    token = _next("tournament")
    data = {
        "site": site,
        "name": f"QA Tournament {token}",
        "billing_type": TournamentBillingType.WEEKLY_MATCH,
        "starts_on": timezone.localdate(),
        "expected_weeks": 8,
        "is_active": True,
    }
    data.update(overrides)
    return Tournament.objects.create(**data)


def make_team(tournament: Tournament | None = None, **overrides) -> Team:
    tournament = tournament or make_tournament()
    token = _next("team")
    data = {
        "tournament": tournament,
        "name": f"QA Team {token}",
        "representative_name": f"QA Representative {token}",
        "representative_phone": f"56{next(_sequence):08d}"[:10],
        "representative_email": f"{token}@futsi.test",
    }
    data.update(overrides)
    return Team.objects.create(**data)


def make_player(team: Team | None = None, user: User | None = None, **overrides) -> Player:
    team = team or make_team()
    token = _next("player")
    data = {
        "team": team,
        "user": user,
        "full_name": f"QA Player {token}",
        "phone": f"57{next(_sequence):08d}"[:10],
        "email": f"{token}@futsi.test",
        "jersey_number": next(_sequence) % 99 or 1,
        "is_active": True,
    }
    data.update(overrides)
    return Player.objects.create(**data)


def make_match(
    tournament: Tournament | None = None,
    site: Site | None = None,
    home_team: Team | None = None,
    away_team: Team | None = None,
    **overrides,
) -> Match:
    tournament = tournament or make_tournament(site=site)
    site = site or tournament.site
    home_team = home_team or make_team(tournament=tournament)
    away_team = away_team or make_team(tournament=tournament)
    data = {
        "tournament": tournament,
        "site": site,
        "home_team": home_team,
        "away_team": away_team,
        "played_on": timezone.localdate(),
        "starts_at": timezone.localtime().time().replace(microsecond=0),
        "duration_minutes": 120,
        "status": "scheduled",
    }
    data.update(overrides)
    return Match.objects.create(**data)


def make_round(tournament: Tournament | None = None, **overrides) -> Round:
    tournament = tournament or make_tournament()
    data = {
        "tournament": tournament,
        "number": next(_sequence),
        "starts_on": timezone.localdate(),
        "ends_on": timezone.localdate() + timedelta(days=6),
    }
    data.update(overrides)
    return Round.objects.create(**data)


def make_student_tournament_registration(
    tournament: Tournament | None = None,
    student: Student | None = None,
    team: Team | None = None,
    registered_by: User | None = None,
    **overrides,
) -> StudentTournamentRegistration:
    tournament = tournament or make_tournament()
    student = student or make_student(site=tournament.site)
    team = team or make_team(tournament=tournament)
    registered_by = registered_by or make_user(role="admin", primary_site=tournament.site)
    data = {
        "tournament": tournament,
        "student": student,
        "team": team,
        "billing_type": TournamentBillingType.WEEKLY_MATCH,
        "weekly_amount": Decimal("650.00"),
        "full_amount": Decimal("7800.00"),
        "billing_starts_on": timezone.localdate(),
        "status": "registered",
        "registered_by": registered_by,
    }
    data.update(overrides)
    return StudentTournamentRegistration.objects.create(**data)


def make_student_assessment(
    student: Student | None = None,
    coach: User | None = None,
    site: Site | None = None,
    **overrides,
) -> StudentAssessment:
    student = student or make_student(site=site)
    site = site or student.site
    coach = coach or make_user(role="coach", primary_site=site)
    data = {
        "student": student,
        "coach": coach,
        "site": site,
        "assessment_month": timezone.localdate().replace(day=1),
        "pace": 70,
        "shooting": 70,
        "passing": 70,
        "dribbling": 70,
        "defense": 70,
        "physical": 70,
        "attitude": 70,
    }
    data.update(overrides)
    return StudentAssessment.objects.create(**data)


def make_student_value_assessment(
    student: Student | None = None,
    coach: User | None = None,
    site: Site | None = None,
    **overrides,
) -> StudentValueAssessment:
    student = student or make_student(site=site)
    site = site or student.site
    coach = coach or make_user(role="coach", primary_site=site)
    data = {
        "student": student,
        "coach": coach,
        "site": site,
        "assessment_month": timezone.localdate().replace(day=1),
        "respect": 70,
        "discipline": 70,
        "teamwork": 70,
        "responsibility": 70,
        "sportsmanship": 70,
    }
    data.update(overrides)
    return StudentValueAssessment.objects.create(**data)


def make_charge(
    student: Student | None = None,
    team: Team | None = None,
    site: Site | None = None,
    created_by: User | None = None,
    **overrides,
) -> Charge:
    if student is None and team is None:
        student = make_student(site=site)
    site = site or (student.site if student is not None else team.tournament.site)
    created_by = created_by or make_user(role="admin", primary_site=site)
    token = _next("charge")
    data = {
        "site": site,
        "student": student,
        "team": team,
        "concept": "Mensualidad",
        "description": f"QA charge {token}",
        "amount": Decimal("1000.00"),
        "due_date": timezone.localdate(),
        "status": ChargeStatus.PENDING,
        "created_by": created_by,
    }
    data.update(overrides)
    return Charge.objects.create(**data)


def make_payment(
    charge: Charge,
    status: str = PaymentStatus.REGISTERED,
    received_by: User | None = None,
    **overrides,
) -> Payment:
    received_by = received_by or make_user(role="cashier", primary_site=charge.site)
    data = {
        "site": charge.site,
        "charge": charge,
        "student": charge.student,
        "team": charge.team,
        "method": PaymentMethod.CASH,
        "channel": PaymentChannel.CASH_CONFIRMATION,
        "status": status,
        "amount": charge.amount,
        "paid_at": timezone.now(),
        "received_by": received_by,
    }
    data.update(overrides)
    return Payment.objects.create(**data)


def make_discount(
    charge: Charge | None = None,
    student: Student | None = None,
    team: Team | None = None,
    site: Site | None = None,
    requested_by: User | None = None,
    approved_by: User | None = None,
    **overrides,
) -> Discount:
    charge = charge or make_charge(student=student, team=team, site=site)
    student = student or charge.student
    team = team or charge.team
    site = site or charge.site
    requested_by = requested_by or make_user(role="cashier", primary_site=site)
    data = {
        "site": site,
        "charge": charge,
        "student": student,
        "team": team,
        "reason": "QA discount",
        "amount": Decimal("100.00"),
        "status": DiscountStatus.REQUESTED,
        "requested_by": requested_by,
        "approved_by": approved_by,
    }
    data.update(overrides)
    return Discount.objects.create(**data)


def make_expense(
    site: Site | None = None,
    captured_by: User | None = None,
    approved_by: User | None = None,
    **overrides,
) -> Expense:
    site = site or make_site()
    captured_by = captured_by or make_user(role="cashier", primary_site=site)
    data = {
        "site": site,
        "category": "QA gasto",
        "description": "QA generated expense",
        "provider_name": "QA Provider",
        "amount": Decimal("500.00"),
        "expense_date": timezone.localdate(),
        "status": ExpenseStatus.PENDING,
        "captured_by": captured_by,
        "approved_by": approved_by,
    }
    data.update(overrides)
    return Expense.objects.create(**data)


def make_staff_payment_request(
    site: Site | None = None,
    recipient: User | None = None,
    requested_by: User | None = None,
    **overrides,
) -> StaffPaymentRequest:
    site = site or make_site()
    recipient = recipient or make_user(role="coach", primary_site=site)
    requested_by = requested_by or make_user(role="admin", primary_site=site)
    data = {
        "site": site,
        "recipient": recipient,
        "kind": StaffPaymentKind.COACH,
        "amount": Decimal("700.00"),
        "requested_payment_date": timezone.localdate(),
        "description": "QA staff payment",
        "payment_method": "cash",
        "requested_by": requested_by,
    }
    data.update(overrides)
    return StaffPaymentRequest.objects.create(**data)


def make_cash_movement(
    site: Site | None = None,
    responsible: User | None = None,
    created_by: User | None = None,
    staff_payment_request: StaffPaymentRequest | None = None,
    **overrides,
) -> CashMovement:
    site = site or (staff_payment_request.site if staff_payment_request is not None else make_site())
    responsible = responsible or make_user(role="cashier", primary_site=site)
    created_by = created_by or make_user(role="admin", primary_site=site)
    data = {
        "site": site,
        "movement_type": CashMovementType.CASH_OUT,
        "amount": Decimal("300.00"),
        "movement_date": timezone.localdate(),
        "reason": "QA cash movement",
        "responsible": responsible,
        "created_by": created_by,
        "staff_payment_request": staff_payment_request,
    }
    data.update(overrides)
    return CashMovement.objects.create(**data)


def make_invoice(
    site: Site | None = None,
    student: Student | None = None,
    guardian: Guardian | None = None,
    charge: Charge | None = None,
    payment: Payment | None = None,
    expense: Expense | None = None,
    issued_by: User | None = None,
    **overrides,
) -> Invoice:
    if charge is not None:
        site = site or charge.site
        student = student or charge.student
        guardian = guardian or (student.guardian if student is not None else None)
    elif payment is not None:
        site = site or payment.site
        student = student or payment.student
        guardian = guardian or (student.guardian if student is not None else None)
        charge = charge or payment.charge
    elif expense is not None:
        site = site or expense.site
    else:
        student = student or make_student(site=site)
        site = site or student.site
        guardian = guardian or student.guardian
    issued_by = issued_by or make_user(role="accounting", primary_site=site)
    data = {
        "kind": InvoiceKind.INCOME,
        "site": site,
        "student": student,
        "guardian": guardian,
        "charge": charge,
        "payment": payment,
        "expense": expense,
        "recipient_name": guardian.full_name if guardian is not None else "QA Recipient",
        "recipient_tax_id": "XAXX010101000",
        "recipient_email": guardian.email if guardian is not None else "",
        "concept": "QA invoice",
        "subtotal": Decimal("1000.00"),
        "tax": Decimal("160.00"),
        "total": Decimal("1160.00"),
        "issued_by": issued_by,
    }
    data.update(overrides)
    return Invoice.objects.create(**data)


def make_audit_log(actor: User | None = None, **overrides) -> AuditLog:
    actor = actor or make_user(role="admin")
    token = _next("audit")
    data = {
        "actor": actor,
        "action": "qa.action",
        "table_name": "qa_table",
        "record_id": token,
        "previous_values": {},
        "new_values": {"record_id": token},
        "metadata": {},
    }
    data.update(overrides)
    return AuditLog.objects.create(**data)


def make_attendance_session(
    site: Site | None = None,
    captured_by: User | None = None,
    **overrides,
) -> AttendanceSession:
    site = site or make_site()
    captured_by = captured_by or make_user(role="coach", primary_site=site)
    data = {
        "site": site,
        "session_type": AttendanceSessionType.ACADEMY_CLASS,
        "date": timezone.localdate(),
        "starts_at": timezone.localtime().time().replace(microsecond=0),
        "duration_minutes": 90,
        "group_name": "QA Group",
        "captured_by": captured_by,
    }
    data.update(overrides)
    return AttendanceSession.objects.create(**data)


def make_attendance_record(
    session: AttendanceSession | None = None,
    student: Student | None = None,
    captured_by: User | None = None,
    **overrides,
) -> AttendanceRecord:
    session = session or make_attendance_session()
    student = student or make_student(site=session.site, group_name=session.group_name)
    captured_by = captured_by or session.captured_by
    data = {
        "session": session,
        "student": student,
        "status": AttendanceStatus.PRESENT,
        "captured_by": captured_by,
    }
    data.update(overrides)
    return AttendanceRecord.objects.create(**data)
