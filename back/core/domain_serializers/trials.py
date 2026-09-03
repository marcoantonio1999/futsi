from datetime import timedelta

from django.utils import timezone
from django.db.models import Q
from rest_framework import serializers

from core.models import (
    CallOutcome,
    CallTranscriptSegment,
    TrialAvailabilityRule,
    TrialBooking,
    TrialVisit,
    VoiceCall,
    WhatsAppConversation,
    WhatsAppMessage,
    WhatsAppMessageDirection,
    User,
    sanitize_voice_error,
)
from core.permissions import ADMIN_ROLES


class TrialVisitSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    court_name = serializers.CharField(source="court.name", read_only=True)

    class Meta:
        model = TrialVisit
        fields = [
            "id",
            "booking",
            "site",
            "site_name",
            "court",
            "court_name",
            "visit_number",
            "starts_at",
            "ends_at",
            "status",
            "notes",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        instance = self.instance
        booking = attrs.get("booking", getattr(instance, "booking", None))
        site = attrs.get("site", getattr(instance, "site", None))
        court = attrs.get("court", getattr(instance, "court", None))
        starts_at = attrs.get("starts_at", getattr(instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(instance, "ends_at", None))

        if starts_at and ends_at and ends_at <= starts_at:
            raise serializers.ValidationError(
                {"ends_at": "La hora de fin debe ser posterior a la hora de inicio."}
            )
        if booking and site and booking.site_id != site.id:
            raise serializers.ValidationError(
                {"site": "La visita debe pertenecer a la misma sede que la reserva."}
            )
        if court and site and court.site_id != site.id:
            raise serializers.ValidationError(
                {"court": "La cancha debe pertenecer a la sede de la visita."}
            )
        return attrs


class TrialBookingSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)
    visits = TrialVisitSerializer(many=True, read_only=True)

    class Meta:
        model = TrialBooking
        fields = [
            "id",
            "site",
            "site_name",
            "responsible_name",
            "responsible_phone",
            "responsible_email",
            "child_first_name",
            "child_age",
            "source",
            "status",
            "notes",
            "created_by",
            "created_by_username",
            "visits",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]

    def validate_responsible_name(self, value):
        return value.strip()

    def validate_responsible_phone(self, value):
        return value.strip()

    def validate_child_first_name(self, value):
        return value.strip()


class CallTranscriptSegmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = CallTranscriptSegment
        fields = [
            "id",
            "sequence",
            "speaker",
            "text",
            "item_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class VoiceCallSerializer(serializers.ModelSerializer):
    booking_child_first_name = serializers.CharField(
        source="booking.child_first_name",
        read_only=True,
        allow_null=True,
    )
    site = serializers.IntegerField(source="booking.site_id", read_only=True, allow_null=True)
    site_name = serializers.CharField(
        source="booking.site.name",
        read_only=True,
        allow_null=True,
    )
    reviewed_by_username = serializers.CharField(
        source="reviewed_by.username",
        read_only=True,
        allow_null=True,
    )
    transcript_segments = serializers.SerializerMethodField()
    token_usage = serializers.SerializerMethodField()

    class Meta:
        model = VoiceCall
        fields = [
            "id",
            "call_sid",
            "stream_sid",
            "from_number",
            "to_number",
            "technical_status",
            "booking",
            "booking_child_first_name",
            "site",
            "site_name",
            "summary",
            "ai_outcome",
            "review_outcome",
            "failure_reason",
            "sanitized_error",
            "consent_granted",
            "consent_granted_at",
            "consent_withdrawn_at",
            "started_at",
            "ended_at",
            "duration_seconds",
            "token_usage",
            "reviewed_by",
            "reviewed_by_username",
            "reviewed_at",
            "transcript_segments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "review_outcome",
            "failure_reason",
            "reviewed_by",
            "reviewed_at",
            "created_at",
            "updated_at",
        ]

    def get_transcript_segments(self, obj):
        request = self.context.get("request")
        if not request or getattr(request.user, "role", None) not in ADMIN_ROLES:
            return []
        return CallTranscriptSegmentSerializer(
            obj.transcript_segments.all(),
            many=True,
            context=self.context,
        ).data

    def get_token_usage(self, obj):
        usage = (obj.extracted_data or {}).get("openai_realtime_usage")
        return usage if isinstance(usage, dict) else {}

    def validate_sanitized_error(self, value):
        return sanitize_voice_error(value)

    def validate(self, attrs):
        instance = self.instance
        consent_granted = attrs.get(
            "consent_granted",
            getattr(instance, "consent_granted", False),
        )
        consent_granted_at = attrs.get(
            "consent_granted_at",
            getattr(instance, "consent_granted_at", None),
        )
        started_at = attrs.get("started_at", getattr(instance, "started_at", None))
        ended_at = attrs.get("ended_at", getattr(instance, "ended_at", None))

        if consent_granted and not consent_granted_at:
            attrs["consent_granted_at"] = timezone.now()
        elif not consent_granted:
            attrs["consent_granted_at"] = None
        if started_at and ended_at and ended_at < started_at:
            raise serializers.ValidationError(
                {"ended_at": "El fin de la llamada no puede ser anterior al inicio."}
            )
        return attrs


class VoiceCallReviewSerializer(serializers.Serializer):
    review_outcome = serializers.ChoiceField(
        choices=[CallOutcome.SUCCESSFUL, CallOutcome.UNSUCCESSFUL]
    )
    failure_reason = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=2000,
    )

    def validate(self, attrs):
        outcome = attrs["review_outcome"]
        failure_reason = attrs.get("failure_reason", "").strip()
        if outcome == CallOutcome.UNSUCCESSFUL and not failure_reason:
            raise serializers.ValidationError(
                {"failure_reason": "Indica el motivo de una llamada no exitosa."}
            )
        attrs["failure_reason"] = (
            failure_reason if outcome == CallOutcome.UNSUCCESSFUL else ""
        )
        return attrs


class WhatsAppMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = WhatsAppMessage
        fields = [
            "id",
            "direction",
            "body",
            "created_at",
        ]
        read_only_fields = fields


class WhatsAppSendMessageSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=4096, trim_whitespace=True)

    def validate_body(self, value):
        body = str(value or "").strip()
        if not body:
            raise serializers.ValidationError("Escribe un mensaje antes de enviarlo.")
        return body


