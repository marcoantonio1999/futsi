from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4
from django.test import TestCase, override_settings
from django.utils import timezone
from core.models import User, PlayerSanction, PlayerBlacklistEntry
from core.tests import test_disciplinary
from core.tests.test_player_enrollments import image_file
from core.services.player_sanctions import unfulfilled_sanctions, assert_no_pending_sanction
from rest_framework.exceptions import ValidationError


@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core':None})
class SanctionAppealTests(TestCase):
    setUp = test_disciplinary.DisciplinaryTests.setUp

    def url(self, name='appeal'):
        return f'/api/player-enrollments/sanctions/{self.sanction.pk}/{name}/'

    def appeal(self):
        with patch('core.api.sanction_appeals.enrollment_storage.upload_document', side_effect=lambda path, content, mime: path):
            result=self.client.post(self.url(), {'reason':'Carta del jugador con sus motivos de apelación.','letter':image_file('carta.png')},format='multipart')
        self.assertEqual(result.status_code,201,result.data)
        self.sanction.refresh_from_db()

    def test_acceptance_does_not_remove_sanction_and_preserves_letter_and_actor(self):
        self.appeal()
        result=self.client.post(self.url('decision'),{'action':'accepted','reason':'Se revisó la carta y se acepta.'},format='json')
        self.assertEqual(result.status_code,200)
        self.sanction.refresh_from_db()
        self.assertEqual(self.sanction.appeal_status,'accepted')
        self.assertEqual(self.sanction.appeal_decided_by,self.user)
        self.assertTrue(self.sanction.appeal_letter_path)
        self.assertTrue(unfulfilled_sanctions().filter(pk=self.sanction.pk).exists())
        self.assertEqual(self.client.post(self.url('decision'),{'action':'rejected','reason':'Otra decisión'},format='json').status_code,400)

    def test_requires_both_inclusive_period_and_payment_even_without_an_appeal(self):
        today=timezone.localdate()
        self.sanction.ends_on=today;self.sanction.save()
        self.assertTrue(unfulfilled_sanctions().exists())
        response=self.client.post(self.url('decision'),{'action':'payment','folio':'F-2026-123'},format='json')
        self.assertEqual(response.status_code,200)
        self.assertTrue(unfulfilled_sanctions().exists())
        self.sanction.refresh_from_db()
        self.assertEqual(self.sanction.payment_recorded_by,self.user)
        self.sanction.starts_on=today-timedelta(days=2);self.sanction.ends_on=today-timedelta(days=1);self.sanction.save()
        self.assertFalse(unfulfilled_sanctions().exists())
        self.sanction.payment_folio='';self.sanction.save()
        self.assertTrue(unfulfilled_sanctions().exists())
        with self.assertRaises(ValidationError):assert_no_pending_sanction(self.enrollment.name,self.enrollment.birth_date)
        rows=self.client.get('/api/player-enrollments/disciplinary/?status=awaiting_payment').json()['results']
        self.assertEqual(rows[0]['status'],'awaiting_payment')

    def test_payment_never_lifts_indefinite_or_other_sanctions_or_blacklist(self):
        from core.services.player_blacklist import assert_not_blacklisted, identity_key
        PlayerBlacklistEntry.objects.create(player_name=self.enrollment.name,birth_date=self.enrollment.birth_date,
            identity_key=identity_key(self.enrollment.name,self.enrollment.birth_date),origin_site='Prueba',origin_tournament='Prueba',
            origin_team='Prueba',offense_label='Prueba',reason='Prueba de exclusión independiente',created_by=self.user,request_id=uuid4())
        self.client.post(self.url('decision'),{'action':'payment','folio':'INDEFINITE'},format='json')
        self.assertTrue(unfulfilled_sanctions().exists())
        with self.assertRaises(ValidationError):assert_not_blacklisted(self.enrollment.name,self.enrollment.birth_date)
        self.assertEqual(self.client.post(self.url('decision'),{'action':'payment','folio':'REPLACE'},format='json').status_code,400)
        self.assertEqual(self.client.post(self.url('decision'),{'action':'payment','folio':'INDEFINITE'},format='json').status_code,200)

    def test_site_scope_and_admin_only_decisions_and_private_letter(self):
        self.appeal()
        coordinator=User.objects.create_user(username='appeal-coordinator',role='site_coordinator',primary_site=self.other)
        self.client.force_authenticate(coordinator)
        self.assertEqual(self.client.get(self.url()).status_code,404)
        self.assertEqual(self.client.post(self.url('decision'),{'action':'payment','folio':'123'},format='json').status_code,403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url()).status_code,(401,403))

    def test_letter_required_invalid_files_rejected_and_duplicate_preserves_original(self):
        self.assertEqual(self.client.post(self.url(),{'reason':'Motivos de apelación'},format='multipart').status_code,400)
        self.appeal();original=self.sanction.appeal_letter_path
        with patch('core.api.sanction_appeals.enrollment_storage.upload_document', side_effect=lambda path, content, mime: path) as upload:
            self.assertEqual(self.client.post(self.url(),{'reason':'Nueva carta diferente','letter':image_file('carta.png')},format='multipart').status_code,400)
            upload.assert_not_called()
        self.sanction.refresh_from_db();self.assertEqual(self.sanction.appeal_letter_path,original)

    def test_letter_download_integrity_and_private_headers_and_failed_save_cleanup(self):
        from hashlib import sha256
        self.appeal()
        content=b'private-test-photo'
        self.sanction.appeal_letter_sha256=sha256(content).hexdigest();self.sanction.save()
        with patch('core.api.sanction_appeals.enrollment_storage.read_document',return_value=content):
            response=self.client.get(self.url())
            self.assertEqual(response.status_code,200)
            self.assertEqual(response['Cache-Control'],'private, no-store')
            self.assertEqual(response.content,content)
        with patch('core.api.sanction_appeals.enrollment_storage.read_document',return_value=b'wrong'):
            self.assertEqual(self.client.get(self.url()).status_code,503)
        self.sanction.appeal_status='none';self.sanction.save()
        with patch('core.api.sanction_appeals.enrollment_storage.upload_document', side_effect=lambda path, content, mime: path),patch('core.api.sanction_appeals.enrollment_storage.delete_document') as cleanup,patch('core.api.sanction_appeals.PlayerSanction.save',side_effect=RuntimeError('synthetic save failure')):
            with self.assertRaises(RuntimeError):
                self.client.post(self.url(),{'reason':'Carta de prueba para validar limpieza','letter':image_file('carta.png')},format='multipart')
            cleanup.assert_called_once()

    def test_unpaid_badge_remains_in_roster_and_tournament_cleanup_includes_letter(self):
        self.appeal()
        self.sanction.starts_on=timezone.localdate()-timedelta(days=2)
        self.sanction.ends_on=timezone.localdate()-timedelta(days=1);self.sanction.save()
        self.enrollment.validated_at=timezone.now();self.enrollment.validated_by=self.user;self.enrollment.save()
        rows=self.client.get('/api/player-enrollments/?active_only=true').json()['results']
        self.assertEqual(rows[0]['sanctions'][0]['status'],'awaiting_payment')
        from core.services.tournament_deletion import deletion_plan
        files=deletion_plan(self.tournament)['files']
        self.assertTrue(any(self.sanction.appeal_letter_path in row.get('uri','') for row in files))


    def test_appeal_and_acceptance_without_reason_keep_letter_and_audit(self):
        with patch('core.api.sanction_appeals.enrollment_storage.upload_document', side_effect=lambda path, content, mime: path):
            response = self.client.post(self.url(), {'letter': image_file('carta.png')}, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        self.sanction.refresh_from_db()
        self.assertEqual(self.sanction.appeal_reason, '')
        self.assertTrue(self.sanction.appeal_letter_path)
        self.assertEqual(self.sanction.appeal_submitted_by, self.user)
        response = self.client.post(self.url('decision'), {'action': 'accepted'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.sanction.refresh_from_db()
        self.assertEqual(self.sanction.appeal_status, 'accepted')
        self.assertEqual(self.sanction.appeal_decision_reason, '')
        self.assertEqual(self.sanction.appeal_decided_by, self.user)
        self.assertIsNotNone(self.sanction.appeal_decided_at)


    def test_acceptance_changes_return_date_and_audits_original_period(self):
        from core.models import AuditLog
        today = timezone.localdate()
        self.sanction.starts_on = today - timedelta(days=5)
        self.sanction.ends_on = today + timedelta(days=20)
        self.sanction.duration_unit = 'days'; self.sanction.duration_value = 26
        self.sanction.save()
        self.appeal()
        response = self.client.post(self.url('decision'), {'action':'accepted', 'return_on':str(today)}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.sanction.refresh_from_db()
        self.assertEqual(self.sanction.ends_on, today - timedelta(days=1))
        self.assertEqual(self.sanction.duration_unit, 'dates')
        self.assertIsNone(self.sanction.duration_value)
        self.assertEqual(response.data['status'], 'awaiting_payment')
        audit = AuditLog.objects.get(action='sanction_appeal_return_changed', record_id=str(self.sanction.pk))
        self.assertEqual(audit.actor, self.user)
        self.assertEqual(audit.previous_values['ends_on'], str(today + timedelta(days=20)))
        self.assertEqual(audit.previous_values['duration_value'], 26)
        self.assertEqual(audit.new_values['return_on'], str(today))
        self.assertEqual(self.client.post(self.url('decision'), {'action':'accepted', 'return_on':str(today+timedelta(days=1))}, format='json').status_code, 400)
        self.assertEqual(AuditLog.objects.filter(action='sanction_appeal_return_changed').count(), 1)
        self.assertTrue(unfulfilled_sanctions().filter(pk=self.sanction.pk).exists())
        self.client.post(self.url('decision'), {'action':'payment', 'folio':'F-RETURN'}, format='json')
        self.assertFalse(unfulfilled_sanctions().filter(pk=self.sanction.pk).exists())


    def test_indefinite_appeal_can_set_return_and_last_sanction_day_is_inclusive(self):
        today = timezone.localdate()
        self.sanction.starts_on = today; self.sanction.ends_on = None
        self.sanction.duration_unit = 'indefinite'; self.sanction.save()
        self.appeal()
        response = self.client.post(self.url('decision'), {'action':'accepted', 'return_on':str(today+timedelta(days=1))}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.sanction.refresh_from_db(); self.assertEqual(self.sanction.ends_on, today)
        self.client.post(self.url('decision'), {'action':'payment', 'folio':'F-LAST-DAY'}, format='json')
        self.assertTrue(unfulfilled_sanctions().filter(pk=self.sanction.pk).exists())


    def test_invalid_return_dates_do_not_accept_or_change_period(self):
        from core.models import AuditLog
        self.appeal()
        original = self.sanction.ends_on
        for value in ('', None, 'incorrecta', '2026-02-30', str(self.sanction.starts_on), str(self.sanction.starts_on-timedelta(days=1))):
            response = self.client.post(self.url('decision'), {'action':'accepted', 'return_on':value}, format='json')
            self.assertEqual(response.status_code, 400, response.data)
            self.sanction.refresh_from_db()
            self.assertEqual(self.sanction.appeal_status, 'pending')
            self.assertEqual(self.sanction.ends_on, original)
        self.assertFalse(AuditLog.objects.filter(action='sanction_appeal_return_changed').exists())
        for action in ('payment','rejected'):
            response = self.client.post(self.url('decision'), {'action':action, 'reason':'Prueba', 'folio':'F-TEST', 'return_on':'2030-01-01'}, format='json')
            self.assertEqual(response.status_code, 400)

    def test_coordinator_can_change_return_only_for_own_site(self):
        self.appeal()
        coordinator=User.objects.create_user(username='date-coordinator',role='site_coordinator',primary_site=self.site)
        self.client.force_authenticate(coordinator)
        result=self.client.get('/api/player-enrollments/disciplinary/').json()
        self.assertTrue(result['can_decide_appeals'])
        self.assertFalse(result['can_manage_blacklist'])
        response=self.client.post(self.url('decision'),{'action':'accepted','return_on':str(self.sanction.starts_on+timedelta(days=1))},format='json')
        self.assertEqual(response.status_code,200,response.data)
        self.sanction.refresh_from_db()
        self.assertEqual(self.sanction.appeal_decided_by,coordinator)
        self.assertEqual(self.sanction.ends_on,self.sanction.starts_on)
        self.assertEqual(self.client.post(self.url('decision'),{'action':'payment','folio':'NOT-ALLOWED'},format='json').status_code,403)

    def test_coordinator_cannot_accept_another_sites_appeal(self):
        self.appeal()
        coordinator=User.objects.create_user(username='outside-date-coordinator',role='site_coordinator',primary_site=self.other)
        self.client.force_authenticate(coordinator)
        self.assertEqual(self.client.post(self.url('decision'),{'action':'accepted','return_on':str(self.sanction.starts_on+timedelta(days=1))},format='json').status_code,404)
        self.sanction.refresh_from_db();self.assertEqual(self.sanction.appeal_status,'pending')
