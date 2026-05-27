from django.contrib.auth import authenticate
from rest_framework import permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import UserSerializer


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

        token, _ = Token.objects.get_or_create(user=user)
        return Response({"token": token.key, "user": UserSerializer(user).data})


class LogoutView(APIView):
    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user).data)

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

        return Response(UserSerializer(user).data)
