from datetime import timedelta
from decimal import Decimal
from uuid import uuid4

from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers

from .models import (
    AttendanceRecord,
    AttendanceSession,
    AuditLog,
    Charge,
    CoachWorkLog,
    Court,
    DailyClosure,
    Discount,
    Expense,
    Guardian,
    Payment,
    Player,
    Round,
    Site,
    Student,
    Team,
    Tournament,
    User,
)


def charge_balance(charge):
    paid = charge.payments.filter(status__in=["registered", "reconciled"]).aggregate(total=Sum("amount"))["total"] or Decimal("0")
    discounted = charge.discounts.filter(status="approved").aggregate(total=Sum("amount"))["total"] or Decimal("0")
    balance = charge.amount - paid - discounted
    return max(balance, Decimal("0"))


def sync_charge_status(charge):
    balance = charge_balance(charge)
    if charge.status == "canceled":
        return
    if balance <= 0:
        charge.status = "paid"
    elif balance < charge.amount:
        charge.status = "partial"
    else:
        charge.status = "pending"
    charge.save(update_fields=["status", "updated_at"])


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    primary_site_name = serializers.CharField(source="primary_site.name", read_only=True)
    guardian_id = serializers.IntegerField(source="guardian_profile.id", read_only=True)
    guardian_name = serializers.CharField(source="guardian_profile.full_name", read_only=True)
    guardian_virtual_clabe = serializers.CharField(source="guardian_profile.virtual_clabe", read_only=True)

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "role",
            "primary_site",
            "primary_site_name",
            "guardian_id",
            "guardian_name",
            "guardian_virtual_clabe",
            "phone",
            "avatar_url",
            "coach_group_name",
            "coach_hourly_rate",
            "is_active",
            "password",
        ]
        read_only_fields = ["id"]

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if password:
            instance.set_password(password)
        instance.save()
        return instance


class SiteSerializer(serializers.ModelSerializer):
    student_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Site
        fields = "__all__"


class CourtSerializer(serializers.ModelSerializer):
    class Meta:
        model = Court
        fields = "__all__"


class GuardianSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = Guardian
        fields = "__all__"


class StudentSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    guardian_name = serializers.CharField(source="guardian.full_name", read_only=True)
    guardian_phone = serializers.CharField(source="guardian.phone", read_only=True)
    open_charge_count = serializers.SerializerMethodField()
    balance_due = serializers.SerializerMethodField()
    active_discounts = serializers.SerializerMethodField()

    class Meta:
        model = Student
        fields = "__all__"

    def get_open_charge_count(self, obj):
        return obj.charges.filter(status__in=["pending", "partial"]).count()

    def get_balance_due(self, obj):
        total = sum(charge_balance(charge) for charge in obj.charges.filter(status__in=["pending", "partial"]))
        return str(total)

    def get_active_discounts(self, obj):
        discounts = obj.discounts.filter(status="approved").order_by("-approved_at", "-created_at")[:5]
        return [
            {
                "id": discount.id,
                "reason": discount.reason,
                "amount": str(discount.amount),
                "charge": discount.charge_id,
            }
            for discount in discounts
        ]


class TournamentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tournament
        fields = "__all__"


class TeamSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = "__all__"


class PlayerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Player
        fields = "__all__"


class RoundSerializer(serializers.ModelSerializer):
    class Meta:
        model = Round
        fields = "__all__"


class AttendanceSessionSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    captured_by_username = serializers.CharField(source="captured_by.username", read_only=True)
    record_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = AttendanceSession
        fields = "__all__"
        read_only_fields = ["captured_by", "closed_at"]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["captured_by"] = request.user
        return super().create(validated_data)


class AttendanceRecordSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    captured_by_username = serializers.CharField(source="captured_by.username", read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = "__all__"
        read_only_fields = ["captured_by", "had_debt_at_capture"]

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            validated_data["captured_by"] = request.user

        student = validated_data.get("student")
        team = validated_data.get("team")
        session = validated_data["session"]
        if student:
            validated_data["had_debt_at_capture"] = student.charges.filter(status__in=["pending", "partial"]).exists()
            record, _ = AttendanceRecord.objects.update_or_create(
                session=session,
                student=student,
                defaults={key: value for key, value in validated_data.items() if key not in {"session", "student"}},
            )
            return record
        if team:
            validated_data["had_debt_at_capture"] = team.charges.filter(status__in=["pending", "partial"]).exists()
            record, _ = AttendanceRecord.objects.update_or_create(
                session=session,
                team=team,
                defaults={key: value for key, value in validated_data.items() if key not in {"session", "team"}},
            )
            return record
        return super().create(validated_data)


class ChargeSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    student_name = serializers.CharField(source="student.full_name", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    paid_amount = serializers.SerializerMethodField()
    discount_amount = serializers.SerializerMethodField()
    balance = serializers.SerializerMethodField()

    class Meta:
        model = Charge
        fields = "__all__"
        read_only_fields = ["created_by"]

    def get_paid_amount(self, obj):
        total = obj.payments.filter(status__in=["registered", "reconciled"]).aggregate(total=Sum("amount"))["total"]
        return str(total or 0)

    def get_discount_amount(self, obj):
        total = obj.discounts.filter(status="approved").aggregate(total=Sum("amount"))["total"]
        return str(total or 0)

    def get_balance(self, obj):
        return str(charge_balance(obj))

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


class CoachWorkLogSerializer(serializers.ModelSerializer):
    coach_username = serializers.CharField(source="coach.username", read_only=True)
    coach_name = serializers.SerializerMethodField()
    site_name = serializers.CharField(source="site.name", read_only=True)
    total_amount = serializers.SerializerMethodField()

    class Meta:
        model = CoachWorkLog
        fields = "__all__"
        read_only_fields = ["coach", "site", "group_name", "hourly_rate_snapshot", "created_by"]

    def get_coach_name(self, obj):
        return obj.coach.get_full_name() or obj.coach.username

    def get_total_amount(self, obj):
        return str(obj.hours * obj.hourly_rate_snapshot)

    def create(self, validated_data):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            if request.user.role == "coach":
                validated_data["coach"] = request.user
                validated_data["site"] = request.user.primary_site
                validated_data["group_name"] = request.user.coach_group_name
                validated_data["hourly_rate_snapshot"] = request.user.coach_hourly_rate
            else:
                coach = validated_data.get("coach") or request.user
                validated_data["coach"] = coach
                validated_data["site"] = validated_data.get("site") or coach.primary_site
                validated_data["group_name"] = validated_data.get("group_name") or coach.coach_group_name
                validated_data["hourly_rate_snapshot"] = validated_data.get("hourly_rate_snapshot") or coach.coach_hourly_rate
            validated_data["created_by"] = request.user
        return super().create(validated_data)


class DailyClosureSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyClosure
        fields = "__all__"


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = "__all__"
        read_only_fields = ["id", "created_at", "updated_at"]
