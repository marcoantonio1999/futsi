import secrets
from django.conf import settings
from django.db import models


def invitation_token():
    return secrets.token_urlsafe(32)


class PlayerEnrollmentInvitation(models.Model):
    token = models.CharField(max_length=64, unique=True, default=invitation_token)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    team = models.CharField(max_length=120, blank=True)
    category = models.CharField(max_length=80, blank=True)
    tournament = models.CharField(max_length=120, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    class Meta:
        db_table = "player_enrollment_invitations"


class PlayerEnrollment(models.Model):
    invitation = models.OneToOneField(PlayerEnrollmentInvitation, on_delete=models.PROTECT)
    name = models.CharField(max_length=160)
    birth_date = models.DateField()
    team = models.CharField(max_length=120)
    category = models.CharField(max_length=80)
    tournament = models.CharField(max_length=120, blank=True)
    identity_type = models.CharField(max_length=20, default="ine")
    phone = models.CharField(max_length=30)
    phone_secondary = models.CharField(max_length=30, blank=True)
    guardian_name = models.CharField(max_length=160, blank=True)
    payment_reference = models.CharField(max_length=80, blank=True)
    document_checklist = models.JSONField(default=list)
    terms_version = models.CharField(max_length=80)
    terms_text = models.JSONField(default=list)
    signed_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        db_table = "player_enrollments"
        ordering = ["-signed_at", "-id"]


class PlayerEnrollmentDocument(models.Model):
    enrollment = models.ForeignKey(PlayerEnrollment, on_delete=models.CASCADE, related_name="documents")
    kind = models.CharField(max_length=30)
    content = models.BinaryField(editable=False)
    content_type = models.CharField(max_length=40)
    sha256 = models.CharField(max_length=64)
    class Meta:
        db_table = "player_enrollment_documents"
        constraints = [models.UniqueConstraint(fields=["enrollment", "kind"], name="uq_enrollment_document_kind")]
