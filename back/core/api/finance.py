from .billing import (
    ChargeViewSet,
    DiscountViewSet,
    PaymentViewSet,
    generate_scheduled_charges_for_user,
    generate_student_tournament_charges_for_user,
)
from .common import *


class ExpenseViewSet(viewsets.ModelViewSet):
    queryset = Expense.objects.select_related("site", "captured_by", "approved_by").all()
    serializer_class = ExpenseSerializer
    permission_classes = [IsOperationsRole]
    action_only_fields = (
        "id",
        "created_at",
        "updated_at",
        "site_id",
        "category",
        "description",
        "amount",
        "expense_date",
        "provider_name",
        "evidence_file",
        "status",
        "captured_by_id",
        "approved_by_id",
        "approved_at",
        "site__id",
        "site__name",
        "captured_by__id",
        "captured_by__username",
        "approved_by__id",
        "approved_by__username",
    )

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.role in {"site_coordinator", "cashier"} and user.primary_site_id:
            queryset = queryset.filter(site_id=user.primary_site_id)
        status_value = self.request.query_params.get("status")
        site = self.request.query_params.get("site")
        if status_value:
            queryset = queryset.filter(status=status_value)
        if site and user.role in {"admin", "dev", "owner", "accounting"}:
            queryset = queryset.filter(site_id=site)
        if getattr(self, "action", None) in {"approve", "reject"}:
            queryset = queryset.only(*self.action_only_fields)
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
    list_only_fields = (
        "id",
        "created_at",
        "updated_at",
        "site_id",
        "recipient_id",
        "kind",
        "amount",
        "requested_payment_date",
        "description",
        "payment_method",
        "status",
        "requested_by_id",
        "accepted_at",
        "response_notes",
        "expense_id",
        "site__id",
        "site__name",
        "recipient__id",
        "recipient__username",
        "recipient__first_name",
        "recipient__last_name",
        "requested_by__id",
        "requested_by__username",
        "expense__id",
        "expense__description",
    )

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.role not in {"admin", "dev", "owner", "accounting", "site_coordinator", "cashier"}:
            queryset = queryset.filter(recipient=user)
        if user.role in {"site_coordinator", "cashier"} and user.primary_site_id:
            queryset = queryset.filter(site_id=user.primary_site_id)
        site = self.request.query_params.get("site")
        status_value = self.request.query_params.get("status")
        mine = self.request.query_params.get("mine")
        if site and user.role in {"admin", "dev", "owner", "accounting"}:
            queryset = queryset.filter(site_id=site)
        if status_value:
            queryset = queryset.filter(status=status_value)
        if mine:
            queryset = queryset.filter(recipient=user)
        if getattr(self, "action", None) == "list":
            queryset = queryset.only(*self.list_only_fields)
        elif getattr(self, "action", None) in {"accept", "reject"}:
            queryset = queryset.only(*self.list_only_fields)
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
    list_only_fields = (
        "id",
        "created_at",
        "updated_at",
        "site_id",
        "movement_type",
        "amount",
        "movement_date",
        "reason",
        "responsible_id",
        "created_by_id",
        "staff_payment_request_id",
        "notes",
        "site__id",
        "site__name",
        "responsible__id",
        "responsible__username",
        "responsible__first_name",
        "responsible__last_name",
        "created_by__id",
        "created_by__username",
    )

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role in {"site_coordinator", "cashier"} and self.request.user.primary_site_id:
            queryset = queryset.filter(site_id=self.request.user.primary_site_id)
        site = self.request.query_params.get("site")
        movement_type = self.request.query_params.get("movement_type")
        if site and self.request.user.role in {"admin", "dev", "owner", "accounting"}:
            queryset = queryset.filter(site_id=site)
        if movement_type:
            queryset = queryset.filter(movement_type=movement_type)
        if getattr(self, "action", None) == "list":
            queryset = queryset.select_related(None).select_related("site", "responsible", "created_by").only(*self.list_only_fields)
        return queryset

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
