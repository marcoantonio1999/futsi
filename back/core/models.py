from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone
from uuid import uuid4


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


def generate_virtual_clabe():
    return f"646180{uuid4().int % 10**12:012d}"


class UserRole(models.TextChoices):
    ADMIN = "admin", "Administrador"
    DEV = "dev", "Dev App"
    ACCOUNTING = "accounting", "Contador"
    OWNER = "owner", "Direccion"
    SITE_COORDINATOR = "site_coordinator", "Coordinador de sede"
    CASHIER = "cashier", "Cajero"
    COACH = "coach", "Coach"
    GUARDIAN = "guardian", "Representante"
    ADULT_REPRESENTATIVE = "adult_representative", "Representante adulto"
    ADULT_PLAYER = "adult_player", "Jugador adulto"


class User(AbstractUser):
    role = models.CharField(max_length=32, choices=UserRole.choices, default=UserRole.SITE_COORDINATOR)
    primary_site = models.ForeignKey(
        "Site",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="primary_users",
    )
    phone = models.CharField(max_length=30, blank=True)
    avatar_url = models.URLField(blank=True)
    coach_group_name = models.CharField(max_length=80, blank=True)
    coach_hourly_rate = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    section_permissions = models.JSONField(default=list, blank=True)

    class Meta:
        db_table = "core_user"


class Site(TimestampedModel):
    name = models.CharField(max_length=120, unique=True)
    code = models.SlugField(max_length=40, unique=True)
    address = models.TextField(blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    close_editing_after_hours = models.PositiveSmallIntegerField(default=24)

    class Meta:
        db_table = "sites"
        ordering = ["name"]

    def __str__(self):
        return self.name


class Court(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="courts")
    name = models.CharField(max_length=80)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "courts"
        constraints = [
            models.UniqueConstraint(fields=["site", "name"], name="uq_court_site_name"),
        ]

    def __str__(self):
        return f"{self.site} - {self.name}"


class Guardian(TimestampedModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="guardian_profile",
    )
    full_name = models.CharField(max_length=160)
    phone = models.CharField(max_length=30)
    email = models.EmailField(blank=True)
    tax_name = models.CharField(max_length=180, blank=True)
    tax_id = models.CharField(max_length=20, blank=True)
    virtual_clabe = models.CharField(max_length=18, unique=True, null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "guardians"
        indexes = [
            models.Index(fields=["full_name"], name="ix_guardian_full_name"),
            models.Index(fields=["phone"], name="ix_guardian_phone"),
        ]

    def __str__(self):
        return self.full_name

    def save(self, *args, **kwargs):
        if not self.virtual_clabe:
            self.virtual_clabe = generate_virtual_clabe()
        super().save(*args, **kwargs)


class StudentStatus(models.TextChoices):
    TRIAL = "trial", "Prueba"
    ACTIVE = "active", "Activo"
    PAUSED = "paused", "Pausa"
    INJURED = "injured", "Lesion"
    DROPPED = "dropped", "Baja"


class Student(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="students")
    guardian = models.ForeignKey(Guardian, on_delete=models.PROTECT, related_name="students")
    full_name = models.CharField(max_length=160)
    birth_date = models.DateField(null=True, blank=True)
    category = models.CharField(max_length=60, blank=True)
    group_name = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=20, choices=StudentStatus.choices, default=StudentStatus.TRIAL)
    photo = models.ImageField(upload_to="students/photos/", blank=True)
    photo_url = models.URLField(blank=True)
    waiver_url = models.URLField(blank=True)
    medical_notes = models.TextField(blank=True)
    emergency_contact = models.CharField(max_length=160, blank=True)
    emergency_phone = models.CharField(max_length=30, blank=True)
    uniform_status = models.CharField(max_length=40, default="pending")
    pause_start = models.DateField(null=True, blank=True)
    pause_end = models.DateField(null=True, blank=True)
    pause_reason = models.CharField(max_length=180, blank=True)
    joined_at = models.DateField(default=timezone.localdate)

    class Meta:
        db_table = "students"
        indexes = [
            models.Index(fields=["site", "status"], name="ix_student_site_status"),
            models.Index(fields=["full_name"], name="ix_student_full_name"),
        ]

    def __str__(self):
        return self.full_name


class TournamentBillingType(models.TextChoices):
    FULL_TOURNAMENT = "full_tournament", "Torneo completo"
    WEEKLY_MATCH = "weekly_match", "Pago semanal"


class Tournament(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="tournaments")
    name = models.CharField(max_length=140)
    billing_type = models.CharField(max_length=30, choices=TournamentBillingType.choices)
    starts_on = models.DateField(null=True, blank=True)
    expected_weeks = models.PositiveSmallIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "tournaments"
        indexes = [
            models.Index(fields=["site", "is_active"], name="ix_tournament_site_active"),
        ]

    def __str__(self):
        return self.name


class Team(TimestampedModel):
    tournament = models.ForeignKey(Tournament, on_delete=models.PROTECT, related_name="teams")
    name = models.CharField(max_length=140)
    representative_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="represented_adult_teams",
    )
    representative_name = models.CharField(max_length=160)
    representative_phone = models.CharField(max_length=30)
    representative_email = models.EmailField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "teams"
        constraints = [
            models.UniqueConstraint(fields=["tournament", "name"], name="uq_team_tournament_name"),
        ]

    def __str__(self):
        return self.name


