from rest_framework.routers import DefaultRouter

from core.api.accounting import AccountingExportView
from core.api.attendance import AttendanceRecordViewSet, AttendanceSessionViewSet, CoachWorkLogViewSet
from core.api.audit import AuditLogViewSet, DailyClosureViewSet
from core.api.catalog import (
    CourtViewSet,
    GuardianViewSet,
    PlayerAttendanceRecordViewSet,
    PlayerViewSet,
    RoundViewSet,
    SiteViewSet,
    StudentViewSet,
    StudentTournamentRegistrationViewSet,
    TeamViewSet,
    TournamentViewSet,
    UserViewSet,
)
from core.api.face import FaceAttendanceView
from core.api.finance import (
    CashMovementViewSet,
    ChargeViewSet,
    DiscountViewSet,
    ExpenseViewSet,
    PaymentViewSet,
    StaffPaymentRequestViewSet,
)
from core.api.historical import HistoricalImportViewSet
from core.api.invoices import InvoiceViewSet
from core.api.sports import MatchViewSet, StudentAssessmentViewSet, StudentValueAssessmentViewSet
from core.api.trials import (
    TrialAvailabilityRuleViewSet,
    TrialBookingViewSet,
    TrialVisitViewSet,
    VoiceCallViewSet,
    WhatsAppConversationViewSet,
)


router = DefaultRouter()
router.register("users", UserViewSet)
router.register("sites", SiteViewSet)
router.register("courts", CourtViewSet)
router.register("guardians", GuardianViewSet)
router.register("students", StudentViewSet)
router.register("tournaments", TournamentViewSet)
router.register("teams", TeamViewSet)
router.register("student-tournament-registrations", StudentTournamentRegistrationViewSet)
router.register("players", PlayerViewSet)
router.register("player-attendance-records", PlayerAttendanceRecordViewSet)
router.register("rounds", RoundViewSet)
router.register("matches", MatchViewSet)
router.register("student-assessments", StudentAssessmentViewSet)
router.register("student-value-assessments", StudentValueAssessmentViewSet)
router.register("attendance-sessions", AttendanceSessionViewSet)
router.register("attendance-records", AttendanceRecordViewSet)
router.register("charges", ChargeViewSet)
router.register("coach-work-logs", CoachWorkLogViewSet)
router.register("payments", PaymentViewSet)
router.register("discounts", DiscountViewSet)
router.register("expenses", ExpenseViewSet)
router.register("staff-payment-requests", StaffPaymentRequestViewSet)
router.register("cash-movements", CashMovementViewSet)
router.register("invoices", InvoiceViewSet)
router.register("historical-imports", HistoricalImportViewSet)
router.register("daily-closures", DailyClosureViewSet)
router.register("audit-logs", AuditLogViewSet)
router.register("trial-bookings", TrialBookingViewSet)
router.register("trial-visits", TrialVisitViewSet)
router.register("voice-calls", VoiceCallViewSet)
router.register("whatsapp-conversations", WhatsAppConversationViewSet)
router.register("trial-availability-rules", TrialAvailabilityRuleViewSet)
