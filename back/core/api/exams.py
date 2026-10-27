"""On-demand exams: automatic choice grading, explicitly requested AI grading."""
import uuid
import hashlib
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import BasePermission, AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from rest_framework.views import APIView
from core.models import RecruitmentExam, RecruitmentExamAttempt
from core.veronica_access import is_veronica_only
from core.exam_identity import exam_email, exam_phone
from core.exam_grading import clean_key, choice_grades, finish_grade, grade_open, GradingError, MODEL
from core.exam_timing import exam_deadline, expire_attempt


class CanManageExams(BasePermission):
    def has_permission(self, request, view):
        u = request.user
        return bool(u and u.is_authenticated and not any(p in (u.section_permissions or []) for p in ['player_enrollments_only', 'court_communications_only']) and (
            u.role in {'admin', 'owner', 'dev'} or (u.role == 'collaborator' and is_veronica_only(u))))


class ExamPublicThrottle(AnonRateThrottle):
    rate = '40/min'


class ExamAttemptThrottle(AnonRateThrottle):
    scope = 'exam_attempt'
    rate = '180/min'

    def get_cache_key(self, request, view):
        auth = request.headers.get('Authorization', '')
        # Drafts from multiple applicants sharing an office IP have separate
        # bounded quotas; do not store the raw capability in cache keys.
        ident = hashlib.sha256(auth.encode()).hexdigest() if auth.startswith('Exam ') and 40 <= len(auth[5:]) <= 64 else self.get_ident(request)
        return self.cache_format % {'scope': self.scope, 'ident': ident}


class ExamAITestThrottle(UserRateThrottle):
    scope = 'exam_ai_test'
    rate = '6/hour'


class ExamGradingTestView(APIView):
    permission_classes = [CanManageExams]
    throttle_classes = [ExamAITestThrottle]

    def post(self, request):
        # Fixed fictional text only. Never grade actual applicants as a smoke test.
        try:
            grades, usage = grade_open([{'id': '1', 'kind': 'open', 'prompt': '¿Cuánto es dos más dos?'}],
                {'1': 'Cuatro.'}, {'1': '4 o cuatro; debe sumar correctamente.'})
        except GradingError as error:
            return Response({'detail': str(error)}, status=503)
        return Response({'model': MODEL, 'reasoning': 'low', 'fictional_test': True, 'grades': grades, 'usage': usage})


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
            'public_token': exam.public_token, 'attempt_count': getattr(exam, 'attempt_count', 0),
            'answer_key': exam.answer_key}


def attempt_data(a, private=False):
    elapsed = max(0, int(((a.submitted_at or timezone.now()) - a.started_at).total_seconds()))
    result = {'started_at': a.started_at.isoformat(), 'submitted_at': a.submitted_at.isoformat() if a.submitted_at else None,
              'deadline_at': exam_deadline(a).isoformat(),
              'timed_out': bool(a.submitted_at and a.submitted_at >= exam_deadline(a)),
              'elapsed_seconds': elapsed, 'over_time': elapsed > a.snapshot['duration_minutes'] * 60,
              'snapshot': a.snapshot, 'answers': a.answers}
    if private:
        result.update(id=a.id, name=a.name, email=a.email, phone=a.phone,
                      grading_status=a.grading_status, grading=a.grading,
                      graded_at=a.graded_at.isoformat() if a.graded_at else None)
        if hasattr(a, 'skill_score'):
            result['skill_score'] = a.skill_score
        offline = a.snapshot.get('offline_import', {})
        if isinstance(offline, dict) and offline.get('source') in {'pdf_manual', 'xlsx_results'}:
            # Date-only anchors support historical day filters, not invented clocks.
            result.update(started_at=None, deadline_at=None, elapsed_seconds=None,
                          timed_out=False, over_time=False, offline_import={
                              key: offline.get(key) for key in ('source', 'completed_on', 'imported_at', 'ambiguous_answers', 'correct_count', 'question_count', 'answers_available')})
            if not offline.get('completed_on'):
                result['submitted_at'] = None
            result['submitted'] = bool(a.submitted_at)
    return result


