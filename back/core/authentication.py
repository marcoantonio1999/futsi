from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed


class ExpiringTokenAuthentication(TokenAuthentication):
    """DRF token authentication with server-side token expiration."""

    def authenticate_credentials(self, key):
        user, token = super().authenticate_credentials(key)
        max_age_minutes = int(getattr(settings, "API_TOKEN_TTL_MINUTES", 720))
        expires_at = token.created + timedelta(minutes=max_age_minutes)

        if timezone.now() >= expires_at:
            token.delete()
            raise AuthenticationFailed("La sesion expiro. Inicia sesion nuevamente.")

        return user, token
