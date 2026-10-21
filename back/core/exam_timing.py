"""Deadline enforcement using persisted drafts, without workers or polling."""
from datetime import timedelta
from django.utils import timezone
from core.exam_grading import choice_grades, finish_grade


def exam_deadline(attempt):
    return attempt.started_at + timedelta(minutes=attempt.snapshot['duration_minutes'])


def expire_attempt(attempt, now=None):
    """Caller holds the attempt row lock. Never accept answers after its deadline."""
    if attempt.submitted_at or (now or timezone.now()) < exam_deadline(attempt):
        return False
    # This is the policy's logical closing time, even if a disconnected browser
    # or an admin only asks to materialize the receipt later.
    attempt.submitted_at = exam_deadline(attempt)
    questions = attempt.snapshot['questions']
    if attempt.grading_key and all(q['kind'] == 'choice' for q in questions):
        finish_grade(attempt, choice_grades(questions, attempt.answers, attempt.grading_key))
    attempt.save(update_fields=['submitted_at', 'grading', 'grading_status', 'graded_at'])
    return True
