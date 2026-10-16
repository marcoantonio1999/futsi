import secrets
from django.conf import settings
from django.db import models


def invitation_token():
    return secrets.token_urlsafe(32)


class PlayerEnrollmentInvitation(models.Model):
    token = models.CharField(max_length=64, unique=True, default=invitation_token)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    team = models.CharField(max_length=140, blank=True)
    team_record = models.ForeignKey('core.Team', null=True, blank=True, on_delete=models.PROTECT, related_name='player_enrollment_invitations')
    category = models.CharField(max_length=80, blank=True)
    tournament = models.CharField(max_length=140, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    purpose = models.CharField(max_length=12, default='enroll', choices=[('enroll', 'Inscripción'), ('withdraw', 'Baja')])
    used_at = models.DateTimeField(null=True, blank=True)
    class Meta:
        db_table = "player_enrollment_invitations"


class PlayerEnrollment(models.Model):
    invitation = models.OneToOneField(PlayerEnrollmentInvitation, on_delete=models.PROTECT)
    name = models.CharField(max_length=160)
    identity_key = models.CharField(max_length=64, blank=True, default='', db_index=True)
    birth_date = models.DateField()
    team = models.CharField(max_length=140)
    team_record = models.ForeignKey('core.Team', null=True, blank=True, on_delete=models.PROTECT, related_name='signed_player_enrollments')
    # Solo se conserva para los registros históricos; no se solicita en los nuevos.
    category = models.CharField(max_length=80, blank=True, default='')
    tournament = models.CharField(max_length=140, blank=True)
    identity_type = models.CharField(max_length=20, default="ine")
    phone = models.CharField(max_length=30)
    phone_secondary = models.CharField(max_length=30, blank=True)
    guardian_name = models.CharField(max_length=160, blank=True)
    payment_reference = models.CharField(max_length=80, blank=True)
    document_checklist = models.JSONField(default=list)
    terms_version = models.CharField(max_length=80)
    terms_text = models.JSONField(default=list)
    signed_at = models.DateTimeField(auto_now_add=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    is_delegate = models.BooleanField(default=False)
    def save(self, *args, **kwargs):
        from core.services.player_blacklist import identity_key
        key = identity_key(self.name, self.birth_date)
        if self.identity_key != key:
            self.identity_key = key
            if kwargs.get('update_fields') is not None:
                kwargs['update_fields'] = set(kwargs['update_fields']) | {'identity_key'}
        return super().save(*args, **kwargs)
    class Meta:
        db_table = "player_enrollments"
        ordering = ["-signed_at", "-id"]


class PlayerEnrollmentDocument(models.Model):
    enrollment = models.ForeignKey(PlayerEnrollment, on_delete=models.CASCADE, related_name="documents")
    kind = models.CharField(max_length=30)
    content = models.BinaryField(editable=False, default=bytes)
    storage_path = models.CharField(max_length=500, blank=True, default="")
    content_type = models.CharField(max_length=40)
    sha256 = models.CharField(max_length=64)
    class Meta:
        db_table = "player_enrollment_documents"
        constraints = [models.UniqueConstraint(fields=["enrollment", "kind"], name="uq_enrollment_document_kind")]


class PlayerSanction(models.Model):
    payment_required = models.BooleanField(default=True)
    fine_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    payment_folio = models.CharField(max_length=100, blank=True, default='')
    payment_recorded_at = models.DateTimeField(null=True, blank=True)
    payment_recorded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='sanction_payments')
    appeal_status = models.CharField(max_length=12, default='none', choices=[('none','Sin apelación'),('pending','Pendiente'),('accepted','Aceptada'),('rejected','No aceptada')])
    appeal_reason = models.TextField(max_length=4000, blank=True, default='')
    appeal_letter_path = models.CharField(max_length=500, blank=True, default='')
    appeal_letter_sha256 = models.CharField(max_length=64, blank=True, default='')
    appeal_submitted_at = models.DateTimeField(null=True, blank=True)
    appeal_submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='submitted_sanction_appeals')
    appeal_decision_reason = models.TextField(max_length=2000, blank=True, default='')
    appeal_decided_at = models.DateTimeField(null=True, blank=True)
    appeal_decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='decided_sanction_appeals')
    team = models.ForeignKey('core.Team', null=True, blank=True, on_delete=models.SET_NULL, related_name='sanctions')
    origin_site_id = models.BigIntegerField(null=True, blank=True)
    origin_site = models.CharField(max_length=160, blank=True, default='')
    origin_tournament = models.CharField(max_length=140, blank=True, default='')
    origin_team = models.CharField(max_length=140, blank=True, default='')
    enrollment = models.ForeignKey(PlayerEnrollment, null=True, blank=True, on_delete=models.CASCADE, related_name='sanctions')
    player = models.ForeignKey('core.Player', null=True, blank=True, on_delete=models.CASCADE, related_name='sanctions')
    player_name = models.CharField(max_length=160)
    offense_code = models.CharField(max_length=12)
    offense_label = models.CharField(max_length=200)
    recommended_duration = models.CharField(max_length=240)
    reason = models.TextField(max_length=2000)
    incident_on = models.DateField()
    starts_on = models.DateField()
    ends_on = models.DateField(null=True, blank=True)
    duration_unit = models.CharField(max_length=12)
    duration_value = models.PositiveIntegerField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='applied_player_sanctions')
    created_at = models.DateTimeField(auto_now_add=True)
    request_id = models.UUIDField(unique=True)

    def save(self, *args, **kwargs):
        if self.team_id and not self.origin_team:
            self.origin_site_id = self.team.tournament.site_id
            self.origin_site = self.team.tournament.site.name
            self.origin_tournament = self.team.tournament.name
            self.origin_team = self.team.name
            if kwargs.get('update_fields') is not None:
                kwargs['update_fields'] = set(kwargs['update_fields']) | {'origin_site_id', 'origin_site', 'origin_tournament', 'origin_team'}
        super().save(*args, **kwargs)

    class Meta:
        db_table = 'player_sanctions'
        ordering = ['-created_at', '-pk']
        indexes = [models.Index(fields=['team', 'starts_on'], name='ix_sanction_team_start')]
        constraints = [
            models.CheckConstraint(condition=(models.Q(enrollment__isnull=False, player__isnull=True) | models.Q(enrollment__isnull=True, player__isnull=False)), name='ck_sanction_one_player'),
            models.CheckConstraint(condition=(models.Q(ends_on__isnull=True) | models.Q(ends_on__gte=models.F('starts_on'))), name='ck_sanction_valid_dates'),
        ]


