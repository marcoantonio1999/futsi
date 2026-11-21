from datetime import date, timedelta

from django.core import signing
from django.db import IntegrityError, transaction
from django.http import Http404
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.api.enrollments import EnrollmentStaffPermission, enrollment_sites
from core.domain_serializers.sports import TeamSerializer
from core.models import GameRoleRound, GameRoleTeamNote, Team, Tournament
from core.services.standings import build_standings


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


class ScoreInput(serializers.Serializer):
    home_goals = serializers.IntegerField(min_value=0, max_value=999)
    away_goals = serializers.IntegerField(min_value=0, max_value=999)


class CrossInput(serializers.Serializer):
    round_id = serializers.IntegerField(min_value=1, allow_null=True)
    home_team_id = serializers.IntegerField(min_value=1)
    away_team_id = serializers.IntegerField(min_value=1)
    schedule = ScheduleInput(required=False, allow_null=True)
    played = serializers.BooleanField(required=False)
    score = ScoreInput(required=False, allow_null=True)

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


class GameRolePermission(EnrollmentStaffPermission):
    def has_permission(self, request, view):
        return super().has_permission(request, view) and (
            request.user.role in {"admin", "owner", "dev"}
            or "game_roles_manage" in (request.user.section_permissions or [])
        )


class GameRoleView(APIView):
    permission_classes = [GameRolePermission]

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


ROLE_LINK_SALT = "futsi.public-game-role.v1"
ROLE_LINK_SIGNER = signing.Signer(salt=ROLE_LINK_SALT, sep=".")


def round_schedule(round_row):
    tournament = round_row.tournament
    crosses = tournament_crosses(tournament)
    match_fields = (
        "scheduled_on", "starts_at", "ends_at", "home_team__name", "away_team__name",
        "played", "home_goals", "away_goals",
    )
    matches = crosses.filter(round=round_row, scheduled_on__isnull=False).order_by("scheduled_on", "starts_at", "pk")
    played = crosses.filter(played=True, round__number__lte=round_row.number)
    results_round = played.order_by("-round__number").values_list("round__number", flat=True).first()
    results = played.filter(round__number=results_round).order_by("scheduled_on", "starts_at", "pk")
    team_ids = set(tournament.game_role_team_order or [])
    for home_id, away_id in crosses.order_by().values_list("home_team_id", "away_team_id"):
        team_ids.update((home_id, away_id))
    scored = crosses.filter(played=True, home_goals__isnull=False, away_goals__isnull=False).order_by().values_list(
        "home_team_id", "away_team_id", "home_goals", "away_goals",
    )
    teams = tournament.teams.filter(pk__in=team_ids).values_list("pk", "name", "tournament_id")
    standings = build_standings(teams, scored)
    return {
        "tournament": tournament.name,
        "site": tournament.site.name,
        "number": round_row.number,
        "starts_on": round_row.starts_on,
        "matches": list(matches.values(*match_fields[:-2])),
        "results_round": results_round,
        "results": list(results.values(*match_fields)),
        "standings": standings,
        "scoring": [
            {"team": row["team_name"], "goals": row["goals_for"]}
            for row in sorted(standings, key=lambda row: -row["goals_for"]) if row["played"]
        ],
    }


class GameRoleShareView(GameRoleView):
    def get(self, request, tournament_id, round_id):
        tournament = self.tournament(request, tournament_id)
        round_row = get_object_or_404(tournament.game_role_rounds, pk=round_id)
        token = ROLE_LINK_SIGNER.sign(str(round_row.pk))
        return Response({**round_schedule(round_row), "token": token}, headers={"Cache-Control": "no-store"})


