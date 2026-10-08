from datetime import date, timedelta
from io import BytesIO
from PIL import Image, ImageDraw
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User, Site, Tournament, Team
from core.enrollment_models import PlayerEnrollmentInvitation, PlayerEnrollment, PlayerEnrollmentDocument
from core.api.enrollments import is_minor


def image_file(name, blank=False):
    image = Image.new("RGB", (600, 180), "white")
    if not blank:
        ImageDraw.Draw(image).line([(20, 40), (250, 150), (450, 30)], fill="black", width=5)
    data = BytesIO(); image.save(data, "PNG")
    return SimpleUploadedFile(name, data.getvalue(), content_type="image/png")


@override_settings(ALLOWED_HOSTS=["testserver"], MIGRATION_MODULES={"core": None})
class PlayerEnrollmentTests(TestCase):
    def setUp(self):
        from django.core.cache import cache
        cache.clear()
        self.emilio = User.objects.create_user(username="emilio", password="test-pass-123", role="collaborator", section_permissions=["player_enrollments_only"])
        self.other = User.objects.create_user(username="other", role="collaborator", section_permissions=["player_enrollments_only"])
        self.site = Site.objects.create(name='Colegio Franco', code='prueba')
        self.tournament = Tournament.objects.create(site=self.site, name='Torneo', billing_type='weekly_match')
        self.team = Team.objects.create(tournament=self.tournament, name='Equipo', representative_name='Responsable de prueba', representative_phone='5512345678')
        self.invitation = self.new_invitation()
        self.url = f"/api/player-enrollments/public/{self.invitation.token}/"
        self.client = APIClient()

    def new_invitation(self):
        return PlayerEnrollmentInvitation.objects.create(created_by=self.emilio, expires_at=timezone.now() + timedelta(days=1), team_record=self.team, team=self.team.name, tournament=self.tournament.name)

    def test_emilio_pilot_cannot_access_other_courts(self):
        outside = Site.objects.create(name='Otra cancha', code='otra')
        tournament = Tournament.objects.create(site=outside, name='Privado', billing_type='weekly_match')
        team = Team.objects.create(tournament=tournament, name='Equipo externo')
        self.client.force_authenticate(self.emilio)
        catalog = self.client.get('/api/player-enrollments/catalog/').json()
        self.assertEqual([row['id'] for row in catalog['sites']], [self.site.pk])
        self.assertNotIn(tournament.pk, [row['id'] for row in catalog['tournaments']])
        self.assertEqual(self.client.post('/api/player-enrollments/catalog/', {'kind':'tournament','name':'No permitido','site':outside.pk,'billing_type':'weekly_match'}, format='json').status_code,403)
        self.assertEqual(self.client.post('/api/player-enrollments/', {'tournament_id':tournament.pk,'team_id':team.pk}, format='json').status_code,403)
        for method in ('get','delete'):
            url = f'/api/player-enrollments/tournaments/{tournament.pk}/' + ('deletion-preview/' if method == 'get' else '')
            self.assertEqual(getattr(self.client,method)(url).status_code,404)
        self.assertTrue(Tournament.objects.filter(pk=tournament.pk).exists())

    def test_franco_deletion_reuses_confirmation_and_protects_enrollments(self):
        self.client.force_authenticate(self.emilio)
        row = Tournament.objects.create(site=self.site, name='Eliminar prueba', billing_type='weekly_match')
        url = f'/api/player-enrollments/tournaments/{row.pk}/'
        self.assertEqual(self.client.delete(url,{},format='json').status_code,400)
        preview = self.client.get(url+'deletion-preview/').json()
        payload = {'confirmation_token':preview['confirmation_token'],'confirmation_name':row.name}
        self.assertEqual(self.client.delete(url,payload,format='json').status_code,200)
        self.assertFalse(Tournament.objects.filter(pk=row.pk).exists())
        protected = f'/api/player-enrollments/tournaments/{self.tournament.pk}/'
        self.assertEqual(self.client.delete(protected,{},format='json').status_code,400)
        self.assertTrue(PlayerEnrollmentInvitation.objects.filter(pk=self.invitation.pk).exists())

    def test_other_enrollment_operator_cannot_delete(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/player-enrollments/tournaments/{self.tournament.pk}/deletion-preview/').status_code,403)

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

    def test_team_deletion_scope_and_signed_links_are_protected(self):
        self.client.force_authenticate(self.emilio)
        self.assertEqual(self.client.get(f'/api/player-enrollments/teams/{self.team.pk}/deletion-preview/').status_code, 400)
        outside = Site.objects.create(name='Fuera de Franco')
        tournament = Tournament.objects.create(site=outside, name='Otro')
        team = Team.objects.create(tournament=tournament, name='Ajeno')
        self.assertEqual(self.client.get(f'/api/player-enrollments/teams/{team.pk}/deletion-preview/').status_code, 404)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/player-enrollments/teams/{team.pk}/deletion-preview/').status_code, 403)

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

    def test_deleted_faceguard_clip_is_preserved_without_blocking_team(self):
        import json
        from django.db import connection
        team, player, match, session = self.empty_team_match()
        with connection.cursor() as cursor:
            cursor.execute('CREATE TABLE video_clips (id TEXT PRIMARY KEY, status TEXT, match_id INTEGER, attendance_session_id INTEGER, metadata TEXT)')
        try:
            with connection.cursor() as cursor:
                cursor.execute('INSERT INTO video_clips VALUES (%s,%s,%s,%s,%s)', ['clip-test','deleted',match.pk,session.pk,'{"evidence":"keep"}'])
            url = f'/api/player-enrollments/teams/{team.pk}/'
            response = self.client.get(url+'deletion-preview/')
            self.assertEqual(response.status_code, 200)
            payload = {'confirmation_token':response.json()['confirmation_token'], 'confirmation_name':team.name}
            self.assertEqual(self.client.delete(url, payload, format='json').status_code, 200)
            with connection.cursor() as cursor:
                cursor.execute('SELECT status,match_id,attendance_session_id,metadata FROM video_clips WHERE id=%s', ['clip-test'])
                row = cursor.fetchone()
            self.assertEqual(row[:3], ('deleted',None,None))
            metadata = json.loads(row[3])
            self.assertEqual(metadata['evidence'], 'keep')
            self.assertEqual(metadata['team_deletion_evidence']['match_id'], match.pk)
            player.refresh_from_db()
            self.assertIsNone(player.team_id)
        finally:
            with connection.cursor() as cursor:
                cursor.execute('DROP TABLE video_clips')

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
        data = {"name": "Jugador de prueba", "birth_date": "2015-01-01" if minor else "1990-01-01", "identity_type": "minor" if minor else "ine", "phone": "5512345678", "phone_secondary": "5587654321", "accepted_terms": "true", "player_photo": image_file("foto.png"), "player_signature": image_file("firma.png", blank)}
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
        response=self.client.post('/api/player-enrollments/catalog/',{'kind':'tournament','site':self.site.pk,'name':'Copa compartida','billing_type':'weekly_match','is_active':True},format='json')
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

    def test_old_ambiguous_links_are_not_guessed(self):
        invitation=PlayerEnrollmentInvitation.objects.create(created_by=self.emilio,expires_at=timezone.now()+timedelta(days=1),team='Nombre libre',tournament='Nombre libre')
        self.assertEqual(self.client.get(f'/api/player-enrollments/public/{invitation.token}/').status_code,410)

    def test_eighteenth_birthday_is_adult(self):
        today = timezone.localdate()
        with __import__("unittest.mock", fromlist=["patch"]).patch("core.api.enrollments.timezone.localdate", return_value=date(2026, 10, 7)):
            self.assertFalse(is_minor(date(2008, 10, 7)))
            self.assertTrue(is_minor(date(2008, 10, 8)))