class ExamAdminView(APIView):
    permission_classes = [CanManageExams]

    @transaction.atomic
    def get(self, request, pk=None):
        if pk is not None:
            exam = get_object_or_404(RecruitmentExam, pk=pk)
            # Bounded pages; contact data is never exposed by the public routes.
            try:
                page = max(1, int(request.query_params.get('page', 1)))
            except (TypeError, ValueError):
                raise ValidationError({'detail': 'Página inválida.'})
            rows = exam.attempts.all()
            page_rows = list(rows.select_for_update()[(page-1)*50:page*50])
            for attempt in page_rows:
                expire_attempt(attempt)
            from core.exam_profiles import filtered_attempts
            rows, filters = filtered_attempts(rows, request.query_params)
            page_rows = list(rows[(page-1)*50:page*50])
            return Response({'exam': exam_data(exam), 'count': rows.count(), 'page': page,
                             'filters': filters,
                             'results': [attempt_data(a, True) for a in page_rows]})
        rows = RecruitmentExam.objects.annotate(attempt_count=Count('attempts'))[:200]
        return Response({'results': [exam_data(e) for e in rows]})

    @transaction.atomic
    def post(self, request, pk=None):
        if not isinstance(request.data, dict):
            raise ValidationError({'detail': 'Formulario inválido.'})
        if pk is not None:
            exam = get_object_or_404(RecruitmentExam.objects.select_for_update(), pk=pk)
            if 'answer_key' in request.data:
                key = clean_key(exam.questions, request.data['answer_key'])
                if exam.answer_key and exam.answer_key != key:
                    raise ValidationError({'detail': 'La clave publicada es inmutable. Crea otro examen para cambiar los criterios.'})
                exam.answer_key = key
                exam.save(update_fields=['answer_key'])
                return Response(exam_data(exam))
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
        questions = clean_questions(data.get('questions'))
        key = clean_key(questions, data.get('answer_key'))
        exam = RecruitmentExam.objects.create(
            title=text(data.get('title'), 'el nombre del examen', 180),
            instructions=text(data.get('instructions', ''), 'las instrucciones', 10000, False),
            duration_minutes=duration, questions=questions, answer_key=key, created_by=request.user)
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
        existing = e.attempts.select_for_update().filter(start_key=start_key).first()
        if existing:
            expire_attempt(existing)
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
        if not 8 <= len(exam_phone(phone)) <= 15 or data.get('consent') is not True:
            raise ValidationError({'detail': 'Revisa tu teléfono y la autorización para guardar tus respuestas.'})
        # The parent exam row remains locked throughout this transaction. Two
        # simultaneous starts cannot both pass this check on PostgreSQL.
        # Normalize a legacy row written by an older instance during rollout.
        for legacy in e.attempts.filter(Q(identity_email='') | Q(identity_phone='')).only('id', 'email', 'phone'):
            legacy.save(update_fields=['identity_email', 'identity_phone'])
        matching = e.attempts.filter(Q(identity_email=exam_email(email)) | Q(identity_phone=exam_phone(phone)))
        if matching.filter(submitted_at__isnull=False).exists():
            return Response({'detail': 'Ya se realizó este examen con este correo o teléfono. No es posible realizarlo dos veces.', 'code': 'exam_already_completed'}, status=409)
        if matching.exists():
            return Response({'detail': 'Este examen ya fue iniciado con este correo o teléfono. Continúa en la pestaña original; no es posible iniciar un segundo intento.', 'code': 'exam_already_started'}, status=409)
        a = RecruitmentExamAttempt.objects.create(exam=e, start_key=start_key, name=name, email=email, phone=phone, grading_key=e.answer_key,
            snapshot={'title': e.title, 'instructions': e.instructions, 'duration_minutes': e.duration_minutes, 'questions': e.questions})
        return Response({'access_token': a.access_token, **attempt_data(a)}, status=201)


