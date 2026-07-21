from __future__ import annotations

from django.contrib.auth.hashers import check_password
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from core.models import FaceStationDevice


STATION_HEADER = "X-Futsi-Station-Key"
STATION_TOKEN_PREFIX = "futsi_station"


def build_station_token(public_id, secret: str) -> str:
    return f"{STATION_TOKEN_PREFIX}:{public_id}:{secret}"


class FaceStationAuthentication(BaseAuthentication):
    """Authenticate an unattended field station without storing a user password."""

    def authenticate(self, request):
        raw_token = request.headers.get(STATION_HEADER, "").strip()
        if not raw_token:
            return None

        prefix, separator, remainder = raw_token.partition(":")
        public_id, second_separator, secret = remainder.partition(":")
        if prefix != STATION_TOKEN_PREFIX or not separator or not second_separator or not public_id or not secret:
            raise AuthenticationFailed("Token de estacion invalido.")

        try:
            device = FaceStationDevice.objects.select_related("site", "service_user").get(
                public_id=public_id,
                is_active=True,
            )
        except (FaceStationDevice.DoesNotExist, ValueError) as exc:
            raise AuthenticationFailed("Estacion no registrada o desactivada.") from exc

        if not check_password(secret, device.secret_hash):
            raise AuthenticationFailed("Token de estacion invalido.")
        if not device.service_user.is_active:
            raise AuthenticationFailed("Usuario de servicio inactivo.")

        now = timezone.now()
        if not device.last_seen_at or (now - device.last_seen_at).total_seconds() >= 30:
            FaceStationDevice.objects.filter(pk=device.pk).update(last_seen_at=now)
            device.last_seen_at = now
        return device.service_user, device
