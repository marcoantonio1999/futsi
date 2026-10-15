"""Read-only directory: people and their preserved tournament participations."""
import unicodedata
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from core.api.enrollments import EnrollmentStaffPermission, invitations_for
from core.enrollment_models import PlayerEnrollment, PlayerBlacklistEntry
from core.models import Player
from core.services.player_blacklist import identity_key


def normalized(value):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFKD', value)
                            if not unicodedata.combining(c)).casefold().split())


class EnrollmentPlayersView(APIView):
    permission_classes = [EnrollmentStaffPermission]

    def get(self, request):
        params = request.query_params
        try:
            page = int(params.get('page', '1'))
            if not 1 <= page <= 100000:
                raise ValueError()
        except (ValueError, TypeError):
            raise ValidationError('Página inválida.')
        state = params.get('status', '')
        if state not in ('', 'active', 'inactive'):
            raise ValidationError('Estado inválido.')
        source = params.get('source', 'enrollments')
        if source not in ('enrollments', 'legacy'):
            raise ValidationError('Origen inválido.')
        # Only scalar directory fields, never documents, signatures or binaries.
        rows = PlayerEnrollment.objects.filter(invitation__in=invitations_for(request.user)).order_by('signed_at', 'id').values(
            'id', 'name', 'birth_date', 'team', 'tournament', 'team_record_id',
            'withdrawn_at', 'signed_at', 'is_delegate', 'team_record__name',
            'team_record__is_active', 'team_record__tournament_id', 'team_record__tournament__name',
            'team_record__tournament__is_active', 'team_record__tournament__site_id',
            'team_record__tournament__site__name', 'team_record__tournament__site__is_active')
        exclusions = list(PlayerBlacklistEntry.objects.filter(is_active=True).values('identity_key', 'source_player_id'))
        blocked = {row['identity_key'] for row in exclusions}
        blocked_players = {row['source_player_id'] for row in exclusions if row['source_player_id']}
        people = {}

        def participation(row, prefix='team_record'):
            team_id = row.get(prefix + '_id')
            tournament_id = row.get(prefix + '__tournament_id')
            active = bool(team_id and row[prefix + '__is_active'] and row[prefix + '__tournament__is_active']
                          and row[prefix + '__tournament__site__is_active'])
            return {'team_id': team_id, 'team': row.get(prefix + '__name') or row.get('team') or 'Sin equipo asignado',
                    'tournament_id': tournament_id, 'tournament': row.get(prefix + '__tournament__name') or row.get('tournament') or 'Sin torneo asignado',
                    'site_id': row.get(prefix + '__tournament__site_id'),
                    'site': row.get(prefix + '__tournament__site__name') or 'Sin sede',
                    'is_active': active}

        for row in rows.iterator(chunk_size=500):
            key = identity_key(row['name'], row['birth_date'])
            person = people.setdefault(key, {'id': key, 'name': row['name'], 'birth_date': row['birth_date'],
                                            'legacy': False, 'participations': []})
            item = participation(row)
            item.update(id='enrollment:' + str(row['id']), signed_at=row['signed_at'], withdrawn_at=row['withdrawn_at'],
                        is_delegate=row['is_delegate'], is_active=item['is_active'] and not row['withdrawn_at'] and key not in blocked)
            item['status'] = ('Baja' if row['withdrawn_at'] else 'Lista negra' if key in blocked
                              else 'Activo' if item['is_active'] else 'Equipo o torneo inactivo')
            person['participations'].append(item)

        # Legacy Player has no birth date. Never merge it with a namesake or
        # infer an identity from a shared family phone. Own-link operators do
        # not gain access to the global legacy directory through this endpoint.
        global_access = request.user.username.casefold() == 'emilio' or request.user.role in {'admin', 'owner', 'dev'}
        if global_access:
            legacy = Player.objects.order_by('id').values('id', 'full_name', 'is_active', 'team_id', 'team__name',
                'team__is_active', 'team__tournament_id', 'team__tournament__name', 'team__tournament__is_active',
                'team__tournament__site_id', 'team__tournament__site__name', 'team__tournament__site__is_active')
            for row in legacy.iterator(chunk_size=500):
                item = participation(row, 'team')
                item.update(id='player:' + str(row['id']), signed_at=None, withdrawn_at=None, is_delegate=False,
                            is_active=item['is_active'] and row['is_active'] and row['id'] not in blocked_players)
                item['status'] = 'Lista negra' if row['id'] in blocked_players else 'Activo' if item['is_active'] else 'Inactivo'
                key = 'player:' + str(row['id'])
                people[key] = {'id': key, 'name': row['full_name'], 'birth_date': None, 'legacy': True, 'participations': [item]}

        players = list(people.values())
        for player in players:
            player['is_active'] = any(item['is_active'] for item in player['participations'])
        legacy_count = sum(p['legacy'] for p in players)
        players = [p for p in players if p['legacy'] == (source == 'legacy')]
        totals = {'total': len(players), 'active': sum(p['is_active'] for p in players),
                  'inactive': sum(not p['is_active'] for p in players),
                  'participations': sum(len(p['participations']) for p in players),
                  'legacy': legacy_count}
        options = {'sites': {}, 'tournaments': {}, 'teams': {}}
        for player in players:
            for item in player['participations']:
                for plural, singular in [('sites', 'site'), ('tournaments', 'tournament'), ('teams', 'team')]:
                    value = item[singular + '_id']
                    if value is not None:
                        options[plural][value] = {'id': value, 'name': item[singular],
                            'tournament_id': item['tournament_id'], 'site_id': item['site_id']}
        search = normalized(params.get('search', '')[:160])
        def matches(player):
            if search and search not in normalized(player['name']):
                return False
            if state and player['is_active'] != (state == 'active'):
                return False
            # All location filters must match the SAME participation.
            return any(all(not params.get(field + '_id') or str(item[field + '_id']) == params[field + '_id']
                           for field in ('site', 'tournament', 'team')) for item in player['participations'])
        filtered = sorted((p for p in players if matches(p)), key=lambda p: (normalized(p['name']), p['id']))
        count = len(filtered)
        page = min(page, max(1, (count + 24) // 25))
        response = Response({'results': filtered[(page - 1) * 25:page * 25], 'count': count, 'page': page,
            'totals': totals, 'filters': {k: sorted(v.values(), key=lambda x: normalized(x['name'])) for k, v in options.items()}})
        response['Cache-Control'] = 'no-store'
        return response
