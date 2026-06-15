from .common import *
from .money import charge_balance, sync_charge_status

class ChargeSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    tournament_registration_name = serializers.CharField(source="tournament_registration.tournament.name", read_only=True)
    paid_amount = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()
    balance = serializers.SerializerMethodField()
    due_in_days = serializers.SerializerMethodField()
    due_bucket = serializers.SerializerMethodField()
    customer_notice = serializers.SerializerMethodField()
    payer_name = serializers.SerializerMethodField()
    payer_phone = serializers.SerializerMethodField()
    schedule_type = serializers.SerializerMethodField()

    class Meta:
        model = Charge
        fields = "__all__"
        read_only_fields = ["created_by"]

    def _confirmed_payment_total(self, obj):
        if hasattr(obj, "confirmed_payments"):
            return sum((payment.amount for payment in obj.confirmed_payments), Decimal("0"))
        return obj.payments.filter(status__in=["registered", "reconciled"]).aggregate(total=Sum("amount"))["total"] or Decimal("0")

    def _approved_discount_total(self, obj):
        if hasattr(obj, "approved_discounts"):
            return sum((discount.amount for discount in obj.approved_discounts), Decimal("0"))
        return obj.discounts.filter(status="approved").aggregate(total=Sum("amount"))["total"] or Decimal("0")

    def _balance(self, obj):
        return max(obj.amount - self._confirmed_payment_total(obj) - self._approved_discount_total(obj), Decimal("0"))

    def get_paid_amount(self, obj):
        return str(self._confirmed_payment_total(obj))

    def get_discount_amount(self, obj):
        return str(self._approved_discount_total(obj))

    def get_balance(self, obj):
        return str(self._balance(obj))

    def get_due_in_days(self, obj):
        if not obj.due_date:
            return None
        return (obj.due_date - timezone.localdate()).days

    def get_due_bucket(self, obj):
        if obj.status in {"paid", "canceled"}:
            return obj.status
        days = self.get_due_in_days(obj)
        if days is None:
            return "without_due_date"
        if days < 0:
            return "overdue"
        if days <= 2:
            return "due_soon"
        return "scheduled"

    def get_customer_notice(self, obj):
        if obj.status in {"paid", "canceled"}:
            return ""
        days = self.get_due_in_days(obj)
        balance = self._balance(obj)
        if days is None:
            return f"Tienes un saldo pendiente de ${balance} por {obj.concept}."
        if days < 0:
            return f"Tu pago de {obj.concept} vencio hace {abs(days)} dia(s). Saldo pendiente: ${balance}."
        if days <= 2:
            return f"Recordatorio: tu pago de {obj.concept} vence en {days} dia(s). Saldo: ${balance}."
        return ""

    def get_payer_name(self, obj):
        if obj.student_id and obj.student and obj.student.guardian_id:
            return obj.student.guardian.full_name
        if obj.team_id and obj.team:
            return obj.team.representative_name
        return ""

    def get_payer_phone(self, obj):
        if obj.student_id and obj.student and obj.student.guardian_id:
            return obj.student.guardian.phone
        if obj.team_id and obj.team:
            return obj.team.representative_phone
        return ""

    def get_schedule_type(self, obj):
        concept = (obj.concept or "").lower()
        description = (obj.description or "").lower()
        if "mensual" in concept or "mensual" in description:
            return "monthly"
        if "jornada" in concept or "semanal" in concept or "semana" in description:
            return "weekly"
        if "torneo completo" in concept or "abono torneo" in description:
            return "tournament"
        return "one_time"

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["created_by"] = request.user
        return super().create(validated_data)


class PaymentSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    charge_concept = serializers.CharField(source="charge.concept", read_only=True)
    received_by_username = serializers.CharField(source="received_by.username", read_only=True)

    class Meta:
        model = Payment
        fields = "__all__"
        read_only_fields = [
            "received_by",
            "site",
            "student",
            "team",
            "status",
            "reference",
            "tracking_key",
            "payment_url",
            "confirmed_at",
            "expires_at",
        ]

    def validate(self, attrs):
        request = self.context.get("request")
        charge = attrs.get("charge")
        amount = attrs.get("amount")
        if amount is not None and amount < 0:
            raise serializers.ValidationError({"amount": "El monto no puede ser negativo."})
        if request and request.user.is_authenticated and request.user.role == "cashier":
            if not charge:
                raise serializers.ValidationError("El cajero debe registrar pagos contra un cargo existente.")
            if request.user.primary_site_id != charge.site_id:
                raise serializers.ValidationError("El cajero solo puede cobrar cargos de su sede.")
        return attrs

    def create(self, validated_data):
        request = self.context.get("request")
        charge = validated_data.get("charge")
        if charge:
            validated_data["site"] = charge.site
            validated_data["student"] = charge.student
            validated_data["team"] = charge.team
        if request and request.user.is_authenticated:
            validated_data["received_by"] = request.user

        method = validated_data.get("method")
        channel = validated_data.get("channel") or {
            "cash": "cash_confirmation",
            "transfer": "transfer_clabe",
            "card": "card_terminal",
            "courtesy": "courtesy",
        }.get(method, "")
        if method == "cash":
            channel = "cash_confirmation"
        elif method == "transfer":
            channel = "transfer_clabe"
        elif method == "card" and channel not in {"card_terminal", "card_link"}:
            channel = "card_terminal"
        elif method == "courtesy":
            channel = "courtesy"
        validated_data["channel"] = channel

        token = uuid4().hex[:10].upper()
        if method == "transfer":
            validated_data["status"] = "processing"
            validated_data["reference"] = f"CLABE-{charge.student.guardian.virtual_clabe}" if charge and charge.student else f"SPEI-{token}"
            validated_data["expires_at"] = timezone.now() + timedelta(hours=72)
            validated_data["notes"] = "Simulacion: esperando webhook SPEI. Si no llega en 72 horas, vuelve a adeudo."
        elif method == "cash":
            validated_data["status"] = "awaiting_confirmation"
            validated_data["reference"] = f"EFECTIVO-{token}"
            validated_data["expires_at"] = timezone.now() + timedelta(hours=24)
            validated_data["notes"] = "Simulacion: esperando aceptacion del representante."
        elif method == "card" and channel == "card_link":
            validated_data["status"] = "processing"
            validated_data["reference"] = f"LINK-{token}"
            validated_data["payment_url"] = f"https://pagos.demo.futsi.local/pay/{token}"
            validated_data["expires_at"] = timezone.now() + timedelta(hours=24)
            validated_data["notes"] = "Simulacion: link enviado al portal del cliente."
        elif method == "card":
            validated_data["status"] = "registered"
            validated_data["reference"] = f"TERM-{token}"
            validated_data["confirmed_at"] = timezone.now()
            validated_data["notes"] = "Simulacion: terminal autorizada automaticamente."
        elif method == "courtesy":
            validated_data["status"] = "registered"
            validated_data["reference"] = f"CORTESIA-{token}"
            validated_data["confirmed_at"] = timezone.now()

        payment = super().create(validated_data)
        if payment.charge and payment.status in {"registered", "reconciled"}:
            sync_charge_status(payment.charge)
        return payment


class DiscountSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    charge_concept = serializers.CharField(source="charge.concept", read_only=True)
    requested_by_username = serializers.CharField(source="requested_by.username", read_only=True)
    approved_by_username = serializers.CharField(source="approved_by.username", read_only=True)

    class Meta:
        model = Discount
        fields = "__all__"
        read_only_fields = ["requested_by", "approved_by", "approved_at", "site", "student", "team"]

    def create(self, validated_data):
        request = self.context.get("request")
        charge = validated_data.get("charge")
        if charge:
            validated_data["site"] = charge.site
            validated_data["student"] = charge.student
            validated_data["team"] = charge.team
        if request and request.user.is_authenticated:
            validated_data["requested_by"] = request.user
        return super().create(validated_data)


class ExpenseSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    captured_by_username = serializers.CharField(source="captured_by.username", read_only=True)
    approved_by_username = serializers.CharField(source="approved_by.username", read_only=True)

    class Meta:
        model = Expense
        fields = "__all__"
        read_only_fields = ["captured_by", "approved_by", "approved_at"]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["captured_by"] = request.user
        return super().create(validated_data)


class StaffPaymentRequestSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    recipient_username = serializers.CharField(source="recipient.username", read_only=True)
    recipient_name = serializers.SerializerMethodField()
    requested_by_username = serializers.CharField(source="requested_by.username", read_only=True)
    expense_description = serializers.CharField(source="expense.description", read_only=True)

    class Meta:
        model = StaffPaymentRequest
        fields = "__all__"
        read_only_fields = ["requested_by", "accepted_at", "expense", "created_at", "updated_at"]

    def get_recipient_name(self, obj):
        return obj.recipient.get_full_name() or obj.recipient.username

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["requested_by"] = request.user
        return super().create(validated_data)


class CashMovementSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    responsible_username = serializers.CharField(source="responsible.username", read_only=True)
    responsible_name = serializers.SerializerMethodField()
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = CashMovement
        fields = "__all__"
        read_only_fields = ["created_by", "created_at", "updated_at"]

    def get_responsible_name(self, obj):
        return obj.responsible.get_full_name() or obj.responsible.username

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["created_by"] = request.user
        return super().create(validated_data)

