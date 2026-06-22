from django.contrib import admin
from django.urls import include, path

from core.api.automatic_attendance import (
    AutomaticAttendanceJobView,
    AutomaticAttendanceConfirmReviewView,
    AutomaticAttendanceEvidenceView,
    AutomaticAttendanceProcessView,
    AutomaticAttendanceReprocessClipView,
    AutomaticAttendanceStatusView,
    AutomaticAttendanceUploadView,
)
from core.api.video_occupancy import (
    VideoOccupancyEvidenceView,
    VideoOccupancyJobView,
    VideoOccupancyProcessView,
    VideoOccupancyStatusView,
    VideoOccupancyUploadView,
)
from core.api.dashboard import DashboardSummaryView
from core.api.router import AccountingExportView, FaceAttendanceView, router
from core.auth_views import LoginView, LogoutView, MeView
from futsi_api.health import db_health, health, index


urlpatterns = [
    path("", index),
    path("health/", health),
    path("health/db/", db_health),
    path("admin/", admin.site.urls),
    path("api/auth/login/", LoginView.as_view()),
    path("api/auth/logout/", LogoutView.as_view()),
    path("api/auth/me/", MeView.as_view()),
    path("api/dashboard/summary/", DashboardSummaryView.as_view()),
    path("api/reports/accounting.xlsx", AccountingExportView.as_view()),
    path("api/face-attendance/recognize/", FaceAttendanceView.as_view()),
    path("api/automatic-attendance/status/", AutomaticAttendanceStatusView.as_view()),
    path("api/automatic-attendance/upload/", AutomaticAttendanceUploadView.as_view()),
    path("api/automatic-attendance/process-pending/", AutomaticAttendanceProcessView.as_view()),
    path("api/automatic-attendance/reprocess-video-clip/", AutomaticAttendanceReprocessClipView.as_view()),
    path("api/automatic-attendance/jobs/<str:job_id>/", AutomaticAttendanceJobView.as_view()),
    path("api/automatic-attendance/jobs/<str:job_id>/confirm-review/", AutomaticAttendanceConfirmReviewView.as_view()),
    path("api/automatic-attendance/evidence/<str:job_id>/<path:evidence_path>", AutomaticAttendanceEvidenceView.as_view()),
    path("api/video-occupancy/status/", VideoOccupancyStatusView.as_view()),
    path("api/video-occupancy/upload/", VideoOccupancyUploadView.as_view()),
    path("api/video-occupancy/process-pending/", VideoOccupancyProcessView.as_view()),
    path("api/video-occupancy/jobs/<str:job_id>/", VideoOccupancyJobView.as_view()),
    path("api/video-occupancy/evidence/<str:job_id>/<path:evidence_path>", VideoOccupancyEvidenceView.as_view()),
    path("api/", include(router.urls)),
]