class PlayerBlacklistEntry(models.Model):
    photo_storage_path = models.CharField(max_length=500, blank=True, default='', db_index=True)
    photo_content_type = models.CharField(max_length=40, blank=True, default='')
    photo_sha256 = models.CharField(max_length=64, blank=True, default='')
    photo_content = models.BinaryField(default=bytes, editable=False)
    photo_legacy_file = models.CharField(max_length=500, blank=True, default='')
    source_sanction = models.ForeignKey(PlayerSanction, null=True, blank=True, on_delete=models.SET_NULL, related_name='blacklist_entries')
    source_player = models.ForeignKey('core.Player', null=True, blank=True, on_delete=models.SET_NULL, related_name='blacklist_entries')
    player_name = models.CharField(max_length=160)
    birth_date = models.DateField()
    identity_key = models.CharField(max_length=64, db_index=True)
    origin_site = models.CharField(max_length=160)
    origin_tournament = models.CharField(max_length=140)
    origin_team = models.CharField(max_length=140)
    offense_label = models.CharField(max_length=200)
    reason = models.TextField(max_length=2000)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='created_blacklist_entries')
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    revoked_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='revoked_blacklist_entries')
    revoked_at = models.DateTimeField(null=True, blank=True)
    revocation_reason = models.TextField(blank=True, default='', max_length=2000)
    request_id = models.UUIDField(unique=True)

    class Meta:
        db_table = 'player_blacklist_entries'
        ordering = ['-created_at','-pk']
        constraints = [models.UniqueConstraint(fields=['identity_key'], condition=models.Q(is_active=True), name='uq_active_blacklist_identity')]
