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


def _next_friday(today):
    # weekday: lunes=0, viernes=4. Para jornada semanal usamos viernes como corte de pago.
    days = (4 - today.weekday()) % 7
    return today + timedelta(days=days)


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

    for student in students.distinct():
        exists = Charge.objects.filter(
            student=student,
            concept="Mensualidad",
            due_date__year=today.year,
            due_date__month=today.month,
        ).exclude(status="canceled").exists()
        if exists:
            continue
        charge = Charge.objects.create(
            site=student.site,
            student=student,
            concept="Mensualidad",
            description=f"Mensualidad {month_label} - generado automatico",
            amount=_academy_monthly_amount(student.site),
            due_date=month_due,
            created_by=user,
        )
        created.append(charge)

    weekly_due = _next_friday(today)
    iso_year, iso_week, _ = weekly_due.isocalendar()
    weekly_description = f"Jornada semana {iso_week} {iso_year} - generado automatico"

    for team in teams.distinct():
        if team.tournament.billing_type == "weekly_match":
            exists = Charge.objects.filter(
                team=team,
                concept="Jornada torneo",
                due_date=weekly_due,
            ).exclude(status="canceled").exists()
            if exists:
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
            full_description = f"Torneo completo {team.tournament.name} - generado automatico"
            exists = Charge.objects.filter(
                team=team,
                concept="Torneo completo",
                description=full_description,
            ).exclude(status="canceled").exists()
            if exists:
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

    return created

class ChargeViewSet(viewsets.ModelViewSet):
    queryset = (
        Charge.objects.select_related("site", "student", "student__guardian", "team", "created_by")
        .prefetch_related(
            Prefetch("payments", queryset=Payment.objects.filter(status__in=["registered", "reconciled"]), to_attr="confirmed_payments"),
            Prefetch("discounts", queryset=Discount.objects.filter(status="approved"), to_attr="approved_discounts"),
        )
        .all()
    )
    serializer_class = ChargeSerializer
    permission_classes = [IsOperationsCashierOrGuardianRole]

    def get_permissions(self):
        if self.action == "generate_scheduled":
            return [IsOperationsCashierOrGuardianRole()]
        if self.request.user.is_authenticated and self.request.user.role in {"guardian", "cashier", "adult_representative", "adult_player"} and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(team__representative_user=self.request.user)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(team__players__user=self.request.user)
        if self.request.user.role == "cashier":
            queryset = queryset.filter(site=self.request.user.primary_site)
        status_value = self.request.query_params.get("status")
        student = self.request.query_params.get("student")
        if status_value:
            queryset = queryset.filter(status=status_value)
        if student:
            queryset = queryset.filter(student_id=student)
        return queryset.distinct()

    @action(detail=False, methods=["post"], url_path="generate-scheduled")
    def generate_scheduled(self, request):
        created = generate_scheduled_charges_for_user(request.user)
        due_soon = []
        for charge in self.get_queryset().exclude(status__in=["paid", "canceled"]):
            if charge.due_date is None:
                continue
            days = (charge.due_date - timezone.localdate()).days
            if days <= 2:
                due_soon.append(charge)
        return Response(
            {
                "created": len(created),
                "created_ids": [charge.id for charge in created],
                "due_soon": len(due_soon),
                "message": "Cobros recurrentes y avisos simulados actualizados.",
            }
        )


