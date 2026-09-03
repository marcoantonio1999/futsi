from datetime import timedelta

from django.db import models, transaction
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from core.domain_serializers.trials import (
    TrialAvailabilityRuleSerializer,
    TrialBookingSerializer,
    TrialVisitSerializer,
    VoiceCallReviewSerializer,
    VoiceCallSerializer,
    WhatsAppConversationSerializer,
    WhatsAppSendMessageSerializer,
)
from core.models import (
    AuditLog,
    TrialAvailabilityRule,
    TrialBooking,
    TrialVisit,
    VoiceCall,
    WhatsAppConversation,
    WhatsAppMessage,
    WhatsAppMessageDirection,
    User,
)
from core.permissions import ADMIN_ROLES
from core.whatsapp.meta_api import (
    MetaWhatsAppError,
    configured_business_address,
    send_text,
)


TRIAL_DASHBOARD_ROLES = ADMIN_ROLES | {"site_coordinator"}


class CanManageTrialDashboard(BasePermission):
    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in TRIAL_DASHBOARD_ROLES
        )


class SiteScopedTrialViewSetMixin:
    site_filter = "site_id"

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.role in ADMIN_ROLES:
            return queryset
        if user.role == "site_coordinator" and user.primary_site_id:
            return queryset.filter(**{self.site_filter: user.primary_site_id})
        return queryset.none()

    def ensure_site_scope(self, site_id):
        user = self.request.user
        if user.role in ADMIN_ROLES:
            return
        if (
            user.role != "site_coordinator"
            or not user.primary_site_id
            or user.primary_site_id != site_id
        ):
            raise PermissionDenied("Solo puedes administrar pruebas de tu sede principal.")


class TrialBookingViewSet(SiteScopedTrialViewSetMixin, viewsets.ModelViewSet):
    queryset = (
        TrialBooking.objects.select_related("site", "created_by")
        .prefetch_related("visits", "visits__site", "visits__court")
        .order_by("-created_at")
    )
    serializer_class = TrialBookingSerializer
    permission_classes = [CanManageTrialDashboard]

    def get_queryset(self):
        queryset = super().get_queryset()
        site = self.request.query_params.get("site")
        status_value = self.request.query_params.get("status")
        source = self.request.query_params.get("source")
        search = self.request.query_params.get("search", "").strip()
        if site:
            queryset = queryset.filter(site_id=site)
        if status_value:
            queryset = queryset.filter(status=status_value)
        if source:
            queryset = queryset.filter(source=source)
        if search:
            queryset = queryset.filter(
                models.Q(responsible_name__icontains=search)
                | models.Q(responsible_phone__icontains=search)
                | models.Q(child_first_name__icontains=search)
            )
        return queryset

    def perform_create(self, serializer):
        site = serializer.validated_data["site"]
        self.ensure_site_scope(site.id)
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        site = serializer.validated_data.get("site", serializer.instance.site)
        self.ensure_site_scope(site.id)
        serializer.save()


class TrialVisitViewSet(SiteScopedTrialViewSetMixin, viewsets.ModelViewSet):
    queryset = TrialVisit.objects.select_related(
        "booking",
        "booking__site",
        "site",
        "court",
    ).order_by("starts_at", "visit_number")
    serializer_class = TrialVisitSerializer
    permission_classes = [CanManageTrialDashboard]

    def get_queryset(self):
        queryset = super().get_queryset()
        site = self.request.query_params.get("site")
        booking = self.request.query_params.get("booking")
        status_value = self.request.query_params.get("status")
        if site:
            queryset = queryset.filter(site_id=site)
        if booking:
            queryset = queryset.filter(booking_id=booking)
        if status_value:
            queryset = queryset.filter(status=status_value)
        return queryset

    def perform_create(self, serializer):
        site = serializer.validated_data["site"]
        self.ensure_site_scope(site.id)
        serializer.save()

    def perform_update(self, serializer):
        site = serializer.validated_data.get("site", serializer.instance.site)
        self.ensure_site_scope(site.id)
        serializer.save()