class ExamAttemptView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ExamAttemptThrottle]

    def get_attempt(self, request, lock=False):
        # Capability stays in a header rather than logs/URLs. 256-bit random token.
        rows = RecruitmentExamAttempt.objects.select_for_update() if lock else RecruitmentExamAttempt.objects
        auth = request.headers.get('Authorization', '')
        return get_object_or_404(rows, access_token=auth[5:] if auth.startswith('Exam ') else '')

    @transaction.atomic
    def get(self, request):
        a = self.get_attempt(request, True)
        expire_attempt(a)
        return Response(attempt_data(a))

    @transaction.atomic
    def post(self, request):
        a = self.get_attempt(request, True)
        if a.submitted_at:
            return Response(attempt_data(a))  # Idempotent; submitted answers cannot be overwritten.
        if expire_attempt(a):
            return Response(attempt_data(a))  # Ignore all late client answers.
        data = request.data
        if not isinstance(data, dict):
            raise ValidationError({'detail': 'Formulario inválido.'})
        answers = data.get('answers')
        questions = a.snapshot['questions']
        draft = data.get('action') == 'draft'
        ids = {q['id'] for q in questions}
        if not isinstance(answers, dict) or not set(answers).issubset(ids) or (not draft and set(answers) != ids):
            raise ValidationError({'detail': 'Responde todas las preguntas antes de enviar.'})
        cleaned = {}
        for q in questions:
            if draft and q['id'] not in answers:
                continue
            value = answers[q['id']]
            if q['kind'] == 'choice':
                if type(value) is not int or not 0 <= value < len(q['options']):
                    raise ValidationError({'detail': f'Revisa la pregunta {q["id"]}.'})
                cleaned[q['id']] = value
            else:
                if draft and isinstance(value, str) and not value.strip():
                    continue
                cleaned[q['id']] = text(value, f'la pregunta {q["id"]}', 10000)
        a.answers = cleaned
        if draft:
            a.save(update_fields=['answers'])
            # Do not retransmit the entire questionnaire on every answer.
            return Response({'saved': True, 'answers': a.answers, 'submitted_at': None,
                             'deadline_at': exam_deadline(a).isoformat()})
        a.submitted_at = timezone.now()
        # Legacy exams retain their original answers. Missing keys never mean zero.
        if a.grading_key and all(q['kind'] == 'choice' for q in questions):
            finish_grade(a, choice_grades(questions, cleaned, a.grading_key))
        a.save(update_fields=['answers', 'submitted_at', 'grading', 'grading_status', 'graded_at'])
        from core.employment_forms import link_forms_after_exam
        link_forms_after_exam(a)
        return Response(attempt_data(a))


class ExamGradeView(APIView):
    permission_classes = [CanManageExams]

    def post(self, request, pk):
        # One attempt per request bounds execution; UI continues only during an
        # explicit user batch. Claim is committed BEFORE the paid HTTP call.
        with transaction.atomic():
            exam = get_object_or_404(RecruitmentExam.objects.select_for_update(), pk=pk)
            if not exam.answer_key:
                raise ValidationError({'detail': 'Primero guarda la clave de respuestas de este examen.'})
            rows = exam.attempts.filter(submitted_at__isnull=False, grading_status='pending')
            a = rows.select_for_update().order_by('id').first()
            if not a:
                return Response({'processed': False, 'remaining': 0,
                    'errors': exam.attempts.filter(grading_status='error').count(),
                    'processing': exam.attempts.filter(grading_status='processing').count()})
            a.grading_key = clean_key(a.snapshot['questions'], a.grading_key or exam.answer_key)
            a.grading_status = 'processing'
            a.grading_started_at = timezone.now()
            a.graded_by = request.user
            a.save(update_fields=['grading_key', 'grading_status', 'grading_started_at', 'graded_by'])
        try:
            questions = a.snapshot['questions']
            grades = choice_grades(questions, a.answers, a.grading_key)
            open_questions = [q for q in questions if q['kind'] == 'open' and str(a.answers.get(q['id'], '')).strip()]
            grades.update({q['id']: {'points': 0, 'reason': 'Sin respuesta', 'review': False}
                for q in questions if q['kind'] == 'open' and q not in open_questions})
            has_open = bool(open_questions)
            usage = {}
            if has_open:
                open_grades, usage = grade_open(open_questions, a.answers, a.grading_key)
                grades.update(open_grades)
            finish_grade(a, grades, MODEL if has_open else 'deterministic', usage)
        except GradingError as error:
            a.grading_status = 'error'
            a.grading = {'error': str(error)}
        except Exception:
            # Never persist/log provider responses, keys, candidate text, or PII.
            a.grading_status = 'error'
            a.grading = {'error': 'Error interno de calificación. Requiere revisión; no se reintentó.'}
        a.save(update_fields=['grading_status', 'grading', 'graded_at'])
        return Response({'processed': True, 'attempt_id': a.id, 'status': a.grading_status,
            'remaining': exam.attempts.filter(submitted_at__isnull=False, grading_status='pending').count()})
