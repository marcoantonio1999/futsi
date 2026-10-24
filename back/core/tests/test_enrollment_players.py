from datetime import date, timedelta
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User, Site, Tournament, Team, Player
from core.enrollment_models import PlayerEnrollment, PlayerEnrollmentInvitation, PlayerBlacklistEntry
from core.services.player_blacklist import identity_key

URL = '/api/player-enrollments/players/'


@override_settings(ALLOWED_HOSTS=['testserver'])
class EnrollmentPlayersTests(TestCase):
    def setUp(self):
        self.emilio = User.objects.create_user(username='emilio', role='collaborator', section_permissions=['player_enrollments_only'])
        self.other = User.objects.create_user(username='other', role='collaborator', section_permissions=['player_enrollments_only'])
        self.site = Site.objects.create(name='Sede Uno', code='uno')
        self.site2 = Site.objects.create(name='Sede Dos', code='dos')
        self.tournament = Tournament.objects.create(site=self.site, name='Liga Uno', billing_type='weekly_match')
        self.tournament2 = Tournament.objects.create(site=self.site2, name='Liga Dos', billing_type='weekly_match')
        self.team = Team.objects.create(tournament=self.tournament, name='Paris', representative_name='Delegado', representative_phone='5500000000')
        self.team2 = Team.objects.create(tournament=self.tournament2, name='Paris', representative_name='Delegado', representative_phone='5500000000')
        self.client = APIClient()
        self.client.force_authenticate(self.emilio)

    def enroll(self, name='José Pérez López', team=None, creator=None, birth=None, **kwargs):
        team = team or self.team
        invitation = PlayerEnrollmentInvitation.objects.create(created_by=creator or self.emilio, team_record=team,
            team=team.name, tournament=team.tournament.name, expires_at=timezone.now() + timedelta(days=1))
        return PlayerEnrollment.objects.create(invitation=invitation, team_record=team, name=name,
            birth_date=birth or date(2000, 1, 2), team=team.name, tournament=team.tournament.name,
            phone='5500000000', terms_version='test', terms_text=[], **kwargs)

    def test_same_person_has_multiple_memberships_without_duplicate_person_count(self):
        self.enroll(is_delegate=True)
        self.enroll('  JOSE  PEREZ LOPEZ ', team=self.team2, withdrawn_at=timezone.now())
        result = self.client.get(URL).json()
        self.assertEqual(result['totals'], {'total': 1, 'active': 1, 'inactive': 0, 'participations': 2, 'legacy': 0})
        memberships = result['results'][0]['participations']
        self.assertEqual(len(memberships), 2)
        self.assertEqual([m['status'] for m in memberships], ['Activo', 'Baja'])
        self.assertEqual({m['tournament_id'] for m in memberships}, {self.tournament.pk, self.tournament2.pk})
        self.assertTrue(memberships[0]['is_delegate'])

    def test_namesakes_with_distinct_birthdays_are_not_merged(self):
        self.enroll()
        self.enroll(birth=date(2001, 1, 2))
        self.assertEqual(self.client.get(URL).json()['count'], 2)

    def test_signed_sheet_filter_selects_exact_authorized_enrollment(self):
        first = self.enroll()
        second = self.enroll(team=self.team2)
        response = self.client.get('/api/player-enrollments/', {'enrollment_id': second.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['id'] for row in response.json()['results']], [second.pk])
        self.client.force_authenticate(self.other)
        response = self.client.get('/api/player-enrollments/', {'enrollment_id': first.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['results'], [])

    def test_signed_sheet_filter_rejects_invalid_identifier(self):
        for value in ['0', '-1', 'abc', '1,2']:
            self.assertEqual(self.client.get('/api/player-enrollments/', {'enrollment_id': value}).status_code, 400)

    def test_global_state_is_inactive_only_when_no_active_membership_remains(self):
        self.enroll(withdrawn_at=timezone.now())
        self.enroll('Otro Jugador', team=self.team2)
        self.tournament2.is_active = False; self.tournament2.save()
        body = self.client.get(URL, {'status': 'inactive'}).json()
        self.assertEqual(body['count'], 2)
        self.assertEqual(body['totals']['active'], 0)

    def test_filters_cannot_match_different_participations_of_the_same_person(self):
        self.enroll(); self.enroll(team=self.team2)
        self.assertEqual(self.client.get(URL, {'site_id': self.site.pk, 'team_id': self.team2.pk}).json()['count'], 0)
        body = self.client.get(URL, {'tournament_id': self.tournament2.pk, 'search': 'jose perez'}).json()
        self.assertEqual(body['count'], 1)
        self.assertEqual(len(body['results'][0]['participations']), 2)
        self.assertEqual(body['totals']['total'], 1)

    def test_own_link_scope_is_not_expanded_and_emilio_sees_other_operators(self):
        self.enroll('Visible', creator=self.other)
        self.enroll('Private')
        Player.objects.create(team=self.team, full_name='Legacy private')
        self.client.force_authenticate(self.other)
        body = self.client.get(URL).json()
        self.assertEqual([p['name'] for p in body['results']], ['Visible'])
        self.client.force_authenticate(self.emilio)
        self.assertEqual(self.client.get(URL).json()['count'], 2)
        self.assertEqual(self.client.get(URL, {'source': 'legacy'}).json()['count'], 1)

    def test_legacy_without_birth_is_separate_and_has_no_sensitive_fields(self):
        self.enroll()
        Player.objects.create(team=self.team, full_name='José Pérez López', phone='5512345678')
        body = self.client.get(URL).json()
        self.assertEqual(body['totals']['legacy'], 1)
        self.assertEqual(body['count'], 1)
        legacy = self.client.get(URL, {'source': 'legacy'}).json()
        self.assertEqual(legacy['count'], 1)
        self.assertTrue(legacy['results'][0]['legacy'])
        for row in body['results']:
            self.assertNotIn('phone', row)
            self.assertNotIn('documents', row)
            self.assertNotIn('terms_text', row)

    def test_blacklist_marks_memberships_inactive_without_erasing_history(self):
        self.enroll()
        PlayerBlacklistEntry.objects.create(player_name='José Pérez López', birth_date=date(2000, 1, 2),
            identity_key=identity_key('José Pérez López', date(2000, 1, 2)), origin_site='Uno', origin_tournament='Liga',
            origin_team='Paris', offense_label='Test', reason='Test', created_by=self.emilio,
            request_id='b3db082a-a67f-40ec-9f42-f4eb3dd30c7b')
        row = self.client.get(URL).json()['results'][0]
        self.assertFalse(row['is_active'])
        self.assertEqual(row['participations'][0]['status'], 'Lista negra')

    def test_pagination_validation_cache_and_query_count(self):
        for i in range(27): self.enroll('Jugador %02d' % i)
        with self.assertNumQueries(3):
            response = self.client.get(URL)
        self.assertEqual(len(response.json()['results']), 25)
        self.assertEqual(response['Cache-Control'], 'no-store')
        last = self.client.get(URL, {'page': 999}).json()
        self.assertEqual(last['page'], 2)
        self.assertEqual(len(last['results']), 2)
        self.assertEqual(self.client.get(URL, {'page': 'bad'}).status_code, 400)
        self.assertEqual(self.client.get(URL, {'status': 'bad'}).status_code, 400)
        self.assertEqual(self.client.get(URL, {'source': 'bad'}).status_code, 400)

    def test_endpoint_is_private_and_read_only(self):
        self.assertEqual(self.client.post(URL, {}).status_code, 405)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(URL).status_code, (401, 403))
        user = User.objects.create_user(username='unrelated', role='collaborator')
        self.client.force_authenticate(user)
        self.assertEqual(self.client.get(URL).status_code, 403)
