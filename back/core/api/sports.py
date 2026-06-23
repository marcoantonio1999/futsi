from .common import *

class MatchViewSet(viewsets.ModelViewSet):
    queryset = Match.objects.select_related("tournament", "round", "site", "home_team", "away_team", "updated_by").all()
    serializer_class = MatchSerializer
    permission_classes = [IsOperationsCashierCoachOrGuardianRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        tournament = self.request.query_params.get("tournament")
        site = self.request.query_params.get("site")
        if tournament:
            queryset = queryset.filter(tournament_id=tournament)
        if site:
            queryset = queryset.filter(site_id=site)
        if self.request.user.role in {"cashier", "coach"} and self.request.user.primary_site_id:
            queryset = queryset.filter(site=self.request.user.primary_site)
        if self.request.user.role == "guardian":
            student_sites = Site.objects.filter(students__guardian__user=self.request.user)
            queryset = queryset.filter(site__in=student_sites)
        return queryset.order_by("-played_on", "-starts_at", "-updated_at")

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCashierCoachOrGuardianRole()]
        return [IsAdminOrSiteCoordinatorRole()]

    @action(detail=False, methods=["get"], url_path="standings")
    def standings(self, request):
        queryset = self.filter_queryset(self.get_queryset()).filter(status__in=["live", "finished"])
        tournament_id = request.query_params.get("tournament")
        if tournament_id:
            teams = Team.objects.filter(tournament_id=tournament_id)
            if request.user.role in {"cashier", "coach"} and request.user.primary_site_id:
                teams = teams.filter(tournament__site_id=request.user.primary_site_id)
        else:
            teams = Team.objects.filter(tournament__matches__in=queryset).distinct()

        table = {
            team.id: {
                "team": team.id,
                "team_name": team.name,
                "tournament": team.tournament_id,
                "played": 0,
                "won": 0,
                "drawn": 0,
                "lost": 0,
                "goals_for": 0,
                "goals_against": 0,
                "goal_difference": 0,
                "points": 0,
                "is_leader": False,
            }
            for team in teams
        }

        for match in queryset:
            if match.home_team_id not in table or match.away_team_id not in table:
                continue
            home = table[match.home_team_id]
            away = table[match.away_team_id]
            home["played"] += 1
            away["played"] += 1
            home["goals_for"] += match.home_goals
            home["goals_against"] += match.away_goals
            away["goals_for"] += match.away_goals
            away["goals_against"] += match.home_goals
            if match.home_goals > match.away_goals:
                home["won"] += 1
                away["lost"] += 1
                home["points"] += 3
            elif match.home_goals < match.away_goals:
                away["won"] += 1
                home["lost"] += 1
                away["points"] += 3
            else:
                home["drawn"] += 1
                away["drawn"] += 1
                home["points"] += 1
                away["points"] += 1

        rows = []
        for row in table.values():
            row["goal_difference"] = row["goals_for"] - row["goals_against"]
            rows.append(row)
        rows.sort(key=lambda item: (item["points"], item["goal_difference"], item["goals_for"], item["team_name"]), reverse=True)
        for index, row in enumerate(rows, start=1):
            row["position"] = index
            row["is_leader"] = index == 1 and row["played"] > 0
        return Response(rows)


class StudentAssessmentViewSet(viewsets.ModelViewSet):
    queryset = StudentAssessment.objects.select_related("student", "coach", "site").all()
    serializer_class = StudentAssessmentSerializer
    permission_classes = [IsOperationsCoachOrGuardianRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        student = self.request.query_params.get("student")
        site = self.request.query_params.get("site")
        if student:
            queryset = queryset.filter(student_id=student)
        if site:
            queryset = queryset.filter(site_id=site)
        if self.request.user.role == "coach":
            queryset = queryset.filter(site=self.request.user.primary_site)
            if self.request.user.coach_group_name:
                queryset = queryset.filter(student__group_name=self.request.user.coach_group_name)
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        return queryset.order_by("-assessment_month", "student__full_name")

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCoachOrGuardianRole()]
        return [IsOperationsOrCoachRole()]


class StudentValueAssessmentViewSet(viewsets.ModelViewSet):
    queryset = StudentValueAssessment.objects.select_related("student", "coach", "site").all()
    serializer_class = StudentValueAssessmentSerializer
    permission_classes = [IsOperationsCoachOrGuardianRole]

    def get_queryset(self):
        queryset = super().get_queryset()
        student = self.request.query_params.get("student")
        site = self.request.query_params.get("site")
        if student:
            queryset = queryset.filter(student_id=student)
        if site:
            queryset = queryset.filter(site_id=site)
        if self.request.user.role == "coach":
            queryset = queryset.filter(site=self.request.user.primary_site)
            if self.request.user.coach_group_name:
                queryset = queryset.filter(student__group_name=self.request.user.coach_group_name)
        if self.request.user.role == "guardian":
            queryset = queryset.filter(student__guardian__user=self.request.user)
        return queryset.order_by("-assessment_month", "-updated_at", "student__full_name")

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [IsOperationsCoachOrGuardianRole()]
        return [IsOperationsOrCoachRole()]

