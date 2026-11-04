from datetime import date, timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.api.enrollments import EnrollmentStaffPermission, enrollment_sites
from core.models import GameRoleCross, GameRoleRound, Team, Tournament


class RoundInput(serializers.Serializer):
    number = serializers.IntegerField(min_value=1, max_value=999)
    starts_on = serializers.DateField()

    def validate_starts_on(self, value):
        if value > date.max - timedelta(days=6):
            raise ValidationError("La jornada debe abarcar siete días completos.")
        return value


class CrossInput(serializers.Serializer):
    round_id = serializers.IntegerField(min_value=1, allow_null=True)
    home_team_id = serializers.IntegerField(min_value=1)
    away_team_id = serializers.IntegerField(min_value=1)


class GameRoleMatrixView(APIView):
    permission_classes = [EnrollmentStaffPermission]

    def tournament(self, request, tournament_id, lock=False):
        rows = Tournament.objects.filter(site__in=enrollment_sites(request.user))
        return get_object_or_404(rows.select_for_update() if lock else rows, pk=tournament_id)

    def matrix(self, tournament):
        teams = list(tournament.teams.order_by("name", "pk").values("id", "name", "is_active"))
        team_ids = [team["id"] for team in teams]
        rounds = list(tournament.game_role_rounds.order_by("number").values("id", "number", "starts_on"))
        crosses = list(tournament.game_role_crosses.filter(home_team_id__in=team_ids, away_team_id__in=team_ids)
                       .order_by("pk").values("home_team_id", "away_team_id", "round_id"))
        return Response({"teams": teams, "rounds": rounds, "crosses": crosses, "starts_on": tournament.starts_on})

    def get(self, request, tournament_id):
        return self.matrix(self.tournament(request, tournament_id))

    @transaction.atomic
    def post(self, request, tournament_id):
        tournament = self.tournament(request, tournament_id, lock=True)
        serializer = RoundInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        row, created = tournament.game_role_rounds.get_or_create(number=data["number"], defaults=data)
        if not created and row.starts_on != data["starts_on"]:
            raise ValidationError("Ya existe una jornada con ese número en este torneo.")
        return self.matrix(tournament)

    @transaction.atomic
    def patch(self, request, tournament_id):
        tournament = self.tournament(request, tournament_id, lock=True)
        lookup = serializers.IntegerField(min_value=1)
        round_id = lookup.run_validation(request.data.get("round_id"))
        row = get_object_or_404(tournament.game_role_rounds, pk=round_id)
        serializer = RoundInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if tournament.game_role_rounds.exclude(pk=row.pk).filter(number=data["number"]).exists():
            raise ValidationError("Ya existe una jornada con ese número en este torneo.")
        row.number, row.starts_on = data["number"], data["starts_on"]
        row.save(update_fields=["number", "starts_on", "updated_at"])
        return self.matrix(tournament)

    @transaction.atomic
    def put(self, request, tournament_id):
        tournament = self.tournament(request, tournament_id, lock=True)
        serializer = CrossInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        round_id = data.pop("round_id")
        team_ids = {data["home_team_id"], data["away_team_id"]}
        if len(team_ids) != 2:
            raise ValidationError("Selecciona dos equipos distintos.")
        teams = Team.objects.select_for_update().filter(tournament=tournament, pk__in=team_ids).order_by("pk")
        if set(teams.values_list("pk", flat=True)) != team_ids:
            raise ValidationError("Ambos equipos deben pertenecer a este torneo.")
        if round_id is None:
            tournament.game_role_crosses.filter(**data).delete()
        else:
            get_object_or_404(tournament.game_role_rounds, pk=round_id)
            tournament.game_role_crosses.update_or_create(**data, defaults={"round_id": round_id})
        return self.matrix(tournament)
