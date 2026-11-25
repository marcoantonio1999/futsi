from datetime import date, timedelta
from hashlib import sha256

from django.core import signing
from django.db import IntegrityError, transaction
from django.http import Http404
from django.db.models import Count, Max, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import permissions, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.api.enrollments import EnrollmentStaffPermission, enrollment_sites
from core.domain_serializers.sports import EnrollmentTeamCreateSerializer, find_enrollment_team_by_name
from core.models import GameRoleCross, GameRoleRound, GameRoleTeamNote, Site, Team, Tournament
from core.services.game_role_schedule import FRANCO_SITE_ID, tournament_schedule
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


class WeeklyBlockInput(serializers.Serializer):
    weekday = serializers.IntegerField(min_value=0, max_value=6)
    starts_at = serializers.TimeField(input_formats=["%H:%M"], format="%H:%M")
    ends_at = serializers.TimeField(input_formats=["%H:%M"], format="%H:%M")

    def validate(self, data):
        if data["ends_at"] <= data["starts_at"]:
            raise ValidationError("La hora de fin debe ser posterior a la de inicio.")
        return data


def weekly_order(block):
    return (block["weekday"] - 1) % 7, block["starts_at"]


class WeeklyScheduleInput(serializers.Serializer):
    weekly_schedule = WeeklyBlockInput(many=True)
    previous_weekly_schedule = WeeklyBlockInput(many=True)

    def validate_weekly_schedule(self, blocks):
        ordered = sorted(blocks, key=weekly_order)
        for first, second in zip(ordered, ordered[1:]):
            if first["weekday"] == second["weekday"] and first["ends_at"] > second["starts_at"]:
                raise ValidationError("Hay bloques que se cruzan en el mismo día.")
        return ordered


class ScoreInput(serializers.Serializer):
    home_goals = serializers.IntegerField(min_value=0, max_value=999)
    away_goals = serializers.IntegerField(min_value=0, max_value=999)


class CrossInput(serializers.Serializer):
    cross_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
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


class PlannerSlotInput(serializers.Serializer):
    round_id = serializers.IntegerField(min_value=1)
    schedule = ScheduleInput()


class PlannerMatchInput(PlannerSlotInput):
    cross_id = serializers.IntegerField(min_value=1, required=False)
    home_team_id = serializers.IntegerField(min_value=1)
    away_team_id = serializers.IntegerField(min_value=1)


class PlannerScoreInput(serializers.Serializer):
    cross_id = serializers.IntegerField(min_value=1, required=False)
    round_id = serializers.IntegerField(min_value=1)
    home_team_id = serializers.IntegerField(min_value=1)
    away_team_id = serializers.IntegerField(min_value=1)
    score = ScoreInput(allow_null=True)


class PlannerSplitInput(serializers.Serializer):
    source = PlannerMatchInput()
    destination = PlannerSlotInput()
    team_id = serializers.IntegerField(min_value=1)
    opponent_id = serializers.IntegerField(min_value=1, allow_null=True)
    side = serializers.ChoiceField(choices=("home", "away"))


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
    rest_team = round_row.rest_team
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
        "expected_weeks": tournament.expected_weeks,
        "rest_team": rest_team.name if rest_team and rest_team.tournament_id == tournament.pk else None,
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
        round_row = get_object_or_404(GameRoleRound.objects.select_related("tournament__site", "rest_team"), pk=round_id)
        headers = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex"}
        previous = request.query_params.get("revision")
        if previous is None:
            return Response(round_schedule(round_row), headers=headers)
        tournament = round_row.tournament
        timestamps = {"total": Count("pk"), "latest": Max("updated_at")}
        revision = sha256(repr((
            round_row.number, round_row.starts_on, round_row.rest_team and round_row.rest_team.name,
            tournament.name, tournament.site.name, tournament.expected_weeks, tournament.game_role_team_order,
            tournament.teams.aggregate(**timestamps),
            tournament.game_role_rounds.aggregate(**timestamps),
            tournament_crosses(tournament).aggregate(**timestamps),
        )).encode()).hexdigest()
        if revision == previous:
            return Response(status=204, headers=headers)
        return Response({**round_schedule(round_row), "revision": revision}, headers=headers)