class PublicGameRoleView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request, token):
        try:
            round_id = int(ROLE_LINK_SIGNER.unsign(token))
        except (signing.BadSignature, ValueError):
            raise Http404 from None
        round_row = get_object_or_404(GameRoleRound.objects.select_related("tournament__site"), pk=round_id)
        return Response(round_schedule(round_row),
                        headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


class GameRoleMatrixView(GameRoleView):
    def matrix(self, tournament):
        teams = list(tournament.teams.order_by("name", "pk").values("id", "name", "is_active"))
        rounds = list(tournament.game_role_rounds.order_by("number").values("id", "number", "starts_on"))
        crosses = list(tournament_crosses(tournament).order_by("pk").values(
            "home_team_id", "away_team_id", "round_id", "scheduled_on", "starts_at", "ends_at", "played", "home_goals", "away_goals",
        ))
        results = ((cross["home_team_id"], cross["away_team_id"], cross["home_goals"], cross["away_goals"])
                   for cross in crosses if cross["played"] and cross["home_goals"] is not None and cross["away_goals"] is not None)
        standings = build_standings(((team["id"], team["name"], tournament.pk) for team in teams), results)
        return Response({
            "teams": teams, "matrix_team_ids": tournament.game_role_team_order, "rounds": rounds, "crosses": crosses,
            "starts_on": tournament.starts_on, "schedule_enabled": True, "team_notes": team_notes(tournament), "standings": standings,
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
        if "new_team" in request.data or "add_team_id" in request.data:
            if "new_team" in request.data:
                if "add_team_id" in request.data:
                    raise ValidationError("Elige crear un equipo o agregar uno existente.")
                team_id = self.create_matrix_team(tournament, request.data["new_team"]).pk
            else:
                team_id = serializers.IntegerField(min_value=1).run_validation(request.data["add_team_id"])
                if not tournament.teams.filter(pk=team_id, is_active=True).exists():
                    raise ValidationError("Selecciona un equipo activo de este torneo.")
            if team_id not in tournament.game_role_team_order:
                tournament.game_role_team_order = [*tournament.game_role_team_order, team_id]
                tournament.save(update_fields=["game_role_team_order", "updated_at"])
            return self.matrix(tournament)
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

    def create_matrix_team(self, tournament, data):
        if not tournament.is_active or not tournament.site.is_active:
            raise ValidationError("Selecciona un torneo activo.")
        if not isinstance(data, dict):
            raise ValidationError("Ingresa los datos del equipo.")
        allowed = {"name", "representative_name", "representative_phone"}
        serializer = TeamSerializer(data={
            **{key: value for key, value in data.items() if key in allowed},
            "tournament": tournament.pk,
        })
        serializer.is_valid(raise_exception=True)
        if not serializer.validated_data.get("representative_name"):
            raise ValidationError({"representative_name": "Ingresa el nombre del delegado."})
        try:
            with transaction.atomic():
                return serializer.save(tournament=tournament, is_active=True)
        except IntegrityError:
            if tournament.teams.filter(name=serializer.validated_data["name"]).exists():
                raise ValidationError({"name": "Ya existe un equipo con ese nombre en este torneo."})
            raise

    @transaction.atomic
    def put(self, request, tournament_id):
        tournament = self.tournament(request, tournament_id, lock=True)
        serializer = CrossInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data.copy()
        round_id = data.pop("round_id")
        schedule = data.pop("schedule", serializers.empty)
        played = data.pop("played", serializers.empty)
        score = data.pop("score", serializers.empty)
        team_ids = {data["home_team_id"], data["away_team_id"]}
        if len(team_ids) != 2:
            raise ValidationError("Selecciona dos equipos distintos.")
        teams = Team.objects.select_for_update().filter(tournament=tournament, pk__in=team_ids).order_by("pk")
        if set(teams.values_list("pk", flat=True)) != team_ids:
            raise ValidationError("Ambos equipos deben pertenecer a este torneo.")
        if round_id is None:
            if schedule not in (None, serializers.empty) or score not in (None, serializers.empty) or played is True:
                raise ValidationError("Selecciona una jornada para guardar el horario, el marcador o el estado del partido.")
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
            if score is not serializers.empty:
                defaults.update(score or {"home_goals": None, "away_goals": None})
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