class StudentTournamentRegistration(TimestampedModel):
    tournament = models.ForeignKey(Tournament, on_delete=models.PROTECT, related_name="student_registrations")
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="tournament_registrations")
    team = models.ForeignKey(Team, null=True, blank=True, on_delete=models.SET_NULL, related_name="student_registrations")
    jersey_number = models.PositiveSmallIntegerField(null=True, blank=True)
    billing_type = models.CharField(max_length=30, choices=TournamentBillingType.choices, default=TournamentBillingType.WEEKLY_MATCH)
    weekly_amount = models.DecimalField(max_digits=12, decimal_places=2, default=650)
    full_amount = models.DecimalField(max_digits=12, decimal_places=2, default=7800)
    billing_starts_on = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=24, default="registered")
    notes = models.TextField(blank=True)
    registered_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="student_tournament_registrations")

    class Meta:
        db_table = "student_tournament_registrations"
        constraints = [
            models.UniqueConstraint(fields=["tournament", "student"], name="uq_student_tournament_registration"),
        ]
        indexes = [
            models.Index(fields=["tournament", "status"], name="ix_stu_tourn_reg_tourn_status"),
            models.Index(fields=["billing_type", "status"], name="ix_stu_reg_bill_status"),
            models.Index(fields=["student"], name="ix_stu_tourn_reg_student"),
        ]

    def __str__(self):
        return f"{self.student} - {self.tournament}"


class Player(TimestampedModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="adult_player_profile",
    )
    team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="players")
    full_name = models.CharField(max_length=160)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    jersey_number = models.PositiveSmallIntegerField(null=True, blank=True)
    photo = models.ImageField(upload_to="players/photos/", blank=True)
    photo_url = models.URLField(blank=True)
    identity_document = models.FileField(upload_to="players/ids/", blank=True)
    waiver_document = models.FileField(upload_to="players/waivers/", blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "players"
        indexes = [
            models.Index(fields=["team", "is_active"], name="ix_player_team_active"),
        ]

    def __str__(self):
        return self.full_name


class Round(TimestampedModel):
    tournament = models.ForeignKey(Tournament, on_delete=models.PROTECT, related_name="rounds")
    number = models.PositiveSmallIntegerField()
    starts_on = models.DateField(null=True, blank=True)
    ends_on = models.DateField(null=True, blank=True)

    class Meta:
        db_table = "rounds"
        constraints = [
            models.UniqueConstraint(fields=["tournament", "number"], name="uq_round_tournament_number"),
        ]


class MatchStatus(models.TextChoices):
    SCHEDULED = "scheduled", "Programado"
    LIVE = "live", "En vivo"
    FINISHED = "finished", "Finalizado"
    CANCELED = "canceled", "Cancelado"


class Match(TimestampedModel):
    tournament = models.ForeignKey(Tournament, on_delete=models.PROTECT, related_name="matches")
    round = models.ForeignKey(Round, null=True, blank=True, on_delete=models.PROTECT, related_name="matches")
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="matches")
    home_team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="home_matches")
    away_team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="away_matches")
    played_on = models.DateField(default=timezone.localdate)
    starts_at = models.TimeField(null=True, blank=True)
    duration_minutes = models.PositiveSmallIntegerField(default=120, validators=[MinValueValidator(1)])
    home_goals = models.PositiveSmallIntegerField(default=0)
    away_goals = models.PositiveSmallIntegerField(default=0)
    status = models.CharField(max_length=20, choices=MatchStatus.choices, default=MatchStatus.SCHEDULED)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="updated_matches")

    class Meta:
        db_table = "matches"
        indexes = [
            models.Index(fields=["tournament", "status"], name="ix_match_tournament_status"),
            models.Index(fields=["site", "played_on"], name="ix_match_site_played_on"),
        ]


