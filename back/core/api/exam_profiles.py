"""Authorized text-only recruitment profiles and explicit form imports."""
from django.db import transaction
from django.db.models import Case, When, Value, BooleanField
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from core.api.exams import CanManageExams
from core.exam_models import RecruitmentExamAttempt, RecruitmentProfile
from core.exam_profiles import filtered_attempts, normalized, clean_string, clean_fields, match_form
from core.cv_import import match_cv,cv_digest
import hmac
import re


def submitted_rows(detail=False):
    rows=RecruitmentExamAttempt.objects.filter(submitted_at__isnull=False).select_related('exam','profile')
    if not detail:
        # Do not transfer CVs, form texts or whole questionnaires to list contacts.
        rows=rows.defer('snapshot','answers','grading_key','exam__questions','exam__answer_key',
                        'profile__cv_text','profile__cv_search','profile__form_text','profile__form_fields','profile__form_search')
        rows=rows.annotate(cv_available=Case(When(profile__cv_text__gt='',then=Value(True)),default=Value(False),output_field=BooleanField()),
                           form_available=Case(When(profile__form_text__gt='',then=Value(True)),default=Value(False),output_field=BooleanField()))
    return rows


def profile_data(a, detail=False, terms=()):
    p = getattr(a, 'profile', None)
    result = dict(id=a.pk, name=a.name, email=a.email, phone=a.phone,
                  exam_id=a.exam_id, exam_title=a.exam.title, submitted_at=a.submitted_at.isoformat(),
                  grading_status=a.grading_status, score=a.grading.get('score') if a.grading_status == 'graded' else None,
                  position=p.position if p and p.position else a.exam.title,
                  position_source='saved' if p and p.position else 'exam',
                  has_cv=bool(p and p.cv_text) if detail else a.cv_available,
                  has_form=bool(p and p.form_text) if detail else a.form_available,
                  updated_at=p.updated_at.isoformat() if p else None,
                  matched_keywords=[t for i,t in enumerate(terms) if getattr(a,f'profile_keyword_{i}',False)])
    if detail:
        result.update(cv_text=p.cv_text if p else '', form_text=p.form_text if p else '',
                      form_fields=p.form_fields if p else {})
    return result


class ExamProfilesView(APIView):
    permission_classes = [CanManageExams]

    def get(self, request, pk=None):
        rows = submitted_rows()
        if pk is not None:
            return Response(profile_data(get_object_or_404(submitted_rows(detail=True), pk=pk), True))
        try:
            page = max(1,int(request.query_params.get('page',1)))
            exam = request.query_params.get('exam')
            if exam:
                rows = rows.filter(exam_id=int(exam))
        except (ValueError, TypeError):
            raise ValidationError({'detail': 'Página o examen inválido.'})
        rows, filters = filtered_attempts(rows,request.query_params,profiles=True)
        return Response(dict(count=rows.count(),page=page,filters=filters,
                             results=[profile_data(a,terms=filters['matched_keywords']) for a in rows[(page-1)*50:page*50]]))

    @transaction.atomic
    def post(self, request, pk):
        attempt = get_object_or_404(RecruitmentExamAttempt.objects.select_for_update(),pk=pk,submitted_at__isnull=False)
        data = request.data
        if not isinstance(data,dict) or set(data)-{'position','cv_text','form_text','form_fields'}:
            raise ValidationError({'detail': 'Solo se admiten puesto y textos del perfil; no archivos ni cambios al examen.'})
        profile, _ = RecruitmentProfile.objects.get_or_create(attempt=attempt,defaults={'updated_by':request.user})
        for field,limit in [('position',180),('cv_text',80000),('form_text',60000)]:
            if field in data:
                setattr(profile,field,clean_string(data[field],limit,field))
        if 'form_fields' in data:
            profile.form_fields=clean_fields(data['form_fields'])
        profile.cv_search=normalized(profile.cv_text)
        profile.form_search=normalized(profile.form_text+' '+ ' '.join(profile.form_fields.values()))
        profile.updated_by=request.user
        profile.save()
        # The reverse one-to-one may have been cached absent by select_related.
        return Response(profile_data(submitted_rows(detail=True).get(pk=attempt.pk),True))


