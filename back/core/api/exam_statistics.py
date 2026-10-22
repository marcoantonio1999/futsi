"""Read-only on-demand recruitment statistics; no expiry, grading or polling."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo
from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Max, Min, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from core.api.exams import CanManageExams
from core.exam_models import RecruitmentExam, RecruitmentExamAttempt
from core.exam_profiles import score_rows
from django.contrib.auth import get_user_model

CDMX = ZoneInfo('America/Mexico_City')


class ExamStatisticsView(APIView):
    permission_classes = [CanManageExams]

    def get(self, request):
        now = timezone.now()
        today = now.astimezone(CDMX).date()
        try:
            end = date.fromisoformat(request.query_params.get('until') or today.isoformat())
            start = date.fromisoformat(request.query_params.get('since') or (end-timedelta(days=29)).isoformat())
            if end > today or start > end or (end-start).days >= 366:
                raise ValueError()
            exam_id = request.query_params.get('exam')
            if exam_id and (not exam_id.isdecimal() or int(exam_id) < 1):
                raise ValueError()
        except (TypeError, ValueError):
            raise ValidationError({'detail':'Elige fechas válidas, sin días futuros, en un período de hasta 366 días.'})
        begin = datetime.combine(start, time.min, CDMX)
        stop = datetime.combine(end+timedelta(days=1), time.min, CDMX)
        days = (end-start).days+1
        rows = RecruitmentExamAttempt.objects.all()
        exams = RecruitmentExam.objects.all()
        if exam_id:
            if not exams.filter(pk=int(exam_id)).exists():
                raise ValidationError({'detail':'El examen seleccionado no existe.'})
            rows = rows.filter(exam_id=int(exam_id))
            exams = exams.filter(pk=int(exam_id))
        # Submissions belong to their delivery date, not the date their attempt started.
        delivered = score_rows(rows.filter(submitted_at__gte=begin, submitted_at__lt=stop))
        valid = Q(profile_score__gte=0, profile_score__lte=10)
        offline = Q(snapshot__offline_import__source='pdf_manual')
        known_timing = Q(snapshot__offline_import__source__isnull=True) | ~offline
        metrics = dict(delivered=Count('id'), graded=Count('id', filter=valid),
            average_score=Avg('profile_score', filter=valid), highest_score=Max('profile_score', filter=valid),
            lowest_score=Min('profile_score', filter=valid),
            grading_errors=Count('id', filter=Q(grading_status='error')),
            pending_grading=Count('id', filter=~Q(grading_status__in=['graded','error'])),
            invalid_grades=Count('id', filter=Q(grading_status='graded') & (Q(profile_score__isnull=True)|Q(profile_score__lt=0)|Q(profile_score__gt=10))))
        summary = delivered.aggregate(**metrics, imported_offline=Count('id', filter=offline))
        elapsed = ExpressionWrapper(F('submitted_at')-F('started_at'), output_field=DurationField())
        duration = delivered.filter(known_timing, submitted_at__gte=F('started_at')).aggregate(value=Avg(elapsed))['value']
        summary['average_seconds'] = round(duration.total_seconds()) if duration is not None else None
        started = rows.filter(known_timing, started_at__gte=begin, started_at__lt=stop)
        summary['started'] = started.count()
        summary['without_delivery'] = started.filter(submitted_at__isnull=True).count()
        created = exams.filter(created_at__gte=begin, created_at__lt=stop)
        summary['exams_created'] = created.count()
        # This attribution is based on the stored creator, never an assumed username.
        creator_ids = [pk for pk,permissions in get_user_model().objects.filter(role='collaborator').values_list('id','section_permissions') if 'veronica_only' in (permissions or [])]
        vero_created = created.filter(created_by_id__in=creator_ids)
        totals = {'received': summary['delivered'], 'created_by_vero': vero_created.count()}
        averages = {key: dict(total=total, daily=round(total/days,2), weekly=round(total/days*7,2), monthly=round(total/days*30,2)) for key,total in totals.items()}
        daily_counts = {r['day']:r['total'] for r in delivered.annotate(day=TruncDate('submitted_at',tzinfo=CDMX)).values('day').annotate(total=Count('id')).order_by('day')}
        daily = [dict(day=(start+timedelta(days=i)).isoformat(), total=daily_counts.get(start+timedelta(days=i),0)) for i in range(days)]
        per_exam = list(delivered.values('exam_id','exam__title').annotate(**metrics).order_by('-delivered','exam_id'))
        buckets = delivered.aggregate(**{f'b{i}':Count('id',filter=Q(profile_score__gte=i*2,**({'profile_score__lt':(i+1)*2} if i<4 else {'profile_score__lte':10}))) for i in range(5)})
        for row in [summary,*per_exam]:
            for key in ['average_score','highest_score','lowest_score']:
                if row[key] is not None: row[key] = round(row[key],2)
        return Response(dict(since=start.isoformat(),until=end.isoformat(),days=days,timezone=str(CDMX),
            generated_at=now.isoformat(),summary=summary,averages=averages,daily=daily,per_exam=per_exam,
            distribution=[dict(label=f'{i*2} a '+('10' if i==4 else f'< {(i+1)*2}'),total=buckets[f'b{i}']) for i in range(5)]))
