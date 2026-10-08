from datetime import date, timedelta
from io import BytesIO
from PIL import Image, ImageDraw
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from core.models import User
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
        self.emilio = User.objects.create_user(username="emilio", password="test-pass-123", role="collaborator", section_permissions=["player_enrollments_only"])
        self.other = User.objects.create_user(username="other", role="collaborator", section_permissions=["player_enrollments_only"])
        self.invitation = PlayerEnrollmentInvitation.objects.create(created_by=self.emilio, expires_at=timezone.now() + timedelta(days=1))
        self.url = f"/api/player-enrollments/public/{self.invitation.token}/"
        self.client = APIClient()

    def payload(self, minor=False, tutor=True, blank=False):
        data = {"name": "Jugador de prueba", "birth_date": "2015-01-01" if minor else "1990-01-01", "team": "Equipo", "category": "Categoría", "phone": "5512345678", "accepted_terms": "true", "ine_front": image_file("frente.png"), "ine_back": image_file("reverso.png"), "player_signature": image_file("firma.png", blank)}
        if minor and tutor:
            data.update(guardian_name="Tutor de prueba", guardian_signature=image_file("tutor.png"))
        return data

    def test_adult_accepts_without_tutor_and_rejects_duplicate(self):
        self.assertEqual(self.client.post(self.url, self.payload(), format="multipart").status_code, 201)
        self.assertEqual(self.client.post(self.url, self.payload(), format="multipart").status_code, 409)
        self.assertEqual(PlayerEnrollment.objects.count(), 1)
        self.assertEqual(PlayerEnrollmentDocument.objects.count(), 3)

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

    def test_eighteenth_birthday_is_adult(self):
        today = timezone.localdate()
        with __import__("unittest.mock", fromlist=["patch"]).patch("core.api.enrollments.timezone.localdate", return_value=date(2026, 10, 7)):
            self.assertFalse(is_minor(date(2008, 10, 7)))
            self.assertTrue(is_minor(date(2008, 10, 8)))
