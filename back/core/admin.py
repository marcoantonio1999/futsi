from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    AttendanceRecord,
    AttendanceSession,
    AuditLog,
    CashMovement,
    CallTranscriptSegment,
    Charge,
    CoachWorkLog,
    Court,
    DailyClosure,
    Discount,
    Expense,
    FaceRecognitionAttempt,
    FaceStationDevice,
    FaceStationEvent,
    FaceStationUnknownLink,
    Guardian,
    HistoricalImport,
    HistoricalImportRow,
    Invoice,
    Match,
    Payment,
    Player,
    PlayerAttendanceRecord,
    Round,
    Site,
    StaffPaymentRequest,
    Student,
    StudentAssessment,
    StudentValueAssessment,
    StudentTournamentRegistration,
    Team,
    TrialAvailabilityRule,
    TrialBooking,
    TrialVisit,
    Tournament,
    User,
    VoiceCall,
    WhatsAppConversation,
    WhatsAppMessage,
)


@admin.register(User)
class CustomUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        ("Operacion", {"fields": ("role", "primary_site", "phone", "avatar_url", "coach_group_name", "coach_hourly_rate", "section_permissions")}),
    )
    list_display = ("username", "email", "role", "primary_site", "is_active")
    list_filter = ("role", "is_active", "primary_site")


admin.site.register(Site)
admin.site.register(Court)
admin.site.register(Guardian)
admin.site.register(Student)
admin.site.register(Tournament)
admin.site.register(Team)
admin.site.register(StudentTournamentRegistration)
admin.site.register(Player)
admin.site.register(PlayerAttendanceRecord)
admin.site.register(Round)
admin.site.register(Match)
admin.site.register(StudentAssessment)
admin.site.register(StudentValueAssessment)
admin.site.register(AttendanceSession)
admin.site.register(AttendanceRecord)
admin.site.register(Charge)
admin.site.register(CoachWorkLog)
admin.site.register(Payment)
admin.site.register(Discount)
admin.site.register(Expense)
admin.site.register(StaffPaymentRequest)
admin.site.register(CashMovement)
admin.site.register(Invoice)
admin.site.register(HistoricalImport)
admin.site.register(HistoricalImportRow)
admin.site.register(FaceRecognitionAttempt)
admin.site.register(FaceStationDevice)
admin.site.register(FaceStationEvent)
admin.site.register(FaceStationUnknownLink)
admin.site.register(DailyClosure)
admin.site.register(AuditLog)


class TrialVisitInline(admin.TabularInline):
    model = TrialVisit
    extra = 0


@admin.register(TrialBooking)
class TrialBookingAdmin(admin.ModelAdmin):
    list_display = (
        "child_first_name",
        "responsible_name",
        "site",
        "source",
        "status",
        "created_at",
    )
    list_filter = ("site", "source", "status")
    search_fields = (
        "child_first_name",
        "responsible_name",
        "responsible_phone",
    )
    inlines = [TrialVisitInline]


@admin.register(TrialVisit)
class TrialVisitAdmin(admin.ModelAdmin):
    list_display = (
        "booking",
        "visit_number",
        "site",
        "court",
        "starts_at",
        "status",
    )
    list_filter = ("site", "status", "visit_number")
    search_fields = (
        "booking__child_first_name",
        "booking__responsible_name",
    )


class CallTranscriptSegmentInline(admin.TabularInline):
    model = CallTranscriptSegment
    extra = 0
    ordering = ("sequence",)


@admin.register(VoiceCall)
class VoiceCallAdmin(admin.ModelAdmin):
    list_display = (
        "call_sid",
        "from_number",
        "technical_status",
        "ai_outcome",
        "review_outcome",
        "created_at",
    )
    list_filter = ("technical_status", "ai_outcome", "review_outcome")
    search_fields = (
        "call_sid",
        "from_number",
        "to_number",
        "booking__responsible_name",
    )
    readonly_fields = ("reviewed_by", "reviewed_at")
    inlines = [CallTranscriptSegmentInline]


@admin.register(CallTranscriptSegment)
class CallTranscriptSegmentAdmin(admin.ModelAdmin):
    list_display = ("call", "sequence", "speaker", "created_at")
    list_filter = ("speaker",)
    search_fields = ("call__call_sid", "text", "item_id")


class WhatsAppMessageInline(admin.TabularInline):
    model = WhatsAppMessage
    extra = 0
    readonly_fields = ("direction", "body", "provider_sid", "in_reply_to_sid", "created_at")


@admin.register(WhatsAppConversation)
class WhatsAppConversationAdmin(admin.ModelAdmin):
    list_display = (
        "contact_phone",
        "site",
        "status",
        "current_step",
        "booking",
        "follow_up_required",
        "follow_up_assigned_to",
        "last_message_at",
    )
    list_filter = ("status", "current_step", "site", "follow_up_required")
    search_fields = (
        "contact_phone",
        "booking__responsible_name",
        "booking__child_first_name",
    )
    inlines = [WhatsAppMessageInline]


@admin.register(WhatsAppMessage)
class WhatsAppMessageAdmin(admin.ModelAdmin):
    list_display = ("conversation", "direction", "created_at")
    list_filter = ("direction",)
    search_fields = ("conversation__contact_phone", "body", "provider_sid")


@admin.register(TrialAvailabilityRule)
class TrialAvailabilityRuleAdmin(admin.ModelAdmin):
    list_display = (
        "site",
        "court",
        "weekday",
        "starts_at",
        "ends_at",
        "capacity",
        "is_active",
    )
    list_filter = ("site", "weekday", "is_active")
