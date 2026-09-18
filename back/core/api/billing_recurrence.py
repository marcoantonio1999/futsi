from calendar import monthrange
from datetime import date
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers
from core.models import BillingPlan, Charge, Student, StudentTournamentRegistration
from core.domain_serializers.finance import DiscountSerializer, PaymentSerializer


def installment_dates(first, day, count, interval):
    result = []
    for index in range(count):
        month_index = first.year * 12 + first.month - 1 + index * interval
        year, month = divmod(month_index, 12)
        month += 1
        result.append(date(year, month, min(day, monthrange(year, month)[1])))
    return result


class RecurrenceInput(serializers.Serializer):
    request_key = serializers.UUIDField()
    student = serializers.IntegerField(min_value=1)
    tournament_registration = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    concept = serializers.CharField(max_length=80)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    discount_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"), default=Decimal("0"))
    reason = serializers.CharField(max_length=180, default="Autorizacion especial")
    first_due_date = serializers.DateField()
    day_of_month = serializers.IntegerField(min_value=1, max_value=31)
    interval_months = serializers.IntegerField(min_value=1, max_value=12, default=1)
    installments = serializers.IntegerField(min_value=1, max_value=120)
    collect_first = serializers.BooleanField(default=False)
    method = serializers.ChoiceField(choices=["cash", "card"], default="cash")

    def validate(self, attrs):
        if not 1900 <= attrs["first_due_date"].year <= 9800:
            raise serializers.ValidationError("Elige un año válido para el plan.")
        if attrs["discount_amount"] > attrs["amount"]:
            raise serializers.ValidationError("El descuento no puede superar el importe por cuota.")
        expected = installment_dates(attrs["first_due_date"], attrs["day_of_month"], 1, 1)[0]
        if expected != attrs["first_due_date"]:
            raise serializers.ValidationError("La primera fecha no coincide con el día elegido.")
        return attrs


@transaction.atomic
def create_plan(request):
    serializer = RecurrenceInput(data=request.data)
    serializer.is_valid(raise_exception=True)
    values = dict(serializer.validated_data)
    collect_first = values.pop("collect_first")
    method = values.pop("method")
    student_id = values.pop("student")
    # Serialize submissions for the same pupil, including distinct request keys.
    students = Student.objects.select_for_update().filter(pk=student_id)
    if request.user.role == "site_coordinator":
        students = students.filter(site_id=request.user.primary_site_id)
    student = students.first()
    if student is None:
        raise serializers.ValidationError("Alumno no disponible en tu sede.")
    existing = BillingPlan.objects.filter(request_key=values["request_key"]).first()
    if existing:
        if existing.student_id != student.id or existing.created_by_id != request.user.id:
            raise serializers.ValidationError("La solicitud ya pertenece a otro cobro.")
        for key in ("concept", "amount", "discount_amount", "first_due_date", "day_of_month", "installments", "interval_months"):
            if getattr(existing, key) != values[key]:
                raise serializers.ValidationError("El plan ya fue guardado con otros datos. Revisa sus cuotas.")
        if existing.tournament_registration_id != values.get("tournament_registration"):
            raise serializers.ValidationError("El plan ya pertenece a otra inscripción.")
        # Same key is a replay, not permission to change an already saved plan.
        return existing.charges.order_by("due_date"), False
    registration_id = values.pop("tournament_registration", None)
    registration = None
    if registration_id:
        registration = StudentTournamentRegistration.objects.filter(
            pk=registration_id, student=student, tournament__site_id=student.site_id,
            status="registered", tournament__is_active=True,
        ).first()
        if not registration:
            raise serializers.ValidationError("Selecciona una inscripción activa de este alumno y sede.")
        if BillingPlan.objects.filter(tournament_registration=registration).exists():
            raise serializers.ValidationError("Esta inscripción ya tiene un plan. Revisa sus cuotas existentes.")
        if registration.charges.exclude(status="canceled").exists():
            raise serializers.ValidationError("La inscripción ya tiene cargos. Revísalos antes de crear un plan para no duplicar su cobro.")
    dates = installment_dates(values["first_due_date"], values["day_of_month"], values["installments"], values["interval_months"])
    for due in dates:
        if Charge.objects.filter(student=student, concept=values["concept"], due_date__year=due.year, due_date__month=due.month).exclude(status="canceled").exists():
            raise serializers.ValidationError(f"Ya existe un cargo de este concepto en {due:%m/%Y}. No se creó ningún cargo.")
    reason = values.pop("reason")
    plan = BillingPlan.objects.create(student=student, tournament_registration=registration, created_by=request.user, **values)
    for index, due in enumerate(dates, 1):
        charge = Charge.objects.create(
            billing_plan=plan, student=student, site_id=student.site_id,
            tournament_registration=registration, concept=plan.concept, amount=plan.amount,
            due_date=due, created_by=request.user,
            description=f"Plan #{plan.id} · Cuota {index}/{plan.installments} · cada {plan.interval_months} mes(es), día {plan.day_of_month}",
        )
        if plan.discount_amount:
            discount = DiscountSerializer(data={"charge": charge.id, "amount": str(plan.discount_amount), "reason": reason}, context={"request": request})
            discount.is_valid(raise_exception=True)
            discount_record = discount.save()
            if collect_first and discount_record.status != "approved":
                raise serializers.ValidationError("El descuento requiere autorización. Guarda el plan sin cobrar la primera cuota.")
        if index == 1 and collect_first and plan.amount > plan.discount_amount:
            payment = PaymentSerializer(data={"charge": charge.id, "amount": str(plan.amount - plan.discount_amount), "method": method, "channel": "cash_confirmation" if method == "cash" else "card_terminal"}, context={"request": request})
            payment.is_valid(raise_exception=True)
            payment.save()
    return plan.charges.order_by("due_date"), True
