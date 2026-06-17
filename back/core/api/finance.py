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
        if user.role == "cashier" and user.primary_site_id:
            queryset = queryset.filter(site_id=user.primary_site_id)
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