class ExamProfileImportView(APIView):
    permission_classes = [CanManageExams]

    @transaction.atomic
    def post(self,request):
        data=request.data
        if not isinstance(data,dict) or set(data)-{'form_text','form_fields','attempt_id','commit','exam'}:
            raise ValidationError({'detail':'Envía únicamente el texto y los campos extraídos; el PDF no se almacena.'})
        body=clean_string(data.get('form_text',''),60000,'el texto del formato')
        fields=clean_fields(data.get('form_fields',{}))
        if not body and not fields:
            raise ValidationError({'detail':'No se encontró texto legible. Usa un PDF digital o pega el texto; no se inventarán datos.'})
        rows=submitted_rows()
        if data.get('exam'):
            try: rows=rows.filter(exam_id=int(data['exam']))
            except (ValueError,TypeError): raise ValidationError({'detail':'Examen inválido.'})
        status,matches=match_form(rows,fields,body)
        if data.get('attempt_id') is not None:
            try: chosen_id=int(data['attempt_id'])
            except (ValueError,TypeError): raise ValidationError({'detail':'Participante inválido.'})
            chosen=get_object_or_404(rows,pk=chosen_id)
            status='manual'
        else:
            chosen=matches.first() if status=='matched' else None
        if data.get('commit') is True:
            if chosen is None:
                return Response({'detail':'Confirma a qué participante pertenece el formato. No se vinculó ningún dato.', 'match_status':status},status=409)
            # Serialize simultaneous imports with the same lock used by profile editing.
            attempt=RecruitmentExamAttempt.objects.select_for_update().get(pk=chosen.pk)
            p,_=RecruitmentProfile.objects.get_or_create(attempt=attempt,defaults={'updated_by':request.user})
            p.form_fields=fields
            p.form_text=body or '\n'.join(f'{k}: {v}' for k,v in fields.items())
            p.form_search=normalized(p.form_text+' '+' '.join(fields.values()))
            if not p.position:
                p.position=(fields.get('puesto_solicitado') or fields.get('puesto') or '')[:180]
            p.updated_by=request.user
            p.save()
            return Response({'saved':True,'match_status':status,'profile':profile_data(submitted_rows(detail=True).get(pk=chosen.pk),True)})
        candidates=list(matches.order_by('-id')[:20])
        return Response({'saved':False,'match_status':status,
                         'candidate':profile_data(chosen) if chosen else None,
                         'candidates':[profile_data(a) for a in candidates]})


class ExamCVImportView(APIView):
    permission_classes=[CanManageExams]

    @transaction.atomic
    def post(self,request):
        data=request.data
        if not isinstance(data,dict) or set(data)-{'cv_text','exam','commit','expected_cv_hash'}:
            raise ValidationError({'detail':'Envía solo el texto extraído del CV; no se reciben archivos PDF.'})
        body=clean_string(data.get('cv_text',''),80000,'el texto del CV')
        if not body:
            raise ValidationError({'detail':'No se encontró texto legible en el CV.'})
        rows=submitted_rows()
        if data.get('exam'):
            try: rows=rows.filter(exam_id=int(data['exam']))
            except (ValueError,TypeError): raise ValidationError({'detail':'Postulación inválida.'})
        status,matches=match_cv(rows,body)
        chosen=matches.first() if status=='matched' else None
        if data.get('commit') is True:
            if chosen is None:
                return Response({'detail':'El CV no tiene una coincidencia única. No se actualizó ningún perfil.','match_status':status},status=409)
            expected=data.get('expected_cv_hash')
            if not isinstance(expected,str) or not re.fullmatch(r'[0-9a-f]{64}',expected):
                raise ValidationError({'detail':'Primero revisa la coincidencia del CV.'})
            attempt=RecruitmentExamAttempt.objects.select_for_update().get(pk=chosen.pk)
            profile=getattr(attempt,'profile',None)
            old=profile.cv_text if profile else ''
            if not hmac.compare_digest(expected,cv_digest(old)):
                return Response({'detail':'El CV del perfil cambió durante la carga. Se conservó la versión más reciente; revisa este archivo manualmente.'},status=409)
            if old==body:
                return Response({'saved':True,'unchanged':True,'attempt_id':attempt.pk})
            if profile is None: profile=RecruitmentProfile(attempt=attempt)
            profile.cv_text=body
            profile.cv_search=normalized(body)
            profile.updated_by=request.user
            profile.save()
            return Response({'saved':True,'unchanged':False,'attempt_id':attempt.pk})
        old=chosen.profile.cv_text if chosen and getattr(chosen,'profile',None) else ''
        return Response({'saved':False,'match_status':status,'candidate':profile_data(chosen) if chosen else None,
            'candidates':[profile_data(a) for a in matches.order_by('-id')[:20]],
            'expected_cv_hash':cv_digest(old) if chosen else None})
