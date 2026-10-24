from datetime import date, timedelta
from django.test import TestCase, override_settings
from django.utils import timezone
from core.models import Tournament, Site
from core.enrollment_models import PlayerEnrollment, PlayerEnrollmentInvitation, PlayerEnrollmentDocument
from core.tests.test_enrollment_site_access import EnrollmentSiteAccessTests


@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core': None})
class EnrollmentTournamentEditingTests(TestCase):
    setUp = EnrollmentSiteAccessTests.setUp

    def url(self, index=0):
        return f'/api/player-enrollments/tournaments/{self.teams[index].tournament_id}/'

    def test_edit_configuration_preserves_ids_teams_signed_enrollments_and_documents(self):
        counts = [model.objects.count() for model in (PlayerEnrollment, PlayerEnrollmentInvitation, PlayerEnrollmentDocument)]
        response = self.client.patch(self.url(), {'name':'Nuevo nombre','starts_on':'2026-11-15','expected_weeks':24,'football_format':'fut7','billing_type':'full_tournament','is_active':False,'site':self.sites[0].pk},format='json')
        self.assertEqual(response.status_code,200,response.data)
        tournament=Tournament.objects.get(pk=self.teams[0].tournament_id)
        self.assertEqual(tournament.name,'Nuevo nombre')
        self.assertEqual(tournament.starts_on,date(2026,11,15))
        self.assertEqual(tournament.expected_weeks,24)
        self.assertEqual(tournament.football_format,'fut7')
        self.assertFalse(tournament.is_active)
        self.assertEqual(tournament.billing_type,'full_tournament')
        self.assertEqual(counts,[model.objects.count() for model in (PlayerEnrollment, PlayerEnrollmentInvitation, PlayerEnrollmentDocument)])
        self.rows[0].refresh_from_db()
        self.assertEqual(self.rows[0].team_record_id,self.teams[0].pk)
        catalog=self.client.get('/api/player-enrollments/catalog/').json()
        self.assertEqual(catalog['deletable_tournament_ids'],[])
        self.assertIn(tournament.pk,[row['id'] for row in catalog['tournaments']])
        self.assertEqual(self.client.patch(self.url(),{'is_active':True},format='json').status_code,200)

    def test_site_scoped_operator_cannot_read_edit_or_move_outside_their_site(self):
        self.assertEqual(self.client.get(self.url(1)).status_code,404)
        self.assertEqual(self.client.patch(self.url(1),{'name':'Prohibido'},format='json').status_code,404)
        self.assertEqual(self.client.patch(self.url(),{'site':self.sites[1].pk},format='json').status_code,403)
        self.assertEqual(self.client.delete(self.url(),format='json').status_code,403)

    def test_site_transfer_requires_empty_tournament_and_allowed_active_destination(self):
        self.client.force_authenticate(self.creator)
        self.assertEqual(self.client.patch(self.url(),{'site':self.sites[1].pk},format='json').status_code,400)
        empty=Tournament.objects.create(site=self.sites[0],name='Vacío',billing_type='weekly_match')
        url=f'/api/player-enrollments/tournaments/{empty.pk}/'
        self.assertEqual(self.client.patch(url,{'site':self.sites[1].pk},format='json').status_code,200)
        inactive=Site.objects.create(name='Inactiva',code='inactive-edit',is_active=False)
        self.assertEqual(self.client.patch(url,{'site':inactive.pk},format='json').status_code,403)

    def test_invalid_configuration_and_unknown_fields_do_not_write(self):
        old=Tournament.objects.get(pk=self.teams[0].tournament_id).name
        for data in [{'name':''},{'starts_on':'bad'},{'expected_weeks':0},{'football_format':'fut99'},{'billing_type':'unknown'},{'is_active':'invalid'},{'id':999},{'site':999999}]:
            with self.subTest(data=data):
                self.assertEqual(self.client.patch(self.url(),data,format='json').status_code,400)
        self.assertEqual(Tournament.objects.get(pk=self.teams[0].tournament_id).name,old)

    def test_existing_modality_capacity_validation_is_retained(self):
        team=self.teams[0]
        Tournament.objects.filter(pk=team.tournament_id).update(football_format='fut8')
        for i in range(12):
            invitation=PlayerEnrollmentInvitation.objects.create(created_by=self.creator,team_record=team,expires_at=timezone.now()+timedelta(days=1))
            PlayerEnrollment.objects.create(invitation=invitation,team_record=team,name=f'Persona Prueba {i}',birth_date=date(2000,1,1))
        response=self.client.patch(self.url(),{'football_format':'fut6'},format='json')
        self.assertEqual(response.status_code,400,response.data)
        self.assertEqual(Tournament.objects.get(pk=team.tournament_id).football_format,'fut8')
