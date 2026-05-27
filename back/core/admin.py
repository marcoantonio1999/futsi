from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

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


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        ("Operacion", {"fields": ("role", "primary_site", "phone", "avatar_url", "coach_group_name", "coach_hourly_rate")}),
    )
    list_display = ("username", "email", "role", "primary_site", "is_active")
    list_filter = ("role", "is_active", "primary_site")


admin.site.register(Site)
admin.site.register(Court)
admin.site.register(Guardian)
admin.site.register(Student)
admin.site.register(Tournament)
admin.site.register(Team)
admin.site.register(Player)
admin.site.register(Round)
admin.site.register(AttendanceSession)
admin.site.register(AttendanceRecord)
admin.site.register(Charge)
admin.site.register(CoachWorkLog)
admin.site.register(Payment)
admin.site.register(Discount)
admin.site.register(Expense)
admin.site.register(DailyClosure)
admin.site.register(AuditLog)
