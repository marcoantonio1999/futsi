from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.exceptions import PermissionDenied
from core.veronica_access import (
    court_communications_route_allowed,
    is_court_communications_only,
    is_veronica_only,
    veronica_route_allowed,
)


class ExpiringTokenAuthentication(TokenAuthentication):
    """DRF token authentication with server-side token expiration."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result and is_veronica_only(result[0]) and not veronica_route_allowed(request.path_info, request.method):
            raise PermissionDenied("Esta cuenta solo tiene acceso a Comunicaciones de Verónica.")
        if result and is_court_communications_only(result[0]) and not court_communications_route_allowed(request.path_info, request.method):
            raise PermissionDenied("Esta cuenta solo tiene acceso a WhatsApp de Canchas para su sede.")
        return result

    def authenticate_credentials(self, key):
        cache_key = f"auth:token:{key}"
        cached = cache.get(cache_key)
        now = timezone.now()
        if cached:
            user, token, expires_at = cached
            if now < expires_at:
                return user, token
            cache.delete(cache_key)

        user, token = super().authenticate_credentials(key)
        max_age_minutes = int(getattr(settings, "API_TOKEN_TTL_MINUTES", 720))
        expires_at = token.created + timedelta(minutes=max_age_minutes)

        if now >= expires_at:
            cache.delete(cache_key)
            token.delete()
            raise AuthenticationFailed("La sesion expiro. Inicia sesion nuevamente.")

        cache_seconds = max(0, int(getattr(settings, "API_TOKEN_AUTH_CACHE_SECONDS", 60)))
        ttl_seconds = max(0, int((expires_at - now).total_seconds()))
        if cache_seconds and ttl_seconds:
            cache.set(cache_key, (user, token, expires_at), min(cache_seconds, ttl_seconds))

        return user, token