class StudentAssessment(TimestampedModel):
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="assessments")
    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="student_assessments")
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="student_assessments")
    assessment_month = models.DateField()
    pace = models.PositiveSmallIntegerField(default=50)
    shooting = models.PositiveSmallIntegerField(default=50)
    passing = models.PositiveSmallIntegerField(default=50)
    dribbling = models.PositiveSmallIntegerField(default=50)
    defense = models.PositiveSmallIntegerField(default=50)
    physical = models.PositiveSmallIntegerField(default=50)
    attitude = models.PositiveSmallIntegerField(default=50)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "student_assessments"
        constraints = [
            models.UniqueConstraint(fields=["student", "assessment_month"], name="uq_student_assessment_month"),
            models.CheckConstraint(condition=Q(pace__gte=0, pace__lte=100), name="ck_assessment_pace_range"),
            models.CheckConstraint(condition=Q(shooting__gte=0, shooting__lte=100), name="ck_assessment_shooting_range"),
            models.CheckConstraint(condition=Q(passing__gte=0, passing__lte=100), name="ck_assessment_passing_range"),
            models.CheckConstraint(condition=Q(dribbling__gte=0, dribbling__lte=100), name="ck_assessment_dribbling_range"),
            models.CheckConstraint(condition=Q(defense__gte=0, defense__lte=100), name="ck_assessment_defense_range"),
            models.CheckConstraint(condition=Q(physical__gte=0, physical__lte=100), name="ck_assessment_physical_range"),
            models.CheckConstraint(condition=Q(attitude__gte=0, attitude__lte=100), name="ck_assessment_attitude_range"),
        ]
        indexes = [
            models.Index(fields=["student", "assessment_month"], name="ix_assessment_student_month"),
            models.Index(fields=["coach", "assessment_month"], name="ix_assessment_coach_month"),
        ]

    @property
    def overall_rating(self):
        return round((self.pace + self.shooting + self.passing + self.dribbling + self.defense + self.physical + self.attitude) / 7)


class StudentValueAssessment(TimestampedModel):
    student = models.ForeignKey(Student, on_delete=models.PROTECT, related_name="value_assessments")
    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="student_value_assessments")
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="student_value_assessments")
    assessment_month = models.DateField()
    respect = models.PositiveSmallIntegerField(default=50)
    discipline = models.PositiveSmallIntegerField(default=50)
    teamwork = models.PositiveSmallIntegerField(default=50)
    responsibility = models.PositiveSmallIntegerField(default=50)
    sportsmanship = models.PositiveSmallIntegerField(default=50)
    minutes_recommendation = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "student_value_assessments"
        constraints = [
            models.UniqueConstraint(fields=["student", "assessment_month"], name="uq_student_value_month"),
            models.CheckConstraint(condition=Q(respect__gte=0, respect__lte=100), name="ck_value_respect_range"),
            models.CheckConstraint(condition=Q(discipline__gte=0, discipline__lte=100), name="ck_value_discipline_range"),
            models.CheckConstraint(condition=Q(teamwork__gte=0, teamwork__lte=100), name="ck_value_teamwork_range"),
            models.CheckConstraint(condition=Q(responsibility__gte=0, responsibility__lte=100), name="ck_value_responsibility_range"),
            models.CheckConstraint(condition=Q(sportsmanship__gte=0, sportsmanship__lte=100), name="ck_value_sportsmanship_range"),
        ]
        indexes = [
            models.Index(fields=["student", "assessment_month"], name="ix_value_student_month"),
            models.Index(fields=["coach", "assessment_month"], name="ix_value_coach_month"),
            models.Index(fields=["site", "assessment_month"], name="ix_value_site_month"),
        ]

    @property
    def overall_values_rating(self):
        return round((self.respect + self.discipline + self.teamwork + self.responsibility + self.sportsmanship) / 5)


class AttendanceSessionType(models.TextChoices):
    ACADEMY_CLASS = "academy_class", "Clase academia"
    TOURNAMENT_MATCH = "tournament_match", "Partido torneo"


