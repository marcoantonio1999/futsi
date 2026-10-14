from datetime import date, timedelta
from uuid import uuid4
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User, Site, Tournament, Team, Player, PlayerSanction
from core.enrollment_models import PlayerEnrollment, PlayerEnrollmentInvitation
from core.sanction_catalog import CATALOG
from core.api.sanctions import calculate_end

@override_settings(ALLOWED_HOSTS=['testserver'],MIGRATION_MODULES={'core':None})
class PlayerSanctionTests(TestCase):
    def setUp(self):
        self.client=APIClient()
        self.user=User.objects.create_user(username='emilio',role='collaborator',section_permissions=['player_enrollments_only'])
        self.client.force_authenticate(self.user)
        self.site=Site.objects.create(name='Cancha',code='sanction')
        self.tournament=Tournament.objects.create(site=self.site,name='Torneo')
        self.team=Team.objects.create(tournament=self.tournament,name='Equipo')
        invitation=PlayerEnrollmentInvitation.objects.create(created_by=self.user,team_record=self.team,expires_at=timezone.now()+timedelta(days=30))
        self.enrollment=PlayerEnrollment.objects.create(invitation=invitation,team_record=self.team,name='José Luis Pérez Orduña',birth_date=date(1990,1,1),team=self.team.name,tournament=self.tournament.name)
        self.player=Player.objects.create(team=self.team,full_name='Jugador de plantilla')
        self.url='/api/player-enrollments/sanctions/'

    def payload(self,**changes):
        data={'team_id':self.team.pk,'member_type':'enrollment','member_id':self.enrollment.pk,'offense_code':'s01',
            'reason':'Decisión del coordinador después de revisar el incidente.', 'incident_on':str(timezone.localdate()),
            'starts_on':str(timezone.localdate()),'duration_unit':'days','duration_value':1,'request_id':str(uuid4())}
        data.update(changes);return data

    def test_catalog_has_all_groups_and_both_player_sources(self):
        response=self.client.get(self.url+f'?team_id={self.team.pk}')
        self.assertEqual(response.status_code,200)
        self.assertEqual(len(set(row['group'] for row in response.data['catalog'])),8)
        self.assertEqual(len(response.data['members']),2)
        self.assertEqual({row['type'] for row in response.data['members']},{'enrollment','player'})
        self.assertNotIn('phone',str(response.data))

    def test_recommended_range_never_constrains_coordinator_and_does_not_withdraw(self):
        payload=self.payload()
        response=self.client.post(self.url,payload,format='json')
        self.assertEqual(response.status_code,201,response.data)
        row=PlayerSanction.objects.get()
        self.assertEqual(row.duration_value,1)
        self.assertEqual(row.recommended_duration,'De 3 semanas a 2 meses')
        self.assertEqual(row.ends_on,row.starts_on)
        self.assertEqual(row.created_by,self.user)
        self.enrollment.refresh_from_db();self.assertIsNone(self.enrollment.withdrawn_at)
        self.team.refresh_from_db();self.assertTrue(self.team.is_active)
        self.assertEqual(self.client.post(self.url,payload,format='json').status_code,200)
        self.assertEqual(PlayerSanction.objects.count(),1)

    def test_months_years_and_custom_periods(self):
        self.assertEqual(calculate_end(date(2026,10,14),'weeks',2),date(2026,10,27))
        self.assertEqual(calculate_end(date(2026,10,14),'months',1),date(2026,11,13))
        self.assertEqual(calculate_end(date(2024,2,29),'years',1),date(2025,2,27))
        response=self.client.post(self.url,self.payload(duration_unit='dates',ends_on=str(timezone.localdate()+timedelta(days=4))),format='json')
        self.assertEqual(response.status_code,201)
        self.assertIsNone(PlayerSanction.objects.get().duration_value)

    def test_indefinite_can_be_selected_even_for_short_recommendation(self):
        response=self.client.post(self.url,self.payload(member_type='player',member_id=self.player.pk,offense_code=CATALOG[-1]['code'],duration_unit='indefinite'),format='json')
        self.assertEqual(response.status_code,201)
        self.assertIsNone(PlayerSanction.objects.get().ends_on)
        self.assertEqual(PlayerSanction.objects.get().player,self.player)

    def test_invalid_dates_empty_reason_or_unknown_offense_are_rejected(self):
        for changes in [{'duration_value':0},{'reason':' '},{'offense_code':'not-valid'},
                        {'incident_on':str(timezone.localdate()+timedelta(days=1))},
                        {'duration_unit':'dates','ends_on':str(timezone.localdate()-timedelta(days=1))}]:
            self.assertEqual(self.client.post(self.url,self.payload(**changes),format='json').status_code,400)
        self.assertFalse(PlayerSanction.objects.exists())

    def test_foreign_or_withdrawn_member_is_rejected_and_coordinator_is_site_scoped(self):
        other_site=Site.objects.create(name='Otra',code='sanction-other')
        other_tournament=Tournament.objects.create(site=other_site,name='Otro torneo')
        other_team=Team.objects.create(tournament=other_tournament,name='Otro equipo')
        self.assertEqual(self.client.post(self.url,self.payload(team_id=other_team.pk),format='json').status_code,404)
        coordinator=User.objects.create_user(username='coordinator-sanction',role='site_coordinator',primary_site=self.site)
        self.client.force_authenticate(coordinator)
        self.assertEqual(self.client.get(self.url+f'?team_id={other_team.pk}').status_code,404)
        self.enrollment.withdrawn_at=timezone.now();self.enrollment.save()
        self.assertEqual(self.client.post(self.url,self.payload(),format='json').status_code,404)
        self.assertFalse(PlayerSanction.objects.exists())

    def test_unknown_request_role_or_anonymous_cannot_apply_sanctions(self):
        for role in ('coach','cashier','collaborator'):
            user=User.objects.create_user(username='sanction-'+role,role=role)
            self.client.force_authenticate(user)
            self.assertEqual(self.client.post(self.url,self.payload(),format='json').status_code,403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.post(self.url,self.payload(),format='json').status_code,(401,403))

    def test_retry_cannot_change_original_decision_or_spoof_actor(self):
        payload=self.payload(created_by=999999)
        self.assertEqual(self.client.post(self.url,payload,format='json').status_code,201)
        payload['duration_value']=2
        self.assertEqual(self.client.post(self.url,payload,format='json').status_code,400)
        self.assertEqual(PlayerSanction.objects.count(),1)
        row=PlayerSanction.objects.get();self.assertEqual(row.duration_value,1);self.assertEqual(row.created_by,self.user)

    def test_tournament_delete_preview_includes_sanctions(self):
        self.client.post(self.url,self.payload(),format='json')
        from core.services.tournament_deletion import deletion_plan
        plan=deletion_plan(self.tournament)
        group=next(row for row in plan['groups'] if row['model'] is PlayerSanction)
        self.assertEqual(len(group['rows']),1)
