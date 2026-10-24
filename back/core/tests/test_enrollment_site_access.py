from datetime import date, timedelta
from hashlib import sha256
from uuid import uuid4
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient
from core.models import User, Site, Tournament, Team, PlayerSanction, PlayerBlacklistEntry
from core.enrollment_models import PlayerEnrollment, PlayerEnrollmentInvitation, PlayerEnrollmentDocument
from core.enrollment_access import enrollment_site_ids


@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core': None})
class EnrollmentSiteAccessTests(TestCase):
    def setUp(self):
        self.creator = User.objects.create_user(username='emilio', role='collaborator', section_permissions=['player_enrollments_only'])
        self.sites = [Site.objects.create(name=name, code=str(i)) for i, name in enumerate(['Franco', 'Tecamachalco', 'Otra sede'])]
        self.operator = User.objects.create_user(username='scoped', role='collaborator', primary_site=self.sites[0], section_permissions=['player_enrollments_only', f'player_enrollments_site:{self.sites[0].pk}'])
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Token ' + Token.objects.create(user=self.operator).key)
        self.teams, self.rows, self.docs, self.sanctions, self.blacklist = [], [], [], [], []
        for i, site in enumerate(self.sites):
            tournament = Tournament.objects.create(site=site, name=f'Torneo {i}', football_format='fut6')
            team = Team.objects.create(tournament=tournament, name=f'Equipo {i}')
            invitation = PlayerEnrollmentInvitation.objects.create(created_by=self.creator, team_record=team, team=team.name, tournament=tournament.name, expires_at=timezone.now()+timedelta(days=1))
            row = PlayerEnrollment.objects.create(invitation=invitation, team_record=team, team=team.name, tournament=tournament.name, name=f'Jugador Prueba Apellido {i}', birth_date=date(2000,1,1), is_delegate=True)
            doc = PlayerEnrollmentDocument.objects.create(enrollment=row, kind='player_photo', content=b'photo', content_type='image/png', sha256=sha256(b'photo').hexdigest())
            sanction = PlayerSanction.objects.create(team=team, enrollment=row, player_name=row.name, offense_code='s05', offense_label='Incidente', reason='Registro de prueba', incident_on=timezone.localdate(), starts_on=timezone.localdate(), ends_on=None, duration_unit='indefinite', created_by=self.creator, request_id=uuid4())
            blacklist = PlayerBlacklistEntry.objects.create(source_sanction=sanction, player_name=row.name, birth_date=row.birth_date, identity_key=str(i)*64, origin_site=site.name, origin_tournament=tournament.name, origin_team=team.name, offense_label='Incidente', reason='Registro de prueba', created_by=self.creator, request_id=uuid4())
            self.teams.append(team); self.rows.append(row); self.docs.append(doc); self.sanctions.append(sanction); self.blacklist.append(blacklist)

    def test_catalog_and_records_are_site_scoped_even_when_created_by_emilio(self):
        catalog = self.client.get('/api/player-enrollments/catalog/').json()
        self.assertEqual([site['id'] for site in catalog['sites']], [self.sites[0].pk])
        self.assertEqual([team['id'] for team in catalog['teams']], [self.teams[0].pk])
        rows = self.client.get('/api/player-enrollments/').json()
        self.assertEqual([row['id'] for row in rows['results']], [self.rows[0].pk])
        self.assertEqual(self.client.get(f'/api/player-enrollments/?team_id={self.teams[1].pk}').json()['count'], 0)
        self.assertEqual(self.client.get('/api/player-enrollments/players/').json()['count'], 1)

    def test_private_documents_and_signed_sheet_cannot_cross_sites(self):
        self.assertEqual(self.client.get(f'/api/player-enrollments/documents/{self.docs[0].pk}/').status_code, 200)
        self.assertEqual(self.client.get(f'/api/player-enrollments/documents/{self.docs[1].pk}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/player-enrollments/?enrollment_id={self.rows[1].pk}').json()['count'], 0)

    def test_outside_invitation_tournament_and_delegate_writes_are_denied(self):
        team = self.teams[1]
        self.assertEqual(self.client.post('/api/player-enrollments/', {'team_id':team.pk,'tournament_id':team.tournament_id}, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/player-enrollments/catalog/', {'kind':'team','tournament':team.tournament_id,'name':'Prohibido'}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'/api/player-enrollments/teams/{team.pk}/delegate/', {'enrollment_id':self.rows[1].pk}, format='json').status_code, 404)
        self.assertFalse(Team.objects.filter(name='Prohibido').exists())

    def test_reuse_sources_and_targets_remain_scoped(self):
        url = '/api/player-enrollments/reuse-teams/'
        self.assertEqual([row['id'] for row in self.client.get(url).json()['results']], [self.teams[0].pk])
        self.assertEqual(self.client.post(url, {'target_id':self.teams[1].tournament_id,'team_ids':[self.teams[0].pk]},format='json').status_code,404)
        self.assertEqual(self.client.post(url, {'target_id':self.teams[0].tournament_id,'team_ids':[self.teams[1].pk]},format='json').status_code,400)

    def test_commission_blacklist_photos_and_appeals_remain_scoped(self):
        for path, expected in [('disciplinary',self.sanctions[0].pk),('blacklist',self.blacklist[0].pk)]:
            listing = self.client.get(f'/api/player-enrollments/{path}/').json()
            self.assertEqual([row['id'] for row in listing['results']], [expected])
            self.assertFalse(listing['can_manage_blacklist'])
        for path in [f'disciplinary/{self.sanctions[1].pk}/photo/', f'blacklist/{self.blacklist[1].pk}/photo/', f'sanctions/{self.sanctions[1].pk}/appeal/', f'sanctions/?team_id={self.teams[1].pk}']:
            self.assertEqual(self.client.get('/api/player-enrollments/'+path).status_code,404)
        self.assertEqual(self.client.post(f'/api/player-enrollments/sanctions/{self.sanctions[0].pk}/decision/',{'action':'payment','folio':'No'},format='json').status_code,403)

    def test_other_modules_are_blocked_by_token_authentication(self):
        for path in ['/api/users/','/api/sites/','/api/tournaments/','/api/exams/']:
            self.assertIn(self.client.get(path).status_code, [403,404])

    def test_multiple_sites_and_invalid_grants_fail_closed(self):
        self.operator.section_permissions += [f'player_enrollments_site:{self.sites[1].pk}']
        self.operator.save()
        from django.core.cache import cache
        cache.clear()
        self.assertEqual(self.client.get('/api/player-enrollments/').json()['count'],2)
        self.operator.section_permissions = ['player_enrollments_only','player_enrollments_site:invalid']
        self.operator.save(); cache.clear()
        self.assertEqual(enrollment_site_ids(self.operator), set())
        self.assertEqual(self.client.get('/api/player-enrollments/catalog/').json()['sites'],[])
        self.assertEqual(self.client.get('/api/player-enrollments/').json()['count'],0)

    def test_existing_global_operator_scope_is_preserved(self):
        self.client.force_authenticate(self.creator)
        self.assertIsNone(enrollment_site_ids(self.creator))
        self.assertEqual(self.client.get('/api/player-enrollments/').json()['count'],3)
        self.assertEqual(len(self.client.get('/api/player-enrollments/catalog/').json()['sites']),3)
