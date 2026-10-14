"""Eligibility and roster labels share the same inclusive disciplinary dates."""
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from core.models import PlayerSanction
from core.services.player_blacklist import identity_key


def unfulfilled_sanctions():
    # Scheduled sanctions cannot be escaped before their start either.
    return PlayerSanction.objects.filter(Q(ends_on__isnull=True) | Q(ends_on__gte=timezone.localdate()))


def enrollment_sanctions(rows):
    rows = list(rows)
    result = {row.pk: [] for row in rows}
    if not rows:
        return result
    row_keys = {row.pk: row.identity_key or identity_key(row.name, row.birth_date) for row in rows}
    keys = set(row_keys.values())
    sanctions = unfulfilled_sanctions().filter(
        Q(enrollment_id__in=result) | Q(enrollment__identity_key__in=keys)
    ).select_related('enrollment').order_by('starts_on', 'pk')
    today = timezone.localdate()
    for sanction in sanctions:
        for row in rows:
            if sanction.enrollment_id == row.pk or (sanction.enrollment and sanction.enrollment.identity_key == row_keys[row.pk]):
                result[row.pk].append({'id': sanction.pk, 'starts_on': sanction.starts_on,
                    'ends_on': sanction.ends_on, 'status': 'scheduled' if sanction.starts_on > today else 'active'})
    return result


def assert_withdrawal_allowed(rows):
    if any(enrollment_sanctions(rows).values()):
        raise ValidationError({'detail': 'No se puede dar de baja a jugadores con una sanción pendiente de cumplir. Retira a los sancionados de la selección y espera a que termine su período.'})


def assert_no_pending_sanction(name, birth_date):
    if unfulfilled_sanctions().filter(enrollment__identity_key=identity_key(name, birth_date)).exists():
        raise ValidationError({'detail': 'No se puede completar esta inscripción mientras exista una sanción pendiente de cumplir. Comunícate con la administración.'})


def assert_player_change_allowed(player_id):
    if unfulfilled_sanctions().filter(player_id=player_id).exists():
        raise ValidationError({'player': 'No se puede dar de baja ni cambiar de equipo a un jugador con una sanción pendiente de cumplir.'})
