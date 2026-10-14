from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4
from django.test import TestCase, override_settings
from django.utils import timezone
from core.models import Player, PlayerSanction, Team
from core.enrollment_models import PlayerEnrollment, PlayerEnrollmentInvitation, PlayerEnrollmentDocument
from core.tests import test_disciplinary
from core.tests.test_player_enrollments import image_file


@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core': None})
class SanctionEligibilityTests(TestCase):
    setUp = test_disciplinary.DisciplinaryTests.setUp

    def link(self):
        invitation = PlayerEnrollmentInvitation.objects.create(created_by=self.user, team_record=self.team,
            purpose='withdraw', expires_at=timezone.now()+timedelta(days=1))
        return invitation, f'/api/player-enrollments/withdrawal/{invitation.token}/'

    def payload(self, ids):
        return {'enrollment_ids': ids, 'accepted': True, 'withdrawal_signature': image_file('baja.png')}

    def test_sanction_blocks_entire_batch_before_upload(self):
        another_invitation = PlayerEnrollmentInvitation.objects.create(created_by=self.user,team_record=self.team,expires_at=timezone.now()+timedelta(days=1))
        other = PlayerEnrollment.objects.create(invitation=another_invitation, team_record=self.team,
            name='Otro Jugador Pérez', birth_date='1990-02-01')
        invitation, url = self.link()
        listing = self.client.get(url).json()['players']
        self.assertFalse(next(row for row in listing if row['id']==self.enrollment.pk)['can_withdraw'])
        with patch('core.api.enrollments.enrollment_storage.upload_document') as upload:
            self.assertEqual(self.client.post(url, self.payload([self.enrollment.pk, other.pk]), format='multipart').status_code,400)
            upload.assert_not_called()
        self.assertFalse(PlayerEnrollment.objects.filter(withdrawn_at__isnull=False).exists())
        invitation.refresh_from_db(); self.assertIsNone(invitation.used_at)

    def test_final_day_inclusive_and_expired_allows_withdrawal(self):
        self.sanction.ends_on=timezone.localdate(); self.sanction.save()
        _, url = self.link()
        self.assertEqual(self.client.post(url,self.payload([self.enrollment.pk]),format='multipart').status_code,400)
        self.sanction.ends_on=timezone.localdate()-timedelta(days=1)
        self.sanction.starts_on=self.sanction.ends_on; self.sanction.save()
        with patch('core.api.enrollments.enrollment_storage.upload_document'):
            self.assertEqual(self.client.post(url,self.payload([self.enrollment.pk]),format='multipart').status_code,200)

    def test_scheduled_sanction_cannot_be_escaped(self):
        self.sanction.starts_on=timezone.localdate()+timedelta(days=3);self.sanction.save()
        _, url=self.link()
        row=self.client.get(url).json()['players'][0]
        self.assertFalse(row['can_withdraw']);self.assertEqual(row['sanctions'][0]['status'],'scheduled')

    def test_sanction_added_during_signature_upload_cleans_up_and_does_not_withdraw(self):
        self.sanction.delete(); invitation,url=self.link()
        def sanction_during_upload(*args):
            PlayerSanction.objects.create(team=self.team,enrollment=self.enrollment,player_name=self.enrollment.name,
                offense_code='s01',offense_label='Incidente',reason='Prueba',incident_on=timezone.localdate(),
                starts_on=timezone.localdate(),created_by=self.user,duration_unit='indefinite',request_id=uuid4())
        with patch('core.api.enrollments.enrollment_storage.upload_document',side_effect=sanction_during_upload), patch('core.api.enrollments.enrollment_storage.delete_document') as cleanup:
            self.assertEqual(self.client.post(url,self.payload([self.enrollment.pk]),format='multipart').status_code,400)
            cleanup.assert_called_once()
        self.enrollment.refresh_from_db();self.assertIsNone(self.enrollment.withdrawn_at)
        self.assertFalse(PlayerEnrollmentDocument.objects.filter(kind='withdrawal_signature').exists())

    def test_other_team_signup_blocked_by_normalized_identity(self):
        team=Team.objects.create(tournament=self.tournament,name='Otro equipo')
        invitation=PlayerEnrollmentInvitation.objects.create(created_by=self.user,team_record=team,expires_at=timezone.now()+timedelta(days=1))
        url=f'/api/player-enrollments/public/{invitation.token}/'
        data={'given_names':'JOSE LUIS','paternal_surname':'PEREZ','maternal_surname':'ORDUNA','birth_date':'1990-01-01','identity_type':'ine','phone':'5512345678','accepted_terms':True}
        with patch('core.api.enrollments.enrollment_storage.upload_document') as upload:
            self.assertEqual(self.client.post(url,data,format='multipart').status_code,400);upload.assert_not_called()

    def test_roster_keeps_sanctioned_player_and_excludes_expired_labels(self):
        row=self.client.get('/api/player-enrollments/?active_only=true').json()['results'][0]
        self.assertEqual(row['id'],self.enrollment.pk);self.assertEqual(len(row['sanctions']),1)
        self.sanction.starts_on=timezone.localdate()-timedelta(days=3)
        self.sanction.ends_on=timezone.localdate()-timedelta(days=1);self.sanction.save()
        self.assertEqual(self.client.get('/api/player-enrollments/?active_only=true').json()['results'][0]['sanctions'],[])

    def test_known_legacy_player_cannot_be_deactivated_or_moved(self):
        from core.domain_serializers.sports import PlayerSerializer
        from rest_framework.exceptions import ValidationError
        player=Player.objects.create(team=self.team,full_name='Jugador Legado Pérez')
        self.sanction.enrollment=None;self.sanction.player=player;self.sanction.save()
        serializer=PlayerSerializer(player,data={'is_active':False},partial=True)
        serializer.is_valid(raise_exception=True)
        with self.assertRaises(ValidationError):serializer.save()

    def test_legacy_player_delete_cannot_erase_pending_sanction(self):
        from core.api.catalog import PlayerViewSet
        from rest_framework.exceptions import ValidationError
        player=Player.objects.create(team=self.team,full_name='Jugador Legado Pérez')
        self.sanction.enrollment=None;self.sanction.player=player;self.sanction.save()
        with self.assertRaises(ValidationError):PlayerViewSet().perform_destroy(player)
        self.assertTrue(Player.objects.filter(pk=player.pk).exists())
