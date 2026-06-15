from .common import *
from django.db.models import Prefetch

class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.select_related("primary_site").all()
    serializer_class = UserSerializer
    permission_classes = [IsAdminRole]


class SiteViewSet(viewsets.ModelViewSet):
    queryset = Site.objects.annotate(student_count=Count("students")).all()
    serializer_class = SiteSerializer
    permission_classes = [IsAdminForWrites]

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role in {"cashier", "coach"} and self.request.user.primary_site_id:
            return queryset.filter(id=self.request.user.primary_site_id)
        if self.request.user.role == "guardian":
            return queryset.filter(students__guardian__user=self.request.user).distinct()
        return queryset.distinct()


class CourtViewSet(viewsets.ModelViewSet):
    queryset = Court.objects.select_related("site").all()
    serializer_class = CourtSerializer
    permission_classes = [IsAdminForWrites]


class GuardianViewSet(viewsets.ModelViewSet):
    queryset = Guardian.objects.all()
    serializer_class = GuardianSerializer
    permission_classes = [IsOperationsRole]


class StudentViewSet(viewsets.ModelViewSet):
    queryset = (
        Student.objects.select_related("site", "guardian")
        .prefetch_related(
            Prefetch(
                "charges",
                queryset=Charge.objects.filter(status__in=["pending", "partial"]).prefetch_related(
                    Prefetch("payments", queryset=Payment.objects.filter(status__in=["registered", "reconciled"]), to_attr="confirmed_payments"),
                    Prefetch("discounts", queryset=Discount.objects.filter(status="approved"), to_attr="approved_discounts"),
                ),
                to_attr="open_charges",
            ),
            Prefetch("discounts", queryset=Discount.objects.filter(status="approved").order_by("-approved_at", "-created_at"), to_attr="approved_student_discounts"),
        )
        .all()
    )
    serializer_class = StudentSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]

    def get_permissions(self):
        if self.request.user.is_authenticated and self.request.user.role in {"guardian", "cashier", "coach"} and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "guardian":
            return queryset.filter(guardian__user=self.request.user)
        if self.request.user.role == "cashier":
            return queryset.filter(site=self.request.user.primary_site)
        if self.request.user.role == "coach":
            queryset = queryset.filter(site=self.request.user.primary_site)
            if self.request.user.coach_group_name:
                queryset = queryset.filter(group_name=self.request.user.coach_group_name)
            return queryset
        return queryset.distinct()


class TournamentViewSet(viewsets.ModelViewSet):
    queryset = Tournament.objects.select_related("site").all()
    serializer_class = TournamentSerializer


class TeamViewSet(viewsets.ModelViewSet):
    queryset = Team.objects.select_related("tournament", "tournament__site").annotate(player_count=Count("players")).all()
    serializer_class = TeamSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(representative_user=self.request.user)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(players__user=self.request.user)
        if self.request.user.role == "cashier" and self.request.user.primary_site_id:
            queryset = queryset.filter(tournament__site=self.request.user.primary_site)
        return queryset.distinct()


class StudentTournamentRegistrationViewSet(viewsets.ModelViewSet):
    queryset = StudentTournamentRegistration.objects.select_related("tournament", "tournament__site", "student", "team", "registered_by").all()
    serializer_class = StudentTournamentRegistrationSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]

    def get_permissions(self):
        if self.request.user.is_authenticated and self.request.user.role in {"guardian", "coach", "cashier"} and self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsRole()]
        return super().get_permissions()

    def get_queryset(self):
        queryset = super().get_queryset()
        tournament = self.request.query_params.get("tournament")
        student = self.request.query_params.get("student")
        site = self.request.query_params.get("site")
        if tournament:
            queryset = queryset.filter(tournament_id=tournament)
        if student:
            queryset = queryset.filter(student_id=student)
        if site:
            queryset = queryset.filter(tournament__site_id=site)
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        if self.request.user.role in {"coach", "cashier"} and self.request.user.primary_site_id:
            queryset = queryset.filter(tournament__site=self.request.user.primary_site)
        return queryset.distinct()


class PlayerViewSet(viewsets.ModelViewSet):
    queryset = Player.objects.select_related("team", "team__tournament", "team__tournament__site", "user").all()
    serializer_class = PlayerSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        team = self.request.query_params.get("team")
        site = self.request.query_params.get("site")
        if team:
            queryset = queryset.filter(team_id=team)
        if site:
            queryset = queryset.filter(team__tournament__site_id=site)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(user=self.request.user)
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(team__representative_user=self.request.user)
        if self.request.user.role == "cashier" and self.request.user.primary_site_id:
            queryset = queryset.filter(team__tournament__site_id=self.request.user.primary_site_id)
        return queryset


class PlayerAttendanceRecordViewSet(viewsets.ModelViewSet):
    queryset = PlayerAttendanceRecord.objects.select_related("session", "player", "player__team", "captured_by").all()
    serializer_class = PlayerAttendanceRecordSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        session = self.request.query_params.get("session")
        team = self.request.query_params.get("team")
        if session:
            queryset = queryset.filter(session_id=session)
        if team:
            queryset = queryset.filter(player__team_id=team)
        if self.request.user.role == "adult_player":
            queryset = queryset.filter(player__user=self.request.user)
        if self.request.user.role == "adult_representative":
            queryset = queryset.filter(player__team__representative_user=self.request.user)
        if self.request.user.role == "cashier" and self.request.user.primary_site_id:
            queryset = queryset.filter(player__team__tournament__site_id=self.request.user.primary_site_id)
        return queryset

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCashierCoachOrGuardianRole()]
        return [IsOperationsCashierOrCoachRole()]


class RoundViewSet(viewsets.ModelViewSet):
    queryset = Round.objects.select_related("tournament").all()
    serializer_class = RoundSerializer