class VoiceCallViewSet(SiteScopedTrialViewSetMixin, viewsets.ReadOnlyModelViewSet):
    queryset = VoiceCall.objects.select_related(
        "booking",
        "booking__site",
        "reviewed_by",
    ).order_by("-created_at")
    serializer_class = VoiceCallSerializer
    permission_classes = [CanManageTrialDashboard]
    site_filter = "booking__site_id"

    def _ensure_call_scope(self, booking):
        if self.request.user.role in ADMIN_ROLES:
            return
        if booking is None:
            raise PermissionDenied(
                "La llamada debe estar vinculada a una reserva de tu sede."
            )
        self.ensure_site_scope(booking.site_id)

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role in ADMIN_ROLES:
            queryset = queryset.prefetch_related("transcript_segments")
        booking = self.request.query_params.get("booking")
        technical_status = self.request.query_params.get("technical_status")
        review_outcome = self.request.query_params.get("review_outcome")
        ai_outcome = self.request.query_params.get("ai_outcome")
        if booking:
            queryset = queryset.filter(booking_id=booking)
        if technical_status:
            queryset = queryset.filter(technical_status=technical_status)
        if review_outcome:
            queryset = queryset.filter(review_outcome=review_outcome)
        if ai_outcome:
            queryset = queryset.filter(ai_outcome=ai_outcome)
        return queryset

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        review_serializer = VoiceCallReviewSerializer(data=request.data)
        review_serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            visible_call = self.get_object()
            call = VoiceCall.objects.select_for_update().get(pk=visible_call.pk)
            self._ensure_call_scope(call.booking)
            previous_values = {
                "review_outcome": call.review_outcome,
                "failure_reason": call.failure_reason,
                "reviewed_by_id": call.reviewed_by_id,
                "reviewed_at": call.reviewed_at.isoformat() if call.reviewed_at else None,
            }
            reviewed_at = timezone.now()
            call.review_outcome = review_serializer.validated_data["review_outcome"]
            call.failure_reason = review_serializer.validated_data["failure_reason"]
            call.reviewed_by = request.user
            call.reviewed_at = reviewed_at
            call.save(
                update_fields=[
                    "review_outcome",
                    "failure_reason",
                    "reviewed_by",
                    "reviewed_at",
                    "updated_at",
                ]
            )
            new_values = {
                "review_outcome": call.review_outcome,
                "failure_reason": call.failure_reason,
                "reviewed_by_id": call.reviewed_by_id,
                "reviewed_at": reviewed_at.isoformat(),
            }
            AuditLog.objects.create(
                actor=request.user,
                action="voice_call_reviewed",
                table_name=VoiceCall._meta.db_table,
                record_id=str(call.pk),
                previous_values=previous_values,
                new_values=new_values,
                metadata={"call_sid": call.call_sid},
            )

        return Response(self.get_serializer(call).data)


