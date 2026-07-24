from django.contrib import admin
from django.urls import include, path

from core.api.automatic_attendance import (
    AutomaticAttendanceCancelJobView,
    AutomaticAttendanceJobView,
    AutomaticAttendanceConfirmReviewView,
    AutomaticAttendanceDownloadPendingView,
    AutomaticAttendanceEvidenceView,
    AutomaticAttendanceProcessView,
    AutomaticAttendanceReprocessClipView,
    AutomaticAttendanceStatusView,
    AutomaticAttendanceStorageEvidenceView,
    AutomaticAttendanceUploadView,
)
from core.api.video_occupancy import (
    VideoOccupancyEvidenceView,
    VideoOccupancyJobView,
    VideoOccupancyProcessView,
    VideoOccupancyStatusView,
    VideoOccupancyUploadView,
)
from core.api.unknown_attendance import (
    UnknownAttendanceCaptureImageView,
    UnknownAttendanceLocalFaceImageView,
    UnknownAttendanceProcessView,
    UnknownAttendanceRejectedFaceImageView,
    UnknownAttendanceRejectedFacesView,
    UnknownAttendanceRecordsView,
    UnknownAttendanceStatusView,
    UnknownAttendanceSubjectAcceptView,
    UnknownAttendanceSubjectDiscardView,
    UnknownAttendanceSubjectRegisterPersonView,
)
from core.api.face_station import (
    FaceStationBootstrapView,
    FaceStationCollaboratorQuickCreateView,
    FaceStationEventBatchView,
    FaceStationHeartbeatView,
    FaceStationPersonPhotoView,
    FaceStationStudentQuickCreateView,
    FaceStationUnknownRegisterView,
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
    path("api/automatic-attendance/download-pending-local/", AutomaticAttendanceDownloadPendingView.as_view()),
    path("api/automatic-attendance/process-pending/", AutomaticAttendanceProcessView.as_view()),
    path("api/automatic-attendance/reprocess-video-clip/", AutomaticAttendanceReprocessClipView.as_view()),
    path("api/automatic-attendance/jobs/<str:job_id>/", AutomaticAttendanceJobView.as_view()),
    path("api/automatic-attendance/jobs/<str:job_id>/cancel/", AutomaticAttendanceCancelJobView.as_view()),
    path("api/automatic-attendance/jobs/<str:job_id>/confirm-review/", AutomaticAttendanceConfirmReviewView.as_view()),
    path("api/automatic-attendance/evidence/<str:job_id>/<path:evidence_path>", AutomaticAttendanceEvidenceView.as_view()),
    path("api/automatic-attendance/evidence-storage/<str:bucket>/<path:object_path>", AutomaticAttendanceStorageEvidenceView.as_view()),
    path("api/video-occupancy/status/", VideoOccupancyStatusView.as_view()),
    path("api/video-occupancy/upload/", VideoOccupancyUploadView.as_view()),
    path("api/video-occupancy/process-pending/", VideoOccupancyProcessView.as_view()),
    path("api/video-occupancy/jobs/<str:job_id>/", VideoOccupancyJobView.as_view()),
    path("api/video-occupancy/evidence/<str:job_id>/<path:evidence_path>", VideoOccupancyEvidenceView.as_view()),
    path("api/unknown-attendance/status/", UnknownAttendanceStatusView.as_view()),
    path("api/unknown-attendance/records/", UnknownAttendanceRecordsView.as_view()),
    path("api/unknown-attendance/process-pending/", UnknownAttendanceProcessView.as_view()),
    path("api/unknown-attendance/subjects/<str:subject_id>/accept/", UnknownAttendanceSubjectAcceptView.as_view()),
    path("api/unknown-attendance/subjects/<str:subject_id>/discard/", UnknownAttendanceSubjectDiscardView.as_view()),
    path("api/unknown-attendance/subjects/<str:subject_id>/register-person/", UnknownAttendanceSubjectRegisterPersonView.as_view()),
    path("api/unknown-attendance/rejected-faces/", UnknownAttendanceRejectedFacesView.as_view()),
    path("api/unknown-attendance/rejected-faces/<str:capture_id>/<int:face_index>/image/", UnknownAttendanceRejectedFaceImageView.as_view()),
    path("api/unknown-attendance/captures/<str:capture_id>/image/", UnknownAttendanceCaptureImageView.as_view()),
    path("api/unknown-attendance/faces/<path:object_path>", UnknownAttendanceLocalFaceImageView.as_view()),
    path("api/face-station/bootstrap/", FaceStationBootstrapView.as_view()),
    path("api/face-station/heartbeat/", FaceStationHeartbeatView.as_view()),
    path("api/face-station/events/batch/", FaceStationEventBatchView.as_view()),
    path("api/face-station/unknowns/register/", FaceStationUnknownRegisterView.as_view()),
    path(
        "api/face-station/students/quick-create/",
        FaceStationStudentQuickCreateView.as_view(),
    ),
    path(
        "api/face-station/collaborators/quick-create/",
        FaceStationCollaboratorQuickCreateView.as_view(),
    ),
    path("api/face-station/people/<str:person_type>/<int:person_id>/photo/", FaceStationPersonPhotoView.as_view()),
    path("api/", include(router.urls)),
]
