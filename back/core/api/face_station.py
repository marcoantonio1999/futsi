from __future__ import annotations

from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.face_station_auth import FaceStationAuthentication
from core.models import FaceStationUnknownLink

from .face_station_service import (
    bootstrap_payload,
    person_for_device,
    person_photo_response,
    sync_detection_event,
)
from .face_station_unknowns import register_linked_unknown


class FaceStationAPIView(APIView):
    authentication_classes = [FaceStationAuthentication]
    permission_classes = [IsAuthenticated]

    @property
    def device(self):
        return self.request.auth


class FaceStationBootstrapView(FaceStationAPIView):
    def get(self, request):
        return Response(bootstrap_payload(request, self.device))


class FaceStationHeartbeatView(FaceStationAPIView):
    def post(self, request):
        now = timezone.now()
        self.device.last_seen_at = now
        self.device.save(update_fields=["last_seen_at", "updated_at"])
        return Response(
            {
                "online": True,
                "server_time": now.isoformat(),
                "device_id": str(self.device.public_id),
                "site_id": self.device.site_id,
            }
        )


class FaceStationPersonPhotoView(FaceStationAPIView):
    def get(self, request, person_type: str, person_id: int):
        try:
            return person_photo_response(self.device, person_type, person_id)
        except LookupError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except Exception as exc:
            return Response({"detail": f"No se pudo preparar la foto: {exc}"}, status=status.HTTP_400_BAD_REQUEST)


class FaceStationEventBatchView(FaceStationAPIView):
    def post(self, request):
        events = request.data.get("events", [])
        if not isinstance(events, list) or not events:
            return Response({"detail": "events debe ser una lista con al menos un evento."}, status=status.HTTP_400_BAD_REQUEST)
        if len(events) > 100:
            return Response({"detail": "Cada lote admite hasta 100 eventos."}, status=status.HTTP_400_BAD_REQUEST)

        results = []
        for raw_event in events:
            try:
                results.append(sync_detection_event(self.device, raw_event))
            except Exception as exc:
                results.append(
                    {
                        "event_id": str(raw_event.get("event_id", "")),
                        "status": "rejected",
                        "detail": str(exc),
                    }
                )
        accepted = sum(result.get("status") in {"synced", "no_session"} for result in results)
        return Response({"accepted": accepted, "rejected": len(results) - accepted, "results": results})


class FaceStationUnknownRegisterView(FaceStationAPIView):
    @transaction.atomic
    def post(self, request):
        local_subject_id = str(request.data.get("local_subject_id", "")).strip()[:80]
        person_type = str(request.data.get("person_type", "")).strip()
        try:
            person_id = int(request.data.get("person_id"))
        except (TypeError, ValueError):
            person_id = 0
        events = request.data.get("events", [])
        if not local_subject_id:
            return Response({"detail": "local_subject_id es obligatorio."}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(events, list) or not events:
            return Response({"detail": "Incluye al menos una aparicion consolidada."}, status=status.HTTP_400_BAD_REQUEST)
        if len(events) > 100:
            return Response({"detail": "Se admiten hasta 100 apariciones por registro."}, status=status.HTTP_400_BAD_REQUEST)

        person = person_for_device(self.device, person_type, person_id)
        if not person:
            return Response({"detail": "La persona no pertenece al padron de esta sede."}, status=status.HTTP_400_BAD_REQUEST)

        existing = FaceStationUnknownLink.objects.filter(
            device=self.device,
            local_subject_id=local_subject_id,
        ).first()
        sync_results = []
        for raw_event in events:
            event = {
                **raw_event,
                "person_type": person_type,
                "person_id": person_id,
                "source_subject_id": local_subject_id,
            }
            try:
                sync_results.append(sync_detection_event(self.device, event))
            except Exception as exc:
                sync_results.append({"event_id": str(raw_event.get("event_id", "")), "status": "rejected", "detail": str(exc)})

        if existing:
            return Response(
                {
                    "linked": True,
                    "duplicate": True,
                    "remote_subject_id": str(existing.remote_subject_id) if existing.remote_subject_id else None,
                    "events": sync_results,
                }
            )

        registration = register_linked_unknown(self.device, request.data, person, events)
        link = FaceStationUnknownLink.objects.create(
            device=self.device,
            local_subject_id=local_subject_id,
            person_type=person_type,
            student=person if person_type == "student" else None,
            player=person if person_type == "player" else None,
            remote_subject_id=registration.get("subject_id") or None,
            evidence_uri=registration.get("face_uri", ""),
            metadata={"storage_warning": registration.get("storage_warning", "")},
        )
        return Response(
            {
                "linked": True,
                "duplicate": False,
                "link_id": link.id,
                "remote_subject_id": registration.get("subject_id"),
                "temporary_name": registration.get("temporary_name"),
                "storage_warning": registration.get("storage_warning", ""),
                "events": sync_results,
            },
            status=status.HTTP_201_CREATED,
        )
