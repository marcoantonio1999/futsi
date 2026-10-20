"""On-demand exam portal. No AI calls, polling, or background jobs."""
import uuid
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission, AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from core.models import RecruitmentExam, RecruitmentExamAttempt
from core.veronica_access import is_veronica_only


class CanManageExams(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and not any(p in (u.section_permissions or []) for p in ['player_enrollments_only', 'court_communications_only']) and (
            u.role in {'admin', 'owner', 'dev'} or (u.role == 'collaborator' and is_veronica_only(u))))


class ExamPublicThrottle(AnonRateThrottle):
    rate = '40/min'


def text(value, label, limit, required=True):
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValidationError({'detail': f'Revisa {label}.'})
    return value.strip()


def clean_questions(value):
    if not isinstance(value, list) or not 1 <= len(value) <= 100:
        raise ValidationError({'detail': 'Agrega entre 1 y 100 preguntas.'})
    result = []
    for i, q in enumerate(value, 1):
        if not isinstance(q, dict) or q.get('kind') not in {'choice', 'open'}:
            raise ValidationError({'detail': f'Revisa el tipo de la pregunta {i}.'})
        row = {'id': str(i), 'kind': q['kind'], 'prompt': text(q.get('prompt'), f'la pregunta {i}', 5000)}
        if q['kind'] == 'choice':
            options = q.get('options')
            if not isinstance(options, list) or not 2 <= len(options) <= 26:
                raise ValidationError({'detail': f'Agrega de 2 a 26 opciones en la pregunta {i}.'})
            row['options'] = [text(o, f'las opciones de la pregunta {i}', 2000) for o in options]
        result.append(row)
    return result


def exam_data(exam):
    return {'id': exam.id, 'title': exam.title, 'instructions': exam.instructions,
            'duration_minutes': exam.duration_minutes, 'questions': exam.questions,
            'accepting': exam.accepting, 'created_at': exam.created_at.isoformat(),
            'public_token': exam.public_token, 'attempt_count': getattr(exam, 'attempt_count', 0)}


def attempt_data(a, private=False):
    elapsed = max(0, int(((a.submitted_at or timezone.now()) - a.started_at).total_seconds()))
    result = {'started_at': a.started_at.isoformat(), 'submitted_at': a.submitted_at.isoformat() if a.submitted_at else None,
              'elapsed_seconds': elapsed, 'over_time': elapsed > a.snapshot['duration_minutes'] * 60,
              'snapshot': a.snapshot, 'answers': a.answers}
    if private:
        result.update(id=a.id, name=a.name, email=a.email, phone=a.phone)
    return result


class ExamAdminView(APIView):
    permission_classes = [CanManageExams]

    def get(self, request, pk=None):
        if pk is not None:
            exam = get_object_or_404(RecruitmentExam, pk=pk)
            # Bounded pages; contact data is never exposed by the public routes.
            try:
                page = max(1, int(request.query_params.get('page', 1)))
            except (TypeError, ValueError):
                raise ValidationError({'detail': 'Página inválida.'})
            rows = exam.attempts.all()
            return Response({'exam': exam_data(exam), 'count': rows.count(), 'page': page,
                             'results': [attempt_data(a, True) for a in rows[(page-1)*50:page*50]]})
        rows = RecruitmentExam.objects.annotate(attempt_count=Count('attempts'))[:200]
        return Response({'results': [exam_data(e) for e in rows]})

    def post(self, request, pk=None):
        if not isinstance(request.data, dict):
            raise ValidationError({'detail': 'Formulario inválido.'})
        if pk is not None:
            exam = get_object_or_404(RecruitmentExam, pk=pk)
            if type(request.data.get('accepting')) is not bool:
                raise ValidationError({'detail': 'Indica si se aceptan respuestas.'})
            exam.accepting = request.data['accepting']
            exam.save(update_fields=['accepting'])
            return Response(exam_data(exam))
        data = request.data
        if not isinstance(data, dict):
            raise ValidationError({'detail': 'Formulario inválido.'})
        duration = data.get('duration_minutes', 40)
        if type(duration) is not int or not 1 <= duration <= 480:
            raise ValidationError({'detail': 'La duración debe ser de 1 a 480 minutos.'})
        exam = RecruitmentExam.objects.create(
            title=text(data.get('title'), 'el nombre del examen', 180),
            instructions=text(data.get('instructions', ''), 'las instrucciones', 10000, False),
            duration_minutes=duration, questions=clean_questions(data.get('questions')), created_by=request.user)
        return Response(exam_data(exam), status=201)


