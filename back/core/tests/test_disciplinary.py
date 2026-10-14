from datetime import date,timedelta
from uuid import uuid4
from unittest.mock import patch
from django.test import TestCase,override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User,Site,Tournament,Team,PlayerSanction,PlayerBlacklistEntry
from core.enrollment_models import PlayerEnrollment,PlayerEnrollmentInvitation
from core.services.player_blacklist import identity_key,assert_not_blacklisted
from core.tests.test_player_enrollments import image_file

@override_settings(ALLOWED_HOSTS=['testserver'],MIGRATION_MODULES={'core':None})
class DisciplinaryTests(TestCase):
    def setUp(self):
        self.client=APIClient();self.user=User.objects.create_user(username='emilio',role='collaborator',section_permissions=['player_enrollments_only'])
        self.client.force_authenticate(self.user)
        self.site=Site.objects.create(name='Sede uno',code='disc-one');self.other=Site.objects.create(name='Sede dos',code='disc-two')
        self.tournament=Tournament.objects.create(site=self.site,name='Torneo original')
        self.team=Team.objects.create(tournament=self.tournament,name='Equipo original')
        self.invitation=PlayerEnrollmentInvitation.objects.create(created_by=self.user,team_record=self.team,expires_at=timezone.now()+timedelta(days=30))
        self.enrollment=PlayerEnrollment.objects.create(invitation=self.invitation,team_record=self.team,name='José Luis Pérez Orduña',birth_date=date(1990,1,1),team=self.team.name,tournament=self.tournament.name)
        self.sanction=PlayerSanction.objects.create(team=self.team,enrollment=self.enrollment,player_name=self.enrollment.name,
            offense_code='s05',offense_label='Agresión a un contrario',recommended_duration='De 4 semanas a baja definitiva',
            reason='Incidente grave documentado',incident_on=timezone.localdate(),starts_on=timezone.localdate(),ends_on=None,duration_unit='indefinite',created_by=self.user,request_id=uuid4())
        self.blacklist='/api/player-enrollments/blacklist/'

    def add_payload(self):
        return {'sanction_id':self.sanction.pk,'player_name':self.enrollment.name,'birth_date':'1990-01-01','reason':'Exclusión permanente acordada por administración por agresión grave.','confirmed':True,'request_id':str(uuid4())}

    def test_commission_filters_and_status_and_coordinator_scope(self):
        url='/api/player-enrollments/disciplinary/'
        data=self.client.get(url).json();self.assertEqual(data['count'],1);self.assertTrue(data['can_manage_blacklist'])
        self.assertEqual(self.client.get(url+'?status=active&search=José').json()['count'],1)
        self.assertEqual(self.client.get(url+'?status=expired').json()['count'],0)
        self.assertEqual(self.client.get(url+'?site=Sede dos').json()['count'],0)
        self.assertEqual(self.client.get(url+'?date_from=wrong').status_code,400)
        user=User.objects.create_user(username='coordinator-disc',role='site_coordinator',primary_site=self.other)
        self.client.force_authenticate(user);self.assertEqual(self.client.get(url).json()['count'],0)

    def test_global_exclusion_is_explicit_idempotent_and_filters_active_roster(self):
        self.assertFalse(PlayerBlacklistEntry.objects.exists())
        payload=self.add_payload();payload['confirmed']=False
        self.assertEqual(self.client.post(self.blacklist,payload,format='json').status_code,400)
        payload['confirmed']=True
        response=self.client.post(self.blacklist,payload,format='json');self.assertEqual(response.status_code,201,response.data)
        self.assertEqual(self.client.post(self.blacklist,payload,format='json').status_code,200)
        self.assertEqual(PlayerBlacklistEntry.objects.count(),1)
        self.assertEqual(self.client.get('/api/player-enrollments/?active_only=true').json()['count'],0)
        self.assertEqual(self.client.get('/api/player-enrollments/').json()['count'],1)
        self.assertEqual(self.client.get(self.blacklist+'?status=active').json()['count'],1)
        self.assertEqual(self.client.get(self.blacklist+'?status=revoked').json()['count'],0)

    def test_name_normalization_and_birthdate_matching_across_sites_before_any_upload(self):
        self.client.post(self.blacklist,self.add_payload(),format='json')
        self.assertEqual(identity_key(' JOSE  LUIS PEREZ ORDUNA ',date(1990,1,1)),identity_key(self.enrollment.name,date(1990,1,1)))
        tournament=Tournament.objects.create(site=self.other,name='Torneo nuevo');team=Team.objects.create(tournament=tournament,name='Equipo nuevo')
        invitation=PlayerEnrollmentInvitation.objects.create(created_by=self.user,team_record=team,expires_at=timezone.now()+timedelta(days=30))
        url=f'/api/player-enrollments/public/{invitation.token}/'
        data={'given_names':'JOSE LUIS','paternal_surname':'PEREZ','maternal_surname':'ORDUNA','birth_date':'1990-01-01','identity_type':'ine','phone':'5512345678','accepted_terms':True}
        self.client.force_authenticate(None)
        with patch('core.api.enrollments.enrollment_storage.upload_document') as upload:
            response=self.client.post(url,data,format='multipart');self.assertEqual(response.status_code,400)
            upload.assert_not_called();self.assertNotIn('agresión',str(response.data).lower())
            data['birth_date']='1990-01-02';data.update(player_photo=image_file('foto.png'),player_signature=image_file('firma.png'),ine_front=image_file('ine.png'),ine_back=image_file('reverso.png'))
            self.assertEqual(self.client.post(url,data,format='multipart').status_code,201)

    def test_blacklist_survives_source_deletion(self):
        self.client.post(self.blacklist,self.add_payload(),format='json')
        self.sanction.delete();self.enrollment.delete();self.invitation.delete();self.team.delete();self.tournament.delete()
        row=PlayerBlacklistEntry.objects.get();self.assertIsNone(row.source_sanction_id)
        self.assertEqual(row.origin_tournament,'Torneo original')
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):assert_not_blacklisted(row.player_name,row.birth_date)

    def test_revocation_keeps_audit_and_restores_eligibility(self):
        self.client.post(self.blacklist,self.add_payload(),format='json');row=PlayerBlacklistEntry.objects.get()
        url=self.blacklist+f'{row.pk}/revoke/'
        self.assertEqual(self.client.post(url,{'reason':'Corrección de identidad verificada','confirmed':False},format='json').status_code,400)
        self.assertEqual(self.client.post(url,{'reason':'Corrección de identidad verificada','confirmed':True},format='json').status_code,200)
        row.refresh_from_db();self.assertFalse(row.is_active);self.assertEqual(row.revoked_by,self.user);self.assertTrue(row.revocation_reason)
        self.assertEqual(self.client.get('/api/player-enrollments/?active_only=true').json()['count'],1)
        assert_not_blacklisted(row.player_name,row.birth_date)

    def test_coordinator_can_consult_global_blacklist_but_not_apply_or_revoke(self):
        self.client.post(self.blacklist,self.add_payload(),format='json');row=PlayerBlacklistEntry.objects.get()
        user=User.objects.create_user(username='coordinator-other-disc',role='site_coordinator',primary_site=self.other)
        self.client.force_authenticate(user)
        self.assertEqual(self.client.get(self.blacklist).json()['count'],1)
        self.assertFalse(self.client.get(self.blacklist).json()['can_manage_blacklist'])
        self.assertEqual(self.client.post(self.blacklist,self.add_payload(),format='json').status_code,403)
        self.assertEqual(self.client.post(self.blacklist+f'{row.pk}/revoke/',{'confirmed':True,'reason':'No autorizado'},format='json').status_code,403)

    def test_migration_backfills_normalized_identity(self):
        import importlib
        from django.apps import apps
        from types import SimpleNamespace
        PlayerEnrollment.objects.filter(pk=self.enrollment.pk).update(identity_key='')
        module=importlib.import_module('core.migrations.0066_disciplinary_blacklist')
        module.initialize_and_protect(apps,SimpleNamespace(connection=SimpleNamespace(alias='default',vendor='sqlite')))
        self.enrollment.refresh_from_db();self.assertEqual(self.enrollment.identity_key,identity_key(self.enrollment.name,self.enrollment.birth_date))

    def test_exclusion_added_during_upload_is_checked_again_and_cleans_files(self):
        tournament=Tournament.objects.create(site=self.other,name='Torneo carrera');team=Team.objects.create(tournament=tournament,name='Equipo carrera')
        invitation=PlayerEnrollmentInvitation.objects.create(created_by=self.user,team_record=team,expires_at=timezone.now()+timedelta(days=30))
        url=f'/api/player-enrollments/public/{invitation.token}/'
        data={'given_names':'José Luis','paternal_surname':'Pérez','maternal_surname':'Orduña','birth_date':'1990-01-01','identity_type':'ine','phone':'5512345678','accepted_terms':True,
              'player_photo':image_file('foto.png'),'player_signature':image_file('firma.png'),'ine_front':image_file('ine.png'),'ine_back':image_file('reverso.png')}
        saved={}
        def upload(path,content,mime):
            saved[path]=content
            if not PlayerBlacklistEntry.objects.exists():
                PlayerBlacklistEntry.objects.create(player_name=self.enrollment.name,birth_date=self.enrollment.birth_date,identity_key=self.enrollment.identity_key,
                    origin_site=self.site.name,origin_tournament=self.tournament.name,origin_team=self.team.name,offense_label='Agresión',reason='Exclusión global de prueba',created_by=self.user,request_id=uuid4())
        self.client.force_authenticate(None)
        with patch('core.api.enrollments.enrollment_storage.upload_document',side_effect=upload),patch('core.api.enrollments.enrollment_storage.delete_document',side_effect=lambda path:saved.pop(path,None)):
            self.assertEqual(self.client.post(url,data,format='multipart').status_code,400)
        self.assertEqual(saved,{})
        self.assertFalse(PlayerEnrollment.objects.filter(invitation=invitation).exists())
