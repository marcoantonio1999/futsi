from datetime import timedelta

from django.db.models import Prefetch

from .common import *


def _money(value, fallback="0"):
    try:
        return Decimal(str(value))
    except Exception:
        return Decimal(fallback)


def _month_name(month):
    names = [
        "enero",
        "febrero",
        "marzo",
        "abril",
        "mayo",
        "junio",
        "julio",
        "agosto",
        "septiembre",
        "octubre",
        "noviembre",
        "diciembre",
    ]
    return names[month - 1]


def _academy_monthly_amount(site):
    latest = (
        Charge.objects.filter(site=site, student__isnull=False, concept__icontains="Mensualidad")
        .exclude(status="canceled")
        .order_by("-created_at")
        .first()
    )
    if latest:
        return latest.amount
    defaults = {
        "roma": Decimal("1500.00"),
        "coyoacan": Decimal("1350.00"),
        "santa-fe": Decimal("1600.00"),
    }
    return defaults.get(site.code, Decimal("1500.00"))


def _team_weekly_amount(team):
    latest = (
        Charge.objects.filter(team=team, concept__icontains="Jornada")
        .exclude(status="canceled")
        .order_by("-created_at")
        .first()
    )
    if latest:
        return latest.amount
    site_latest = (
        Charge.objects.filter(site=team.tournament.site, team__isnull=False, concept__icontains="Jornada")
        .exclude(status="canceled")
        .order_by("-created_at")
        .first()
    )
    return site_latest.amount if site_latest else Decimal("750.00")


def _team_tournament_amount(team):
    latest = (
        Charge.objects.filter(team=team, concept__icontains="Torneo completo")
        .exclude(status="canceled")
        .order_by("-created_at")
        .first()
    )
    if latest:
        return latest.amount
    return Decimal("4200.00")


def _student_tournament_weekly_amount(registration):
    if registration.weekly_amount:
        return registration.weekly_amount
    latest = (
        Charge.objects.filter(
            site=registration.tournament.site,
            student__isnull=False,
            concept__icontains="Jornada torneo",
        )
        .exclude(status="canceled")
        .order_by("-created_at")
        .first()
    )
    return latest.amount if latest else Decimal("650.00")


def _student_tournament_full_amount(registration):
    if registration.full_amount:
        return registration.full_amount
    weeks = registration.tournament.expected_weeks or 12
    return _student_tournament_weekly_amount(registration) * weeks


def _next_friday(today):
    # weekday: lunes=0, viernes=4. Para jornada semanal usamos viernes como corte de pago.
    days = (4 - today.weekday()) % 7
    return today + timedelta(days=days)