class AttendanceSession(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="attendance_sessions")
    session_type = models.CharField(max_length=30, choices=AttendanceSessionType.choices)
    date = models.DateField()
    starts_at = models.TimeField(null=True, blank=True)
    ends_at = models.TimeField(null=True, blank=True)
    duration_minutes = models.PositiveSmallIntegerField(default=120, validators=[MinValueValidator(1)])
    court = models.ForeignKey(Court, null=True, blank=True, on_delete=models.PROTECT, related_name="attendance_sessions")
    group_name = models.CharField(max_length=80, blank=True)
    tournament = models.ForeignKey(Tournament, null=True, blank=True, on_delete=models.PROTECT)
    round = models.ForeignKey(Round, null=True, blank=True, on_delete=models.PROTECT)
    team = models.ForeignKey(Team, null=True, blank=True, on_delete=models.PROTECT)
    match = models.ForeignKey(Match, null=True, blank=True, on_delete=models.PROTECT, related_name="attendance_sessions")
    captured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="captured_sessions")
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "attendance_sessions"
        indexes = [
            models.Index(fields=["site", "date"], name="ix_att_session_site_date"),
            models.Index(fields=["session_type", "date"], name="ix_att_session_type_date"),
        ]


class AttendanceStatus(models.TextChoices):
    PRESENT = "present", "Asistio"
    ABSENT = "absent", "Falto"
    JUSTIFIED = "justified", "Justificada"


class AttendanceRecord(TimestampedModel):
    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE, related_name="records")
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.PROTECT, related_name="attendance_records")
    team = models.ForeignKey(Team, null=True, blank=True, on_delete=models.PROTECT, related_name="attendance_records")
    status = models.CharField(max_length=20, choices=AttendanceStatus.choices)
    had_debt_at_capture = models.BooleanField(default=False)
    override_reason = models.TextField(blank=True)
    captured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="captured_attendance")

    class Meta:
        db_table = "attendance_records"
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(student__isnull=False, team__isnull=True)
                    | Q(student__isnull=True, team__isnull=False)
                ),
                name="ck_attendance_record_subject",
            ),
            models.UniqueConstraint(fields=["session", "student"], condition=Q(student__isnull=False), name="uq_att_record_session_student"),
            models.UniqueConstraint(fields=["session", "team"], condition=Q(team__isnull=False), name="uq_att_record_session_team"),
        ]
        indexes = [
            models.Index(fields=["session", "status"], name="ix_att_record_session_status"),
            models.Index(fields=["student"], name="ix_att_record_student"),
            models.Index(fields=["team"], name="ix_att_record_team"),
        ]


class PlayerAttendanceRecord(TimestampedModel):
    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE, related_name="player_records")
    player = models.ForeignKey(Player, on_delete=models.PROTECT, related_name="attendance_records")
    status = models.CharField(max_length=20, choices=AttendanceStatus.choices)
    had_team_debt_at_capture = models.BooleanField(default=False)
    override_reason = models.TextField(blank=True)
    captured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="captured_player_attendance")

    class Meta:
        db_table = "player_attendance_records"
        constraints = [
            models.UniqueConstraint(fields=["session", "player"], name="uq_player_att_session_player"),
        ]
        indexes = [
            models.Index(fields=["session", "status"], name="ix_player_att_session_status"),
            models.Index(fields=["player"], name="ix_player_att_player"),
        ]


class ChargeStatus(models.TextChoices):
    PENDING = "pending", "Pendiente"
    PARTIAL = "partial", "Parcial"
    PAID = "paid", "Pagado"
    CANCELED = "canceled", "Cancelado"


class Charge(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="charges")
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.PROTECT, related_name="charges")
    team = models.ForeignKey(Team, null=True, blank=True, on_delete=models.PROTECT, related_name="charges")
    tournament_registration = models.ForeignKey(StudentTournamentRegistration, null=True, blank=True, on_delete=models.PROTECT, related_name="charges")
    jornada_number = models.PositiveSmallIntegerField(null=True, blank=True)
    concept = models.CharField(max_length=80)
    description = models.CharField(max_length=180, blank=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=ChargeStatus.choices, default=ChargeStatus.PENDING)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_charges")

    class Meta:
        db_table = "charges"
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_charge_amount"),
            models.CheckConstraint(
                condition=(
                    Q(student__isnull=False, team__isnull=True)
                    | Q(student__isnull=True, team__isnull=False)
                ),
                name="ck_charge_subject",
            ),
        ]
        indexes = [
            models.Index(fields=["site", "status"], name="ix_charge_site_status"),
            models.Index(fields=["student", "status"], name="ix_charge_student_status"),
            models.Index(fields=["team", "status"], name="ix_charge_team_status"),
            models.Index(fields=["tournament_registration", "status"], name="ix_charge_tourn_reg_status"),
        ]


