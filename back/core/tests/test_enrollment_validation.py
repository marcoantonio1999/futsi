from datetime import date,timedelta
from django.test import TestCase,override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User,Site,Tournament,Team
from core.enrollment_models import PlayerEnrollmentInvitation,PlayerEnrollment,PlayerEnrollmentDocument

@override_settings(ALLOWED_HOSTS=['testserver'],MIGRATION_MODULES={'core':None})
class EnrollmentValidationTests(TestCase):
 def setUp(self):
  self.user=User.objects.create_user(username='reviewer',role='collaborator',section_permissions=['player_enrollments_only'])
  self.other=User.objects.create_user(username='outsider',role='collaborator',section_permissions=['player_enrollments_only'])
  site=Site.objects.create(name='Sede',code='validation')
  tournament=Tournament.objects.create(site=site,name='Torneo',billing_type='weekly_match')
  self.team=Team.objects.create(name='Equipo',tournament=tournament)
  invitation=PlayerEnrollmentInvitation.objects.create(created_by=self.user,expires_at=timezone.now()+timedelta(days=1),team_record=self.team)
  self.row=PlayerEnrollment.objects.create(invitation=invitation,name='Persona Prueba Apellido',birth_date=date(1990,1,1),team_record=self.team,identity_type='ine',terms_text=[],terms_version='test')
  self.docs=[PlayerEnrollmentDocument.objects.create(enrollment=self.row,kind=k,content=b'test',content_type='image/png',sha256='a'*64) for k in ('player_photo','ine_front','ine_back','player_signature')]
  self.client=APIClient();self.client.force_authenticate(self.user)
  self.url=f'/api/player-enrollments/{self.row.pk}/validate/'
 def approve(self,**kwargs):
  return self.client.post(self.url,dict(confirmed=True,documents_reviewed=[d.pk for d in self.docs],**kwargs),format='json')
 def test_pending_existing_enrollment_hidden_until_staff_validation(self):
  self.assertEqual(self.client.get('/api/player-enrollments/?active_only=true').data['count'],0)
  self.assertEqual(self.client.get('/api/player-enrollments/?pending_validation=true').data['count'],1)
  self.assertEqual(self.client.get('/api/player-enrollments/?validation_count_only=true').data['pending_validation_count'],1)
  self.assertEqual(self.approve().status_code,200)
  self.row.refresh_from_db();self.assertEqual(self.row.validated_by,self.user);self.assertIsNotNone(self.row.validated_at)
  self.assertEqual(self.client.get('/api/player-enrollments/?active_only=true').data['count'],1)
  self.assertEqual(self.client.get('/api/player-enrollments/?pending_validation=true').data['count'],0)
  self.assertEqual(self.client.get('/api/player-enrollments/?validation_count_only=true').data['pending_validation_count'],0)
 def test_validation_is_idempotent_and_preserves_original_author(self):
  self.approve();self.row.refresh_from_db();stamp=self.row.validated_at
  self.approve();self.row.refresh_from_db();self.assertEqual(self.row.validated_at,stamp)
 def test_missing_required_document_cannot_be_approved(self):
  self.docs[-1].delete();self.assertEqual(self.approve().status_code,400);self.row.refresh_from_db();self.assertIsNone(self.row.validated_at)
 def test_every_document_must_be_reviewed_and_confirmation_required(self):
  for body in ({'confirmed':True,'documents_reviewed':[self.docs[0].pk]},{'confirmed':False,'documents_reviewed':[d.pk for d in self.docs]},{'confirmed':True,'documents_reviewed':[999999]}):
   self.assertEqual(self.client.post(self.url,body,format='json').status_code,400)
 def test_other_operator_and_public_cannot_validate_or_count(self):
  self.client.force_authenticate(self.other);self.assertEqual(self.approve().status_code,404)
  self.assertEqual(self.client.get('/api/player-enrollments/?validation_count_only=true').data['pending_validation_count'],0)
  self.client.force_authenticate(None);self.assertIn(self.approve().status_code,[401,403])
 def test_withdrawn_or_inactive_enrollments_cannot_be_validated(self):
  self.row.withdrawn_at=timezone.now();self.row.save();self.assertEqual(self.approve().status_code,400)
  self.row.withdrawn_at=None;self.row.save();self.team.is_active=False;self.team.save();self.assertEqual(self.approve().status_code,400)
 def test_minor_requires_guardian_documents(self):
  self.row.birth_date=date(2015,1,1);self.row.save();self.assertEqual(self.approve().status_code,400)

 def test_catalog_count_matches_roster_and_changes_after_validation_or_withdrawal(self):
  def count():
   teams=self.client.get('/api/player-enrollments/catalog/').data['teams']
   return next(team['validated_player_count'] for team in teams if team['id']==self.team.pk)
  self.assertEqual(count(),0)
  self.assertEqual(self.approve().status_code,200)
  self.assertEqual(count(),1)
  self.assertEqual(count(),self.client.get('/api/player-enrollments/?active_only=true').data['count'])
  self.client.force_authenticate(self.other)
  self.assertEqual(count(),0)
  self.client.force_authenticate(self.user)
  self.row.withdrawn_at=timezone.now();self.row.save()
  self.assertEqual(count(),0)

 def test_minor_validation_accepts_one_child_document_and_only_guardian_signature(self):
  self.row.birth_date=date(2015,1,1);self.row.identity_type='minor';self.row.guardian_name='Tutor';self.row.save()
  self.row.documents.all().delete()
  self.docs=[PlayerEnrollmentDocument.objects.create(enrollment=self.row,kind=k,content=b'test',content_type='image/png',sha256='a'*64) for k in ('player_photo','minor_credential','guardian_ine_front','guardian_ine_back','guardian_signature')]
  self.assertEqual(self.approve().status_code,200)
  self.assertFalse(self.row.documents.filter(kind__in=['curp','player_signature']).exists())
