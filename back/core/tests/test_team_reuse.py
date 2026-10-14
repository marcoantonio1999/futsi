from unittest.mock import patch
from django.test import TestCase, override_settings
from django.db import IntegrityError
from rest_framework.test import APIClient
from core.models import User, Site, Tournament, Team
from core.enrollment_models import PlayerEnrollment

@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core': None})
class TeamReuseTests(TestCase):
    def setUp(self):
        self.client=APIClient()
        self.user=User.objects.create_user(username='emilio',role='collaborator',section_permissions=['player_enrollments_only'])
        self.client.force_authenticate(self.user)
        self.site=Site.objects.create(name='Sede',code='reuse')
        self.old=Tournament.objects.create(site=self.site,name='Terminado',is_active=False)
        self.new=Tournament.objects.create(site=self.site,name='Nuevo',football_format='fut6')
        self.a=Team.objects.create(tournament=self.old,name='Halcones',representative_name='José Pérez Orduña',representative_phone='5512345678',is_active=False,representative_user=self.user)
        self.b=Team.objects.create(tournament=self.old,name='Águilas',representative_name='Otro delegado')
        self.url='/api/player-enrollments/reuse-teams/'

    def payload(self, ids=None):
        return {'target_id':self.new.pk,'team_ids':ids if ids is not None else [self.a.pk,self.b.pk]}

    def test_copies_teams_from_finished_tournament_without_players_or_access(self):
        listing=self.client.get(self.url).json()
        self.assertEqual(listing['count'],2)
        self.assertNotIn('representative_phone',str(listing))
        result=self.client.post(self.url,self.payload(),format='json')
        self.assertEqual(result.status_code,201,result.data)
        self.assertEqual(len(result.data['created']),2)
        copied=Team.objects.get(tournament=self.new,name='Halcones')
        self.assertEqual(copied.representative_name,self.a.representative_name)
        self.assertTrue(copied.is_active)
        self.assertIsNone(copied.representative_user_id)
        self.assertFalse(copied.players.exists())
        self.assertFalse(PlayerEnrollment.objects.filter(team_record=copied).exists())
        self.a.refresh_from_db(); self.assertEqual(self.a.tournament_id,self.old.pk); self.assertFalse(self.a.is_active)

    def test_retry_skips_existing_names_including_case_without_overwriting(self):
        self.client.post(self.url,self.payload(),format='json')
        repeated=self.client.post(self.url,self.payload(),format='json')
        self.assertEqual(repeated.status_code,201)
        self.assertEqual(len(repeated.data['created']),0)
        self.assertEqual(len(repeated.data['skipped']),2)
        self.assertEqual(Team.objects.filter(tournament=self.new).count(),2)

    def test_invalid_selection_and_partial_failure_create_nothing(self):
        self.assertEqual(self.client.post(self.url,self.payload([self.a.pk,99999]),format='json').status_code,400)
        self.assertEqual(self.client.post(self.url,self.payload([self.a.pk,self.a.pk]),format='json').status_code,400)
        create=Team.objects.create
        def fail_second(**kwargs):
            if kwargs['name']=='Águilas': raise IntegrityError('simulated')
            return create(**kwargs)
        with patch.object(Team.objects,'create',side_effect=fail_second):
            self.assertEqual(self.client.post(self.url,self.payload(),format='json').status_code,400)
        self.assertFalse(Team.objects.filter(tournament=self.new).exists())

    def test_permissions_and_inactive_destination(self):
        self.new.is_active=False;self.new.save()
        self.assertEqual(self.client.post(self.url,self.payload(),format='json').status_code,404)
        coach=User.objects.create_user(username='coach-reuse',role='coach')
        self.client.force_authenticate(coach)
        self.assertEqual(self.client.get(self.url).status_code,403)
        self.assertEqual(self.client.post(self.url,self.payload(),format='json').status_code,403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code,(401,403))

    def test_same_team_name_from_two_origins_is_rejected(self):
        other=Tournament.objects.create(site=self.site,name='Otro')
        duplicate=Team.objects.create(tournament=other,name='HALCONES')
        self.assertEqual(self.client.post(self.url,self.payload([self.a.pk,duplicate.pk]),format='json').status_code,400)
        self.assertFalse(Team.objects.filter(tournament=self.new).exists())

    def test_cashier_cannot_copy_from_or_to_other_sites(self):
        other_site=Site.objects.create(name='Sede externa',code='reuse-other')
        outside=Tournament.objects.create(site=other_site,name='Externo')
        outside_team=Team.objects.create(tournament=outside,name='Fuera')
        cashier=User.objects.create_user(username='cashier-reuse',role='cashier',primary_site=self.site)
        self.client.force_authenticate(cashier)
        self.assertEqual(self.client.get(self.url).json()['count'],2)
        self.assertEqual(self.client.post(self.url,self.payload([outside_team.pk]),format='json').status_code,400)
        self.assertEqual(self.client.post(self.url,{'target_id':outside.pk,'team_ids':[self.a.pk]},format='json').status_code,404)

    def test_existing_case_variant_is_not_overwritten(self):
        original=Team.objects.create(tournament=self.new,name='HALCONES',representative_name='Delegado actual')
        response=self.client.post(self.url,self.payload([self.a.pk]),format='json')
        self.assertEqual(response.status_code,201)
        self.assertEqual(response.data['created'],[])
        original.refresh_from_db();self.assertEqual(original.representative_name,'Delegado actual')