class GameRoleMatrixView(GameRoleView):
    def matrix(self, tournament):
        teams = list(tournament.teams.order_by("name", "pk").values("id", "name", "is_active"))
        rounds = list(tournament.game_role_rounds.order_by("number").values("id", "number", "starts_on", "rest_team_id", "extra_schedule"))
        for row in rounds:
            if row["rest_team_id"] is None:
                del row["rest_team_id"]
            if not row["extra_schedule"]:
                del row["extra_schedule"]
        crosses = list(tournament_crosses(tournament).order_by("pk").values(
            "id", "home_team_id", "away_team_id", "round_id", "scheduled_on", "starts_at", "ends_at", "played", "home_goals", "away_goals",
        ))
        results = ((cross["home_team_id"], cross["away_team_id"], cross["home_goals"], cross["away_goals"])
                   for cross in crosses if cross["played"] and cross["home_goals"] is not None and cross["away_goals"] is not None)
        standings = build_standings(((team["id"], team["name"], tournament.pk) for team in teams), results)
        return Response({
            "teams": teams, "matrix_team_ids": tournament.game_role_team_order, "rounds": rounds, "crosses": crosses,
            "weekly_schedule": sorted(tournament_schedule(tournament), key=weekly_order),
            "starts_on": tournament.starts_on, "schedule_enabled": True, "team_notes": team_notes(tournament), "standings": standings,
        })

    def get(self, request, tournament_id):
        tournament = self.tournament(request, tournament_id)
        if "planner_week" in request.query_params:
            week = serializers.DateField().run_validation(request.query_params["planner_week"])
            if week > date.max - timedelta(days=4):
                raise ValidationError("Selecciona una semana válida.")
            friday = week + timedelta(days=4)
            first_day, last_day = week.isoformat(), friday.isoformat()
            occupied = GameRoleCross.objects.filter(
                tournament__site_id=tournament.site_id, scheduled_on__range=(week, friday),
            ).exclude(tournament=tournament).values("scheduled_on", "starts_at", "ends_at")
            others = list(Tournament.objects.filter(site_id=tournament.site_id, is_active=True)
                          .exclude(pk=tournament.pk).only("id", "name", "site_id", "game_role_schedule").order_by("name", "id"))
            extras = {}
            for league_id, blocks in GameRoleRound.objects.filter(
                tournament_id__in=[other.id for other in others],
                starts_on__range=(max(date.min + timedelta(days=6), week) - timedelta(days=6), friday),
            ).values_list("tournament_id", "extra_schedule"):
                extras.setdefault(league_id, []).extend(
                    block for block in blocks if first_day <= block["scheduled_on"] <= last_day
                )
            return Response({"occupied": list(occupied), "schedules": [
                {"name": other.name, "weekly_schedule": tournament_schedule(other), "extra_schedule": extras.get(other.id, [])}
                for other in others
            ]})
        if "week_occupancy" in request.query_params:
            week = serializers.DateField().run_validation(request.query_params["week_occupancy"])
            occupied = GameRoleCross.objects.filter(
                tournament__site_id=tournament.site_id,
                scheduled_on__range=(week, week + timedelta(days=4)),
                starts_at__isnull=False, ends_at__isnull=False,
            ).values("scheduled_on", "starts_at", "ends_at")
            return Response(list(occupied))
        return self.matrix(tournament)

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
        if "weekly_schedule" in request.data:
            return self.update_weekly_schedule(request, tournament_id)
        if "planner_matches" in request.data:
            return self.save_planner_matches(request, tournament_id)
        if "remove_planner_match" in request.data:
            return self.remove_planner_match(request, tournament_id)
        if "split_planner_match" in request.data:
            return self.split_planner_match(request, tournament_id)
        if "add_extra_slot" in request.data:
            return self.add_extra_slot(request, tournament_id)
        if "planner_score" in request.data:
            return self.save_planner_score(request, tournament_id)
        tournament = self.tournament(request, tournament_id, lock=True)
        team_fields = {"new_team", "new_team_name", "add_team_id"}.intersection(request.data)
        if team_fields:
            if len(team_fields) > 1:
                raise ValidationError("Elige crear un equipo o agregar uno existente.")
            if "new_team" in request.data:
                team_id = self.create_matrix_team(tournament, request.data["new_team"]).pk
            elif "new_team_name" in request.data:
                team_id = self.create_matrix_team(
                    tournament, {"name": request.data["new_team_name"]}, require_representative=False,
                ).pk
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
        if "rest_team_id" in request.data:
            return self.update_rest_team(tournament, row, request.data["rest_team_id"])
        serializer = RoundInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if tournament.game_role_rounds.exclude(pk=row.pk).filter(number=data["number"]).exists():
            raise ValidationError("Ya existe una jornada con ese número en este torneo.")
        start = data["starts_on"]
        if any(not start <= date.fromisoformat(slot["scheduled_on"]) <= start + timedelta(days=6) for slot in row.extra_schedule):
            raise ValidationError("La nueva semana deja un horario extra fuera de la jornada.")
        if tournament_crosses(tournament).filter(round=row).filter(
            Q(scheduled_on__lt=start) | Q(scheduled_on__gt=start + timedelta(days=6))
        ).exists():
            raise ValidationError("Cambia primero los horarios de los partidos que quedarían fuera de la semana.")
        row.number, row.starts_on = data["number"], data["starts_on"]
        row.save(update_fields=["number", "starts_on", "updated_at"])
        return self.matrix(tournament)

    def lock_game_calendar(self, request, tournament_id):
        site_id = self.tournament(request, tournament_id).site_id
        Site.objects.select_for_update().only("id").get(pk=site_id)
        tournament = self.tournament(request, tournament_id, lock=True)
        if tournament.site_id != site_id:
            raise ValidationError("La sede del torneo cambió. Vuelve a cargar la programación.")
        return tournament

    def calendar_conflicts(self, tournament, schedule, exclude_id=None):
        rows = GameRoleCross.objects.filter(tournament__site_id=tournament.site_id)
        if exclude_id is not None:
            rows = rows.exclude(pk=exclude_id)
        return rows.filter(
            scheduled_on=schedule["scheduled_on"], starts_at__lt=schedule["ends_at"], ends_at__gt=schedule["starts_at"],
        )

    def validate_planner_date(self, round_row, schedule):
        day = schedule["scheduled_on"]
        if not round_row or not round_row.starts_on <= day <= round_row.starts_on + timedelta(days=6):
            raise ValidationError("Selecciona una jornada que incluya la fecha del partido.")
        self.require_open_planner_round(round_row)
        if day.isoweekday() > 5:
            raise ValidationError("Selecciona un día de lunes a viernes.")
        if schedule["ends_at"] <= schedule["starts_at"]:
            raise ValidationError("La hora de fin debe ser posterior a la de inicio.")

    def planner_round_closed(self, round_row):
        return round_row.starts_on + timedelta(days=6) < timezone.localdate()

    def require_open_planner_round(self, round_row):
        if self.planner_round_closed(round_row):
            raise ValidationError("La jornada terminó. Solo se puede actualizar el marcador.")

    def save_planner_score(self, request, tournament_id):
        serializer = PlannerScoreInput(data=request.data["planner_score"])
        serializer.is_valid(raise_exception=True)
        tournament = self.lock_game_calendar(request, tournament_id)
        lookup = serializer.validated_data.copy()
        score = lookup.pop("score")
        cross_id = lookup.pop("cross_id", None)
        rows = tournament_crosses(tournament).select_related("round").filter(**lookup)
        if cross_id is not None:
            rows = rows.filter(pk=cross_id)
        match = self.single_cross(rows)
        if not match:
            raise Http404
        if score is not None and not match.played and (not match.scheduled_on or match.round.starts_on > timezone.localdate()):
            raise ValidationError("Puedes capturar el marcador de un partido programado desde que inicia la jornada.")
        match.home_goals = score["home_goals"] if score is not None else None
        match.away_goals = score["away_goals"] if score is not None else None
        match.played = score is not None
        match.save(update_fields=["home_goals", "away_goals", "played", "updated_at"])
        return self.matrix(tournament)

    @staticmethod
    def single_cross(rows):
        matches = list(rows.order_by("pk")[:2])
        if len(matches) > 1:
            raise ValidationError("Selecciona el partido específico que quieres editar.")
        return matches[0] if matches else None

    def planner_source(self, tournament, data):
        rows = tournament_crosses(tournament).filter(
            home_team_id=data["home_team_id"], away_team_id=data["away_team_id"],
        )
        if "cross_id" in data:
            return rows.filter(pk=data["cross_id"]).first()
        return rows.filter(round_id=data["round_id"], **data["schedule"]).first()

    def validate_planner_slot(self, round_row, schedule, weekly, participants):
        self.validate_planner_date(round_row, schedule)
        day = schedule["scheduled_on"]
        block = (day.isoweekday() % 7, schedule["starts_at"].strftime("%H:%M"), schedule["ends_at"].strftime("%H:%M"))
        if block not in weekly and self.serialize_extra_slot(schedule) not in round_row.extra_schedule:
            raise ValidationError("El bloque ya no está disponible en los horarios del torneo.")
        if round_row.rest_team_id in participants:
            raise ValidationError("Uno de los equipos tiene descanso en esta jornada.")

    def serialize_extra_slot(self, schedule):
        return {
            "scheduled_on": schedule["scheduled_on"].isoformat(),
            "starts_at": schedule["starts_at"].strftime("%H:%M"),
            "ends_at": schedule["ends_at"].strftime("%H:%M"),
        }

    def add_extra_slot(self, request, tournament_id):
        serializer = PlannerSlotInput(data=request.data["add_extra_slot"])
        serializer.is_valid(raise_exception=True)
        tournament = self.lock_game_calendar(request, tournament_id)
        if not tournament.is_active or not tournament.site.is_active:
            raise ValidationError("Selecciona un torneo activo.")
        data = serializer.validated_data
        round_row = tournament.game_role_rounds.filter(pk=data["round_id"]).first()
        schedule = data["schedule"]
        self.validate_planner_date(round_row, schedule)
        extra = self.serialize_extra_slot(schedule)
        if extra in round_row.extra_schedule:
            return self.matrix(tournament)
        if self.calendar_conflicts(tournament, schedule).exists():
            raise ValidationError("El horario está ocupado por un partido en esta sede.")
        weekday = schedule["scheduled_on"].isoweekday() % 7
        same_day = [block for block in tournament_schedule(tournament) if block["weekday"] == weekday]
        for row in tournament.game_role_rounds.all():
            same_day.extend(block for block in row.extra_schedule if block["scheduled_on"] == extra["scheduled_on"])
        if any(block["starts_at"] < extra["ends_at"] and block["ends_at"] > extra["starts_at"] for block in same_day):
            raise ValidationError("Ese rango ya coincide con un horario del torneo.")
        round_row.extra_schedule = [*round_row.extra_schedule, extra]
        round_row.save(update_fields=["extra_schedule", "updated_at"])
        return self.matrix(tournament)

    def save_planner_matches(self, request, tournament_id):
        serializer = PlannerMatchInput(data=request.data["planner_matches"], many=True, allow_empty=False, max_length=100)
        serializer.is_valid(raise_exception=True)
        tournament = self.lock_game_calendar(request, tournament_id)
        if not tournament.is_active or not tournament.site.is_active:
            raise ValidationError("Selecciona un torneo activo.")
        self.apply_planner_matches(tournament, serializer.validated_data)
        return self.matrix(tournament)

    def apply_planner_matches(self, tournament, matches):
        weekly = {(block["weekday"], block["starts_at"], block["ends_at"]) for block in tournament_schedule(tournament)}
        rounds = {row.pk: row for row in tournament.game_role_rounds.all()}
        team_ids = set(tournament.teams.filter(is_active=True).values_list("pk", flat=True))
        rows = tournament_crosses(tournament)
        matrix_order = dict.fromkeys(tournament.game_role_team_order)
        for match in matches:
            home, away = match["home_team_id"], match["away_team_id"]
            participants = {home, away}
            round_row = rounds.get(match["round_id"])
            schedule = match["schedule"]
            if len(participants) != 2 or not participants <= team_ids:
                raise ValidationError("Selecciona dos equipos activos del mismo torneo.")
            self.validate_planner_slot(round_row, schedule, weekly, participants)
            pair = {"home_team_id": home, "away_team_id": away}
            scoped = rows.filter(round=round_row, **pair)
            if scoped.filter(**schedule).exists():
                continue
            if self.calendar_conflicts(tournament, schedule).exists():
                raise ValidationError("El horario ya está ocupado. Actualiza la programación.")
            pending = scoped.filter(played=False, scheduled_on__isnull=True).order_by("pk").first()
            if pending:
                for field, value in schedule.items():
                    setattr(pending, field, value)
                pending.save(update_fields=[*schedule, "updated_at"])
            else:
                tournament.game_role_crosses.create(round=round_row, **pair, **schedule)
            matrix_order.update(dict.fromkeys((home, away)))
        if list(matrix_order) != tournament.game_role_team_order:
            tournament.game_role_team_order = list(matrix_order)
            tournament.save(update_fields=["game_role_team_order", "updated_at"])

    def split_planner_match(self, request, tournament_id):
        serializer = PlannerSplitInput(data=request.data["split_planner_match"])
        serializer.is_valid(raise_exception=True)
        tournament = self.lock_game_calendar(request, tournament_id)
        if not tournament.is_active or not tournament.site.is_active:
            raise ValidationError("Selecciona un torneo activo.")
        data = serializer.validated_data
        source, destination = data["source"], data["destination"]
        team_id, opponent_id = data["team_id"], data["opponent_id"]
        original_teams = {source["home_team_id"], source["away_team_id"]}
        if team_id not in original_teams or opponent_id in original_teams:
            raise ValidationError("Selecciona un equipo del partido y un rival distinto.")
        match = self.planner_source(tournament, source)
        if not match:
            raise ValidationError("El partido ya no está programado. Actualiza la programación.")
        if match.played or match.home_goals is not None or match.away_goals is not None:
            raise ValidationError("El partido ya tiene resultado y no se puede mover.")
        schedule = destination["schedule"]
        if match.round_id != source["round_id"] or any(getattr(match, field) != value for field, value in source["schedule"].items()):
            raise ValidationError("El partido cambió. Actualiza la programación antes de moverlo.")
        if not tournament.teams.filter(pk=team_id, is_active=True).exists():
            raise ValidationError("El equipo debe estar activo en el torneo.")
        weekly = {(block["weekday"], block["starts_at"], block["ends_at"]) for block in tournament_schedule(tournament)}
        self.validate_planner_slot(match.round, source["schedule"], weekly, original_teams)
        round_row = tournament.game_role_rounds.filter(pk=destination["round_id"]).first()
        self.validate_planner_slot(round_row, schedule, weekly, {team_id})
        if self.calendar_conflicts(tournament, schedule).exists():
            raise ValidationError("El horario ya está ocupado. Actualiza la programación.")
        match.delete()
        if opponent_id is not None:
            home, away = (team_id, opponent_id) if data["side"] == "home" else (opponent_id, team_id)
            self.apply_planner_matches(tournament, [{**destination, "home_team_id": home, "away_team_id": away}])
        return self.matrix(tournament)

    def remove_planner_match(self, request, tournament_id):
        serializer = PlannerMatchInput(data=request.data["remove_planner_match"])
        serializer.is_valid(raise_exception=True)
        tournament = self.lock_game_calendar(request, tournament_id)
        if not tournament.is_active or not tournament.site.is_active:
            raise ValidationError("Selecciona un torneo activo.")
        data = serializer.validated_data
        schedule = data["schedule"]
        match = self.planner_source(tournament, data)
        if match:
            self.require_open_planner_round(match.round)
            if match.played or match.home_goals is not None or match.away_goals is not None:
                raise ValidationError("El partido ya tiene resultado y no se puede eliminar desde el calendario.")
            if match.round_id != data["round_id"] or any(getattr(match, field) != value for field, value in schedule.items()):
                raise ValidationError("El partido cambió. Actualiza el calendario antes de eliminarlo.")
            match.delete()
        return self.matrix(tournament)

    def update_rest_team(self, tournament, round_row, value):
        team_id = serializers.IntegerField(min_value=1, allow_null=True).run_validation(value)
        if round_row.rest_team_id == team_id:
            return self.matrix(tournament)
        if team_id is not None:
            team = tournament.teams.select_for_update().filter(pk=team_id, is_active=True).first()
            if team is None:
                raise ValidationError("Selecciona un equipo activo de este torneo.")
            if tournament_crosses(tournament).filter(round=round_row).filter(
                Q(home_team_id=team_id) | Q(away_team_id=team_id)
            ).exists():
                raise ValidationError("El equipo ya tiene un partido asignado en esta jornada.")
        round_row.rest_team_id = team_id
        round_row.save(update_fields=["rest_team", "updated_at"])
        return self.matrix(tournament)

    def update_weekly_schedule(self, request, tournament_id):
        serializer = WeeklyScheduleInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        site_id = self.tournament(request, tournament_id).site_id
        # Serialize edits to the shared calendar before checking the other tournaments.
        Site.objects.select_for_update().only("id").get(pk=site_id)
        tournament = self.tournament(request, tournament_id, lock=True)
        if tournament.site_id != site_id or not tournament.is_active or not tournament.site.is_active:
            raise ValidationError("Selecciona un torneo activo de la sede.")
        blocks = serializer.data["weekly_schedule"]
        current = sorted(tournament_schedule(tournament), key=weekly_order)
        if blocks == current:
            return self.matrix(tournament)
        if sorted(serializer.data["previous_weekly_schedule"], key=weekly_order) != current:
            raise ValidationError("El horario cambió. Vuelve a cargarlo antes de guardar.")
        if site_id == FRANCO_SITE_ID:
            weekdays = ("domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado")
            for other in Tournament.objects.filter(site_id=site_id, is_active=True).exclude(pk=tournament.pk):
                for occupied in tournament_schedule(other):
                    if any(block["weekday"] == occupied["weekday"] and block["starts_at"] < occupied["ends_at"]
                           and occupied["starts_at"] < block["ends_at"] for block in blocks):
                        day = weekdays[occupied["weekday"]]
                        raise ValidationError(f"El {day} se cruza con {other.name} ({occupied['starts_at']}–{occupied['ends_at']}).")
        tournament.game_role_schedule = blocks
        tournament.save(update_fields=["game_role_schedule", "updated_at"])
        return self.matrix(tournament)

    def create_matrix_team(self, tournament, data, *, require_representative=True):
        if not tournament.is_active or not tournament.site.is_active:
            raise ValidationError("Selecciona un torneo activo.")
        if not isinstance(data, dict):
            raise ValidationError("Ingresa los datos del equipo.")
        allowed = {"name", "representative_name", "representative_phone"}
        serializer = EnrollmentTeamCreateSerializer(data={
            **{key: value for key, value in data.items() if key in allowed},
            "tournament": tournament.pk,
        })
        serializer.is_valid(raise_exception=True)
        if require_representative and not serializer.validated_data.get("representative_name"):
            raise ValidationError({"representative_name": "Ingresa el nombre del delegado."})
        if find_enrollment_team_by_name(tournament, serializer.validated_data["name"]):
            raise ValidationError({"name": "Ya existe un equipo con ese nombre en este torneo."})
        try:
            with transaction.atomic():
                return serializer.save(tournament=tournament, is_active=True)
        except IntegrityError:
            if tournament.teams.filter(name=serializer.validated_data["name"]).exists():
                raise ValidationError({"name": "Ya existe un equipo con ese nombre en este torneo."})
            raise

    @transaction.atomic
    def put(self, request, tournament_id):
        tournament = self.lock_game_calendar(request, tournament_id)
        serializer = CrossInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data.copy()
        cross_id = data.pop("cross_id", serializers.empty)
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
        rows = tournament_crosses(tournament).filter(**data)
        existing = None
        if cross_id is serializers.empty:
            existing = self.single_cross(rows.filter(round_id=round_id)) if round_id is not None else None
            if existing is None:
                existing = self.single_cross(rows)
        elif cross_id is not None:
            existing = get_object_or_404(rows, pk=cross_id)
        if round_id is None:
            if schedule not in (None, serializers.empty) or score not in (None, serializers.empty) or played is True:
                raise ValidationError("Selecciona una jornada para guardar el horario, el marcador o el estado del partido.")
            if existing:
                existing.delete()
        else:
            round_row = get_object_or_404(tournament.game_role_rounds, pk=round_id)
            if round_row.rest_team_id in team_ids:
                raise ValidationError("Uno de los equipos tiene descanso en esta jornada.")
            defaults = {"round_id": round_row.pk}
            fields = ("scheduled_on", "starts_at", "ends_at")
            if schedule is serializers.empty:
                schedule = {field: getattr(existing, field) for field in fields} if existing else None
            defaults.update(schedule or dict.fromkeys(fields))
            if played is not serializers.empty:
                defaults["played"] = played
            if score is not serializers.empty:
                defaults.update(score or {"home_goals": None, "away_goals": None})
            if not existing and rows.filter(round_id=round_id, **{field: defaults[field] for field in fields}).exists():
                return self.matrix(tournament)
            scheduled_on = defaults["scheduled_on"]
            if scheduled_on is not None:
                if not round_row.starts_on <= scheduled_on <= round_row.starts_on + timedelta(days=6):
                    raise ValidationError("La fecha del partido debe estar dentro de la semana de la jornada.")
                if self.calendar_conflicts(tournament, defaults, exclude_id=existing.pk if existing else None).exists():
                    raise ValidationError("Ese horario ya está ocupado. Selecciona otro rango.")
            if existing:
                for field, value in defaults.items():
                    setattr(existing, field, value)
                existing.save(update_fields=[*defaults, "updated_at"])
            else:
                tournament.game_role_crosses.create(**data, **defaults)
        return self.matrix(tournament)