class WhatsAppConversationSerializer(serializers.ModelSerializer):
    kind = serializers.SerializerMethodField()
    contact_name = serializers.SerializerMethodField()
    human_takeover_active = serializers.SerializerMethodField()
    human_last_reply_at = serializers.SerializerMethodField()
    bot_response_pending = serializers.SerializerMethodField()
    last_inbound_at = serializers.SerializerMethodField()
    free_form_window_expires_at = serializers.SerializerMethodField()
    free_form_window_open = serializers.SerializerMethodField()
    site_name = serializers.CharField(source="site.name", read_only=True, allow_null=True)
    booking_child_first_name = serializers.CharField(
        source="booking.child_first_name",
        read_only=True,
        allow_null=True,
    )
    booking_responsible_name = serializers.CharField(
        source="booking.responsible_name",
        read_only=True,
        allow_null=True,
    )
    follow_up_assigned_to = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(
            is_active=True,
            role__in=["admin", "owner", "dev", "site_coordinator"],
        ),
        required=False,
        allow_null=True,
    )
    follow_up_assigned_to_name = serializers.SerializerMethodField()
    follow_up_notes = serializers.CharField(
        required=False,
        allow_blank=True,
        max_length=4000,
    )
    messages = WhatsAppMessageSerializer(many=True, read_only=True)

    def get_follow_up_assigned_to_name(self, instance):
        assignee = instance.follow_up_assigned_to
        if not assignee:
            return None
        return assignee.get_full_name().strip() or assignee.username

    def get_kind(self, instance):
        context = instance.context if isinstance(instance.context, dict) else {}
        return str(context.get("kind") or "trial_booking")

    def get_contact_name(self, instance):
        context = instance.context if isinstance(instance.context, dict) else {}
        name = str(context.get("contact_name") or "").strip()
        return name or None

    def get_human_takeover_active(self, instance):
        context = instance.context if isinstance(instance.context, dict) else {}
        return bool(context.get("automation_paused_by_human"))

    def get_human_last_reply_at(self, instance):
        context = instance.context if isinstance(instance.context, dict) else {}
        value = str(context.get("human_last_reply_at") or "").strip()
        return value or None

    def get_bot_response_pending(self, instance):
        context = instance.context if isinstance(instance.context, dict) else {}
        return bool(context.get("human_response_wait"))

    @staticmethod
    def _last_inbound_message(instance):
        return next(
            (
                message
                for message in reversed(list(instance.messages.all()))
                if message.direction == WhatsAppMessageDirection.INBOUND
            ),
            None,
        )

    def get_last_inbound_at(self, instance):
        message = self._last_inbound_message(instance)
        return message.created_at.isoformat() if message else None

    def get_free_form_window_expires_at(self, instance):
        message = self._last_inbound_message(instance)
        if not message:
            return None
        return (message.created_at + timedelta(hours=24)).isoformat()

    def get_free_form_window_open(self, instance):
        message = self._last_inbound_message(instance)
        return bool(message and message.created_at + timedelta(hours=24) > timezone.now())

    def validate_follow_up_assigned_to(self, assignee):
        if assignee is None:
            return None
        conversation = self.instance
        request = self.context.get("request")
        if not conversation or not request:
            return assignee
        if assignee.role == "site_coordinator":
            if not conversation.site_id or assignee.primary_site_id != conversation.site_id:
                raise serializers.ValidationError(
                    "El coordinador asignado debe pertenecer a la sede de la conversación."
                )
        if request.user.role == "site_coordinator":
            if (
                assignee.role != "site_coordinator"
                or assignee.primary_site_id != request.user.primary_site_id
            ):
                raise serializers.ValidationError(
                    "Sólo puedes asignar seguimiento a coordinadores de tu sede."
                )
        return assignee

    def validate_follow_up_notes(self, value):
        return str(value or "").strip()

    class Meta:
        model = WhatsAppConversation
        fields = [
            "id",
            "kind",
            "contact_name",
            "contact_phone",
            "status",
            "current_step",
            "site",
            "site_name",
            "booking",
            "booking_child_first_name",
            "booking_responsible_name",
            "failure_reason",
            "last_message_at",
            "follow_up_required",
            "follow_up_assigned_to",
            "follow_up_assigned_to_name",
            "follow_up_notes",
            "follow_up_updated_at",
            "human_takeover_active",
            "human_last_reply_at",
            "bot_response_pending",
            "last_inbound_at",
            "free_form_window_expires_at",
            "free_form_window_open",
            "messages",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "kind",
            "contact_name",
            "contact_phone",
            "status",
            "current_step",
            "site",
            "site_name",
            "booking",
            "booking_child_first_name",
            "booking_responsible_name",
            "failure_reason",
            "last_message_at",
            "follow_up_assigned_to_name",
            "follow_up_updated_at",
            "human_takeover_active",
            "human_last_reply_at",
            "bot_response_pending",
            "last_inbound_at",
            "free_form_window_expires_at",
            "free_form_window_open",
            "messages",
            "created_at",
            "updated_at",
        ]


