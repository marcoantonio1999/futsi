from .common import *

class AttendanceSessionViewSet(viewsets.ModelViewSet):
    queryset = AttendanceSession.objects.select_related(
        "site",
        "court",
        "tournament",
        "round",
        "team",
        "captured_by",
    ).annotate(record_count=Count("records")).all()
    serializer_class = AttendanceSessionSerializer
    permission_classes = [IsOperationsCashierOrCoachRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        site = self.request.query_params.get("site")
        date = self.request.query_params.get("date")
        if site:
            queryset = queryset.filter(site_id=site)
        if date:
            queryset = queryset.filter(date=date)
        if self.request.user.role == "coach":
            queryset = queryset.filter(site=self.request.user.primary_site)
            if self.request.user.coach_group_name:
                queryset = queryset.filter(group_name=self.request.user.coach_group_name)
        if self.request.user.role == "cashier":
            queryset = queryset.filter(site=self.request.user.primary_site)
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(team__representative_user=self.request.user)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(team__players__user=self.request.user)
        return queryset

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCashierCoachOrGuardianRole()]
        return [IsOperationsCashierOrCoachRole()]

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        session = self.get_object()
        if session.closed_at:
            return Response(self.get_serializer(session).data)
        session.closed_at = timezone.now()
        session.save(update_fields=["closed_at", "updated_at"])
        return Response(self.get_serializer(session).data)


class AttendanceRecordViewSet(viewsets.ModelViewSet):
    queryset = AttendanceRecord.objects.select_related("session", "student", "team", "captured_by").all()
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsOperationsCoachOrGuardianRole]

    def get_permissions(self):
        if self.request.user.is_authenticated and self.request.user.role == "guardian" and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        if self.request.user.role == "coach":
            queryset = queryset.filter(student__site=self.request.user.primary_site)
            if self.request.user.coach_group_name:
                queryset = queryset.filter(student__group_name=self.request.user.coach_group_name)
        session = self.request.query_params.get("session")
        if session:
            queryset = queryset.filter(session_id=session)
        return queryset


class CoachWorkLogViewSet(viewsets.ModelViewSet):
    queryset = CoachWorkLog.objects.select_related("coach", "site", "created_by").all()
    serializer_class = CoachWorkLogSerializer
    permission_classes = [IsOperationsOrCoachRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "coach":
            queryset = queryset.filter(coach=self.request.user)
        site = self.request.query_params.get("site")
        if site:
            queryset = queryset.filter(site_id=site)
        return queryset.order_by("-work_date", "-created_at")