class WhatsAppConversationViewSet(
    SiteScopedTrialViewSetMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    queryset = (
        WhatsAppConversation.objects.select_related(
            "site",
            "booking",
            "follow_up_assigned_to",
        )
        .prefetch_related("messages")
        .order_by("-last_message_at", "-created_at")
    )
    serializer_class = WhatsAppConversationSerializer
    permission_classes = [CanManageTrialDashboard]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        queryset = super().get_queryset()
        business_address = configured_business_address()
        if business_address and queryset.filter(to_address=business_address).exists():
            queryset = queryset.filter(to_address=business_address)
        else:
            # The standalone WhatsApp service writes to the shared database, while
            # this API may run without provider credentials. In that deployment
            # shape, select the inbox that most recently received activity instead
            # of presenting an empty dashboard.
            business_address = (
                queryset.filter(to_address__startswith="whatsapp:+")
                .order_by("-last_message_at", "-created_at")
                .values_list("to_address", flat=True)
                .first()
            )
        if not business_address:
            return queryset.none()
        queryset = queryset.filter(to_address=business_address)
        site = self.request.query_params.get("site")
        status_value = self.request.query_params.get("status")
        booking = self.request.query_params.get("booking")
        search = self.request.query_params.get("search", "").strip()
        if site:
            queryset = queryset.filter(site_id=site)
        if status_value:
            queryset = queryset.filter(status=status_value)
        if booking:
            queryset = queryset.filter(booking_id=booking)
        if search:
            queryset = queryset.filter(
                models.Q(contact_phone__icontains=search)
                | models.Q(booking__responsible_name__icontains=search)
                | models.Q(booking__child_first_name__icontains=search)
            )
        return queryset

    def perform_update(self, serializer):
        conversation = serializer.instance
        previous_values = {
            "follow_up_required": conversation.follow_up_required,
            "follow_up_assigned_to_id": conversation.follow_up_assigned_to_id,
            "follow_up_notes": conversation.follow_up_notes,
            "follow_up_updated_at": (
                conversation.follow_up_updated_at.isoformat()
                if conversation.follow_up_updated_at
                else None
            ),
        }
        updated_at = timezone.now()
        conversation = serializer.save(follow_up_updated_at=updated_at)
        AuditLog.objects.create(
            actor=self.request.user,
            action="whatsapp_follow_up_updated",
            table_name=WhatsAppConversation._meta.db_table,
            record_id=str(conversation.pk),
            previous_values=previous_values,
            new_values={
                "follow_up_required": conversation.follow_up_required,
                "follow_up_assigned_to_id": conversation.follow_up_assigned_to_id,
                "follow_up_notes": conversation.follow_up_notes,
                "follow_up_updated_at": updated_at.isoformat(),
            },
            metadata={"contact_phone": conversation.contact_phone},
        )

    @action(detail=True, methods=["post"], url_path="send-message")
    def send_message(self, request, pk=None):
        conversation = self.get_object()
        input_serializer = WhatsAppSendMessageSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        body = input_serializer.validated_data["body"]
        now = timezone.now()
        last_inbound = (
            conversation.messages.filter(
                direction=WhatsAppMessageDirection.INBOUND,
            )
            .order_by("-created_at", "-id")
            .first()
        )
        if not last_inbound or last_inbound.created_at + timedelta(hours=24) <= now:
            return Response(
                {
                    "detail": (
                        "La ventana de 24 horas terminó. Para volver a contactar a esta "
                        "persona debes enviar una plantilla aprobada."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )

        try:
            with transaction.atomic():
                locked = WhatsAppConversation.objects.select_for_update().get(
                    pk=conversation.pk,
                )
                context = dict(locked.context or {})
                context.pop("human_response_wait", None)
                context["automation_paused_by_human"] = True
                context["automation_paused_at"] = now.isoformat()
                context["last_reply_source"] = "human"
                context["human_last_reply_at"] = now.isoformat()
                context["human_last_reply_by_user_id"] = request.user.pk

                provider_sid = send_text(
                    to_phone=locked.contact_phone,
                    body=body,
                )
                WhatsAppMessage.objects.get_or_create(
                    provider_sid=provider_sid,
                    defaults={
                        "conversation": locked,
                        "direction": WhatsAppMessageDirection.OUTBOUND,
                        "body": body,
                    },
                )
                locked.context = context
                locked.last_message_at = now
                locked.save(update_fields=["context", "last_message_at", "updated_at"])
                AuditLog.objects.create(
                    actor=request.user,
                    action="whatsapp_manual_message_sent",
                    table_name=WhatsAppConversation._meta.db_table,
                    record_id=str(locked.pk),
                    new_values={
                        "provider_sid": provider_sid,
                        "message_length": len(body),
                        "automation_paused_by_human": True,
                    },
                    metadata={"contact_phone": locked.contact_phone},
                )
        except MetaWhatsAppError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        refreshed = self.get_queryset().get(pk=conversation.pk)
        return Response(
            WhatsAppConversationSerializer(
                refreshed,
                context={"request": request},
            ).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=False, methods=["get"])
    def assignees(self, request):
        queryset = User.objects.filter(
            is_active=True,
            role__in=["admin", "owner", "dev", "site_coordinator"],
        ).select_related("primary_site")
        if request.user.role == "site_coordinator":
            queryset = queryset.filter(
                role="site_coordinator",
                primary_site_id=request.user.primary_site_id,
            )
        queryset = queryset.order_by("first_name", "last_name", "username")
        return Response(
            [
                {
                    "id": user.id,
                    "name": user.get_full_name().strip() or user.username,
                    "role": user.role,
                    "primary_site": user.primary_site_id,
                    "primary_site_name": (
                        user.primary_site.name if user.primary_site else None
                    ),
                }
                for user in queryset
            ]
        )


class TrialAvailabilityRuleViewSet(SiteScopedTrialViewSetMixin, viewsets.ModelViewSet):
    queryset = TrialAvailabilityRule.objects.select_related("site", "court").order_by(
        "site",
        "weekday",
        "starts_at",
    )
    serializer_class = TrialAvailabilityRuleSerializer
    permission_classes = [CanManageTrialDashboard]

    def get_queryset(self):
        queryset = super().get_queryset()
        site = self.request.query_params.get("site")
        weekday = self.request.query_params.get("weekday")
        is_active = self.request.query_params.get("is_active")
        if site:
            queryset = queryset.filter(site_id=site)
        if weekday is not None and weekday != "":
            queryset = queryset.filter(weekday=weekday)
        if is_active in {"true", "1"}:
            queryset = queryset.filter(is_active=True)
        elif is_active in {"false", "0"}:
            queryset = queryset.filter(is_active=False)
        return queryset

    def perform_create(self, serializer):
        site = serializer.validated_data["site"]
        self.ensure_site_scope(site.id)
        serializer.save()

    def perform_update(self, serializer):
        site = serializer.validated_data.get("site", serializer.instance.site)
        self.ensure_site_scope(site.id)
        serializer.save()
