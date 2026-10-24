from datetime import date, timedelta
from io import BytesIO
from unittest.mock import patch
from PIL import Image, ImageDraw
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User, Site, Tournament, Team
from core.enrollment_models import PlayerEnrollmentInvitation, PlayerEnrollment, PlayerEnrollmentDocument
from core.api.enrollments import is_minor, validated_file, ENROLLMENT_FILE_MAX_BYTES
from rest_framework.exceptions import ValidationError


def image_file(name, blank=False):
    image = Image.new("RGB", (600, 180), "white")
    if not blank:
        ImageDraw.Draw(image).line([(20, 40), (250, 150), (450, 30)], fill="black", width=5)
    data = BytesIO(); image.save(data, "PNG")
    return SimpleUploadedFile(name, data.getvalue(), content_type="image/png")


@override_settings(ALLOWED_HOSTS=["testserver"], MIGRATION_MODULES={"core": None})
class PlayerEnrollmentTests(TestCase):
    def setUp(self):
        self.storage = {}
        self.upload_storage = patch("core.api.enrollments.enrollment_storage.upload_document", side_effect=lambda path, content, mime: self.storage.__setitem__(path, content)).start()
        patch("core.api.enrollments.enrollment_storage.read_document", side_effect=lambda path: self.storage[path]).start()
        self.delete_storage = patch("core.api.enrollments.enrollment_storage.delete_document", side_effect=lambda path: self.storage.pop(path, None)).start()
        self.addCleanup(patch.stopall)
        from django.core.cache import cache
        cache.clear()
        self.emilio = User.objects.create_user(username="emilio", password="test-pass-123", role="collaborator", section_permissions=["player_enrollments_only"])
        self.other = User.objects.create_user(username="other", role="collaborator", section_permissions=["player_enrollments_only"])
        self.site = Site.objects.create(name='Colegio Franco', code='prueba')
        self.tournament = Tournament.objects.create(site=self.site, name='Torneo', billing_type='weekly_match')
        self.team = Team.objects.create(tournament=self.tournament, name='Equipo', representative_name='Jugador de prueba', representative_phone='5512345678')
        self.invitation = self.new_invitation()
        self.url = f"/api/player-enrollments/public/{self.invitation.token}/"
        self.client = APIClient()

    def new_invitation(self):
        return PlayerEnrollmentInvitation.objects.create(created_by=self.emilio, expires_at=timezone.now() + timedelta(days=1), team_record=self.team, team=self.team.name, tournament=self.tournament.name)

    def test_full_name_requires_each_component_before_upload(self):
        for field in ('given_names', 'paternal_surname', 'maternal_surname'):
            for value in (None, '', '   ', '123', '---', 'Pérez123'):
                with self.subTest(field=field, value=value):
                    from django.core.cache import cache
                    cache.clear()
                    data = self.payload()
                    if value is None:
                        data.pop(field)
                    else:
                        data[field] = value
                    data['name'] = 'Nombre antiguo no puede sustituir los campos'
                    self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 400)
        self.upload_storage.assert_not_called()
        self.assertFalse(PlayerEnrollment.objects.exists())

    def test_full_name_composes_and_normalizes_names_and_compound_surnames(self):
        self.team.representative_name = ''; self.team.save()
        data = self.payload()
        data.update(given_names=' José  Luis ', paternal_surname='De la Cruz', maternal_surname='Orduña')
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 201)
        self.assertEqual(PlayerEnrollment.objects.get().name, 'José Luis De la Cruz Orduña')

    def test_full_name_rejects_combined_length_over_160(self):
        data = self.payload()
        data.update(given_names='a' * 80, paternal_surname='b' * 80, maternal_surname='c')
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 400)
        self.upload_storage.assert_not_called()

    def test_delegate_can_complete_previously_abbreviated_name(self):
        self.team.representative_name = 'José Orduña'; self.team.save()
        data = self.payload()
        data.update(given_names='José Luis', paternal_surname='Orduña', maternal_surname='Pérez')
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 201)
        self.team.refresh_from_db()
        self.assertEqual(self.team.representative_name, 'José Luis Orduña Pérez')
        self.assertTrue(PlayerEnrollment.objects.get().is_delegate)

    def new_withdrawal(self):
        return PlayerEnrollmentInvitation.objects.create(created_by=self.emilio, expires_at=timezone.now() + timedelta(days=1), team_record=self.team, team=self.team.name, tournament=self.tournament.name, purpose='withdraw')

    def enroll_two(self):
        self.assertEqual(self.client.post(self.url, self.payload(), format='multipart').status_code, 201)
        invitation = self.new_invitation()
        data = self.payload(); data['given_names'] = 'Segundo jugador'
        self.assertEqual(self.client.post(f'/api/player-enrollments/public/{invitation.token}/', data, format='multipart').status_code, 201)
        return list(PlayerEnrollment.objects.order_by('pk'))

    def test_withdrawal_history_filters_all_dates_and_protects_signature(self):
        rows = self.enroll_two(); link = self.new_withdrawal()
        response = self.client.post(f'/api/player-enrollments/withdrawal/{link.token}/', {'enrollment_ids': [row.pk for row in rows], 'accepted': 'true', 'withdrawal_signature': image_file('baja.png')}, format='multipart')
        self.assertEqual(response.status_code, 200)
        self.client.force_authenticate(self.emilio)
        url = '/api/player-enrollments/?withdrawn_only=true'
        listing = self.client.get(url).json()
        self.assertEqual(listing['count'], 2)
        self.assertTrue(all(row['status'] == 'Baja' for row in listing['results']))
        self.assertEqual(listing['withdrawal_filters']['teams'][0]['team'], self.team.name)
        self.assertEqual(self.client.get(url + '&search=Segundo').json()['count'], 1)
        self.assertEqual(self.client.get(url + '&team=NoExiste').json()['count'], 0)
        self.assertEqual(self.client.get(url + '&tournament_id=' + str(self.tournament.pk)).json()['count'], 2)
        today = str(timezone.localdate())
        self.assertEqual(self.client.get(url + f'&date_from={today}&date_to={today}').json()['count'], 2)
        self.assertEqual(self.client.get(url + '&date_to=2000-01-01').json()['count'], 0)
        self.assertEqual(self.client.get(url + '&date_from=bad').status_code, 400)
        self.assertEqual(self.client.get(url + '&date_from=2026-12-01&date_to=2026-01-01').status_code, 400)
        document = PlayerEnrollmentDocument.objects.filter(kind='withdrawal_signature').first()
        signature_url = f'/api/player-enrollments/documents/{document.pk}/'
        self.assertEqual(self.client.get(signature_url).status_code, 200)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(url).json()['count'], 0)
        self.assertEqual(self.client.get(signature_url).status_code, 404)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(url).status_code, (401, 403))
        self.assertIn(self.client.get(signature_url).status_code, (401, 403))

    def test_withdrawal_history_includes_inactive_teams_and_older_pages(self):
        for number in range(27):
            PlayerEnrollment.objects.create(invitation=self.new_invitation(), team_record=self.team,
                name=f'Baja {number}', team=self.team.name, tournament=self.tournament.name,
                birth_date=date(1990, 1, 1), phone='5512345678', terms_version='test',
                withdrawn_at=timezone.now() - timedelta(days=400))
        self.team.is_active = False; self.team.save()
        self.tournament.is_active = False; self.tournament.save()
        self.client.force_authenticate(self.emilio)
        url = '/api/player-enrollments/?withdrawn_only=true'
        first = self.client.get(url).json(); second = self.client.get(url + '&page=2').json()
        self.assertEqual(first['count'], 27)
        self.assertEqual(len(first['results']), 25); self.assertEqual(len(second['results']), 2)
        self.assertTrue(set(row['id'] for row in first['results']).isdisjoint(row['id'] for row in second['results']))
        self.assertEqual(first['withdrawal_filters']['tournaments'][0]['tournament'], self.tournament.name)

    def test_batch_withdrawal_signs_every_selected_member_and_consumes_link_once(self):
        rows = self.enroll_two()
        link = self.new_withdrawal(); url = f'/api/player-enrollments/withdrawal/{link.token}/'
        self.upload_storage.reset_mock()
        response = self.client.post(url, {'enrollment_ids': [row.pk for row in rows], 'accepted': 'true', 'withdrawal_signature': image_file('baja.png')}, format='multipart')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['count'], 2)
        self.assertEqual(set(row['id'] for row in response.data['players']), {row.pk for row in rows})
        self.assertEqual(PlayerEnrollment.objects.filter(withdrawn_at__isnull=False).count(), 2)
        documents = PlayerEnrollmentDocument.objects.filter(kind='withdrawal_signature')
        self.assertEqual(documents.count(), 2)
        self.assertEqual(len(set(documents.values_list('storage_path', flat=True))), 1)
        self.upload_storage.assert_called_once()
        link.refresh_from_db(); self.assertIsNotNone(link.used_at)
        self.assertEqual(self.client.get(url).status_code, 400)
        self.assertEqual(self.client.get(url + f'photos/{rows[0].pk}/').status_code, 400)

    def test_batch_invalid_or_duplicate_selection_never_partially_withdraws(self):
        rows = self.enroll_two()
        link = self.new_withdrawal(); url = f'/api/player-enrollments/withdrawal/{link.token}/'
        other = Team.objects.create(tournament=self.tournament, name='Equipo externo')
        rows[1].team_record = other; rows[1].save()
        self.upload_storage.reset_mock()
        for ids, status in [([], 400), ([rows[0].pk, rows[0].pk], 400), ([rows[0].pk, rows[1].pk], 404), ([rows[0].pk, 999999], 404)]:
            response = self.client.post(url, {'enrollment_ids': ids, 'accepted': 'true', 'withdrawal_signature': image_file('baja.png')}, format='multipart')
            self.assertEqual(response.status_code, status, response.data)
        self.assertFalse(PlayerEnrollment.objects.filter(withdrawn_at__isnull=False).exists())
        link.refresh_from_db(); self.assertIsNone(link.used_at)
        self.upload_storage.assert_not_called()

    def test_batch_storage_failure_keeps_all_players_active(self):
        rows = self.enroll_two(); link = self.new_withdrawal()
        self.upload_storage.side_effect = RuntimeError('storage unavailable')
        response = self.client.post(f'/api/player-enrollments/withdrawal/{link.token}/', {'enrollment_ids': [row.pk for row in rows], 'accepted': 'true', 'withdrawal_signature': image_file('baja.png')}, format='multipart')
        self.assertEqual(response.status_code, 503)
        self.assertFalse(PlayerEnrollment.objects.filter(withdrawn_at__isnull=False).exists())
        self.assertFalse(PlayerEnrollmentDocument.objects.filter(kind='withdrawal_signature').exists())
        link.refresh_from_db(); self.assertIsNone(link.used_at)

    def test_batch_database_failure_rolls_back_every_withdrawal_and_cleans_signature(self):
        rows = self.enroll_two(); link = self.new_withdrawal()
        previous_paths = set(self.storage)
        with patch.object(PlayerEnrollmentDocument.objects, 'bulk_create', side_effect=RuntimeError('database unavailable')):
            response = self.client.post(f'/api/player-enrollments/withdrawal/{link.token}/', {'enrollment_ids': [row.pk for row in rows], 'accepted': 'true', 'withdrawal_signature': image_file('baja.png')}, format='multipart')
        self.assertEqual(response.status_code, 503)
        self.assertFalse(PlayerEnrollment.objects.filter(withdrawn_at__isnull=False).exists())
        self.assertFalse(PlayerEnrollmentDocument.objects.filter(kind='withdrawal_signature').exists())
        self.assertEqual(set(self.storage), previous_paths)
        link.refresh_from_db(); self.assertIsNone(link.used_at)

    def test_withdrawal_photos_are_scoped_private_and_do_not_expose_documents(self):
        rows = self.enroll_two(); link = self.new_withdrawal()
        url = f'/api/player-enrollments/withdrawal/{link.token}/'
        listing = self.client.get(url).json()
        self.assertTrue(all(player['has_photo'] for player in listing['players']))
        self.assertNotIn('storage_path', str(listing)); self.assertNotIn('documents', str(listing))
        photo = PlayerEnrollmentDocument.objects.get(enrollment=rows[0], kind='player_photo')
        response = self.client.get(url + f'photos/{rows[0].pk}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, self.storage[photo.storage_path])
        self.assertIn('no-store', response['Cache-Control'])
        self.assertEqual(response['X-Content-Type-Options'], 'nosniff')
        self.assertEqual(self.client.get(url + f'photos/{photo.pk + 9999}/').status_code, 404)
        # Even a known enrollment ID from another team grants no access.
        other = Team.objects.create(tournament=self.tournament, name='Otro equipo')
        rows[1].team_record = other; rows[1].save()
        self.assertEqual(self.client.get(url + f'photos/{rows[1].pk}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/player-enrollments/withdrawal/{self.invitation.token}/photos/{rows[0].pk}/').status_code, 404)
        link.expires_at = timezone.now() - timedelta(seconds=1); link.save()
        self.assertEqual(self.client.get(url + f'photos/{rows[0].pk}/').status_code, 400)

    def test_signed_withdrawal_keeps_record_frees_slot_and_link_is_single_use(self):
        from core.models import Player
        from core.services.team_capacity import team_occupancy
        self.tournament.football_format = 'fut6'; self.tournament.save()
        Player.objects.bulk_create([Player(team=self.team, full_name=f'Jugador {n}') for n in range(11)])
        self.assertEqual(self.client.post(self.url, self.payload(), format='multipart').status_code, 201)
        row = PlayerEnrollment.objects.get()
        self.assertTrue(row.is_delegate)
        link = self.new_withdrawal(); url = f'/api/player-enrollments/withdrawal/{link.token}/'
        listing = self.client.get(url).json()
        self.assertEqual([p['id'] for p in listing['players']], [row.pk])
        self.assertNotIn('phone', str(listing))
        self.assertEqual(team_occupancy(self.team.pk), 12)
        response = self.client.post(url, {'enrollment_id': row.pk, 'accepted': 'true', 'withdrawal_signature': image_file('baja.png')}, format='multipart')
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db(); self.assertIsNotNone(row.withdrawn_at)
        self.assertEqual(team_occupancy(self.team.pk), 11)
        self.assertTrue(PlayerEnrollmentDocument.objects.filter(enrollment=row, kind='withdrawal_signature', storage_path__startswith='bajas/').exists())
        self.assertEqual(self.client.get(url).status_code, 400)
        self.assertEqual(self.client.post(url, {'enrollment_id': row.pk, 'accepted': 'true', 'withdrawal_signature': image_file('baja.png')}, format='multipart').status_code, 400)
        self.client.force_authenticate(self.emilio)
        self.assertEqual(self.client.get('/api/player-enrollments/?active_only=true').json()['count'], 0)
        self.assertEqual(self.client.get('/api/player-enrollments/').json()['results'][0]['status'], 'Baja')

    def test_withdrawal_rejects_other_teams_blank_signatures_and_storage_errors(self):
        self.client.post(self.url, self.payload(), format='multipart')
        row = PlayerEnrollment.objects.get()
        link = self.new_withdrawal(); url = f'/api/player-enrollments/withdrawal/{link.token}/'
        other = Team.objects.create(tournament=self.tournament, name='Otro equipo')
        link.team_record = other; link.save()
        self.assertEqual(self.client.post(url, {'enrollment_id': row.pk, 'accepted': 'true', 'withdrawal_signature': image_file('baja.png')}, format='multipart').status_code, 404)
        link.team_record = self.team; link.save()
        self.assertEqual(self.client.post(url, {'enrollment_id': row.pk, 'accepted': 'true', 'withdrawal_signature': image_file('baja.png', blank=True)}, format='multipart').status_code, 400)
        self.upload_storage.side_effect = RuntimeError('storage unavailable')
        self.assertEqual(self.client.post(url, {'enrollment_id': row.pk, 'accepted': 'true', 'withdrawal_signature': image_file('baja.png')}, format='multipart').status_code, 503)
        row.refresh_from_db(); link.refresh_from_db()
        self.assertIsNone(row.withdrawn_at); self.assertIsNone(link.used_at)

    def test_link_purposes_cannot_be_swapped_and_delegate_is_first(self):
        defaults = self.client.get(self.url).json()
        self.assertTrue(defaults['is_delegate'])
        self.assertEqual(defaults['delegate_name'], '')
        self.assertEqual(defaults['delegate_phone'], '')
        data = self.payload(); data['given_names'] = 'Otra persona'
        data['phone'] = '5598765432'
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 201)
        first = PlayerEnrollment.objects.get()
        self.assertTrue(first.is_delegate)
        self.team.refresh_from_db()
        self.assertEqual(self.team.representative_name, first.name)
        self.assertEqual(self.team.representative_phone, first.phone)
        link = self.new_withdrawal()
        self.assertEqual(self.client.get(f'/api/player-enrollments/public/{link.token}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/player-enrollments/withdrawal/{self.invitation.token}/').status_code, 404)
        invitation = self.new_invitation(); data = self.payload(); data['given_names'] = 'Segundo jugador'
        self.assertFalse(self.client.get(f'/api/player-enrollments/public/{invitation.token}/').json()['is_delegate'])
        self.assertEqual(self.client.post(f'/api/player-enrollments/public/{invitation.token}/', data, format='multipart').status_code, 201)
        self.assertEqual(PlayerEnrollment.objects.filter(is_delegate=True).count(), 1)
        self.team.refresh_from_db()
        self.assertEqual(self.team.representative_name, first.name)
        self.assertEqual(self.team.representative_phone, first.phone)

    def test_two_open_first_invites_do_not_replace_the_completed_delegate(self):
        second_link = self.new_invitation()
        second_url = f'/api/player-enrollments/public/{second_link.token}/'
        self.assertTrue(self.client.get(self.url).json()['is_delegate'])
        self.assertTrue(self.client.get(second_url).json()['is_delegate'])
        self.assertEqual(self.client.post(self.url, self.payload(), format='multipart').status_code, 201)
        first = PlayerEnrollment.objects.get()
        second_payload = self.payload()
        second_payload.update(given_names='Segunda persona', phone='5598765432')
        self.assertEqual(self.client.post(second_url, second_payload, format='multipart').status_code, 201)
        self.assertFalse(PlayerEnrollment.objects.get(invitation=second_link).is_delegate)
        self.assertEqual(PlayerEnrollment.objects.filter(is_delegate=True).count(), 1)
        self.team.refresh_from_db()
        self.assertEqual(self.team.representative_name, first.name)
        self.assertEqual(self.team.representative_phone, first.phone)

    def test_roster_limits_for_each_modality(self):
        from core.domain_serializers.sports import PlayerSerializer
        from core.models import Player
        for modality, limit in [('fut6', 12), ('fut7', 14), ('fut8', 16)]:
            with self.subTest(modality=modality):
                Player.objects.all().delete()
                self.tournament.football_format = modality
                self.tournament.save()
                for number in range(limit):
                    serializer = PlayerSerializer(data={'team': self.team.pk, 'full_name': f'Jugador {number}'})
                    serializer.is_valid(raise_exception=True)
                    serializer.save()
                serializer = PlayerSerializer(data={'team': self.team.pk, 'full_name': 'Sin cupo'})
                serializer.is_valid(raise_exception=True)
                with self.assertRaises(ValidationError):
                    serializer.save()
                self.assertEqual(Player.objects.filter(team=self.team).count(), limit)
                player = Player.objects.first()
                serializer = PlayerSerializer(player, data={'full_name': 'Nombre corregido'}, partial=True)
                serializer.is_valid(raise_exception=True)
                serializer.save()
                player.is_active = False
                player.save()
                serializer = PlayerSerializer(data={'team': self.team.pk, 'full_name': 'Nuevo inscrito'})
                serializer.is_valid(raise_exception=True)
                serializer.save()
                serializer = PlayerSerializer(player, data={'is_active': True}, partial=True)
                serializer.is_valid(raise_exception=True)
                with self.assertRaises(ValidationError):
                    serializer.save()

    def test_full_team_blocks_public_submission_and_new_links(self):
        from core.models import Player
        self.tournament.football_format = 'fut6'
        self.tournament.save()
        Player.objects.bulk_create([Player(team=self.team, full_name=f'Jugador {n}') for n in range(12)])
        self.assertEqual(self.client.get(self.url).status_code, 400)
        response = self.client.post(self.url, self.payload(), format='multipart')
        self.assertEqual(response.status_code, 400)
        self.upload_storage.assert_not_called()
        self.client.force_authenticate(self.emilio)
        self.assertEqual(self.client.post('/api/player-enrollments/', {'tournament_id': self.tournament.pk, 'team_id': self.team.pk}, format='json').status_code, 400)
        self.assertEqual(PlayerEnrollment.objects.count(), 0)

    def test_last_slot_and_upload_race_are_checked_again_before_commit(self):
        from core.models import Player
        self.tournament.football_format = 'fut6'
        self.tournament.save()
        Player.objects.bulk_create([Player(team=self.team, full_name=f'Jugador {n}') for n in range(11)])
        original_upload = self.upload_storage.side_effect
        def fill_last_slot(path, content, mime):
            original_upload(path, content, mime)
            if Player.objects.filter(team=self.team).count() == 11:
                Player.objects.create(team=self.team, full_name='Último lugar')
        self.upload_storage.side_effect = fill_last_slot
        self.assertEqual(self.client.post(self.url, self.payload(), format='multipart').status_code, 400)
        self.assertEqual(self.storage, {})
        self.assertEqual(PlayerEnrollment.objects.count(), 0)
        self.upload_storage.side_effect = original_upload
        Player.objects.filter(full_name='Último lugar').delete()
        self.assertEqual(self.client.post(self.url, self.payload(), format='multipart').status_code, 201)
        next_invitation = self.new_invitation()
        self.assertEqual(self.client.get(f'/api/player-enrollments/public/{next_invitation.token}/').status_code, 400)

    def test_modality_required_and_cannot_reduce_below_existing_roster(self):
        from core.domain_serializers.sports import TournamentSerializer
        from core.models import Player
        data = {'site': self.site.pk, 'name': 'Nuevo', 'billing_type': 'weekly_match'}
        serializer = TournamentSerializer(data=data)
        self.assertFalse(serializer.is_valid())
        self.assertIn('football_format', serializer.errors)
        self.tournament.football_format = 'fut8'
        self.tournament.save()
        Player.objects.bulk_create([Player(team=self.team, full_name=f'Jugador {n}') for n in range(13)])
        serializer = TournamentSerializer(self.tournament, data={'football_format': 'fut6'}, partial=True)
        serializer.is_valid(raise_exception=True)
        with self.assertRaises(ValidationError):
            serializer.save()
        self.tournament.refresh_from_db()
        self.assertEqual(self.tournament.football_format, 'fut8')

    def test_academy_and_player_registrations_share_capacity_without_deleting_people(self):
        from core.tests.factories import make_student
        from core.domain_serializers.sports import StudentTournamentRegistrationSerializer
        from core.models import Player, Student, StudentTournamentRegistration
        self.tournament.football_format = 'fut6'
        self.tournament.save()
        Player.objects.bulk_create([Player(team=self.team, full_name=f'Jugador {n}') for n in range(11)])
        student = make_student(site=self.site)
        serializer = StudentTournamentRegistrationSerializer(data={'tournament': self.tournament.pk, 'team': self.team.pk, 'student': student.pk})
        serializer.is_valid(raise_exception=True)
        row = serializer.save()
        another = make_student(site=self.site)
        serializer = StudentTournamentRegistrationSerializer(data={'tournament': self.tournament.pk, 'team': self.team.pk, 'student': another.pk})
        serializer.is_valid(raise_exception=True)
        with self.assertRaises(ValidationError):
            serializer.save()
        withdrawal = StudentTournamentRegistrationSerializer(row, data={'status': 'withdrawn'}, partial=True)
        withdrawal.is_valid(raise_exception=True)
        withdrawal.save()
        serializer.save()
        self.assertTrue(Student.objects.filter(pk=student.pk).exists())
        self.assertEqual(StudentTournamentRegistration.objects.filter(team=self.team, status='registered').count(), 1)

    def test_emilio_administers_tournaments_in_all_active_sites(self):
        outside = Site.objects.create(name='Otra cancha', code='otra')
        tournament = Tournament.objects.create(site=outside, name='Privado', billing_type='weekly_match')
        team = Team.objects.create(tournament=tournament, name='Equipo externo')
        self.client.force_authenticate(self.emilio)
        catalog = self.client.get('/api/player-enrollments/catalog/').json()
        self.assertEqual({row['id'] for row in catalog['sites']}, {self.site.pk, outside.pk})
        self.assertIn(tournament.pk, [row['id'] for row in catalog['tournaments']])
        self.assertEqual(catalog['deletable_tournament_ids'], [])
        self.assertEqual(self.client.post('/api/player-enrollments/catalog/', {'kind':'tournament','name':'Permitido','site':outside.pk,'billing_type':'weekly_match','football_format':'fut7'}, format='json').status_code,201)
        url = f'/api/player-enrollments/tournaments/{tournament.pk}/'
        preview = self.client.get(url+'deletion-preview/')
        self.assertEqual(preview.status_code,403)
        self.assertEqual(self.client.delete(url, {}, format='json').status_code,403)
        self.assertTrue(Tournament.objects.filter(pk=tournament.pk).exists())
        self.assertEqual(self.client.post('/api/player-enrollments/', {'tournament_id':tournament.pk,'team_id':team.pk}, format='json').status_code,201)
        self.assertEqual(self.client.delete(url, {}, format='json').status_code,403)

        empty = Tournament.objects.create(site=outside, name='Eliminar otra sede')
        url = f'/api/player-enrollments/tournaments/{empty.pk}/'
        self.assertEqual(self.client.get(url+'deletion-preview/').status_code,403)
        self.assertEqual(self.client.delete(url,{},format='json').status_code,403)
        self.assertTrue(Tournament.objects.filter(pk=empty.pk).exists())

    def test_emilio_sees_other_operators_links_but_collaborators_keep_own_scope(self):
        from core.api.enrollments import invitations_for
        row = PlayerEnrollmentInvitation.objects.create(created_by=self.other, expires_at=timezone.now()+timedelta(days=1), team_record=self.team, team=self.team.name, tournament=self.tournament.name)
        self.assertTrue(invitations_for(self.emilio).filter(pk=row.pk).exists())
        self.assertFalse(invitations_for(self.other).filter(pk=self.invitation.pk).exists())

    def test_inactive_sites_and_other_operator_deletion_remain_restricted(self):
        inactive = Site.objects.create(name='Inactiva', is_active=False)
        row = Tournament.objects.create(site=inactive, name='No disponible')
        self.client.force_authenticate(self.emilio)
        self.assertEqual(self.client.get(f'/api/player-enrollments/tournaments/{row.pk}/deletion-preview/').status_code,403)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/player-enrollments/catalog/').json()['deletable_tournament_ids'], [])
        self.assertEqual(self.client.delete(f'/api/player-enrollments/tournaments/{self.tournament.pk}/', {}, format='json').status_code,403)


    def test_other_enrollment_operator_cannot_delete(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/player-enrollments/tournaments/{self.tournament.pk}/deletion-preview/').status_code,403)

    def signed_tournament_document(self):
        row = PlayerEnrollment.objects.create(invitation=self.invitation, team_record=self.team,
            name='Jugador', birth_date=date(2000,1,1), team=self.team.name,
            tournament=self.tournament.name, phone='5512345678', terms_version='v1', terms_text=['Firmado'])
        doc = PlayerEnrollmentDocument.objects.create(enrollment=row, kind='player_signature',
            storage_path='inscripciones/test/firma.png', content=b'', content_type='image/png', sha256='a'*64)
        return row, doc

    def test_tournament_delete_is_disabled_and_preserves_signed_records_for_every_role(self):
        row, doc = self.signed_tournament_document()
        users = [self.emilio, self.other] + [User.objects.create_user(username='no-delete-' + role, role=role) for role in ('admin','owner','dev')]
        url = f'/api/player-enrollments/tournaments/{self.tournament.pk}/'
        with patch('core.services.student_deletion.delete_private_file') as cleanup:
            for user in users:
                self.client.force_authenticate(user)
                self.assertEqual(self.client.get(url+'deletion-preview/').status_code,403)
                self.assertEqual(self.client.delete(url,{'confirmation_token':'stale','confirmation_name':self.tournament.name},format='json').status_code,403)
                self.assertEqual(self.client.post('/api/player-enrollments/tournaments/deletion-cleanup/',{'deletion_id':1},format='json').status_code,403)
            cleanup.assert_not_called()
        self.assertTrue(Tournament.objects.filter(pk=self.tournament.pk).exists())
        self.assertTrue(Team.objects.filter(pk=self.team.pk).exists())
        self.assertTrue(PlayerEnrollment.objects.filter(pk=row.pk).exists())
        self.assertTrue(PlayerEnrollmentDocument.objects.filter(pk=doc.pk).exists())




    def test_delete_team_keeps_client_and_tournament(self):
        from core.models import Player
        self.client.force_authenticate(self.emilio)
        team = Team.objects.create(tournament=self.tournament, name='Equipo sin historial')
        player = Player.objects.create(team=team, full_name='Cliente permanente', photo_url='https://example.com/photo.jpg')
        url = f'/api/player-enrollments/teams/{team.pk}/'
        self.assertEqual(self.client.delete(url, {}, format='json').status_code, 400)
        preview = self.client.get(url+'deletion-preview/')
        self.assertEqual(preview.status_code, 200)
        payload = {'confirmation_token': preview.json()['confirmation_token'], 'confirmation_name': team.name}
        self.assertEqual(self.client.delete(url, payload, format='json').status_code, 200)
        player.refresh_from_db()
        self.assertIsNone(player.team_id)
        self.assertEqual(player.photo_url, 'https://example.com/photo.jpg')
        self.assertTrue(Tournament.objects.filter(pk=self.tournament.pk).exists())
        self.assertFalse(Team.objects.filter(pk=team.pk).exists())

    def test_team_deletion_scope_and_links_do_not_block(self):
        self.client.force_authenticate(self.emilio)
        self.assertEqual(self.client.get(f'/api/player-enrollments/teams/{self.team.pk}/deletion-preview/').status_code, 200)
        outside = Site.objects.create(name='Fuera de Franco')
        tournament = Tournament.objects.create(site=outside, name='Otro')
        team = Team.objects.create(tournament=tournament, name='Ajeno')
        self.assertEqual(self.client.get(f'/api/player-enrollments/teams/{team.pk}/deletion-preview/').status_code, 200)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/player-enrollments/teams/{team.pk}/deletion-preview/').status_code, 403)

    def signed_team_fixture(self):
        row = PlayerEnrollment.objects.create(invitation=self.invitation, team_record=self.team,
            name='Jugador de prueba', birth_date='1990-01-01', team=self.team.name,
            tournament=self.tournament.name, is_delegate=True)
        doc = PlayerEnrollmentDocument.objects.create(enrollment=row, kind='player_photo',
            content=b'private-image', storage_path='private/test.jpg', content_type='image/jpeg', sha256='hash')
        return row, doc

    def test_delete_signed_team_preserves_documents_and_other_memberships_and_expires_links(self):
        from core.models import AuditLog
        row, doc = self.signed_team_fixture()
        withdrawal = self.new_withdrawal()
        other_team = Team.objects.create(tournament=self.tournament, name='Otro equipo')
        other_link = PlayerEnrollmentInvitation.objects.create(created_by=self.emilio, team_record=other_team,
            expires_at=timezone.now()+timedelta(days=1))
        other = PlayerEnrollment.objects.create(invitation=other_link, team_record=other_team,
            name=row.name, birth_date=row.birth_date, team=other_team.name, tournament=self.tournament.name)
        self.client.force_authenticate(self.emilio)
        url = f'/api/player-enrollments/teams/{self.team.pk}/'
        preview = self.client.get(url+'deletion-preview/').json()
        self.assertEqual(preview['preserved_enrollment_count'], 1)
        self.assertEqual(preview['invalidated_link_count'], 2)
        self.assertEqual(preview['file_count'], 0)
        payload = {'confirmation_token': preview['confirmation_token'], 'confirmation_name': self.team.name}
        result = self.client.delete(url, payload, format='json')
        self.assertEqual(result.status_code, 200, result.data)
        self.assertFalse(Team.objects.filter(pk=self.team.pk).exists())
        row.refresh_from_db(); doc.refresh_from_db(); other.refresh_from_db(); other_link.refresh_from_db()
        self.assertIsNone(row.team_record_id)
        self.assertIsNone(row.withdrawn_at)  # A team deletion is not a forged signed withdrawal.
        self.assertEqual(row.team, self.team.name)
        self.assertEqual(doc.content, b'private-image')
        self.assertEqual(doc.storage_path, 'private/test.jpg')
        self.assertEqual(other.team_record_id, other_team.pk)
        self.assertGreater(other_link.expires_at, timezone.now())
        for link in (self.invitation, withdrawal):
            link.refresh_from_db()
            self.assertIsNone(link.team_record_id)
            self.assertLessEqual(link.expires_at, timezone.now())
        self.delete_storage.assert_not_called()
        active = self.client.get('/api/player-enrollments/?active_only=true').json()['results']
        self.assertEqual([entry['id'] for entry in active], [other.pk])
        people = self.client.get('/api/player-enrollments/players/').json()
        self.assertEqual(people['totals']['total'], 1)
        self.assertEqual(len(people['results'][0]['participations']), 2)
        self.assertTrue(people['results'][0]['is_active'])
        audit = AuditLog.objects.get(pk=result.json()['deletion_id'])
        self.assertEqual(audit.metadata['preserved_enrollment_ids'], [row.pk])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).status_code, 410)
        self.assertEqual(self.client.get(f'/api/player-enrollments/withdrawal/{withdrawal.token}/').status_code, 400)

    def test_new_signed_enrollment_invalidates_team_confirmation(self):
        self.client.force_authenticate(self.emilio)
        url = f'/api/player-enrollments/teams/{self.team.pk}/'
        preview = self.client.get(url+'deletion-preview/').json()
        self.signed_team_fixture()
        result = self.client.delete(url, {'confirmation_token': preview['confirmation_token'],
            'confirmation_name': self.team.name}, format='json')
        self.assertEqual(result.status_code, 400)
        self.assertTrue(Team.objects.filter(pk=self.team.pk).exists())

    def test_team_deletion_rolls_back_detached_enrollments_on_failure(self):
        row, doc = self.signed_team_fixture()
        self.client.force_authenticate(self.emilio)
        url = f'/api/player-enrollments/teams/{self.team.pk}/'
        preview = self.client.get(url+'deletion-preview/').json()
        with patch.object(Team, 'delete', side_effect=RuntimeError('simulated deletion failure')):
            response = self.client.delete(url, {'confirmation_token': preview['confirmation_token'],
                'confirmation_name': self.team.name}, format='json')
        self.assertEqual(response.status_code, 500)
        row.refresh_from_db(); self.invitation.refresh_from_db()
        self.assertEqual(row.team_record_id, self.team.pk)
        self.assertEqual(self.invitation.team_record_id, self.team.pk)
        self.assertGreater(self.invitation.expires_at, timezone.now())
        self.assertTrue(PlayerEnrollmentDocument.objects.filter(pk=doc.pk).exists())

    def test_team_deletion_keeps_disciplinary_protection(self):
        from core.enrollment_models import PlayerSanction
        from uuid import uuid4
        row, _ = self.signed_team_fixture()
        PlayerSanction.objects.create(team=self.team, enrollment=row, player_name=row.name,
            offense_code='s01', offense_label='Incidente', reason='Prueba', incident_on=timezone.localdate(),
            starts_on=timezone.localdate(), created_by=self.emilio, duration_unit='indefinite', request_id=uuid4())
        self.client.force_authenticate(self.emilio)
        response = self.client.get(f'/api/player-enrollments/teams/{self.team.pk}/deletion-preview/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['preserved_sanction_count'], 1)
        self.assertEqual(PlayerSanction.objects.filter(team=self.team).count(), 1)

    def empty_team_match(self):
        from core.models import Match, AttendanceSession, Player
        team = Team.objects.create(tournament=self.tournament, name='Equipo programado')
        player = Player.objects.create(team=team, full_name='Cliente que se conserva')
        match = Match.objects.create(tournament=self.tournament, site=self.site, home_team=team, away_team=self.team)
        session = AttendanceSession.objects.create(site=self.site, tournament=self.tournament, team=team,
            match=match, session_type='tournament_match', date=match.played_on, captured_by=self.emilio)
        self.client.force_authenticate(self.emilio)
        return team, player, match, session

    def test_delete_team_removes_only_empty_scheduled_match_and_preserves_clients(self):
        from core.models import Match, AttendanceSession, Player
        team, player, match, session = self.empty_team_match()
        url = f'/api/player-enrollments/teams/{team.pk}/'
        response = self.client.get(url+'deletion-preview/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['count'] for item in response.json()['items']], [1, 1, 1])
        payload = {'confirmation_token':response.json()['confirmation_token'], 'confirmation_name':team.name}
        self.assertEqual(self.client.delete(url, payload, format='json').status_code, 200)
        player.refresh_from_db()
        self.assertIsNone(player.team_id)
        self.assertTrue(Player.objects.filter(pk=player.pk).exists())
        self.assertTrue(Team.objects.filter(pk=self.team.pk).exists())
        self.assertFalse(Match.objects.filter(pk=match.pk).exists())
        self.assertFalse(AttendanceSession.objects.filter(pk=session.pk).exists())

    def test_team_match_results_are_protected(self):
        team, _, match, _ = self.empty_team_match()
        match.home_goals = 1
        match.save()
        self.assertEqual(self.client.get(f'/api/player-enrollments/teams/{team.pk}/deletion-preview/').status_code, 400)

    def test_team_player_attendance_is_protected(self):
        from core.models import PlayerAttendanceRecord
        team, player, _, session = self.empty_team_match()
        PlayerAttendanceRecord.objects.create(session=session, player=player, status='present', captured_by=self.emilio)
        self.assertEqual(self.client.get(f'/api/player-enrollments/teams/{team.pk}/deletion-preview/').status_code, 400)

    def test_team_match_changes_invalidate_review(self):
        team, _, match, _ = self.empty_team_match()
        url = f'/api/player-enrollments/teams/{team.pk}/'
        response = self.client.get(url+'deletion-preview/')
        match.duration_minutes += 1
        match.save()
        payload = {'confirmation_token':response.json()['confirmation_token'], 'confirmation_name':team.name}
        self.assertEqual(self.client.delete(url, payload, format='json').status_code, 400)
        self.assertTrue(Team.objects.filter(pk=team.pk).exists())

    def check_faceguard_evidence_preserved(self, clip_status):
        import json
        from django.db import connection
        team, player, match, session = self.empty_team_match()
        with connection.cursor() as cursor:
            cursor.execute('CREATE TABLE video_clips (id TEXT PRIMARY KEY, status TEXT, match_id INTEGER, attendance_session_id INTEGER, metadata TEXT)')
        try:
            with connection.cursor() as cursor:
                cursor.execute('INSERT INTO video_clips VALUES (%s,%s,%s,%s,%s)', ['clip-test',clip_status,match.pk,session.pk,'{"evidence":"keep"}'])
            url = f'/api/player-enrollments/teams/{team.pk}/'
            response = self.client.get(url+'deletion-preview/')
            self.assertEqual(response.status_code, 200)
            payload = {'confirmation_token':response.json()['confirmation_token'], 'confirmation_name':team.name}
            self.assertEqual(self.client.delete(url, payload, format='json').status_code, 200)
            with connection.cursor() as cursor:
                cursor.execute('SELECT status,match_id,attendance_session_id,metadata FROM video_clips WHERE id=%s', ['clip-test'])
                row = cursor.fetchone()
            self.assertEqual(row[:3], (clip_status,None,None))
            metadata = json.loads(row[3])
            self.assertEqual(metadata['evidence'], 'keep')
            self.assertEqual(metadata['team_deletion_evidence']['match_id'], match.pk)
            player.refresh_from_db()
            self.assertIsNone(player.team_id)
        finally:
            with connection.cursor() as cursor:
                cursor.execute('DROP TABLE video_clips')

    def test_deleted_faceguard_clip_is_preserved_without_blocking_team(self):
        self.check_faceguard_evidence_preserved('deleted')

    def test_processed_faceguard_clip_is_preserved_without_blocking_team(self):
        self.check_faceguard_evidence_preserved('processed')

    def test_failed_faceguard_clip_is_preserved_without_blocking_team(self):
        self.check_faceguard_evidence_preserved('failed')

    def test_active_faceguard_clip_blocks_empty_match_deletion(self):
        from django.db import connection
        team, _, match, session = self.empty_team_match()
        with connection.cursor() as cursor:
            cursor.execute('CREATE TABLE video_clips (id TEXT PRIMARY KEY, status TEXT, match_id INTEGER, attendance_session_id INTEGER, metadata TEXT)')
        try:
            with connection.cursor() as cursor:
                cursor.execute('INSERT INTO video_clips VALUES (%s,%s,%s,%s,%s)', ['clip-active','uploaded',match.pk,session.pk,'{}'])
            self.assertEqual(self.client.get(f'/api/player-enrollments/teams/{team.pk}/deletion-preview/').status_code, 400)
            self.assertTrue(Team.objects.filter(pk=team.pk).exists())
        finally:
            with connection.cursor() as cursor:
                cursor.execute('DROP TABLE video_clips')

    def payload(self, minor=False, tutor=True, blank=False):
        data = {"given_names": "Jugador", "paternal_surname": "de", "maternal_surname": "prueba", "birth_date": "2015-01-01" if minor else "1990-01-01", "identity_type": "minor" if minor else "ine", "phone": "5512345678", "phone_secondary": "5587654321", "accepted_terms": "true", "player_photo": image_file("foto.png"), "player_signature": image_file("firma.png", blank)}
        if minor:
            data.update({kind: image_file(kind + ".png") for kind in ("minor_credential", "curp", "guardian_ine_front", "guardian_ine_back")})
        else:
            data.update(ine_front=image_file("frente.png"), ine_back=image_file("reverso.png"))
        if minor and tutor:
            data.update(guardian_name="Tutor de prueba", guardian_signature=image_file("tutor.png"))
        return data

    def test_adult_accepts_without_tutor_and_rejects_duplicate(self):
        self.assertEqual(self.client.post(self.url, self.payload(), format="multipart").status_code, 201)
        self.assertEqual(self.client.post(self.url, self.payload(), format="multipart").status_code, 409)
        self.assertEqual(PlayerEnrollment.objects.count(), 1)
        self.assertEqual(PlayerEnrollmentDocument.objects.count(), 4)

    def test_passport_and_cartilla_are_accepted(self):
        for kind in ("passport", "military_card"):
            invitation = self.new_invitation()
            data = self.payload(); data["identity_type"] = kind
            del data["ine_front"]; del data["ine_back"]
            data["identity_document"] = image_file("documento.png")
            self.assertEqual(self.client.post(f"/api/player-enrollments/public/{invitation.token}/", data, format="multipart").status_code, 201)

    def test_player_photo_is_required_and_must_be_image(self):
        data = self.payload(); del data["player_photo"]
        self.assertEqual(self.client.post(self.url, data, format="multipart").status_code, 400)
        data = self.payload(); data["player_photo"] = SimpleUploadedFile("foto.pdf", b"%PDF-1.4 test", content_type="application/pdf")
        self.assertEqual(self.client.post(self.url, data, format="multipart").status_code, 400)

    def test_large_phone_photos_and_identity_documents_are_accepted(self):
        for kind in ("player_photo", "ine_front"):
            with self.subTest(kind=kind):
                source = image_file("phone.png").read() + b"\0" * 3_100_000
                content, mime = validated_file(SimpleUploadedFile("phone.png", source), kind)
                self.assertTrue(content)
                self.assertIn(mime, ("image/jpeg", "image/png"))
        image = Image.new("RGB", (5000, 3400), "white")
        buffer = BytesIO(); image.save(buffer, "JPEG")
        content, mime = validated_file(SimpleUploadedFile("high-resolution.jpg", buffer.getvalue()), "player_photo")
        with Image.open(BytesIO(content)) as saved:
            self.assertLessEqual(saved.width, 400)
            self.assertLessEqual(saved.height, 500)

    def test_enrollment_upload_size_limits_remain_enforced(self):
        for kind, limit in (("player_photo", ENROLLMENT_FILE_MAX_BYTES), ("ine_front", ENROLLMENT_FILE_MAX_BYTES), ("player_signature", 500_000)):
            with self.subTest(kind=kind), self.assertRaises(ValidationError):
                validated_file(SimpleUploadedFile("oversized.png", b"x" * (limit + 1)), kind)

    def test_new_documents_are_private_storage_references_not_database_blobs(self):
        self.assertEqual(self.client.post(self.url, self.payload(), format="multipart").status_code, 201)
        for doc in PlayerEnrollmentDocument.objects.all():
            self.assertEqual(bytes(doc.content), b"")
            self.assertIn(doc.storage_path, self.storage)
        self.client.force_authenticate(self.other)
        doc = PlayerEnrollmentDocument.objects.first()
        self.assertEqual(self.client.get(f"/api/player-enrollments/documents/{doc.pk}/").status_code, 404)

    def test_failed_storage_upload_does_not_create_partial_enrollment(self):
        self.upload_storage.side_effect = RuntimeError("storage unavailable")
        self.assertEqual(self.client.post(self.url, self.payload(), format="multipart").status_code, 503)
        self.assertEqual(PlayerEnrollment.objects.count(), 0)
        self.assertEqual(PlayerEnrollmentDocument.objects.count(), 0)
        self.assertTrue(self.delete_storage.called)

    def test_legacy_migration_verifies_storage_before_clearing_database(self):
        from io import StringIO
        from django.core.management import call_command
        from django.core.management.base import CommandError
        from hashlib import sha256
        self.assertEqual(self.client.post(self.url, self.payload(), format="multipart").status_code, 201)
        doc = PlayerEnrollmentDocument.objects.first()
        original = self.storage[doc.storage_path]
        doc.storage_path = ""; doc.content = original; doc.sha256 = sha256(original).hexdigest(); doc.save()
        with patch("core.services.enrollment_storage.ensure_private_bucket"), patch("core.services.enrollment_storage.verify_document", side_effect=CommandError("verification failed")):
            with self.assertRaises(CommandError):
                call_command("migrate_enrollment_documents_to_storage", apply=True, stdout=StringIO())
        doc.refresh_from_db()
        self.assertEqual(bytes(doc.content), original)
        self.assertEqual(doc.storage_path, "")
        with patch("core.services.enrollment_storage.ensure_private_bucket"):
            call_command("migrate_enrollment_documents_to_storage", apply=True, stdout=StringIO())
        doc.refresh_from_db()
        self.assertEqual(bytes(doc.content), b"")
        self.assertEqual(self.storage[doc.storage_path], original)

    def test_legacy_database_document_stays_readable(self):
        from hashlib import sha256
        self.assertEqual(self.client.post(self.url, self.payload(), format="multipart").status_code, 201)
        doc = PlayerEnrollmentDocument.objects.first()
        content = self.storage[doc.storage_path]
        doc.storage_path = ""; doc.content = content; doc.sha256 = sha256(content).hexdigest(); doc.save()
        self.client.force_authenticate(self.emilio)
        response = self.client.get(f"/api/player-enrollments/documents/{doc.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, content)

    def test_minor_requires_curp_and_tutor_identity(self):
        for kind in ("curp", "guardian_ine_front", "minor_credential"):
            data = self.payload(minor=True); del data[kind]
            self.assertEqual(self.client.post(self.url, data, format="multipart").status_code, 400)

    def test_team_and_tournament_filter_and_terms_snapshot(self):
        self.client.post(self.url, self.payload(), format="multipart")
        self.client.force_authenticate(self.emilio)
        self.assertEqual(self.client.get("/api/player-enrollments/?team=Equipo&tournament=Torneo").json()["count"], 1)
        self.assertEqual(self.client.get("/api/player-enrollments/?team=Otro").json()["count"], 0)
        self.assertTrue(PlayerEnrollment.objects.first().terms_text)

    def test_minor_needs_tutor_name_and_signature(self):
        self.assertEqual(self.client.post(self.url, self.payload(minor=True, tutor=False), format="multipart").status_code, 400)
        data = self.payload(minor=True); del data["guardian_signature"]
        self.assertEqual(self.client.post(self.url, data, format="multipart").status_code, 400)
        self.assertEqual(self.client.post(self.url, self.payload(minor=True), format="multipart").status_code, 201)

    def test_minor_accepts_only_guardian_signature_and_does_not_store_child_signature(self):
        data = self.payload(minor=True)
        del data['player_signature']
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 201)
        self.assertTrue(PlayerEnrollmentDocument.objects.filter(kind='guardian_signature').exists())
        self.assertFalse(PlayerEnrollmentDocument.objects.filter(kind='player_signature').exists())

    def test_minor_legacy_upload_ignores_child_signature(self):
        self.assertEqual(self.client.post(self.url, self.payload(minor=True), format='multipart').status_code, 201)
        self.assertFalse(PlayerEnrollmentDocument.objects.filter(kind='player_signature').exists())

    def test_adult_still_requires_player_signature(self):
        data = self.payload()
        del data['player_signature']
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 400)

    def test_blank_signature_rejected(self):
        self.assertEqual(self.client.post(self.url, self.payload(blank=True), format="multipart").status_code, 400)
        self.assertEqual(PlayerEnrollment.objects.count(), 0)

    def test_required_identity_and_consent(self):
        data = self.payload(); del data["ine_back"]
        self.assertEqual(self.client.post(self.url, data, format="multipart").status_code, 400)
        data = self.payload(); data["accepted_terms"] = "false"
        self.assertEqual(self.client.post(self.url, data, format="multipart").status_code, 400)

    def test_expired_and_unknown_invitation(self):
        self.invitation.expires_at = timezone.now() - timedelta(days=1); self.invitation.save()
        self.assertEqual(self.client.get(self.url).status_code, 410)
        self.assertEqual(self.client.get("/api/player-enrollments/public/unknown/").status_code, 404)

    def test_new_enrollment_links_preserve_30_day_validity(self):
        self.client.force_authenticate(self.emilio)
        response = self.client.post('/api/player-enrollments/', {'team_id': self.team.pk, 'tournament_id': self.tournament.pk}, format='json')
        self.assertEqual(response.status_code, 201)
        invitation = PlayerEnrollmentInvitation.objects.get(token=response.data['token'])
        self.assertAlmostEqual((invitation.expires_at - invitation.created_at).total_seconds(), 30 * 86400, delta=2)

    def test_legacy_links_keep_their_original_expiration(self):
        PlayerEnrollmentInvitation.objects.filter(pk=self.invitation.pk).update(
            created_at=timezone.now() - timedelta(hours=25), expires_at=timezone.now() + timedelta(days=30))
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.client.post(self.url, self.payload(), format='multipart').status_code, 201)

    def test_link_expires_at_exact_declared_deadline(self):
        deadline = self.invitation.expires_at
        with patch('core.api.enrollments.timezone.now', return_value=deadline - timedelta(seconds=1)):
            self.assertEqual(self.client.get(self.url).status_code, 200)
        with patch('core.api.enrollments.timezone.now', return_value=deadline):
            self.assertEqual(self.client.get(self.url).status_code, 410)

    def test_withdrawal_link_validity_is_unchanged(self):
        self.client.post(self.url, self.payload(), format='multipart')
        self.client.force_authenticate(self.emilio)
        response = self.client.post('/api/player-enrollments/', {'team_id': self.team.pk, 'tournament_id': self.tournament.pk, 'purpose': 'withdraw'}, format='json')
        self.assertEqual(response.status_code, 201)
        invitation = PlayerEnrollmentInvitation.objects.get(token=response.data['token'])
        self.assertAlmostEqual((invitation.expires_at - invitation.created_at).total_seconds(), 7 * 86400, delta=2)

    def test_private_history_and_documents(self):
        self.client.post(self.url, self.payload(), format="multipart")
        doc = PlayerEnrollmentDocument.objects.first()
        self.assertEqual(self.client.get("/api/player-enrollments/").status_code, 401)
        self.assertEqual(self.client.get(f"/api/player-enrollments/documents/{doc.pk}/").status_code, 401)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get("/api/player-enrollments/").json()["count"], 0)
        self.assertEqual(self.client.get(f"/api/player-enrollments/documents/{doc.pk}/").status_code, 404)
        self.client.force_authenticate(self.emilio)
        result = self.client.get("/api/player-enrollments/")
        self.assertEqual(result.json()["count"], 1)
        self.assertNotIn("content", str(result.json()))
        self.assertEqual(self.client.get(f"/api/player-enrollments/documents/{doc.pk}/").status_code, 200)

    def test_operator_token_denies_other_application_routes(self):
        from rest_framework.authtoken.models import Token
        token = Token.objects.create(user=self.emilio)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        self.assertEqual(self.client.get("/api/sites/").status_code, 403)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 200)
        self.assertEqual(self.client.get("/api/player-enrollments/").status_code, 200)
        self.assertEqual(self.client.get('/api/player-enrollments/catalog/').status_code, 200)
        self.assertEqual(self.client.delete('/api/player-enrollments/catalog/').status_code, 405)

    def test_invitation_requires_existing_team_in_selected_tournament(self):
        self.client.force_authenticate(self.emilio)
        url='/api/player-enrollments/'
        self.assertEqual(self.client.post(url,{'team':'Equipo','tournament':'Torneo'},format='json').status_code,400)
        other=Tournament.objects.create(site=self.site,name='Otro torneo',billing_type='weekly_match')
        self.assertEqual(self.client.post(url,{'team_id':self.team.pk,'tournament_id':other.pk},format='json').status_code,400)
        response=self.client.post(url,{'team_id':self.team.pk,'tournament_id':self.tournament.pk},format='json')
        self.assertEqual(response.status_code,201)
        invitation=PlayerEnrollmentInvitation.objects.get(token=response.json()['token'])
        self.assertEqual(invitation.team_record_id,self.team.pk)
        public=self.client.get(f'/api/player-enrollments/public/{invitation.token}/').json()
        self.assertEqual(public['team'],'Equipo')
        self.assertEqual(public['tournament_id'],self.tournament.pk)
        self.assertNotIn('category',public)
        self.team.is_active=False;self.team.save()
        self.assertEqual(self.client.post(url,{'team_id':self.team.pk,'tournament_id':self.tournament.pk},format='json').status_code,400)

    def test_emergency_phone_is_optional_but_validated_when_present(self):
        from core.api.enrollments import EnrollmentInput
        base = {'given_names': 'Jugador', 'paternal_surname': 'de', 'maternal_surname': 'prueba', 'birth_date': '1990-01-01',
                'identity_type': 'ine', 'phone': '5512345678', 'accepted_terms': True}
        for extra in ({}, {'phone_secondary': ''}, {'phone_secondary': '5587654321'}):
            with self.subTest(extra=extra):
                serializer = EnrollmentInput(data={**base, **extra})
                self.assertTrue(serializer.is_valid(), serializer.errors)
                self.assertEqual(serializer.validated_data['phone_secondary'], extra.get('phone_secondary', ''))
        serializer = EnrollmentInput(data={**base, 'phone_secondary': 'incorrecto'})
        self.assertFalse(serializer.is_valid())
        self.assertIn('phone_secondary', serializer.errors)

    def test_public_submission_cannot_change_assigned_team_or_tournament(self):
        data=self.payload()
        data.update(team='Otro equipo',tournament='Otro torneo',category='No existe',team_id=999)
        self.assertEqual(self.client.post(self.url,data,format='multipart').status_code,201)
        row=PlayerEnrollment.objects.get()
        self.assertEqual((row.team,row.tournament,row.team_record_id,row.category),('Equipo','Torneo',self.team.pk,''))
        self.client.force_authenticate(self.emilio)
        result=self.client.get(f'/api/player-enrollments/?team_id={self.team.pk}&tournament_id={self.tournament.pk}').json()
        self.assertEqual(result['count'],1)
        self.assertNotIn('category',result['results'][0])
        self.assertEqual(self.client.get('/api/player-enrollments/?team_id=invalid').status_code,400)

    def test_catalog_reuses_existing_models_and_keeps_other_areas_private(self):
        self.assertEqual(self.client.get('/api/player-enrollments/catalog/').status_code,401)
        self.client.force_authenticate(self.emilio)
        response=self.client.post('/api/player-enrollments/catalog/',{'kind':'tournament','site':self.site.pk,'name':'Copa compartida','billing_type':'weekly_match','football_format':'fut7','is_active':True},format='json')
        self.assertEqual(response.status_code,201)
        tournament=Tournament.objects.get(name='Copa compartida')
        response=self.client.post('/api/player-enrollments/catalog/',{'kind':'team','tournament':tournament.pk,'name':'Halcones','representative_name':'Responsable','representative_phone':'5512345678','is_active':True},format='json')
        self.assertEqual(response.status_code,201)
        team=Team.objects.get(name='Halcones')
        self.assertEqual(team.tournament_id,tournament.pk)
        catalog=self.client.get('/api/player-enrollments/catalog/').json()
        self.assertIn(team.pk,[item['id'] for item in catalog['teams']])
        self.assertNotIn('representative_phone',catalog['teams'][0])
        regular=User.objects.create_user(username='normal',role='collaborator')
        self.client.force_authenticate(regular)
        self.assertEqual(self.client.get('/api/player-enrollments/catalog/').status_code,403)

    def test_catalog_creates_team_without_representative(self):
        self.client.force_authenticate(self.emilio)
        for index, fields in enumerate(({}, {'representative_name': '', 'representative_phone': ''})):
            response = self.client.post('/api/player-enrollments/catalog/', {
                'kind': 'team', 'tournament': self.tournament.pk,
                'name': f'Equipo academia {index}', **fields,
            }, format='json')
            self.assertEqual(response.status_code, 201, response.data)
            team = Team.objects.get(pk=response.data['id'])
            self.assertEqual(team.representative_name, '')
            self.assertEqual(team.representative_phone, '')

    def test_old_ambiguous_links_are_not_guessed(self):
        invitation=PlayerEnrollmentInvitation.objects.create(created_by=self.emilio,expires_at=timezone.now()+timedelta(days=1),team='Nombre libre',tournament='Nombre libre')
        self.assertEqual(self.client.get(f'/api/player-enrollments/public/{invitation.token}/').status_code,410)

    def test_eighteenth_birthday_is_adult(self):
        today = timezone.localdate()
        with __import__("unittest.mock", fromlist=["patch"]).patch("core.api.enrollments.timezone.localdate", return_value=date(2026, 10, 7)):
            self.assertFalse(is_minor(date(2008, 10, 7)))
            self.assertTrue(is_minor(date(2008, 10, 8)))
