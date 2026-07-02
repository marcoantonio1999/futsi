from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from rest_framework import permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import User

from .serializers import UserSerializer


def user_for_response(user):
    if user.role == "cashier" and user.primary_site_id:
        return User.objects.select_related("primary_site", "guardian_profile").get(pk=user.pk)
    return user


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []

    def post(self, request):
        username = request.data.get("username", "").strip()
        password = request.data.get("password", "")
        user = authenticate(request, username=username, password=password)

        if not user:
            return Response({"detail": "Usuario o password incorrecto."}, status=status.HTTP_400_BAD_REQUEST)
        if not user.is_active:
            return Response({"detail": "Usuario inactivo."}, status=status.HTTP_403_FORBIDDEN)

        Token.objects.filter(user=user).delete()
        token = Token.objects.create(user=user)
        update_last_login(None, user)
        ttl_minutes = int(getattr(settings, "API_TOKEN_TTL_MINUTES", 720))
        expires_at = token.created + timedelta(minutes=ttl_minutes)
        return Response(
            {
                "token": token.key,
                "expires_at": expires_at.isoformat(),
                "token_ttl_seconds": ttl_minutes * 60,
                "user": UserSerializer(user).data,
            }
        )


class LogoutView(APIView):
    def post(self, request):
        if request.auth:
            Token.objects.filter(key=request.auth.key).delete()
        else:
            Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(user_for_response(request.user)).data)

    def patch(self, request):
        user = request.user
        if "guardian_email" in request.data and "email" not in request.data:
            request.data["email"] = request.data.get("guardian_email", "")
        if "guardian_phone" in request.data and "phone" not in request.data:
            request.data["phone"] = request.data.get("guardian_phone", "")
        for field in ["first_name", "last_name", "email", "phone", "avatar_url"]:
            if field in request.data:
                setattr(user, field, request.data.get(field, ""))
        user.save(update_fields=["first_name", "last_name", "email", "phone", "avatar_url"])

        guardian = getattr(user, "guardian_profile", None)
        if guardian:
            guardian_updates = {}
            for source, target in [
                ("guardian_full_name", "full_name"),
                ("guardian_phone", "phone"),
                ("guardian_email", "email"),
                ("tax_name", "tax_name"),
                ("tax_id", "tax_id"),
                ("notes", "notes"),
            ]:
                if source in request.data:
                    guardian_updates[target] = request.data.get(source, "")
            for field, value in guardian_updates.items():
                setattr(guardian, field, value)
            if guardian_updates:
                guardian.save(update_fields=[*guardian_updates.keys(), "updated_at"])

        return Response(UserSerializer(user_for_response(user)).data)