class ExamTemplateView(APIView):
    permission_classes = [CanManageExams]

    def get(self, request):
        import json
        from pathlib import Path
        return Response(json.loads((Path(__file__).resolve().parent.parent / 'exam_template.json').read_text(encoding='utf-8')))


class PublicExamView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ExamPublicThrottle]

    def get(self, request, token):
        e = get_object_or_404(RecruitmentExam, public_token=token)
        return Response({'title': e.title, 'instructions': e.instructions, 'duration_minutes': e.duration_minutes,
                         'question_count': len(e.questions), 'accepting': e.accepting})

    @transaction.atomic
    def post(self, request, token):
        # Lock the exam so closing an invitation and starting are serialized.
        e = get_object_or_404(RecruitmentExam.objects.select_for_update(), public_token=token)
        data = request.data
        if not isinstance(data, dict):
            raise ValidationError({'detail': 'Formulario inválido.'})
        try:
            start_key = uuid.UUID(str(data.get('start_key', '')))
        except ValueError:
            raise ValidationError({'detail': 'Identificador de inicio inválido.'})
        existing = e.attempts.filter(start_key=start_key).first()
        if existing:
            return Response({'access_token': existing.access_token, **attempt_data(existing)})
        if not e.accepting:
            return Response({'detail': 'Este examen ya no admite nuevos participantes.'}, status=410)
        name = text(data.get('name'), 'el nombre completo', 180)
        if len(name.split()) < 2:
            raise ValidationError({'detail': 'Escribe tu nombre completo con apellidos.'})
        email = text(data.get('email'), 'el correo electrónico', 254)
        try:
            validate_email(email)
        except DjangoValidationError:
            raise ValidationError({'detail': 'Escribe un correo electrónico válido.'})
        phone = text(data.get('phone'), 'el teléfono', 30)
        if not 8 <= sum(c.isdigit() for c in phone) <= 15 or data.get('consent') is not True:
            raise ValidationError({'detail': 'Revisa tu teléfono y la autorización para guardar tus respuestas.'})
        a = RecruitmentExamAttempt.objects.create(exam=e, start_key=start_key, name=name, email=email, phone=phone,
            snapshot={'title': e.title, 'instructions': e.instructions, 'duration_minutes': e.duration_minutes, 'questions': e.questions})
        return Response({'access_token': a.access_token, **attempt_data(a)}, status=201)


class ExamAttemptView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ExamPublicThrottle]

    def get_attempt(self, request, lock=False):
        # Capability stays in a header rather than logs/URLs. 256-bit random token.
        rows = RecruitmentExamAttempt.objects.select_for_update() if lock else RecruitmentExamAttempt.objects
        auth = request.headers.get('Authorization', '')
        return get_object_or_404(rows, access_token=auth[5:] if auth.startswith('Exam ') else '')

    def get(self, request):
        return Response(attempt_data(self.get_attempt(request)))

    @transaction.atomic
    def post(self, request):
        a = self.get_attempt(request, True)
        if a.submitted_at:
            return Response(attempt_data(a))  # Idempotent; submitted answers cannot be overwritten.
        data = request.data
        if not isinstance(data, dict):
            raise ValidationError({'detail': 'Formulario inválido.'})
        answers = data.get('answers')
        questions = a.snapshot['questions']
        if not isinstance(answers, dict) or set(answers) != {q['id'] for q in questions}:
            raise ValidationError({'detail': 'Responde todas las preguntas antes de enviar.'})
        cleaned = {}
        for q in questions:
            value = answers[q['id']]
            if q['kind'] == 'choice':
                if type(value) is not int or not 0 <= value < len(q['options']):
                    raise ValidationError({'detail': f'Revisa la pregunta {q["id"]}.'})
                cleaned[q['id']] = value
            else:
                cleaned[q['id']] = text(value, f'la pregunta {q["id"]}', 10000)
        a.answers = cleaned
        a.submitted_at = timezone.now()
        a.save(update_fields=['answers', 'submitted_at'])
        return Response(attempt_data(a))