class TrialAvailabilityRuleSerializer(serializers.ModelSerializer):
    site_name = serializers.CharField(source="site.name", read_only=True)
    court_name = serializers.CharField(source="court.name", read_only=True)

    class Meta:
        model = TrialAvailabilityRule
        fields = [
            "id",
            "site",
            "site_name",
            "court",
            "court_name",
            "weekday",
            "starts_at",
            "ends_at",
            "slot_minutes",
            "capacity",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        instance = self.instance
        site = attrs.get("site", getattr(instance, "site", None))
        court = attrs.get("court", getattr(instance, "court", None))
        starts_at = attrs.get("starts_at", getattr(instance, "starts_at", None))
        ends_at = attrs.get("ends_at", getattr(instance, "ends_at", None))
        slot_minutes = attrs.get(
            "slot_minutes",
            getattr(instance, "slot_minutes", None),
        )
        is_active = attrs.get(
            "is_active",
            getattr(instance, "is_active", True),
        )

        if starts_at and ends_at and ends_at <= starts_at:
            raise serializers.ValidationError(
                {"ends_at": "La hora de fin debe ser posterior a la hora de inicio."}
            )
        if court and site and court.site_id != site.id:
            raise serializers.ValidationError(
                {"court": "La cancha debe pertenecer a la sede de la regla."}
            )
        if court and not court.is_active:
            raise serializers.ValidationError(
                {"court": "La cancha seleccionada no esta activa."}
            )
        if site and not site.is_active:
            raise serializers.ValidationError(
                {"site": "La sede seleccionada no esta activa."}
            )
        if starts_at and ends_at and slot_minutes:
            available_minutes = (
                ends_at.hour * 60
                + ends_at.minute
                - starts_at.hour * 60
                - starts_at.minute
            )
            if slot_minutes > available_minutes:
                raise serializers.ValidationError(
                    {
                        "slot_minutes": (
                            "La duracion de la cita debe caber dentro del horario."
                        )
                    }
                )
        weekday = attrs.get("weekday", getattr(instance, "weekday", None))
        if site and weekday is not None and starts_at and ends_at and is_active:
            conflicts = TrialAvailabilityRule.objects.filter(
                site=site,
                weekday=weekday,
                is_active=True,
                starts_at__lt=ends_at,
                ends_at__gt=starts_at,
            )
            if court:
                conflicts = conflicts.filter(
                    Q(court=court)
                    | Q(court__isnull=True)
                )
            if instance:
                conflicts = conflicts.exclude(pk=instance.pk)
            if conflicts.exists():
                raise serializers.ValidationError(
                    {
                        "starts_at": (
                            "El horario se traslapa con otra regla activa para esa sede o cancha."
                        )
                    }
                )
        return attrs
