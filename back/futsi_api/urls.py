from django.contrib import admin
from django.urls import include, path

from core.api.router import AccountingExportView, FaceAttendanceView, router
from core.auth_views import LoginView, LogoutView, MeView
from futsi_api.health import health, index


urlpatterns = [
    path("", index),
    path("health/", health),
    path("admin/", admin.site.urls),
    path("api/auth/login/", LoginView.as_view()),
    path("api/auth/logout/", LogoutView.as_view()),
    path("api/auth/me/", MeView.as_view()),
    path("api/reports/accounting.xlsx", AccountingExportView.as_view()),
    path("api/face-attendance/recognize/", FaceAttendanceView.as_view()),
    path("api/", include(router.urls)),
]