class PaymentMethod(models.TextChoices):
    CASH = "cash", "Efectivo"
    TRANSFER = "transfer", "Transferencia"
    CARD = "card", "Tarjeta"
    COURTESY = "courtesy", "Cortesia"


class PaymentStatus(models.TextChoices):
    PROCESSING = "processing", "En proceso"
    AWAITING_CONFIRMATION = "awaiting_confirmation", "Pendiente de aceptacion"
    REGISTERED = "registered", "Registrado"
    RECONCILED = "reconciled", "Conciliado"
    CANCELED = "canceled", "Cancelado"
    EXPIRED = "expired", "Expirado"


class PaymentChannel(models.TextChoices):
    CASH_CONFIRMATION = "cash_confirmation", "Efectivo con aceptacion"
    TRANSFER_CLABE = "transfer_clabe", "Transferencia CLABE"
    CARD_TERMINAL = "card_terminal", "Terminal"
    CARD_LINK = "card_link", "Link de pago"
    COURTESY = "courtesy", "Cortesia"


class Payment(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="payments")
    charge = models.ForeignKey(Charge, null=True, blank=True, on_delete=models.PROTECT, related_name="payments")
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.PROTECT, related_name="payments")
    team = models.ForeignKey(Team, null=True, blank=True, on_delete=models.PROTECT, related_name="payments")
    method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    channel = models.CharField(max_length=40, choices=PaymentChannel.choices, blank=True)
    status = models.CharField(max_length=32, choices=PaymentStatus.choices, default=PaymentStatus.REGISTERED)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    paid_at = models.DateTimeField(default=timezone.now)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    reference = models.CharField(max_length=120, blank=True)
    tracking_key = models.CharField(max_length=120, blank=True)
    payment_url = models.URLField(blank=True)
    receipt_file = models.FileField(upload_to="payments/receipts/", blank=True)
    received_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="received_payments")
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "payments"
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_payment_amount"),
        ]
        indexes = [
            models.Index(fields=["site", "paid_at"], name="ix_payment_site_paid_at"),
            models.Index(fields=["method", "status"], name="ix_payment_method_status"),
            models.Index(fields=["tracking_key"], name="ix_payment_tracking_key"),
        ]


class DiscountStatus(models.TextChoices):
    REQUESTED = "requested", "Solicitado"
    APPROVED = "approved", "Aprobado"
    REJECTED = "rejected", "Rechazado"
    CANCELED = "canceled", "Cancelado"


class Discount(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="discounts")
    charge = models.ForeignKey(Charge, null=True, blank=True, on_delete=models.PROTECT, related_name="discounts")
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.PROTECT, related_name="discounts")
    team = models.ForeignKey(Team, null=True, blank=True, on_delete=models.PROTECT, related_name="discounts")
    reason = models.CharField(max_length=80)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=20, choices=DiscountStatus.choices, default=DiscountStatus.REQUESTED)
    evidence_file = models.FileField(upload_to="discounts/evidence/", blank=True)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="requested_discounts")
    signed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="signed_discounts",
    )
    signed_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="approved_discounts",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "discounts"
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_discount_amount"),
        ]
        indexes = [
            models.Index(fields=["site", "status"], name="ix_discount_site_status"),
            models.Index(fields=["student", "status"], name="ix_discount_student_status"),
            models.Index(fields=["team", "status"], name="ix_discount_team_status"),
        ]


class ExpenseStatus(models.TextChoices):
    PENDING = "pending", "Pendiente"
    APPROVED = "approved", "Aprobado"
    REJECTED = "rejected", "Rechazado"
    CANCELED = "canceled", "Cancelado"


