"""Recruitment exams: private admin data and immutable attempt snapshots."""
import secrets
from django.conf import settings
from django.db import models


def exam_token():
    return secrets.token_urlsafe(32)


class RecruitmentExam(models.Model):
    title = models.CharField(max_length=180)
    instructions = models.TextField(blank=True)
    duration_minutes = models.PositiveSmallIntegerField(default=40)
    questions = models.JSONField(default=list)
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
    snapshot = models.JSONField(default=dict)
    answers = models.JSONField(default=dict)
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'recruitment_exam_attempts'
        ordering = ['-id']
        constraints = [models.UniqueConstraint(fields=['exam', 'start_key'], name='unique_exam_start')]
