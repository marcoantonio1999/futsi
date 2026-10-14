"""Shared roster limits. Every admission serializes on the tournament/team."""
from contextlib import contextmanager
from django.db import transaction
from rest_framework.exceptions import ValidationError


def team_occupancy(team_id, exclude_kind=None, exclude_id=None):
    from core.models import Player, StudentTournamentRegistration
    from core.enrollment_models import PlayerEnrollment
    rows = {
        "player": Player.objects.filter(team_id=team_id, is_active=True),
        "student": StudentTournamentRegistration.objects.filter(team_id=team_id, status="registered"),
        "enrollment": PlayerEnrollment.objects.filter(team_record_id=team_id, withdrawn_at__isnull=True),
    }
    return sum(query.exclude(pk=exclude_id).count() if kind == exclude_kind and exclude_id else query.count()
               for kind, query in rows.items())


def assert_capacity(team, exclude_kind=None, exclude_id=None):
    limit = team.tournament.max_players_per_team
    if limit is not None and team_occupancy(team.pk, exclude_kind, exclude_id) >= limit:
        raise ValidationError({"detail": f"El equipo {team.name} está completo: el límite de {team.tournament.get_football_format_display()} es de {limit} jugadores."})


@contextmanager
def capacity_guard(team, kind=None, exclude_id=None):
    from core.models import Team, Tournament
    with transaction.atomic():
        tournament = Tournament.objects.select_for_update().get(pk=team.tournament_id)
        locked = Team.objects.select_for_update().get(pk=team.pk)
        if locked.tournament_id != tournament.pk:
            raise ValidationError("El equipo cambió de torneo. Actualiza e intenta de nuevo.")
        locked.tournament = tournament
        if not locked.is_active or not tournament.is_active:
            raise ValidationError("El equipo o torneo ya no está disponible.")
        assert_capacity(locked, kind, exclude_id)
        yield locked