class PaymentViewSet(viewsets.ModelViewSet):
    queryset = Payment.objects.select_related("site", "charge", "student", "team", "received_by").all()
    serializer_class = PaymentSerializer
    permission_classes = [IsOperationsCashierOrGuardianRole]

    def get_permissions(self):
        if (
            self.request.user.is_authenticated
            and self.request.user.role in {"guardian", "adult_representative", "adult_player"}
            and self.request.method not in ("GET", "HEAD", "OPTIONS")
            and self.action not in {"confirm_cash", "simulate_webhook"}
        ):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(team__representative_user=self.request.user)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(team__players__user=self.request.user)
        if self.request.user.role == "cashier":
            queryset = queryset.filter(site=self.request.user.primary_site)
        charge = self.request.query_params.get("charge")
        if charge:
            queryset = queryset.filter(charge_id=charge)
        return queryset.distinct()

    @action(detail=True, methods=["post"], url_path="confirm-cash")
    def confirm_cash(self, request, pk=None):
        payment = self.get_object()
        if payment.method != "cash" or payment.status != "awaiting_confirmation":
            return Response({"detail": "Este pago no espera aceptacion de efectivo."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user.role == "guardian" and payment.student.guardian.user_id != request.user.id:
            return Response({"detail": "No puedes aceptar pagos de otro representante."}, status=status.HTTP_403_FORBIDDEN)
        payment.status = "registered"
        payment.confirmed_at = timezone.now()
        payment.notes = "Efectivo aceptado por el representante."
        payment.save(update_fields=["status", "confirmed_at", "notes", "updated_at"])
        if payment.charge:
            sync_charge_status(payment.charge)
        return Response(self.get_serializer(payment).data)

    @action(detail=True, methods=["post"], url_path="simulate-webhook")
    def simulate_webhook(self, request, pk=None):
        payment = self.get_object()
        if payment.status != "processing":
            return Response({"detail": "Este pago no esta en proceso."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user.role == "guardian" and payment.channel != "card_link":
            return Response({"detail": "Solo puedes simular el pago de un link enviado a tu portal."}, status=status.HTTP_403_FORBIDDEN)
        if request.user.role == "guardian" and payment.student.guardian.user_id != request.user.id:
            return Response({"detail": "No puedes pagar links de otro representante."}, status=status.HTTP_403_FORBIDDEN)
        payment.status = "registered"
        payment.confirmed_at = timezone.now()
        if payment.method == "transfer":
            payment.tracking_key = payment.tracking_key or f"SPEI-{uuid4().hex[:12].upper()}"
            payment.notes = "Simulacion: webhook SPEI recibido."
        elif payment.channel == "card_link":
            payment.reference = payment.reference or f"LINK-{uuid4().hex[:10].upper()}"
            payment.notes = "Simulacion: link de pago liquidado."
        else:
            payment.notes = "Simulacion: pago confirmado por proveedor."
        payment.save(update_fields=["status", "confirmed_at", "tracking_key", "reference", "notes", "updated_at"])
        if payment.charge:
            sync_charge_status(payment.charge)
        return Response(self.get_serializer(payment).data)

    @action(detail=True, methods=["post"])
    def expire(self, request, pk=None):
        payment = self.get_object()
        if payment.status not in {"processing", "awaiting_confirmation"}:
            return Response({"detail": "Solo se expiran pagos pendientes."}, status=status.HTTP_400_BAD_REQUEST)
        payment.status = "expired"
        payment.notes = "Simulacion: vencio la ventana de confirmacion y el monto vuelve a adeudo."
        payment.save(update_fields=["status", "notes", "updated_at"])
        if payment.charge:
            sync_charge_status(payment.charge)
        return Response(self.get_serializer(payment).data)


class DiscountViewSet(viewsets.ModelViewSet):
    queryset = Discount.objects.select_related("site", "charge", "student", "team", "requested_by", "approved_by").all()
    serializer_class = DiscountSerializer
    permission_classes = [IsOperationsOrGuardianRole]

    def get_permissions(self):
        if self.request.user.is_authenticated and self.request.user.role == "guardian" and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        status_value = self.request.query_params.get("status")
        if status_value:
            queryset = queryset.filter(status=status_value)
        return queryset

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        discount = self.get_object()
        discount.status = "approved"
        discount.approved_by = request.user
        discount.approved_at = timezone.now()
        discount.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        if discount.charge:
            sync_charge_status(discount.charge)
        return Response(self.get_serializer(discount).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        discount = self.get_object()
        discount.status = "rejected"
        discount.approved_by = request.user
        discount.approved_at = timezone.now()
        discount.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        return Response(self.get_serializer(discount).data)


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = Expense.objects.select_related("site", "captured_by", "approved_by").all()
    serializer_class = ExpenseSerializer
    permission_classes = [IsOperationsRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_value = self.request.query_params.get("status")
        site = self.request.query_params.get("site")
        if status_value:
            queryset = queryset.filter(status=status_value)
        if site:
            queryset = queryset.filter(site_id=site)
        return queryset

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        expense = self.get_object()
        expense.status = "approved"
        expense.approved_by = request.user
        expense.approved_at = timezone.now()
        expense.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        expense = self.get_object()
        expense.status = "rejected"
        expense.approved_by = request.user
        expense.approved_at = timezone.now()
        expense.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        return Response(self.get_serializer(expense).data)


class StaffPaymentRequestViewSet(viewsets.ModelViewSet):
    queryset = StaffPaymentRequest.objects.select_related("site", "recipient", "requested_by", "expense").all()
    serializer_class = StaffPaymentRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.role not in {"admin", "dev", "owner", "accounting", "site_coordinator", "cashier"}:
            queryset = queryset.filter(recipient=user)
        site = self.request.query_params.get("site")
        status_value = self.request.query_params.get("status")
        mine = self.request.query_params.get("mine")
        if site:
            queryset = queryset.filter(site_id=site)
        if status_value:
            queryset = queryset.filter(status=status_value)
        if mine:
            queryset = queryset.filter(recipient=user)
        return queryset

    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)

    @action(detail=True, methods=["post"])
    def accept(self, request, pk=None):
        payment_request = self.get_object()
        if request.user != payment_request.recipient and request.user.role not in {"admin", "dev", "owner", "accounting"}:
            return Response({"detail": "Solo el receptor o administracion puede aceptar el pago."}, status=status.HTTP_403_FORBIDDEN)
        payment_request.status = "accepted"
        payment_request.accepted_at = timezone.now()
        payment_request.response_notes = request.data.get("response_notes", payment_request.response_notes)
        if not payment_request.expense:
            expense = Expense.objects.create(
                site=payment_request.site,
                category=payment_request.get_kind_display(),
                description=payment_request.description,
                amount=payment_request.amount,
                expense_date=payment_request.requested_payment_date,
                provider_name=payment_request.recipient.get_full_name() or payment_request.recipient.username,
                status="approved",
                captured_by=payment_request.requested_by,
                approved_by=request.user,
                approved_at=timezone.now(),
            )
            payment_request.expense = expense
        payment_request.save(update_fields=["status", "accepted_at", "response_notes", "expense", "updated_at"])
        if payment_request.payment_method == "cash" and not payment_request.cash_movements.exists():
            CashMovement.objects.create(
                site=payment_request.site,
                movement_type=CashMovementType.CASH_OUT,
                amount=payment_request.amount,
                movement_date=payment_request.requested_payment_date,
                reason=f"Pago aceptado: {payment_request.description}",
                responsible=request.user,
                created_by=payment_request.requested_by,
                staff_payment_request=payment_request,
            )
        return Response(self.get_serializer(payment_request).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        payment_request = self.get_object()
        if request.user != payment_request.recipient and request.user.role not in {"admin", "dev", "owner", "accounting"}:
            return Response({"detail": "Solo el receptor o administracion puede rechazar el pago."}, status=status.HTTP_403_FORBIDDEN)
        payment_request.status = "rejected"
        payment_request.response_notes = request.data.get("response_notes", payment_request.response_notes)
        payment_request.save(update_fields=["status", "response_notes", "updated_at"])
        return Response(self.get_serializer(payment_request).data)


class CashMovementViewSet(viewsets.ModelViewSet):
    queryset = CashMovement.objects.select_related("site", "responsible", "created_by", "staff_payment_request").all()
    serializer_class = CashMovementSerializer
    permission_classes = [IsOperationsOrCashierRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "cashier" and self.request.user.primary_site_id:
            queryset = queryset.filter(site_id=self.request.user.primary_site_id)
        site = self.request.query_params.get("site")
        movement_type = self.request.query_params.get("movement_type")
        if site:
            queryset = queryset.filter(site_id=site)
        if movement_type:
            queryset = queryset.filter(movement_type=movement_type)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

