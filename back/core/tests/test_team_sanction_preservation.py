from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from core.models import User, Team, Player, PlayerSanction, AuditLog
from core.enrollment_models import PlayerEnrollment, PlayerEnrollmentInvitation
from core.services.player_sanctions import assert_no_pending_sanction, assert_player_change_allowed
from core.tests.test_disciplinary import DisciplinaryTests
from core.tests.test_player_enrollments import image_file


@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core': None})
class TeamSanctionPreservationTests(TestCase):
    setUp = DisciplinaryTests.setUp

    def remove(self):
        url = f'/api/player-enrollments/teams/{self.team.pk}/'
        preview = self.client.get(url+'deletion-preview/')
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.json()['preserved_sanction_count'], 1)
        result = self.client.delete(url, {'confirmation_name': self.team.name,
            'confirmation_token': preview.json()['confirmation_token']}, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        return result

    def test_deletion_keeps_full_sanction_and_makes_only_this_membership_inactive(self):
        self.sanction.appeal_status = 'pending'
        self.sanction.appeal_reason = 'Carta de prueba pendiente'
        self.sanction.appeal_letter_path = 'private/letter.jpg'
        self.sanction.payment_folio = 'FOLIO-ORIGINAL'
        self.sanction.save()
        before = PlayerSanction.objects.filter(pk=self.sanction.pk).values().get()
        result = self.remove()
        self.sanction.refresh_from_db(); self.enrollment.refresh_from_db()
        after = PlayerSanction.objects.filter(pk=self.sanction.pk).values().get()
        self.assertIsNone(after.pop('team_id')); before.pop('team_id')
        self.assertEqual(before, after)
        self.assertFalse(Team.objects.filter(pk=self.team.pk).exists())
        self.assertIsNone(self.enrollment.team_record_id)
        self.assertIsNone(self.enrollment.withdrawn_at)
        directory = self.client.get('/api/player-enrollments/players/').json()
        self.assertEqual(directory['totals']['inactive'], 1)
        self.assertEqual(directory['totals']['active'], 0)
        self.assertEqual(self.client.get('/api/player-enrollments/?active_only=true').json()['count'], 0)
        self.assertEqual(AuditLog.objects.get(pk=result.json()['deletion_id']).metadata['preserved_sanction_ids'], [self.sanction.pk])
        with self.assertRaises(ValidationError):
            assert_no_pending_sanction(self.enrollment.name, self.enrollment.birth_date)

    def test_history_filters_and_site_permissions_survive_deleted_team(self):
        self.remove()
        url = '/api/player-enrollments/disciplinary/'
        response = self.client.get(url, {'team':self.team.name, 'tournament':self.tournament.name, 'site':self.site.name})
        self.assertEqual(response.status_code, 200, response.data)
        row = response.json()['results'][0]
        self.assertEqual((row['team'],row['tournament'],row['site']), (self.team.name,self.tournament.name,self.site.name))
        coordinator = User.objects.create_user(username='coord-deleted',role='site_coordinator',primary_site=self.site)
        self.client.force_authenticate(coordinator)
        self.assertEqual(self.client.get(url).json()['count'], 1)
        coordinator.primary_site = self.other; coordinator.save()
        self.assertEqual(self.client.get(url).json()['count'], 0)
        self.assertEqual(self.client.get(f'/api/player-enrollments/sanctions/{self.sanction.pk}/photo/').status_code, 404)
        coordinator.primary_site = None; coordinator.save()
        self.assertEqual(self.client.get(url).json()['count'], 0)

    def test_appeal_letter_and_payment_work_after_deletion_without_early_release(self):
        self.sanction.ends_on = timezone.localdate()+timedelta(days=1); self.sanction.save()
        self.remove()
        base = f'/api/player-enrollments/sanctions/{self.sanction.pk}/'
        with patch('core.api.sanction_appeals.enrollment_storage.upload_document'):
            response = self.client.post(base+'appeal/', {'reason':'Solicito revisión del incidente', 'letter':image_file('carta.png')},format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        response = self.client.post(base+'decision/', {'action':'accepted','reason':'Carta revisada y aceptada'},format='json')
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post(base+'decision/', {'action':'payment','folio':'PAGO-123'},format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()['status'], 'active')
        with self.assertRaises(ValidationError):
            assert_no_pending_sanction(self.enrollment.name, self.enrollment.birth_date)
        self.sanction.refresh_from_db()
        self.sanction.starts_on = timezone.localdate()-timedelta(days=2)
        self.sanction.ends_on = timezone.localdate()-timedelta(days=1); self.sanction.save()
        assert_no_pending_sanction(self.enrollment.name, self.enrollment.birth_date)

    def test_overdue_unpaid_sanction_still_blocks_new_enrollment(self):
        self.sanction.starts_on = timezone.localdate()-timedelta(days=3)
        self.sanction.ends_on = timezone.localdate()-timedelta(days=1); self.sanction.save()
        self.remove()
        another = Team.objects.create(tournament=self.tournament,name='Equipo nuevo')
        invitation = PlayerEnrollmentInvitation.objects.create(created_by=self.user, team_record=another, expires_at=timezone.now()+timedelta(days=1))
        self.client.force_authenticate(None)
        with patch('core.api.enrollments.enrollment_storage.upload_document') as upload:
            result = self.client.post(f'/api/player-enrollments/public/{invitation.token}/', {
                'given_names':'JOSE LUIS', 'paternal_surname':'PEREZ','maternal_surname':'ORDUNA',
                'birth_date':'1990-01-01','identity_type':'ine','phone':'5512345678','accepted_terms':True},format='multipart')
            self.assertEqual(result.status_code,400)
            self.assertIn('sanción pendiente',str(result.data))
            upload.assert_not_called()

    def test_legacy_player_keeps_sanction_and_is_explicitly_inactive(self):
        player = Player.objects.create(team=self.team, full_name='Jugador legado')
        self.sanction.enrollment = None; self.sanction.player = player; self.sanction.save()
        self.remove(); player.refresh_from_db(); self.sanction.refresh_from_db()
        self.assertIsNone(player.team_id); self.assertFalse(player.is_active)
        self.assertEqual(self.sanction.player_id,player.pk)
        with self.assertRaises(ValidationError): assert_player_change_allowed(player.pk)

    def test_blacklist_can_be_applied_after_team_deletion(self):
        self.remove()
        result = self.client.post(self.blacklist, DisciplinaryTests.add_payload(self),format='json')
        self.assertEqual(result.status_code,201,result.data)
        row = self.client.get(self.blacklist).json()['results'][0]
        self.assertEqual(row['team'],self.team.name)

    def test_payment_change_invalidates_existing_deletion_confirmation(self):
        url = f'/api/player-enrollments/teams/{self.team.pk}/'
        preview = self.client.get(url+'deletion-preview/').json()
        self.sanction.payment_folio='NEW-PAYMENT';self.sanction.save()
        response = self.client.delete(url, {'confirmation_name':self.team.name,
            'confirmation_token':preview['confirmation_token']},format='json')
        self.assertEqual(response.status_code,400)
        self.assertTrue(Team.objects.filter(pk=self.team.pk).exists())
        self.sanction.refresh_from_db();self.assertEqual(self.sanction.team_id,self.team.pk)