class Expense(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="expenses")
    category = models.CharField(max_length=80)
    description = models.CharField(max_length=180)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    expense_date = models.DateField(default=timezone.localdate)
    provider_name = models.CharField(max_length=160, blank=True)
    evidence_file = models.FileField(upload_to="expenses/evidence/", blank=True)
    status = models.CharField(max_length=20, choices=ExpenseStatus.choices, default=ExpenseStatus.PENDING)
    captured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="captured_expenses")
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="approved_expenses",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "expenses"
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_expense_amount"),
        ]
        indexes = [
            models.Index(fields=["site", "expense_date"], name="ix_expense_site_date"),
            models.Index(fields=["site", "status"], name="ix_expense_site_status"),
        ]


class StaffPaymentKind(models.TextChoices):
    ADMIN = "admin_payroll", "Nomina administrativa"
    COACH = "coach_payroll", "Nomina coaches"
    REFEREE = "referee_payroll", "Nomina arbitros"
    OTHER = "other_staff_payment", "Otro pago a personal"


class StaffPaymentStatus(models.TextChoices):
    REQUESTED = "requested", "Solicitado"
    ACCEPTED = "accepted", "Aceptado"
    REJECTED = "rejected", "Rechazado"
    CANCELED = "canceled", "Cancelado"


class StaffPaymentRequest(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="staff_payment_requests")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="staff_payment_requests")
    kind = models.CharField(max_length=32, choices=StaffPaymentKind.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    requested_payment_date = models.DateField(default=timezone.localdate)
    description = models.CharField(max_length=220)
    payment_method = models.CharField(max_length=20, default="cash")
    status = models.CharField(max_length=20, choices=StaffPaymentStatus.choices, default=StaffPaymentStatus.REQUESTED)
    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_staff_payment_requests")
    accepted_at = models.DateTimeField(null=True, blank=True)
    response_notes = models.TextField(blank=True)
    expense = models.ForeignKey(Expense, null=True, blank=True, on_delete=models.SET_NULL, related_name="staff_payment_requests")

    class Meta:
        db_table = "staff_payment_requests"
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_staff_payment_amount"),
        ]
        indexes = [
            models.Index(fields=["site", "status"], name="ix_staff_payment_site_status"),
            models.Index(fields=["recipient", "status"], name="ix_staff_pay_rec_status"),
            models.Index(fields=["requested_payment_date"], name="ix_staff_payment_date"),
        ]


class CashMovementType(models.TextChoices):
    CASH_IN = "cash_in", "Entrada de efectivo"
    CASH_OUT = "cash_out", "Salida por gasto"
    VAULT_TRANSFER = "vault_transfer", "Retiro a resguardo"
    ADJUSTMENT = "adjustment", "Ajuste"


class CashMovement(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="cash_movements")
    movement_type = models.CharField(max_length=24, choices=CashMovementType.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    movement_date = models.DateField(default=timezone.localdate)
    reason = models.CharField(max_length=220)
    responsible = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="responsible_cash_movements")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_cash_movements")
    staff_payment_request = models.ForeignKey(StaffPaymentRequest, null=True, blank=True, on_delete=models.SET_NULL, related_name="cash_movements")
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "cash_movements"
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="ck_cash_movement_amount"),
        ]
        indexes = [
            models.Index(fields=["site", "movement_date"], name="ix_cash_movement_site_date"),
            models.Index(fields=["site", "movement_type"], name="ix_cash_movement_site_type"),
        ]


class InvoiceKind(models.TextChoices):
    INCOME = "income", "Ingreso"
    EXPENSE = "expense", "Egreso"


class InvoiceStatus(models.TextChoices):
    ISSUED = "issued", "Emitida"
    CANCELED = "canceled", "Cancelada"


class Invoice(TimestampedModel):
    uuid = models.UUIDField(default=uuid4, unique=True, editable=False)
    kind = models.CharField(max_length=20, choices=InvoiceKind.choices)
    status = models.CharField(max_length=20, choices=InvoiceStatus.choices, default=InvoiceStatus.ISSUED)
    site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices")
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices")
    guardian = models.ForeignKey(Guardian, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices")
    coach = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name="coach_invoices")
    charge = models.ForeignKey(Charge, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices")
    payment = models.ForeignKey(Payment, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices")
    expense = models.ForeignKey(Expense, null=True, blank=True, on_delete=models.PROTECT, related_name="invoices")
    recipient_name = models.CharField(max_length=180)
    recipient_tax_id = models.CharField(max_length=20, blank=True)
    recipient_email = models.EmailField(blank=True)
    concept = models.CharField(max_length=180)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    tax = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=12, decimal_places=2)
    issued_at = models.DateTimeField(default=timezone.now)
    xml_content = models.TextField(blank=True)
    pdf_file = models.FileField(upload_to="invoices/pdf/", blank=True)
    issued_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="issued_invoices")

    class Meta:
        db_table = "invoices"
        indexes = [
            models.Index(fields=["kind", "status"], name="ix_invoice_kind_status"),
            models.Index(fields=["student", "issued_at"], name="ix_invoice_student_date"),
            models.Index(fields=["guardian", "issued_at"], name="ix_invoice_guardian_date"),
            models.Index(fields=["expense", "issued_at"], name="ix_invoice_expense_date"),
        ]


