from .common import *
from rest_framework import serializers

class DailyClosureViewSet(viewsets.ModelViewSet):
    queryset = DailyClosure.objects.all()
    serializer_class = DailyClosureSerializer
    permission_classes = [IsOperationsOrCashierRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        user = self.request.user
        if user.role in {"cashier", "site_coordinator"} and user.primary_site_id:
            queryset = queryset.filter(site_id=user.primary_site_id)
        site = self.request.query_params.get("site")
        if site and user.role in {"admin", "dev", "owner", "accounting"}:
            queryset = queryset.filter(site_id=site)
        return queryset

    def perform_create(self, serializer):
        site = serializer.validated_data.get("site")
        user = self.request.user
        if user.role in {"cashier", "site_coordinator"} and site and site.id != user.primary_site_id:
            raise serializers.ValidationError("Solo puedes cerrar tu sede asignada.")
        serializer.save(closed_by=user)


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdminRole]
