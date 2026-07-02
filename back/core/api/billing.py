from datetime import timedelta

from django.db.models import Prefetch

from .common import *
from .billing_generators import generate_scheduled_charges_for_user, generate_student_tournament_charges_for_user

class ChargeViewSet(viewsets.ModelViewSet):
    queryset = (
        Charge.objects.select_related("site", "student", "student__guardian", "team", "tournament_registration", "tournament_registration__tournament", "created_by")
        .prefetch_related(
            Prefetch("payments", queryset=Payment.objects.filter(status__in=["registered", "reconciled"]).only("id", "charge_id", "amount"), to_attr="confirmed_payments"),
            Prefetch("discounts", queryset=Discount.objects.filter(status="approved").only("id", "charge_id", "amount"), to_attr="approved_discounts"),
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
        due_soon = (
            self.get_queryset()
            .exclude(status__in=["paid", "canceled"])
            .filter(due_date__lte=timezone.localdate() + timedelta(days=2))
            .count()
        )
        return Response(
            {
                "created": len(created),
                "created_ids": [charge.id for charge in created],
                "due_soon": due_soon,
                "message": "Cobros recurrentes y avisos simulados actualizados.",
            }
        )


class PaymentViewSet(viewsets.ModelViewSet):
    queryset = Payment.objects.select_related("site", "charge", "student", "team", "received_by").all()
    serializer_class = PaymentSerializer
    permission_classes = [IsOperationsCashierOrGuardianRole]
    list_only_fields = (
        "id",
        "created_at",
        "updated_at",
        "site_id",
        "charge_id",
        "student_id",
        "team_id",
        "method",
        "channel",
        "status",
        "amount",
        "paid_at",
        "confirmed_at",
        "expires_at",
        "reference",
        "tracking_key",
        "payment_url",
        "receipt_file",
        "received_by_id",
        "notes",
        "site__id",
        "site__name",
        "charge__id",
        "charge__concept",
        "student__id",
        "student__full_name",
        "team__id",
        "team__name",
        "received_by__id",
        "received_by__username",
    )
    confirm_cash_only_fields = (
        "id",
        "created_at",
        "updated_at",
        "site_id",
        "charge_id",
        "student_id",
        "team_id",
        "method",
        "channel",
        "status",
        "amount",
        "paid_at",
        "confirmed_at",
        "expires_at",
        "reference",
        "tracking_key",
        "payment_url",
        "receipt_file",
        "received_by_id",
        "notes",
        "site__id",
        "site__name",
        "charge__id",
        "charge__concept",
        "charge__amount",
        "charge__status",
        "student__id",
        "student__full_name",
        "student__guardian_id",
        "student__guardian__id",
        "student__guardian__user_id",
        "team__id",
        "team__name",
        "received_by__id",
        "received_by__username",
    )
    expire_only_fields = (
        "id",
        "created_at",
        "updated_at",
        "site_id",
        "charge_id",
        "student_id",
        "team_id",
        "method",
        "channel",
        "status",
        "amount",
        "paid_at",
        "confirmed_at",
        "expires_at",
        "reference",
        "tracking_key",
        "payment_url",
        "receipt_file",
        "received_by_id",
        "notes",
        "site__id",
        "site__name",
        "charge__id",
        "charge__concept",
        "charge__amount",
        "charge__status",
        "student__id",
        "student__full_name",
        "team__id",
        "team__name",
        "received_by__id",
        "received_by__username",
    )

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
        if getattr(self, "action", None) == "list":
            queryset = queryset.only(*self.list_only_fields)
        elif getattr(self, "action", None) == "confirm_cash":
            queryset = queryset.select_related("student__guardian").only(*self.confirm_cash_only_fields)
        elif getattr(self, "action", None) == "expire":
            queryset = queryset.only(*self.expire_only_fields)
        return queryset.distinct()

    @action(detail=True, methods=["post"], url_path="confirm-cash")
    def confirm_cash(self, request, pk=None):
        payment = self.get_object()
        if payment.method != "cash" or payment.status != "awaiting_confirmation":
            return Response({"detail": "Este pago no espera aceptacion de efectivo."}, status=status.HTTP_400_BAD_REQUEST)
        if request.user.role == "guardian" and payment.student.guardian.user_id != request.user.id:
            return Response({"detail": "No puedes aceptar pagos de otro representante."}, status=status.HTTP_403_FORBIDDEN)
        if payment.charge and payment.amount > charge_balance(payment.charge):
            return Response(
                {"detail": "El pago ya excede el saldo pendiente del cargo. Revisa pagos parciales previos."},
                status=status.HTTP_400_BAD_REQUEST,
            )
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
        if payment.charge and payment.amount > charge_balance(payment.charge):
            return Response(
                {"detail": "El pago ya excede el saldo pendiente del cargo. Revisa pagos parciales previos."},
                status=status.HTTP_400_BAD_REQUEST,
            )
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
    permission_classes = [IsOperationsCashierOrGuardianRole]
    list_only_fields = (
        "id",
        "created_at",
        "updated_at",
        "site_id",
        "charge_id",
        "student_id",
        "team_id",
        "reason",
        "amount",
        "status",
        "evidence_file",
        "requested_by_id",
        "approved_by_id",
        "approved_at",
        "site__id",
        "site__name",
        "charge__id",
        "charge__concept",
        "student__id",
        "student__full_name",
        "team__id",
        "team__name",
        "requested_by__id",
        "requested_by__username",
        "approved_by__id",
        "approved_by__username",
    )

    def get_permissions(self):
        if self.request.user.is_authenticated and self.request.user.role == "guardian" and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        if self.request.user.role == "cashier":
            queryset = queryset.filter(site=self.request.user.primary_site)
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(team__representative_user=self.request.user)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(team__players__user=self.request.user)
        status_value = self.request.query_params.get("status")
        if status_value:
            queryset = queryset.filter(status=status_value)
        if getattr(self, "action", None) == "list":
            queryset = queryset.only(*self.list_only_fields)
        elif getattr(self, "action", None) == "reject":
            queryset = queryset.only(*self.list_only_fields)
        return queryset.distinct()

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
