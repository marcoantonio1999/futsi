from .common import *

class DailyClosureViewSet(viewsets.ModelViewSet):
    queryset = DailyClosure.objects.select_related("site", "closed_by").all()
    serializer_class = DailyClosureSerializer


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related("actor").all()
