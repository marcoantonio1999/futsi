from datetime import date, timedelta

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from core.enrollment_models import PlayerEnrollment, PlayerEnrollmentInvitation, PlayerEnrollmentDocument
from core.models import Site, Team, Tournament, User


@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core': None})
class EnrollmentDelegateTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='emilio', role='collaborator', section_permissions=['player_enrollments_only'])
        self.site = Site.objects.create(name='Colegio Franco', code='franco')
        self.tournament = Tournament.objects.create(name='Torneo', site=self.site, billing_type='weekly_match')
        self.team = Team.objects.create(name='Equipo', tournament=self.tournament, representative_name='Anterior', representative_phone='5512345678', representative_email='previous@example.com')
        self.previous = self.enroll(self.team, 'Anterior', True)
        self.next = self.enroll(self.team, 'Nuevo')
        self.url = f'/api/player-enrollments/teams/{self.team.pk}/delegate/'
        self.client.force_authenticate(self.user)

    def enroll(self, team, name, delegate=False, creator=None):
        invitation = PlayerEnrollmentInvitation.objects.create(
            created_by=creator or self.user, team_record=team, team=team.name,
            tournament=team.tournament.name, expires_at=timezone.now() + timedelta(days=1))
        return PlayerEnrollment.objects.create(invitation=invitation, team_record=team, team=team.name,
            tournament=team.tournament.name, name=name, phone='5598765432', birth_date=date(2000, 1, 1),
            terms_version='v1', terms_text=['Aceptado'], is_delegate=delegate)

    def test_change_is_persisted_preserves_records_and_is_idempotent(self):
        document = PlayerEnrollmentDocument.objects.create(enrollment=self.previous, kind='player_signature', content=b'signed', content_type='image/png', sha256='a' * 64)
        signed_at = self.next.signed_at
        for _ in range(2):
            response = self.client.post(self.url, {'enrollment_id': self.next.pk}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
        self.previous.refresh_from_db(); self.next.refresh_from_db(); self.team.refresh_from_db()
        self.assertFalse(self.previous.is_delegate)
        self.assertTrue(self.next.is_delegate)
        self.assertEqual(PlayerEnrollment.objects.filter(team_record=self.team, is_delegate=True).count(), 1)
        self.assertEqual(self.team.representative_name, 'Nuevo')
        self.assertEqual(self.team.representative_phone, self.next.phone)
        self.assertEqual(self.team.representative_email, '')
        self.assertEqual(self.next.signed_at, signed_at)
        self.assertIsNone(self.previous.withdrawn_at)
        self.assertEqual(PlayerEnrollment.objects.count(), 2)
        self.assertEqual(PlayerEnrollmentDocument.objects.get(pk=document.pk).content, b'signed')

    def test_rejects_withdrawn_and_other_team_players_without_changes(self):
        self.next.withdrawn_at = timezone.now(); self.next.save()
        self.assertEqual(self.client.post(self.url, {'enrollment_id': self.next.pk}, format='json').status_code, 404)
        other_team = Team.objects.create(name='Otro', tournament=self.tournament)
        other = self.enroll(other_team, 'Otro')
        self.assertEqual(self.client.post(self.url, {'enrollment_id': other.pk}, format='json').status_code, 404)
        self.previous.refresh_from_db(); self.assertTrue(self.previous.is_delegate)

    def test_rejects_unauthenticated_and_unpermitted_accounts(self):
        self.client.force_authenticate(None)
        self.assertIn(self.client.post(self.url, {'enrollment_id': self.next.pk}, format='json').status_code, [401, 403])
        visitor = User.objects.create_user(username='visitor', role='collaborator')
        self.client.force_authenticate(visitor)
        self.assertEqual(self.client.post(self.url, {'enrollment_id': self.next.pk}, format='json').status_code, 403)

    def test_emilio_can_change_delegates_across_sites_and_operators(self):
        site = Site.objects.create(name='Otra cancha', code='otra')
        tournament = Tournament.objects.create(site=site, name='Otro torneo', billing_type='weekly_match')
        team = Team.objects.create(tournament=tournament, name='Otro equipo')
        row = self.enroll(team, 'Otro jugador')
        self.assertEqual(self.client.post(f'/api/player-enrollments/teams/{team.pk}/delegate/', {'enrollment_id': row.pk}, format='json').status_code, 200)
        other = User.objects.create_user(username='other', role='collaborator', section_permissions=['player_enrollments_only'])
        invisible = self.enroll(self.team, 'Privado', creator=other)
        self.assertEqual(self.client.post(self.url, {'enrollment_id': invisible.pk}, format='json').status_code, 200)
        self.client.force_authenticate(other)
        self.assertEqual(self.client.post(self.url, {'enrollment_id': self.next.pk}, format='json').status_code, 404)

    def test_rejects_inactive_team_and_invalid_input(self):
        self.assertEqual(self.client.post(self.url, {}, format='json').status_code, 400)
        self.team.is_active = False; self.team.save()
        self.assertEqual(self.client.post(self.url, {'enrollment_id': self.next.pk}, format='json').status_code, 400)
        self.previous.refresh_from_db(); self.assertTrue(self.previous.is_delegate)

    def test_existing_first_enrollment_becomes_delegate_without_losing_documents(self):
        from importlib import import_module
        from types import SimpleNamespace
        from django.apps import apps
        self.previous.is_delegate = False
        self.previous.save(update_fields=['is_delegate'])
        document = PlayerEnrollmentDocument.objects.create(enrollment=self.previous, kind='player_signature', content=b'kept', content_type='image/png', sha256='a' * 64)
        migration = import_module('core.migrations.0064_signed_enrollment_withdrawals')
        migration.set_existing_delegates(apps, SimpleNamespace(connection=SimpleNamespace(alias='default')))
        self.previous.refresh_from_db(); self.next.refresh_from_db(); self.team.refresh_from_db()
        self.assertTrue(self.previous.is_delegate)
        self.assertFalse(self.next.is_delegate)
        self.assertEqual(self.team.representative_name, self.previous.name)
        self.assertEqual(PlayerEnrollment.objects.count(), 2)
        self.assertEqual(PlayerEnrollmentDocument.objects.get(pk=document.pk).content, b'kept')
