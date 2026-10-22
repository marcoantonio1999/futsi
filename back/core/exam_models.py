"""Recruitment exams: private admin data and immutable attempt snapshots."""
import secrets
import uuid
from django.conf import settings
from django.db import models
from core.exam_identity import exam_email, exam_phone


def exam_token():
    return secrets.token_urlsafe(32)


class RecruitmentExam(models.Model):
    title = models.CharField(max_length=180)
    instructions = models.TextField(blank=True)
    duration_minutes = models.PositiveSmallIntegerField(default=40)
    questions = models.JSONField(default=list)
    answer_key = models.JSONField(default=dict, db_default={})  # Never serialized by public endpoints.
    public_token = models.CharField(max_length=64, unique=True, default=exam_token)
    accepting = models.BooleanField(default=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'recruitment_exams'
        ordering = ['-id']


class RecruitmentExamAttempt(models.Model):
    exam = models.ForeignKey(RecruitmentExam, on_delete=models.PROTECT, related_name='attempts')
    access_token = models.CharField(max_length=64, unique=True, default=exam_token)
    start_key = models.UUIDField()
    name = models.CharField(max_length=180)
    email = models.EmailField()
    phone = models.CharField(max_length=30)
    identity_email = models.CharField(max_length=254, default='', db_default='', editable=False)
    identity_phone = models.CharField(max_length=15, default='', db_default='', editable=False)
    snapshot = models.JSONField(default=dict)
    answers = models.JSONField(default=dict)
    grading_key = models.JSONField(default=dict, db_default={})
    grading_status = models.CharField(max_length=20, default='pending', db_default='pending')
    grading = models.JSONField(default=dict, db_default={})
    grading_started_at = models.DateTimeField(null=True, blank=True)
    graded_at = models.DateTimeField(null=True, blank=True)
    graded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='graded_recruitment_attempts')
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'recruitment_exam_attempts'
        ordering = ['-id']
        constraints = [models.UniqueConstraint(fields=['exam', 'start_key'], name='unique_exam_start')]
        indexes = [models.Index(fields=['exam', 'identity_email'], name='exam_attempt_email_idx'), models.Index(fields=['exam', 'identity_phone'], name='exam_attempt_phone_idx')]

    def save(self, *args, **kwargs):
        self.identity_email = exam_email(self.email)
        self.identity_phone = exam_phone(self.phone)
        if kwargs.get('update_fields') is not None:
            kwargs['update_fields'] = set(kwargs['update_fields']) | {'identity_email', 'identity_phone'}
        return super().save(*args, **kwargs)


class RecruitmentProfile(models.Model):
    """Private application profile; never retains uploaded binary documents."""
    attempt = models.OneToOneField(RecruitmentExamAttempt, on_delete=models.PROTECT, related_name='profile')
    position = models.CharField(max_length=180, blank=True)
    cv_text = models.TextField(blank=True)
    cv_search = models.TextField(blank=True, editable=False)
    form_text = models.TextField(blank=True)
    form_fields = models.JSONField(default=dict)
    form_search = models.TextField(blank=True, editable=False)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'recruitment_profiles'


class RecruitmentApplication(models.Model):
    """Private text-only employment form, independent of taking an exam."""
    submit_key = models.UUIDField(unique=True)
    receipt = models.UUIDField(unique=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=180)
    email = models.EmailField()
    phone = models.CharField(max_length=30)
    identity_email = models.CharField(max_length=254, db_index=True)
    identity_phone = models.CharField(max_length=15, db_index=True)
    position = models.CharField(max_length=180)
    fields = models.JSONField(default=dict)
    search_text = models.TextField()
    exam = models.ForeignKey(RecruitmentExam, null=True, blank=True, on_delete=models.PROTECT)
    attempt = models.ForeignKey(RecruitmentExamAttempt, null=True, blank=True, on_delete=models.PROTECT, related_name='employment_forms')
    link_status = models.CharField(max_length=20, default='pending')
    linked_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT)
    submitted_at = models.DateTimeField(auto_now_add=True)
    consent_version = models.CharField(max_length=30, default='employment_v1')

    class Meta:
        db_table = 'recruitment_applications'
        ordering = ['-id']