class HistoricalImportStatus(models.TextChoices):
    DRAFT = "draft", "Preview"
    COMMITTED = "committed", "Confirmado"
    CANCELED = "canceled", "Cancelado"


class HistoricalImport(TimestampedModel):
    original_file = models.FileField(upload_to="historical/imports/")
    original_filename = models.CharField(max_length=180)
    status = models.CharField(max_length=20, choices=HistoricalImportStatus.choices, default=HistoricalImportStatus.DRAFT)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="historical_imports")
    committed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="committed_historical_imports",
    )
    committed_at = models.DateTimeField(null=True, blank=True)
    signature_name = models.CharField(max_length=180, blank=True)
    signature_role = models.CharField(max_length=80, blank=True)
    source_password_used = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    summary = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "historical_imports"
        indexes = [
            models.Index(fields=["status", "created_at"], name="ix_hist_import_status_date"),
            models.Index(fields=["uploaded_by", "created_at"], name="ix_hist_import_uploaded_by"),
        ]


class HistoricalImportRowStatus(models.TextChoices):
    PENDING = "pending", "Pendiente"
    COMMITTED = "committed", "Confirmado"
    SKIPPED = "skipped", "Omitido"
    ERROR = "error", "Error"


class HistoricalImportRow(TimestampedModel):
    historical_import = models.ForeignKey(HistoricalImport, on_delete=models.CASCADE, related_name="rows")
    row_type = models.CharField(max_length=20)
    sheet_name = models.CharField(max_length=80)
    source_row = models.PositiveIntegerField()
    month_label = models.CharField(max_length=40, blank=True)
    site = models.ForeignKey(Site, null=True, blank=True, on_delete=models.PROTECT, related_name="historical_rows")
    site_name_raw = models.CharField(max_length=140, blank=True)
    concept_code = models.CharField(max_length=40, blank=True)
    concept = models.CharField(max_length=180)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    record_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=HistoricalImportRowStatus.choices, default=HistoricalImportRowStatus.PENDING)
    target_table = models.CharField(max_length=80, blank=True)
    target_id = models.CharField(max_length=80, blank=True)
    raw_data = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)

    class Meta:
        db_table = "historical_import_rows"
        indexes = [
            models.Index(fields=["historical_import", "status"], name="ix_hist_row_import_status"),
            models.Index(fields=["row_type", "record_date"], name="ix_hist_row_type_date"),
            models.Index(fields=["site", "row_type"], name="ix_hist_row_site_type"),
        ]


class FaceRecognitionAttempt(TimestampedModel):
    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE, related_name="face_attempts")
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.SET_NULL, related_name="face_attempts")
    captured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="face_attempts")
    matched = models.BooleanField(default=False)
    confidence = models.DecimalField(max_digits=6, decimal_places=4, default=0)
    engine = models.CharField(max_length=40, default="mock")
    notes = models.TextField(blank=True)

    class Meta:
        db_table = "face_recognition_attempts"
        indexes = [
            models.Index(fields=["session", "matched"], name="ix_face_attempt_session_match"),
            models.Index(fields=["student", "created_at"], name="ix_face_attempt_student_date"),
        ]


