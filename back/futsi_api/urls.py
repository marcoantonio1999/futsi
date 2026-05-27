from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from core.auth_views import LoginView, LogoutView, MeView
from core.views import (
    AttendanceRecordViewSet,
    AttendanceSessionViewSet,
    AuditLogViewSet,
    ChargeViewSet,
    CoachWorkLogViewSet,
    CourtViewSet,
    DailyClosureViewSet,
    DiscountViewSet,
    ExpenseViewSet,
    GuardianViewSet,
    PaymentViewSet,
    PlayerViewSet,
    RoundViewSet,
    SiteViewSet,
    StudentViewSet,
    TeamViewSet,
    TournamentViewSet,
    UserViewSet,
)
from futsi_api.health import health


router = DefaultRouter()
router.register("users", UserViewSet)
router.register("sites", SiteViewSet)
router.register("courts", CourtViewSet)
router.register("guardians", GuardianViewSet)
router.register("students", StudentViewSet)
router.register("tournaments", TournamentViewSet)
router.register("teams", TeamViewSet)
router.register("players", PlayerViewSet)
router.register("rounds", RoundViewSet)
router.register("attendance-sessions", AttendanceSessionViewSet)
router.register("attendance-records", AttendanceRecordViewSet)
router.register("charges", ChargeViewSet)
router.register("coach-work-logs", CoachWorkLogViewSet)
router.register("payments", PaymentViewSet)
router.register("discounts", DiscountViewSet)
router.register("expenses", ExpenseViewSet)
router.register("daily-closures", DailyClosureViewSet)
router.register("audit-logs", AuditLogViewSet)

urlpatterns = [
    path("health/", health),
    path("admin/", admin.site.urls),
    path("api/auth/login/", LoginView.as_view()),
    path("api/auth/logout/", LogoutView.as_view()),
    path("api/auth/me/", MeView.as_view()),
    path("api/", include(router.urls)),
]