def _tournament_week_number(tournament, due_date):
    if not tournament.starts_on:
        return 1
    delta = (due_date - tournament.starts_on).days
    return max(1, min((tournament.expected_weeks or 12), (delta // 7) + 1))


def _third_round_due_date(tournament, today):
    third_round = tournament.rounds.filter(number=3).order_by("starts_on").first()
    if third_round and (third_round.ends_on or third_round.starts_on):
        return third_round.ends_on or third_round.starts_on
    if tournament.starts_on:
        return tournament.starts_on + timedelta(days=21)
    return today + timedelta(days=21)


def generate_student_tournament_charges_for_user(user, today=None):
    today = today or timezone.localdate()
    created = []
    registrations = StudentTournamentRegistration.objects.select_related(
        "tournament",
        "tournament__site",
        "student",
        "student__guardian",
        "team",
    ).filter(status="registered", tournament__is_active=True)

    if user.role == "guardian":
        registrations = registrations.filter(student__guardian__user=user)
    elif user.role == "cashier" and user.primary_site_id:
        registrations = registrations.filter(tournament__site=user.primary_site)
    elif user.role in {"coach"} and user.primary_site_id:
        registrations = registrations.filter(tournament__site=user.primary_site)
    elif user.role not in {"admin", "dev", "owner", "accounting", "site_coordinator"}:
        registrations = registrations.none()

    registrations = list(registrations.distinct())
    weekly_due = _next_friday(today)
    weekly_targets = {}
    full_registration_ids = []
    for registration in registrations:
        billing_starts_on = registration.billing_starts_on or registration.tournament.starts_on or today
        if registration.billing_type == "weekly_match":
            expected_weeks = registration.tournament.expected_weeks or 12
            if weekly_due < billing_starts_on:
                continue
            jornada_number = _tournament_week_number(registration.tournament, weekly_due)
            if jornada_number > expected_weeks:
                continue
            weekly_targets[registration.id] = jornada_number
        elif registration.billing_type == "full_tournament":
            full_registration_ids.append(registration.id)

    existing_weekly_registrations = set()
    if weekly_targets:
        existing_weekly_registrations = set(
            Charge.objects.filter(
                tournament_registration_id__in=weekly_targets.keys(),
                jornada_number__in=set(weekly_targets.values()),
                concept="Jornada torneo alumno",
            )
            .exclude(status="canceled")
            .values_list("tournament_registration_id", "jornada_number")
        )
    existing_full_registration_ids = set()
    if full_registration_ids:
        existing_full_registration_ids = set(
            Charge.objects.filter(
                tournament_registration_id__in=full_registration_ids,
                concept="Torneo completo alumno",
            )
            .exclude(status="canceled")
            .values_list("tournament_registration_id", flat=True)
        )

    for registration in registrations:
        if registration.billing_type == "weekly_match":
            jornada_number = weekly_targets.get(registration.id)
            if not jornada_number or (registration.id, jornada_number) in existing_weekly_registrations:
                continue
            charge = Charge.objects.create(
                site=registration.tournament.site,
                student=registration.student,
                tournament_registration=registration,
                jornada_number=jornada_number,
                concept="Jornada torneo alumno",
                description=f"{registration.tournament.name} - jornada {jornada_number} - generado automatico",
                amount=_student_tournament_weekly_amount(registration),
                due_date=weekly_due,
                created_by=user,
            )
            created.append(charge)
        elif registration.billing_type == "full_tournament":
            if registration.id in existing_full_registration_ids:
                continue
            due_date = _third_round_due_date(registration.tournament, today)
            charge = Charge.objects.create(
                site=registration.tournament.site,
                student=registration.student,
                tournament_registration=registration,
                concept="Torneo completo alumno",
                description=f"{registration.tournament.name} - pago completo antes de jornada 3",
                amount=_student_tournament_full_amount(registration),
                due_date=due_date,
                created_by=user,
            )
            created.append(charge)
    return created


def generate_scheduled_charges_for_user(user, today=None):
    today = today or timezone.localdate()
    created = []
    month_due = date(today.year, today.month, 10)
    month_label = f"{_month_name(today.month)} {today.year}"

    students = Student.objects.select_related("site", "guardian").filter(status__in=["active", "injured"])
    teams = Team.objects.select_related("tournament", "tournament__site").filter(tournament__is_active=True)

    if user.role == "guardian":
        students = students.filter(guardian__user=user)
        teams = teams.none()
    elif user.role == "cashier" and user.primary_site_id:
        students = students.filter(site=user.primary_site)
        teams = teams.filter(tournament__site=user.primary_site)
    elif user.role == "adult_representative":
        students = students.none()
        teams = teams.filter(representative_user=user)
    elif user.role == "adult_player":
        students = students.none()
        teams = teams.filter(players__user=user)
    elif user.role not in {"admin", "dev", "owner", "accounting", "site_coordinator"}:
        students = students.none()
        teams = teams.none()

    students = list(students.distinct())
    student_ids = [student.id for student in students]
    existing_monthly_student_ids = set()
    if student_ids:
        existing_monthly_student_ids = set(
            Charge.objects.filter(
                student_id__in=student_ids,
                concept="Mensualidad",
                due_date__year=today.year,
                due_date__month=today.month,
            )
            .exclude(status="canceled")
            .values_list("student_id", flat=True)
        )
    academy_amount_by_site = {}

    for student in students:
        if student.id in existing_monthly_student_ids:
            continue
        if student.site_id not in academy_amount_by_site:
            academy_amount_by_site[student.site_id] = _academy_monthly_amount(student.site)
        charge = Charge.objects.create(
            site=student.site,
            student=student,
            concept="Mensualidad",
            description=f"Mensualidad {month_label} - generado automatico",
            amount=academy_amount_by_site[student.site_id],
            due_date=month_due,
            created_by=user,
        )
        created.append(charge)

    weekly_due = _next_friday(today)
    iso_year, iso_week, _ = weekly_due.isocalendar()
    weekly_description = f"Jornada semana {iso_week} {iso_year} - generado automatico"

    teams = list(teams.distinct())
    team_ids = [team.id for team in teams]
    existing_weekly_team_ids = set()
    if team_ids:
        existing_weekly_team_ids = set(
            Charge.objects.filter(
                team_id__in=team_ids,
                concept="Jornada torneo",
                due_date=weekly_due,
            )
            .exclude(status="canceled")
            .values_list("team_id", flat=True)
        )
    full_description_by_team = {
        team.id: f"Torneo completo {team.tournament.name} - generado automatico"
        for team in teams
        if team.tournament.billing_type == "full_tournament"
    }
    existing_full_teams = set()
    if full_description_by_team:
        existing_full_teams = set(
            Charge.objects.filter(
                team_id__in=full_description_by_team.keys(),
                concept="Torneo completo",
                description__in=full_description_by_team.values(),
            )
            .exclude(status="canceled")
            .values_list("team_id", "description")
        )

    for team in teams:
        if team.tournament.billing_type == "weekly_match":
            if team.id in existing_weekly_team_ids:
                continue
            charge = Charge.objects.create(
                site=team.tournament.site,
                team=team,
                concept="Jornada torneo",
                description=weekly_description,
                amount=_team_weekly_amount(team),
                due_date=weekly_due,
                created_by=user,
            )
            created.append(charge)
        elif team.tournament.billing_type == "full_tournament":
            full_description = full_description_by_team[team.id]
            if (team.id, full_description) in existing_full_teams:
                continue
            due_date = team.tournament.starts_on + timedelta(days=21) if team.tournament.starts_on else today + timedelta(days=7)
            charge = Charge.objects.create(
                site=team.tournament.site,
                team=team,
                concept="Torneo completo",
                description=full_description,
                amount=_team_tournament_amount(team),
                due_date=due_date,
                created_by=user,
            )
            created.append(charge)

    created.extend(generate_student_tournament_charges_for_user(user, today))
    return created

