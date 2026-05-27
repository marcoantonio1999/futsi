from django.conf import settings
from django.contrib.auth.models import AbstractUser
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
    ACCOUNTING = "accounting", "Contador"
    OWNER = "owner", "Direccion"
    SITE_COORDINATOR = "site_coordinator", "Coordinador de sede"
    CASHIER = "cashier", "Cajero"
    COACH = "coach", "Coach"
    GUARDIAN = "guardian", "Representante"


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


class Player(TimestampedModel):
    team = models.ForeignKey(Team, on_delete=models.PROTECT, related_name="players")
    full_name = models.CharField(max_length=160)
    phone = models.CharField(max_length=30, blank=True)
    photo = models.ImageField(upload_to="players/photos/", blank=True)
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


class AttendanceSessionType(models.TextChoices):
    ACADEMY_CLASS = "academy_class", "Clase academia"
    TOURNAMENT_MATCH = "tournament_match", "Partido torneo"


class AttendanceSession(TimestampedModel):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="attendance_sessions")
    session_type = models.CharField(max_length=30, choices=AttendanceSessionType.choices)
    date = models.DateField()
    starts_at = models.TimeField(null=True, blank=True)
    court = models.ForeignKey(Court, null=True, blank=True, on_delete=models.PROTECT, related_name="attendance_sessions")
    group_name = models.CharField(max_length=80, blank=True)
    tournament = models.ForeignKey(Tournament, null=True, blank=True, on_delete=models.PROTECT)
    round = models.ForeignKey(Round, null=True, blank=True, on_delete=models.PROTECT)
    team = models.ForeignKey(Team, null=True, blank=True, on_delete=models.PROTECT)
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
        ]
        indexes = [
            models.Index(fields=["session", "status"], name="ix_att_record_session_status"),
            models.Index(fields=["student"], name="ix_att_record_student"),
            models.Index(fields=["team"], name="ix_att_record_team"),
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
