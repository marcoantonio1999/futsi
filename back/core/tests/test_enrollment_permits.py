from datetime import timedelta
from io import BytesIO
from unittest.mock import patch
from uuid import uuid4

from PIL import Image, ImageDraw
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User, Site, Tournament, Team
from core.enrollment_models import PlayerTemporaryPermit, PlayerPermitInvitation, PlayerEnrollment


@override_settings(ALLOWED_HOSTS=['testserver'], MIGRATION_MODULES={'core': None})
class EnrollmentPermitTests(TestCase):
    def setUp(self):
        self.site = Site.objects.create(name='Sede prueba', code='permit')
        self.tournament = Tournament.objects.create(site=self.site, name='Torneo', billing_type='weekly_match')
        self.team = Team.objects.create(tournament=self.tournament, name='Equipo')
        self.user = User.objects.create_user(username='operador', role='collaborator',
            section_permissions=['player_enrollments_only', f'player_enrollments_site:{self.site.pk}'])
        self.client = APIClient(); self.client.force_authenticate(self.user)
        self.url = '/api/player-enrollments/permits/'
        self.storage = {}
        def upload(path, content, mime):
            path = 'r2://private/' + path; self.storage[path] = content; return path
        self.upload = patch('core.api.enrollment_permits.enrollment_storage.upload_document', side_effect=upload).start()
        self.cleanup = patch('core.api.enrollment_permits.enrollment_storage.delete_document').start()
        self.addCleanup(patch.stopall)

    def data(self, request_id=None):
        image = BytesIO(); Image.new('RGB', (1000, 1000), 'green').save(image, 'JPEG')
        signature = BytesIO(); canvas = Image.new('RGB', (900, 360), 'white')
        ImageDraw.Draw(canvas).line([(25, 40), (250, 150), (500, 40)], fill='black', width=5); canvas.save(signature, 'PNG')
        return dict(request_id=str(request_id or uuid4()), team_id=self.team.pk, name='Jugador de prueba', accepted='true',
                    signature=SimpleUploadedFile('firma.png', signature.getvalue(), content_type='image/png'),
                    photo=SimpleUploadedFile('foto.jpg', image.getvalue(), content_type='image/jpeg'))

    def test_signed_permit_server_dates_and_no_registration(self):
        now = timezone.now()
        data = self.data(); data.update(issued_at='2000-01-01', expires_at='2099-01-01')
        with patch('core.api.enrollment_permits.timezone.now', return_value=now):
            response = self.client.post(self.url, data, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        row = PlayerTemporaryPermit.objects.get()
        self.assertEqual(row.issued_at, now)
        self.assertEqual(row.expires_at - row.issued_at, timedelta(hours=24))
        self.assertEqual(response.data['folio'], f'P-{row.pk:06d}')
        self.assertTrue(row.photo_storage_path.startswith('r2://'))
        self.assertFalse(PlayerEnrollment.objects.exists())
        self.assertNotIn('photo_storage_path', response.data)

    def test_retries_do_not_extend_or_duplicate_permit(self):
        key = uuid4()
        first = self.client.post(self.url, self.data(key), format='multipart')
        again = self.client.post(self.url, self.data(key), format='multipart')
        self.assertEqual(again.status_code, 200)
        self.assertEqual(first.data, again.data)
        self.assertEqual(PlayerTemporaryPermit.objects.count(), 1)
        self.assertEqual(self.upload.call_count, 2)

    def test_expiration_is_exact_and_filters_agree(self):
        self.client.post(self.url, self.data(), format='multipart')
        row = PlayerTemporaryPermit.objects.get()
        with patch('core.api.enrollment_permits.timezone.now', return_value=row.expires_at-timedelta(microseconds=1)):
            self.assertEqual(self.client.get(self.url+'?status=active').data['count'], 1)
        with patch('core.api.enrollment_permits.timezone.now', return_value=row.expires_at):
            self.assertEqual(self.client.get(self.url+'?status=active').data['count'], 0)
            response = self.client.get(self.url+'?status=expired')
            self.assertEqual(response.data['results'][0]['status'], 'expired')

    def test_missing_photo_and_pdf_rejected_before_storage(self):
        data = self.data(); data.pop('photo')
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 400)
        data = self.data(); data['photo'] = SimpleUploadedFile('id.pdf', b'%PDF-1.4', content_type='application/pdf')
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 400)
        self.upload.assert_not_called()

    def test_other_site_cannot_list_read_or_create(self):
        self.client.post(self.url, self.data(), format='multipart')
        row = PlayerTemporaryPermit.objects.get()
        self.user.section_permissions = ['player_enrollments_only', 'player_enrollments_site:999999']; self.user.save()
        self.assertEqual(self.client.get(self.url).data['count'], 0)
        self.assertEqual(self.client.get(f'{self.url}{row.pk}/photo/').status_code, 404)
        self.assertEqual(self.client.post(self.url, self.data(), format='multipart').status_code, 404)

    def test_unauthorized_user_cannot_issue_or_read(self):
        self.user.section_permissions = []; self.user.save()
        self.assertEqual(self.client.post(self.url, self.data(), format='multipart').status_code, 403)
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_inactive_team_rejected(self):
        self.team.is_active = False; self.team.save()
        self.assertEqual(self.client.post(self.url, self.data(), format='multipart').status_code, 404)
        self.upload.assert_not_called()

    def test_photo_uses_private_r2_delivery(self):
        self.client.post(self.url, self.data(), format='multipart')
        row = PlayerTemporaryPermit.objects.get()
        with patch('core.api.enrollments.enrollment_r2.signed_url', return_value='https://example.r2.cloudflarestorage.com/photo?temporary=1'):
            result = self.client.get(f'{self.url}{row.pk}/photo/?delivery=direct')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result['Cache-Control'], 'private, no-store')

    def test_failed_database_write_removes_uploaded_photo(self):
        with patch('core.api.enrollment_permits.PlayerTemporaryPermit.objects.create', side_effect=RuntimeError('synthetic')):
            with self.assertRaises(RuntimeError):
                self.client.post(self.url, self.data(), format='multipart')
        self.assertEqual(self.cleanup.call_count, 2)
        self.assertFalse(PlayerTemporaryPermit.objects.exists())


    def test_signature_and_consent_required_before_any_upload(self):
        for field in ('signature', 'accepted'):
            data = self.data(); data.pop(field)
            self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 400)
        data = self.data(); data['accepted'] = 'false'
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 400)
        data = self.data(); image = BytesIO(); Image.new('RGB',(900,360),'white').save(image,'PNG')
        data['signature'] = SimpleUploadedFile('vacia.png',image.getvalue(),content_type='image/png')
        self.assertEqual(self.client.post(self.url, data, format='multipart').status_code, 400)
        self.upload.assert_not_called()

    def invite(self):
        result = self.client.post(self.url+'invitations/', {'team_id':self.team.pk},format='json')
        self.assertEqual(result.status_code,201,result.data)
        return self.url+'public/'+result.data['token']+'/'

    def test_online_flow_one_use_no_login_and_24h_from_signing(self):
        url = self.invite()
        self.assertFalse(PlayerTemporaryPermit.objects.exists())
        client = APIClient()
        details = client.get(url)
        self.assertEqual(details.status_code,200)
        self.assertNotIn('created_by',details.data)
        data = self.data(); key = data['request_id']; data['team_id'] = 999999
        now = timezone.now()+timedelta(hours=4)
        with patch('core.api.enrollment_permits.timezone.now',return_value=now):
            result = client.post(url,data,format='multipart')
        self.assertEqual(result.status_code,201,result.data)
        row = PlayerTemporaryPermit.objects.get()
        self.assertEqual(row.source,'online')
        self.assertEqual(row.issued_at,now)
        self.assertEqual(row.expires_at-now,timedelta(hours=24))
        self.assertEqual(row.team_id,self.team.pk)
        self.assertTrue(row.signature_storage_path.startswith('r2://'))
        self.assertIn('Acepto jugar',row.terms_text[-1])
        self.assertEqual(client.get(url).status_code,410)
        self.assertEqual(client.post(url,self.data(key),format='multipart').status_code,200)
        self.assertEqual(client.post(url,self.data(),format='multipart').status_code,400)
        self.assertEqual(PlayerTemporaryPermit.objects.count(),1)
        self.assertEqual(client.get(f'{self.url}{row.pk}/signature/').status_code,401)

    def test_expired_or_revoked_link_cannot_issue(self):
        url = self.invite(); invitation=PlayerPermitInvitation.objects.get()
        invitation.expires_at=timezone.now(); invitation.save()
        public=APIClient()
        self.assertEqual(public.get(url).status_code,410)
        self.assertEqual(public.post(url,self.data(),format='multipart').status_code,400)
        invitation.expires_at=timezone.now()+timedelta(days=1);invitation.save()
        self.user.section_permissions=[];self.user.save()
        self.assertEqual(public.get(url).status_code,404)
        self.assertEqual(public.post(url,self.data(),format='multipart').status_code,404)
        self.upload.assert_not_called()

    def test_missing_public_signature_does_not_consume_invitation(self):
        url = self.invite(); data=self.data();data.pop('signature')
        public=APIClient();self.assertEqual(public.post(url,data,format='multipart').status_code,400)
        self.assertEqual(public.get(url).status_code,200)
        self.assertFalse(PlayerTemporaryPermit.objects.exists())
        self.upload.assert_not_called()
