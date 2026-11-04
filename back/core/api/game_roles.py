from datetime import date, timedelta

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.api.enrollments import EnrollmentStaffPermission, enrollment_sites
from core.models import GameRoleTeamNote, Team, Tournament


class RoundInput(serializers.Serializer):
    number = serializers.IntegerField(min_value=1, max_value=999)
    starts_on = serializers.DateField()

    def validate_starts_on(self, value):
        if value > date.max - timedelta(days=6):
            raise ValidationError("La jornada debe abarcar siete días completos.")
        return value


class ScheduleInput(serializers.Serializer):
    scheduled_on = serializers.DateField()
    starts_at = serializers.TimeField(input_formats=["%H:%M"])
    ends_at = serializers.TimeField(input_formats=["%H:%M"])

class CrossInput(serializers.Serializer):
    round_id = serializers.IntegerField(min_value=1, allow_null=True)
    home_team_id = serializers.IntegerField(min_value=1)
    away_team_id = serializers.IntegerField(min_value=1)
    schedule = ScheduleInput(required=False, allow_null=True)
    played = serializers.BooleanField(required=False)

    def validate(self, data):
        schedule = data.get("schedule")
        if schedule and schedule["ends_at"] <= schedule["starts_at"]:
            raise ValidationError("La hora de fin debe ser posterior a la hora de inicio.")
        return data


def tournament_crosses(tournament):
    return tournament.game_role_crosses.filter(home_team__tournament=tournament, away_team__tournament=tournament)


def team_notes(tournament):
    return list(tournament.game_role_team_notes.filter(team__tournament=tournament)
                .order_by("team__name", "weekday", "pk")
                .values("id", "kind", "team_id", "round_id", "weekday", "starts_at", "ends_at", "note"))


class TeamNoteInput(serializers.Serializer):
    kind = serializers.ChoiceField(choices=GameRoleTeamNote.Kind.choices)
    team_id = serializers.IntegerField(min_value=1)
    round_id = serializers.IntegerField(min_value=1, default=None, allow_null=True)
    weekday = serializers.IntegerField(min_value=0, max_value=6, default=None, allow_null=True)
    starts_at = serializers.TimeField(input_formats=["%H:%M"], default=None, allow_null=True)
    ends_at = serializers.TimeField(input_formats=["%H:%M"], default=None, allow_null=True)
    note = serializers.CharField(max_length=300, default="", allow_blank=True)

    def validate(self, data):
        start, end = data["starts_at"], data["ends_at"]
        if (start is None) != (end is None) or (start is not None and end <= start):
            raise ValidationError("Indica un rango completo con hora de fin posterior a la de inicio.")
        if data["kind"] == GameRoleTeamNote.Kind.PERMIT:
            if data["round_id"] is None or data["weekday"] is not None or start is not None:
                raise ValidationError("Selecciona la jornada a la que corresponde el permiso.")
        elif data["weekday"] is None or data["round_id"] is not None:
            raise ValidationError("Selecciona un día de la semana para la sugerencia de horario.")
        return data


class GameRoleView(APIView):
    permission_classes = [EnrollmentStaffPermission]

    def tournament(self, request, tournament_id, lock=False):
        rows = Tournament.objects.filter(site__in=enrollment_sites(request.user))
        return get_object_or_404(rows.select_for_update() if lock else rows, pk=tournament_id)


class GameRoleTeamNotesView(GameRoleView):
    @transaction.atomic
    def post(self, request, tournament_id):
        tournament = self.tournament(request, tournament_id, lock=True)
        serializer = TeamNoteInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        get_object_or_404(tournament.teams.select_for_update(), pk=data["team_id"])
        if data["round_id"] is not None:
            get_object_or_404(tournament.game_role_rounds, pk=data["round_id"])
        tournament.game_role_team_notes.get_or_create(**data)
        return Response({"team_notes": team_notes(tournament)})


class GameRoleMatrixView(GameRoleView):
    def matrix(self, tournament):
        teams = list(tournament.teams.order_by("name", "pk").values("id", "name", "is_active"))
        rounds = list(tournament.game_role_rounds.order_by("number").values("id", "number", "starts_on"))
        crosses = list(tournament_crosses(tournament).order_by("pk")
                       .values("home_team_id", "away_team_id", "round_id", "scheduled_on", "starts_at", "ends_at", "played"))
        return Response({
            "teams": teams, "rounds": rounds, "crosses": crosses,
            "starts_on": tournament.starts_on, "schedule_enabled": True, "team_notes": team_notes(tournament),
        })

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
        start = data["starts_on"]
        if tournament_crosses(tournament).filter(round=row).filter(
            Q(scheduled_on__lt=start) | Q(scheduled_on__gt=start + timedelta(days=6))
        ).exists():
            raise ValidationError("Cambia primero los horarios de los partidos que quedarían fuera de la semana.")
        row.number, row.starts_on = data["number"], data["starts_on"]
        row.save(update_fields=["number", "starts_on", "updated_at"])
        return self.matrix(tournament)

    @transaction.atomic
    def put(self, request, tournament_id):
        tournament = self.tournament(request, tournament_id, lock=True)
        serializer = CrossInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data.copy()
        round_id = data.pop("round_id")
        schedule = data.pop("schedule", serializers.empty)
        played = data.pop("played", serializers.empty)
        team_ids = {data["home_team_id"], data["away_team_id"]}
        if len(team_ids) != 2:
            raise ValidationError("Selecciona dos equipos distintos.")
        teams = Team.objects.select_for_update().filter(tournament=tournament, pk__in=team_ids).order_by("pk")
        if set(teams.values_list("pk", flat=True)) != team_ids:
            raise ValidationError("Ambos equipos deben pertenecer a este torneo.")
        if round_id is None:
            if schedule not in (None, serializers.empty) or played is True:
                raise ValidationError("Selecciona una jornada para guardar el horario o marcar el partido como jugado.")
            tournament.game_role_crosses.filter(**data).delete()
        else:
            round_row = get_object_or_404(tournament.game_role_rounds, pk=round_id)
            rows = tournament.game_role_crosses
            defaults = {"round_id": round_row.pk}
            fields = ("scheduled_on", "starts_at", "ends_at")
            if schedule is serializers.empty:
                schedule = rows.filter(**data).values(*fields).first()
            defaults.update(schedule or dict.fromkeys(fields))
            if played is not serializers.empty:
                defaults["played"] = played
            scheduled_on = defaults["scheduled_on"]
            if scheduled_on is not None:
                if not round_row.starts_on <= scheduled_on <= round_row.starts_on + timedelta(days=6):
                    raise ValidationError("La fecha del partido debe estar dentro de la semana de la jornada.")
                if tournament_crosses(tournament).exclude(**data).filter(
                    scheduled_on=scheduled_on, starts_at__lt=defaults["ends_at"], ends_at__gt=defaults["starts_at"],
                ).exists():
                    raise ValidationError("Ese horario ya está ocupado en este torneo. Selecciona otro rango.")
            rows.update_or_create(**data, defaults=defaults)
        return self.matrix(tournament)
