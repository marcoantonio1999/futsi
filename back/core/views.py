from uuid import uuid4

from django.db.models import Count
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .permissions import (
    IsAdminForWrites,
    IsAdminRole,
    IsOperationsCashierOrGuardianRole,
    IsOperationsCashierCoachOrGuardianRole,
    IsOperationsCoachOrGuardianRole,
    IsOperationsOrCoachRole,
    IsOperationsOrGuardianRole,
    IsOperationsRole,
)
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
from .serializers import (
    AttendanceRecordSerializer,
    AttendanceSessionSerializer,
    AuditLogSerializer,
    ChargeSerializer,
    CoachWorkLogSerializer,
    CourtSerializer,
    DailyClosureSerializer,
    DiscountSerializer,
    ExpenseSerializer,
    GuardianSerializer,
    PaymentSerializer,
    PlayerSerializer,
    RoundSerializer,
    SiteSerializer,
    StudentSerializer,
    TeamSerializer,
    TournamentSerializer,
    UserSerializer,
    sync_charge_status,
)


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related("primary_site").all()
    serializer_class = UserSerializer
    permission_classes = [IsAdminRole]


class SiteViewSet(viewsets.ModelViewSet):
    queryset = Site.objects.annotate(student_count=Count("students")).all()
    serializer_class = SiteSerializer
    permission_classes = [IsAdminForWrites]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role in {"cashier", "coach"} and self.request.user.primary_site_id:
            return queryset.filter(id=self.request.user.primary_site_id)
        if self.request.user.role == "guardian":
            return queryset.filter(students__guardian__user=self.request.user).distinct()
        return queryset


class CourtViewSet(viewsets.ModelViewSet):
    queryset = Court.objects.select_related("site").all()
    serializer_class = CourtSerializer
    permission_classes = [IsAdminForWrites]


class GuardianViewSet(viewsets.ModelViewSet):
    queryset = Guardian.objects.all()
    serializer_class = GuardianSerializer
    permission_classes = [IsOperationsRole]


class StudentViewSet(viewsets.ModelViewSet):
    queryset = Student.objects.select_related("site", "guardian").all()
    serializer_class = StudentSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]

    def get_permissions(self):
        if self.request.user.is_authenticated and self.request.user.role in {"guardian", "cashier", "coach"} and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            return queryset.filter(guardian__user=self.request.user)
        if self.request.user.role == "cashier":
            return queryset.filter(site=self.request.user.primary_site)
        if self.request.user.role == "coach":
            queryset = queryset.filter(site=self.request.user.primary_site)
            if self.request.user.coach_group_name:
                queryset = queryset.filter(group_name=self.request.user.coach_group_name)
            return queryset
        return queryset


class TournamentViewSet(viewsets.ModelViewSet):
    queryset = Tournament.objects.select_related("site").all()
    serializer_class = TournamentSerializer


class TeamViewSet(viewsets.ModelViewSet):
    queryset = Team.objects.select_related("tournament", "tournament__site").all()
    serializer_class = TeamSerializer


class PlayerViewSet(viewsets.ModelViewSet):
    queryset = Player.objects.select_related("team").all()
    serializer_class = PlayerSerializer


class RoundViewSet(viewsets.ModelViewSet):
    queryset = Round.objects.select_related("tournament").all()
    serializer_class = RoundSerializer


class AttendanceSessionViewSet(viewsets.ModelViewSet):
    queryset = AttendanceSession.objects.select_related(
        "site",
        "court",
        "tournament",
        "round",
        "team",
        "captured_by",
    ).annotate(record_count=Count("records")).all()
    serializer_class = AttendanceSessionSerializer
    permission_classes = [IsOperationsOrCoachRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        site = self.request.query_params.get("site")
        date = self.request.query_params.get("date")
        if site:
            queryset = queryset.filter(site_id=site)
        if date:
            queryset = queryset.filter(date=date)
        if self.request.user.role == "coach":
            queryset = queryset.filter(site=self.request.user.primary_site)
            if self.request.user.coach_group_name:
                queryset = queryset.filter(group_name=self.request.user.coach_group_name)
        return queryset

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        session = self.get_object()
        if session.closed_at:
            return Response(self.get_serializer(session).data)
        session.closed_at = timezone.now()
        session.save(update_fields=["closed_at", "updated_at"])
        return Response(self.get_serializer(session).data)


class AttendanceRecordViewSet(viewsets.ModelViewSet):
    queryset = AttendanceRecord.objects.select_related("session", "student", "team", "captured_by").all()
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsOperationsCoachOrGuardianRole]

    def get_permissions(self):
        if self.request.user.is_authenticated and self.request.user.role == "guardian" and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        if self.request.user.role == "coach":
            queryset = queryset.filter(student__site=self.request.user.primary_site)
            if self.request.user.coach_group_name:
                queryset = queryset.filter(student__group_name=self.request.user.coach_group_name)
        session = self.request.query_params.get("session")
        if session:
            queryset = queryset.filter(session_id=session)
        return queryset


class CoachWorkLogViewSet(viewsets.ModelViewSet):
    queryset = CoachWorkLog.objects.select_related("coach", "site", "created_by").all()
    serializer_class = CoachWorkLogSerializer
    permission_classes = [IsOperationsOrCoachRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "coach":
            queryset = queryset.filter(coach=self.request.user)
        site = self.request.query_params.get("site")
        if site:
            queryset = queryset.filter(site_id=site)
        return queryset.order_by("-work_date", "-created_at")


class ChargeViewSet(viewsets.ModelViewSet):
    queryset = Charge.objects.select_related("site", "student", "team", "created_by").all()
    serializer_class = ChargeSerializer
    permission_classes = [IsOperationsCashierOrGuardianRole]

    def get_permissions(self):
        if self.request.user.is_authenticated and self.request.user.role in {"guardian", "cashier"} and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        if self.request.user.role == "cashier":
            queryset = queryset.filter(site=self.request.user.primary_site)
        status_value = self.request.query_params.get("status")
        student = self.request.query_params.get("student")
        if status_value:
            queryset = queryset.filter(status=status_value)
        if student:
            queryset = queryset.filter(student_id=student)
        return queryset


class PaymentViewSet(viewsets.ModelViewSet):
    queryset = Payment.objects.select_related("site", "charge", "student", "team", "received_by").all()
    serializer_class = PaymentSerializer
    permission_classes = [IsOperationsCashierOrGuardianRole]

    def get_permissions(self):
        if (
            self.request.user.is_authenticated
            and self.request.user.role == "guardian"
            and self.request.method not in ("GET", "HEAD", "OPTIONS")
            and self.action not in {"confirm_cash", "simulate_webhook"}
        ):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        if self.request.user.role == "cashier":
            queryset = queryset.filter(site=self.request.user.primary_site)
        charge = self.request.query_params.get("charge")
        if charge:
            queryset = queryset.filter(charge_id=charge)
        return queryset

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


class DailyClosureViewSet(viewsets.ModelViewSet):
    queryset = DailyClosure.objects.select_related("site", "closed_by").all()
    serializer_class = DailyClosureSerializer


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related("actor").all()
    serializer_class = AuditLogSerializer
