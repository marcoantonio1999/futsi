from .common import *
from .money import charge_balance

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
            "section_permissions",
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
    site = serializers.PrimaryKeyRelatedField(queryset=Site.objects.only("id"))

    class Meta:
        model = Court
        fields = "__all__"


class GuardianSerializer(serializers.ModelSerializer):
    user = serializers.PrimaryKeyRelatedField(queryset=User.objects.only("id", "username"), required=False, allow_null=True)
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = Guardian
        fields = "__all__"


class StudentSerializer(serializers.ModelSerializer):
    site = serializers.PrimaryKeyRelatedField(queryset=Site.objects.only("id", "name"))
    guardian = serializers.PrimaryKeyRelatedField(queryset=Guardian.objects.only("id", "full_name", "phone"))
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
        if hasattr(obj, "open_charges"):
            return len(obj.open_charges)
        return obj.charges.filter(status__in=["pending", "partial"]).count()

    def get_balance_due(self, obj):
        if hasattr(obj, "open_charges"):
            total = Decimal("0")
            for charge in obj.open_charges:
                paid = sum((payment.amount for payment in getattr(charge, "confirmed_payments", [])), Decimal("0"))
                discounted = sum((discount.amount for discount in getattr(charge, "approved_discounts", [])), Decimal("0"))
                total += max(charge.amount - paid - discounted, Decimal("0"))
            return str(total)
        total = sum(charge_balance(charge) for charge in obj.charges.filter(status__in=["pending", "partial"]))
        return str(total)

    def get_active_discounts(self, obj):
        discounts = getattr(obj, "approved_student_discounts", None)
        if discounts is None:
            discounts = obj.discounts.filter(status="approved").order_by("-approved_at", "-created_at")[:5]
        else:
            discounts = discounts[:5]
        return [
            {
                "id": discount.id,
                "reason": discount.reason,
                "amount": str(discount.amount),
                "charge": discount.charge_id,
            }
            for discount in discounts
        ]

