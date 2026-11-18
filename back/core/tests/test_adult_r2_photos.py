import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
from django.test import SimpleTestCase
from core.services import adult_photos
from core.api.automatic_attendance_domain import has_configured_reference

ENV = {'ENROLLMENT_R2_ACCOUNT_ID':'a'*32,'ENROLLMENT_R2_BUCKET':'private-test',
       'ENROLLMENT_R2_ACCESS_KEY_ID':'b'*32,'ENROLLMENT_R2_SECRET_ACCESS_KEY':'c'*64}

class AdultR2PhotoTests(SimpleTestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, ENV); self.env.start(); self.addCleanup(self.env.stop)

    def person(self, uri='r2://private-test/adults/27/import/photo.png', site=27):
        return SimpleNamespace(photo_url=uri, photo=None, team=SimpleNamespace(tournament=SimpleNamespace(site_id=site)))

    def test_scoped_private_temporary_link(self):
        url = adult_photos.display_url(self.person())
        parsed = urlparse(url)
        self.assertEqual(parsed.scheme, 'https')
        self.assertEqual(parse_qs(parsed.query)['X-Amz-Expires'], ['900'])
        self.assertEqual(parsed.path, '/private-test/adults/27/import/photo.png')

    def test_other_site_bucket_and_prefix_rejected(self):
        for uri in ['r2://other-bucket/adults/27/a.png','r2://private-test/adults/42/a.png',
                    'r2://private-test/enrollments/secret.png','r2://private-test/adults/27/../42/a.png']:
            self.assertEqual(adult_photos.display_url(self.person(uri)), '')
            self.assertFalse(has_configured_reference(self.person(uri)))

    def test_reference_available_without_downloading(self):
        with patch('core.services.enrollment_r2.request') as request:
            self.assertTrue(has_configured_reference(self.person()))
            request.assert_not_called()

    def test_download_uses_private_transport_and_preserves_bytes(self):
        with patch('core.services.enrollment_r2.request', return_value=b'fictional-image'):
            filename = adult_photos.download_reference(self.person())
        try:
            self.assertEqual(Path(filename).read_bytes(), b'fictional-image')
        finally:
            Path(filename).unlink()

    def test_existing_supabase_behavior_preserved(self):
        self.assertTrue(has_configured_reference(self.person('supabase://adult-private-photos/test.jpg')))
        self.assertIsNone(adult_photos.reference(self.person('supabase://adult-private-photos/test.jpg')))

    def test_missing_config_does_not_expose_internal_reference(self):
        with patch.dict(os.environ, {'ENROLLMENT_R2_SECRET_ACCESS_KEY':''}):
            self.assertEqual(adult_photos.display_url(self.person()), '')

    def test_player_serializer_returns_link_without_changing_stored_reference(self):
        from core.models import Site, Tournament, Team, Player
        from core.domain_serializers.sports import PlayerSerializer
        site = Site(pk=27, name='Sede ficticia')
        tournament = Tournament(pk=1, site=site, name='Torneo ficticio')
        team = Team(pk=2, tournament=tournament, name='Equipo ficticio')
        player = Player(pk=3, team=team, full_name='Persona ficticia', photo_url=self.person().photo_url)
        data = PlayerSerializer(player).data
        self.assertTrue(data['photo_url'].startswith('https://'))
        self.assertTrue(player.photo_url.startswith('r2://'))
        self.assertNotIn(ENV['ENROLLMENT_R2_SECRET_ACCESS_KEY'], str(data))

    def test_serializer_hides_reference_from_another_site(self):
        from core.models import Tournament, Team, Player
        from core.domain_serializers.sports import PlayerSerializer
        tournament = Tournament(pk=1, site_id=42, name='Torneo ficticio')
        # Cache the site relation so this pure serialization test never queries a DB.
        from core.models import Site
        tournament.site = Site(pk=42, name='Otra sede')
        team = Team(pk=2, tournament=tournament, name='Equipo ficticio')
        player = Player(pk=3, team=team, full_name='Persona ficticia', photo_url=self.person().photo_url)
        self.assertEqual(PlayerSerializer(player).data['photo_url'], '')
