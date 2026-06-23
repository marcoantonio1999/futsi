from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from core.models import (
    AttendanceRecord,
    AttendanceSession,
    CashMovement,
    Charge,
    DailyClosure,
    Expense,
    Guardian,
    Match,
    Payment,
    Player,
    Round,
    Site,
    Student,
    StudentTournamentRegistration,
    Team,
    Tournament,
    User,
)


SITE_NAMES = [
    "Betis Tecam",
    "Jokers",
    "Strangers",
    "Atletico SP",
    "Coquetos",
    "La Plebe FC",
    "Palmeiras",
    "Lazimach",
    "Mainz",
    "New Castle",
    "Scorpions",
    "River",
    "Peduk FC",
]


class Command(BaseCommand):
    help = "Renombra sedes y agrega datos demo balanceados en Supabase sin borrar informacion existente."

    def handle(self, *args, **options):
        with transaction.atomic():
            admin = self._admin_user()
            sites = self._sync_sites()
            totals = {
                "sites": len(sites),
                "coaches": 0,
                "students": 0,
                "teams": 0,
                "matches": 0,
                "charges": 0,
                "payments": 0,
                "expenses": 0,
                "sessions": 0,
            }
            for index, site in enumerate(sites, start=1):
                coaches = self._coaches(site, admin, index)
                students = self._students(site, admin, index)
                tournament, teams = self._tournament(site, admin, index)
                totals["coaches"] += len(coaches)
                totals["students"] += len(students)
                totals["teams"] += len(teams)
                totals["matches"] += self._matches(site, tournament, teams, admin, index)
                totals["charges"] += self._student_finance(site, students, admin, index)
                totals["payments"] += self._team_finance(site, tournament, teams, admin, index)
                totals["expenses"] += self._expenses(site, admin, index)
                totals["sessions"] += self._attendance(site, tournament, teams, students, admin, index)
                self._cash_and_closure(site, admin, index)

        self.stdout.write(self.style.SUCCESS(f"Supabase demo balanceado: {totals}"))

    def _admin_user(self):
        user = User.objects.filter(role__in=["admin", "owner", "dev"]).order_by("id").first()
        if user:
            return user
        return User.objects.create_user(
            username="admin",
            password="admin12345",
            email="admin@futsi.local",
            first_name="Admin",
            last_name="Futsi",
            role="admin",
            is_staff=True,
            is_superuser=True,
        )

    def _sync_sites(self):
        existing = list(Site.objects.order_by("id"))
        while len(existing) < len(SITE_NAMES):
            number = len(existing) + 1
            site = Site.objects.create(
                name=f"Temporal Sede {number}",
                code=f"temporal-sede-{number}",
                address="CDMX",
                latitude=Decimal("19.400000") + Decimal(number) / Decimal("1000"),
                longitude=Decimal("-99.150000") - Decimal(number) / Decimal("1000"),
            )
            existing.append(site)

        for site in existing:
            site.name = f"tmp-site-{site.id}"
            site.code = f"tmp-site-{site.id}"
            site.save(update_fields=["name", "code", "updated_at"])

        active_sites = []
        for index, name in enumerate(SITE_NAMES):
            site = existing[index]
            site.name = name
            site.code = slugify(name)
            site.address = f"Cancha {name}, CDMX"
            site.latitude = Decimal("19.340000") + Decimal(index) / Decimal("500")
            site.longitude = Decimal("-99.220000") + Decimal(index) / Decimal("700")
            site.is_active = True
            site.save(update_fields=["name", "code", "address", "latitude", "longitude", "is_active", "updated_at"])
            active_sites.append(site)

        for site in existing[len(SITE_NAMES) :]:
            site.is_active = False
            site.save(update_fields=["is_active", "updated_at"])
        return active_sites

    def _coaches(self, site, admin, site_index):
        coaches = []
        for index, group_suffix in enumerate(("Sub-12 A", "Sub-12 B"), start=1):
            username = f"coach.{site.code}.{index}"
            email = f"{username}@demo.local"
            user, created = User.objects.update_or_create(
                username=username,
                defaults={
                    "email": email,
                    "first_name": f"Coach {site.name}",
                    "last_name": group_suffix,
                    "role": "coach",
                    "primary_site": site,
                    "phone": f"57{site_index:02d}{index:06d}"[:10],
                    "coach_group_name": f"{site.name} {group_suffix}",
                    "coach_hourly_rate": Decimal("260") + Decimal(site_index * 5),
                    "is_active": True,
                },
            )
            if created or not user.has_usable_password():
                user.set_password("demo12345")
                user.save(update_fields=["password"])
            coaches.append(user)
        return coaches

    def _students(self, site, admin, site_index):
        students = []
        for index in range(1, 13):
            group_name = f"{site.name} {'Sub-12 A' if index <= 6 else 'Sub-12 B'}"
            guardian, _ = Guardian.objects.update_or_create(
                email=f"familia.{site.code}.{index:02d}@demo.local",
                defaults={
                    "full_name": f"Familia {site.name} {index:02d}",
                    "phone": f"55{site_index:02d}{index:06d}"[:10],
                    "tax_name": f"Familia {site.name} {index:02d}",
                    "tax_id": "XAXX010101000",
                },
            )
            status = "active" if index <= 9 else "trial"
            student, _ = Student.objects.update_or_create(
                site=site,
                full_name=f"Alumno {site.name} {index:02d}",
                defaults={
                    "guardian": guardian,
                    "birth_date": date(2013 + (index % 3), ((index - 1) % 12) + 1, min(index, 28)),
                    "category": "Sub-12",
                    "group_name": group_name,
                    "status": status,
                    "uniform_status": "delivered" if index % 3 else "pending",
                    "emergency_contact": guardian.full_name,
                    "emergency_phone": guardian.phone,
                    "joined_at": timezone.localdate() - timedelta(days=45 + index),
                },
            )
            students.append(student)
        return students

    def _tournament(self, site, admin, site_index):
        tournament, _ = Tournament.objects.update_or_create(
            site=site,
            name=f"Liga {site.name} Apertura",
            defaults={
                "billing_type": "weekly_match",
                "starts_on": timezone.localdate() - timedelta(days=21),
                "expected_weeks": 8,
                "is_active": True,
            },
        )
        teams = []
        for index, suffix in enumerate(("A", "B", "C", "D"), start=1):
            team, _ = Team.objects.update_or_create(
                tournament=tournament,
                name=f"{site.name} {suffix}",
                defaults={
                    "representative_name": f"Capitan {site.name} {suffix}",
                    "representative_phone": f"56{site_index:02d}{index:06d}"[:10],
                    "representative_email": f"capitan.{site.code}.{suffix.lower()}@demo.local",
                    "is_active": True,
                },
            )
            teams.append(team)
            for player_index in range(1, 8):
                Player.objects.update_or_create(
                    team=team,
                    full_name=f"Jugador {team.name} {player_index:02d}",
                    defaults={
                        "phone": f"55{site_index:02d}{index:02d}{player_index:04d}"[:10],
                        "email": f"jugador.{site.code}.{suffix.lower()}.{player_index:02d}@demo.local",
                        "jersey_number": player_index,
                        "is_active": True,
                    },
                )
        return tournament, teams

    def _matches(self, site, tournament, teams, admin, site_index):
        count = 0
        base_day = timezone.localdate() - timedelta(days=14)
        for round_number in range(1, 5):
            round_obj, _ = Round.objects.update_or_create(
                tournament=tournament,
                number=round_number,
                defaults={"starts_on": base_day + timedelta(days=round_number * 7), "ends_on": base_day + timedelta(days=round_number * 7 + 1)},
            )
            pairings = ((teams[0], teams[1]), (teams[2], teams[3]))
            for match_index, (home, away) in enumerate(pairings, start=1):
                played_on = base_day + timedelta(days=round_number * 7)
                status = "finished" if round_number <= 3 else "scheduled"
                Match.objects.update_or_create(
                    tournament=tournament,
                    round=round_obj,
                    home_team=home,
                    away_team=away,
                    played_on=played_on,
                    defaults={
                        "site": site,
                        "starts_at": time(18 + match_index, 0),
                        "duration_minutes": 60,
                        "home_goals": (site_index + round_number + match_index) % 5 if status == "finished" else 0,
                        "away_goals": (site_index + round_number + match_index + 2) % 5 if status == "finished" else 0,
                        "status": status,
                        "updated_by": admin,
                    },
                )
                count += 1
        return count

    def _student_finance(self, site, students, admin, site_index):
        count = 0
        today = timezone.localdate()
        for index, student in enumerate(students, start=1):
            amount = Decimal("850") + Decimal((index % 4) * 50)
            charge, _ = Charge.objects.get_or_create(
                site=site,
                student=student,
                team=None,
                concept=f"Mensualidad {today:%Y-%m}",
                defaults={
                    "description": f"Mensualidad academia {site.name}",
                    "amount": amount,
                    "due_date": today.replace(day=10),
                    "status": "paid" if index % 4 else "pending",
                    "created_by": admin,
                },
            )
            count += 1
            if index % 4:
                Payment.objects.get_or_create(
                    reference=f"demo-student-{site.code}-{student.id}-{today:%Y%m}",
                    defaults={
                        "site": site,
                        "charge": charge,
                        "student": student,
                        "method": ["cash", "transfer", "card"][index % 3],
                        "channel": ["cash_confirmation", "transfer_clabe", "card_terminal"][index % 3],
                        "status": "registered",
                        "amount": amount,
                        "paid_at": timezone.now() - timedelta(days=index),
                        "confirmed_at": timezone.now() - timedelta(days=index),
                        "received_by": admin,
                        "notes": "Pago demo balanceado.",
                    },
                )
        return count

    def _team_finance(self, site, tournament, teams, admin, site_index):
        payments = 0
        today = timezone.localdate()
        for index, team in enumerate(teams, start=1):
            amount = Decimal("1800") + Decimal(index * 150)
            charge, _ = Charge.objects.get_or_create(
                site=site,
                student=None,
                team=team,
                concept=f"Jornada {today:%Y-%m} {index}",
                defaults={
                    "description": f"Pago semanal {tournament.name}",
                    "amount": amount,
                    "due_date": today - timedelta(days=index),
                    "status": "paid" if index <= 3 else "partial",
                    "created_by": admin,
                },
            )
            Payment.objects.get_or_create(
                reference=f"demo-team-{site.code}-{team.id}-{today:%Y%m}",
                defaults={
                    "site": site,
                    "charge": charge,
                    "team": team,
                    "method": ["transfer", "card", "cash", "transfer"][index - 1],
                    "channel": ["transfer_clabe", "card_terminal", "cash_confirmation", "transfer_clabe"][index - 1],
                    "status": "registered",
                    "amount": amount if index <= 3 else amount / Decimal("2"),
                    "paid_at": timezone.now() - timedelta(days=index + 1),
                    "confirmed_at": timezone.now() - timedelta(days=index + 1),
                    "received_by": admin,
                    "notes": "Pago adulto demo balanceado.",
                },
            )
            payments += 1
        return payments

    def _expenses(self, site, admin, site_index):
        categories = [
            ("Arbitraje", Decimal("750")),
            ("Renta cancha", Decimal("1200")),
            ("Material", Decimal("480")),
        ]
        count = 0
        for index, (category, amount) in enumerate(categories, start=1):
            Expense.objects.update_or_create(
                site=site,
                category=category,
                description=f"{category} {site.name} demo",
                expense_date=timezone.localdate() - timedelta(days=index * 3),
                defaults={
                    "amount": amount + Decimal(site_index * 25),
                    "provider_name": f"Proveedor {category}",
                    "status": "approved",
                    "captured_by": admin,
                    "approved_by": admin,
                    "approved_at": timezone.now() - timedelta(days=index * 3),
                },
            )
            count += 1
        return count

    def _attendance(self, site, tournament, teams, students, admin, site_index):
        sessions = 0
        session_date = timezone.localdate() - timedelta(days=2)
        session, _ = AttendanceSession.objects.update_or_create(
            site=site,
            session_type="academy_class",
            date=session_date,
            group_name=f"{site.name} Sub-12",
            defaults={
                "starts_at": time(18, 0),
                "ends_at": time(19, 0),
                "duration_minutes": 60,
                "captured_by": admin,
            },
        )
        sessions += 1
        for index, student in enumerate(students, start=1):
            AttendanceRecord.objects.update_or_create(
                session=session,
                student=student,
                defaults={
                    "team": None,
                    "status": "present" if index <= 9 else "absent",
                    "captured_by": admin,
                    "had_debt_at_capture": index % 4 == 0,
                },
            )
        match = Match.objects.filter(tournament=tournament, status="finished").order_by("-played_on").first()
        if match:
            match_session, _ = AttendanceSession.objects.update_or_create(
                site=site,
                session_type="tournament_match",
                date=match.played_on,
                match=match,
                defaults={
                    "starts_at": match.starts_at,
                    "ends_at": time((match.starts_at.hour + 1) % 24, match.starts_at.minute) if match.starts_at else time(20, 0),
                    "duration_minutes": match.duration_minutes,
                    "tournament": tournament,
                    "round": match.round,
                    "captured_by": admin,
                },
            )
            sessions += 1
            for team in (match.home_team, match.away_team):
                AttendanceRecord.objects.update_or_create(
                    session=match_session,
                    student=None,
                    team=team,
                    defaults={"status": "present", "captured_by": admin, "had_debt_at_capture": False},
                )
        return sessions

    def _cash_and_closure(self, site, admin, site_index):
        day = timezone.localdate()
        CashMovement.objects.get_or_create(
            site=site,
            movement_type="cash_in",
            movement_date=day,
            reason=f"Corte demo {site.name}",
            defaults={
                "amount": Decimal("2500") + Decimal(site_index * 120),
                "responsible": admin,
                "created_by": admin,
                "notes": "Ingreso demo para tablero.",
            },
        )
        DailyClosure.objects.update_or_create(
            site=site,
            business_date=day,
            defaults={
                "closed_by": admin,
                "closed_at": datetime.combine(day, time(22, 0), tzinfo=timezone.get_current_timezone()),
                "cash_expected": Decimal("2500") + Decimal(site_index * 120),
                "cash_reported": Decimal("2480") + Decimal(site_index * 120),
                "notes": "Cierre demo balanceado.",
            },
        )