class FaceStationDevice(TimestampedModel):
    public_id = models.UUIDField(default=uuid4, unique=True, editable=False)
    name = models.CharField(max_length=120)
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="face_station_devices")
    service_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="face_station_devices",
    )
    camera_id = models.CharField(max_length=80, default="cancha_1")
    secret_hash = models.CharField(max_length=256)
    is_active = models.BooleanField(default=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    settings = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "face_station_devices"
        indexes = [
            models.Index(fields=["site", "is_active"], name="ix_face_station_site_active"),
            models.Index(fields=["last_seen_at"], name="ix_face_station_last_seen"),
        ]

    def __str__(self):
        return f"{self.name} - {self.site.name}"


class FaceStationEventStatus(models.TextChoices):
    SYNCED = "synced", "Sincronizado"
    NO_SESSION = "no_session", "Sin sesion"
    REJECTED = "rejected", "Rechazado"


class FaceStationEvent(TimestampedModel):
    event_id = models.UUIDField(unique=True)
    device = models.ForeignKey(FaceStationDevice, on_delete=models.PROTECT, related_name="events")
    person_type = models.CharField(max_length=20)
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.PROTECT, related_name="face_station_events")
    player = models.ForeignKey(Player, null=True, blank=True, on_delete=models.PROTECT, related_name="face_station_events")
    session = models.ForeignKey(AttendanceSession, null=True, blank=True, on_delete=models.SET_NULL, related_name="face_station_events")
    occurred_at = models.DateTimeField()
    detection_count = models.PositiveIntegerField(default=1)
    similarity = models.FloatField(default=0)
    source_subject_id = models.CharField(max_length=80, blank=True)
    status = models.CharField(
        max_length=20,
        choices=FaceStationEventStatus.choices,
        default=FaceStationEventStatus.SYNCED,
    )
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "face_station_events"
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(student__isnull=False, player__isnull=True, person_type="student")
                    | Q(student__isnull=True, player__isnull=False, person_type="player")
                ),
                name="ck_face_station_event_person",
            ),
        ]
        indexes = [
            models.Index(fields=["device", "occurred_at"], name="ix_face_station_device_time"),
            models.Index(fields=["student", "occurred_at"], name="ix_face_station_student_time"),
            models.Index(fields=["player", "occurred_at"], name="ix_face_station_player_time"),
        ]


class FaceStationUnknownLink(TimestampedModel):
    device = models.ForeignKey(FaceStationDevice, on_delete=models.PROTECT, related_name="unknown_links")
    local_subject_id = models.CharField(max_length=80)
    person_type = models.CharField(max_length=20)
    student = models.ForeignKey(Student, null=True, blank=True, on_delete=models.PROTECT, related_name="face_station_unknown_links")
    player = models.ForeignKey(Player, null=True, blank=True, on_delete=models.PROTECT, related_name="face_station_unknown_links")
    remote_subject_id = models.UUIDField(null=True, blank=True)
    evidence_uri = models.CharField(max_length=500, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "face_station_unknown_links"
        constraints = [
            models.UniqueConstraint(fields=["device", "local_subject_id"], name="uq_face_station_unknown_local"),
            models.CheckConstraint(
                condition=(
                    Q(student__isnull=False, player__isnull=True, person_type="student")
                    | Q(student__isnull=True, player__isnull=False, person_type="player")
                ),
                name="ck_face_station_unknown_person",
            ),
        ]


class CoachWorkLog(TimestampedModel):
    coach = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="coach_work_logs")
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="coach_work_logs")
    group_name = models.CharField(max_length=80, blank=True)
    work_date = models.DateField(default=timezone.localdate)
    hours = models.DecimalField(max_digits=5, decimal_places=2)
    activity = models.CharField(max_length=80, default="Entrenamiento")
    notes = models.TextField(blank=True)
    hourly_rate_snapshot = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_coach_work_logs")

    class Meta:
        db_table = "coach_work_logs"
        indexes = [
            models.Index(fields=["coach", "work_date"], name="ix_coach_log_coach_date"),
            models.Index(fields=["site", "work_date"], name="ix_coach_log_site_date"),
        ]


class DailyClosure(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="daily_closures")
    business_date = models.DateField()
    closed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="daily_closures")
    closed_at = models.DateTimeField(default=timezone.now)
    cash_expected = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cash_reported = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    notes = models.TextField(blank=True)
    is_reopened = models.BooleanField(default=False)

    class Meta:
        db_table = "daily_closures"
        constraints = [
            models.UniqueConstraint(fields=["site", "business_date"], name="uq_daily_closure_site_date"),
        ]


class AuditLog(TimestampedModel):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    action = models.CharField(max_length=80)
    table_name = models.CharField(max_length=80)
    record_id = models.CharField(max_length=80)
    previous_values = models.JSONField(default=dict, blank=True)
    new_values = models.JSONField(default=dict, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "audit_logs"
        indexes = [
            models.Index(fields=["table_name", "record_id"], name="ix_audit_table_record"),
            models.Index(fields=["actor", "created_at"], name="ix_audit_actor_created"),
        ]
