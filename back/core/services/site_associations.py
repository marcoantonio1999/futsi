"""Fast, read-only summary of records directly associated with a site."""

from django.apps import apps
from django.db.models import Count, Prefetch

from core.models import Site, Team, Tournament
from core.services.site_deletion import LABELS

INSPECTION_LABELS = {
    "User": "Cuentas asignadas",
}

NESTED_ASSOCIATIONS = (
    ("Team", "Equipos", {"tournament__site": None}),
    ("Player", "Jugadores", {"team__tournament__site": None}),
    ("Round", "Jornadas", {"tournament__site": None}),
    ("StudentTournamentRegistration", "Inscripciones a torneos", {"tournament__site": None}),
    ("AttendanceRecord", "Asistencias de alumnos", {"session__site": None}),
    ("PlayerAttendanceRecord", "Asistencias de jugadores", {"session__site": None}),
    ("BillingPlan", "Planes de cobro", {"student__site": None}),
    ("VoiceCall", "Registros de llamadas", {"booking__site": None}),
    ("CallTranscriptSegment", "Transcripciones de llamadas", {"call__booking__site": None}),
    ("WhatsAppMessage", "Mensajes de WhatsApp", {"conversation__site": None}),
)


def _direct_counts(site):
    """Count direct reverse foreign keys without traversing their rows."""
    counts = {}
    for relation in Site._meta.related_objects:
        if relation.many_to_many:
            continue
        model = relation.related_model
        count = model._base_manager.filter(**{relation.field.name: site}).count()
        if not count:
            continue
        label = INSPECTION_LABELS.get(
            model.__name__,
            LABELS.get(model.__name__, str(model._meta.verbose_name_plural).capitalize()),
        )
        counts[model.__name__] = {"label": label, "count": count}
    return counts


def summary(site):
    counts = _direct_counts(site)
    for model_name, label, lookup in NESTED_ASSOCIATIONS:
        if model_name in counts:
            continue
        try:
            model = apps.get_model("core", model_name)
        except LookupError:
            continue
        filters = {key: site for key in lookup}
        count = model._base_manager.filter(**filters).count()
        if count:
            counts[model_name] = {"label": label, "count": count}

    teams = Team.objects.annotate(player_count=Count("players")).order_by("name")
    tournaments = (
        Tournament.objects.filter(site=site)
        .annotate(match_count=Count("matches", distinct=True))
        .prefetch_related(Prefetch("teams", queryset=teams))
        .order_by("name")
    )
    return {
        "site": {
            "id": site.pk,
            "name": site.name,
            "code": site.code,
            "address": site.address,
            "is_active": site.is_active,
        },
        "items": sorted(counts.values(), key=lambda item: item["label"]),
        "accounts": list(
            site.primary_users.order_by("username").values("username", "role", "is_active")
        ),
        "students": list(
            site.students.order_by("full_name").values("id", "full_name", "status")[:100]
        ),
        "courts": list(site.courts.order_by("name").values("id", "name", "is_active")),
        "tournaments": [
            {
                "id": tournament.pk,
                "name": tournament.name,
                "billing_type": tournament.get_billing_type_display(),
                "is_active": tournament.is_active,
                "match_count": tournament.match_count,
                "teams": [
                    {
                        "id": team.pk,
                        "name": team.name,
                        "player_count": team.player_count,
                        "is_active": team.is_active,
                    }
                    for team in tournament.teams.all()
                ],
            }
            for tournament in tournaments
        ],
        "read_only": True,
    }
