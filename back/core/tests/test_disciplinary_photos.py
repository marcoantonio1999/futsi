from hashlib import sha256
from unittest.mock import patch
from django.test import TestCase,override_settings
from core.tests import test_disciplinary
from core.tests.test_player_enrollments import image_file
from core.models import User,Player,PlayerBlacklistEntry,AuditLog
from core.enrollment_models import PlayerEnrollmentDocument
from core.services.disciplinary_photos import stored_thumbnail


@override_settings(ALLOWED_HOSTS=['testserver'],MIGRATION_MODULES={'core':None})
class DisciplinaryPhotoTests(TestCase):
    setUp=test_disciplinary.DisciplinaryTests.setUp
    add_payload=test_disciplinary.DisciplinaryTests.add_payload

    def photo(self,path=''):
        self.image=image_file('foto.png').read()
        return PlayerEnrollmentDocument.objects.create(enrollment=self.enrollment,kind='player_photo',content=b'' if path else self.image,storage_path=path,content_type='image/png',sha256=sha256(self.image).hexdigest())

    @property
    def url(self):return f'/api/player-enrollments/disciplinary/{self.sanction.pk}/photo/'

    def test_private_photo_scopes_and_no_identity_document_fallback(self):
        self.assertEqual(self.client.get(self.url).status_code,404)
        self.photo()
        response=self.client.get(self.url)
        self.assertEqual(response.status_code,200)
        self.assertEqual(response['Content-Type'],'image/jpeg')
        self.assertEqual(response['Cache-Control'],'private, no-store')
        from PIL import Image
        from io import BytesIO
        with Image.open(BytesIO(response.content)) as image:self.assertLessEqual(max(image.size),192)
        self.client.force_authenticate(None);self.assertEqual(self.client.get(self.url).status_code,401)
        coordinator=User.objects.create_user(username='photo-other',role='site_coordinator',primary_site=self.other)
        self.client.force_authenticate(coordinator);self.assertEqual(self.client.get(self.url).status_code,404)
        coordinator.primary_site=self.site;coordinator.save()
        self.assertEqual(self.client.get(self.url).status_code,200)

    def test_metadata_contains_availability_never_binary_or_storage_paths(self):
        self.photo('private/source/photo.png')
        response=self.client.get('/api/player-enrollments/disciplinary/')
        self.assertTrue(response.json()['results'][0]['has_photo'])
        self.assertNotIn('private/source/photo.png',response.content.decode())
        self.assertNotIn('photo_content',response.content.decode())

    def test_blacklist_photo_survives_origin_deletion_and_is_global_private(self):
        self.photo();self.client.post(self.blacklist,self.add_payload(),format='json')
        row=PlayerBlacklistEntry.objects.get();url=f'/api/player-enrollments/blacklist/{row.pk}/photo/'
        self.assertTrue(self.client.get(self.blacklist).json()['results'][0]['has_photo'])
        self.sanction.delete();self.enrollment.delete();self.invitation.delete();self.team.delete();self.tournament.delete()
        self.assertEqual(self.client.get(url).status_code,200)
        coordinator=User.objects.create_user(username='blacklist-photo-other',role='site_coordinator',primary_site=self.other)
        self.client.force_authenticate(coordinator);self.assertEqual(self.client.get(url).status_code,200)
        self.client.force_authenticate(None);self.assertEqual(self.client.get(url).status_code,401)

    def test_blacklist_storage_photo_is_retained_when_tournament_is_deleted(self):
        self.photo('private/source/photo.png');self.client.post(self.blacklist,self.add_payload(),format='json')
        from core.services.tournament_deletion import deletion_plan
        plan=deletion_plan(self.tournament)
        self.assertFalse(any('private/source/photo.png' in str(item) for item in plan['files']))
        from core.services.student_deletion import cleanup_files
        audit=AuditLog.objects.create(actor=self.user,action='tournament_deleted',table_name='tournaments',record_id=str(self.tournament.pk),metadata={'pending_files':[{'kind':'supabase','uri':'supabase://player-enrollment-private/private/source/photo.png'}]})
        with patch('core.services.student_deletion.delete_private_file') as delete:
            self.assertEqual(cleanup_files(audit)['cleanup_pending'],0);delete.assert_not_called()

    def test_thumbnail_cache_is_small_and_hash_mismatch_is_not_served(self):
        self.photo('private/source/cached-photo.png');stored_thumbnail.cache_clear()
        with patch('core.services.disciplinary_photos.enrollment_storage.read_document',return_value=self.image) as read:
            self.assertEqual(self.client.get(self.url).status_code,200)
            self.assertEqual(self.client.get(self.url).status_code,200)
            read.assert_called_once()
        stored_thumbnail.cache_clear()
        with patch('core.services.disciplinary_photos.enrollment_storage.read_document',return_value=b'wrong image'):
            self.assertEqual(self.client.get(self.url).status_code,503)

    def test_legacy_player_photo_uses_private_endpoint_not_remote_url(self):
        player=Player.objects.create(team=self.team,full_name='Jugador Legado Pérez',photo='players/photos/fixture.jpg',photo_url='https://untrusted.invalid/image.jpg')
        self.sanction.enrollment=None;self.sanction.player=player;self.sanction.save()
        self.assertTrue(self.client.get('/api/player-enrollments/disciplinary/').json()['results'][0]['has_photo'])
        with patch('core.api.disciplinary.legacy_thumbnail',return_value=b'jpeg-thumbnail') as read:
            self.assertEqual(self.client.get(self.url).status_code,200);read.assert_called_once_with(player.photo.name)
