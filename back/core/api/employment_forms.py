"""Public write-only submissions; HR-only listing, detail and explicit linking."""
import uuid
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction, IntegrityError
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from core.api.exams import CanManageExams
from core.exam_models import RecruitmentApplication, RecruitmentExam, RecruitmentExamAttempt
from core.exam_identity import exam_email, exam_phone
from core.exam_profiles import normalized, clean_string
from core.employment_forms import SECTIONS, FIELDS, FORM_URL, form_text, candidates, auto_link, link_application


class FormThrottle(AnonRateThrottle):
    scope='employment_form'
    rate='120/hour'


def receipt(row):
    # Never return PII, fields or exam identity to an unauthenticated submitter.
    return dict(received=True,receipt=str(row.receipt),submitted_at=row.submitted_at.isoformat())


class PublicEmploymentFormView(APIView):
    authentication_classes=[]
    permission_classes=[AllowAny]
    throttle_classes=[FormThrottle]

    def get(self,request):
        return Response(dict(title='Solicitud de empleo',sections=SECTIONS,version='employment_v1'))

    @transaction.atomic
    def post(self,request):
        data=request.data
        if not isinstance(data,dict) or set(data)-{'fields','submit_key','consent','sensitive_consent','website','exam_token'}:
            raise ValidationError({'detail':'Envía únicamente los campos del formulario.'})
        if data.get('website') or data.get('consent') is not True:
            raise ValidationError({'detail':'Revisa la autorización para guardar tu postulación.'})
        try: key=uuid.UUID(str(data.get('submit_key','')))
        except (ValueError,TypeError): raise ValidationError({'detail':'Identificador de envío inválido.'})
        fields=data.get('fields')
        if not isinstance(fields,dict) or set(fields)-{f['key'] for f in FIELDS}:
            raise ValidationError({'detail':'Revisa los campos del formulario.'})
        cleaned={}
        for f in FIELDS:
            value=clean_string(fields.get(f['key'],''),180 if f['key'] in {'puesto_solicitado','nombres','apellido_paterno','apellido_materno','firma_solicitante'} else 2000,f['label'])
            if f['required'] and not value:
                raise ValidationError({'detail':f'Completa: {f["label"]}.'})
            if value and f['sensitive'] and data.get('sensitive_consent') is not True:
                raise ValidationError({'detail':'Autoriza expresamente los datos sensibles opcionales o déjalos vacíos.'})
            cleaned[f['key']]=value
        if len(form_text(cleaned))>60000: raise ValidationError({'detail':'El formulario supera el límite de texto permitido.'})
        email=cleaned['correo']
        try: validate_email(email)
        except DjangoValidationError: raise ValidationError({'detail':'Escribe un correo electrónico válido.'})
        if len(email)>254 or len(cleaned['telefono'])>30 or not 8<=len(exam_phone(cleaned['telefono']))<=15:
            raise ValidationError({'detail':'Revisa tu correo y teléfono.'})
        name=' '.join(cleaned[k] for k in ['nombres','apellido_paterno','apellido_materno'] if cleaned[k])
        if len(name)>180: raise ValidationError({'detail':'El nombre completo supera 180 caracteres.'})
        exam=None
        if data.get('exam_token'):
            if not isinstance(data['exam_token'],str) or len(data['exam_token'])>64:
                raise ValidationError({'detail':'El enlace de evaluación no es válido.'})
            exam=get_object_or_404(RecruitmentExam,public_token=data['exam_token'])
            if normalized(exam.title)!=normalized(cleaned['puesto_solicitado']):
                raise ValidationError({'detail':'El puesto no corresponde al enlace de esta evaluación.'})
        existing=RecruitmentApplication.objects.filter(submit_key=key).first()
        if existing:
            if existing.identity_email!=exam_email(email) or existing.identity_phone!=exam_phone(cleaned['telefono']):
                return Response({'detail':'El identificador ya fue usado. Abre un formulario nuevo.'},status=409)
            return Response(receipt(existing))
        try:
            with transaction.atomic():
                row=RecruitmentApplication.objects.create(submit_key=key,name=name,email=email,phone=cleaned['telefono'],
                    identity_email=exam_email(email),identity_phone=exam_phone(cleaned['telefono']),position=cleaned['puesto_solicitado'],
                    fields={**cleaned,'_sensitive_consent':'yes' if data.get('sensitive_consent') is True else 'no'},search_text=normalized(form_text(cleaned)),exam=exam)
        except IntegrityError:
            existing=RecruitmentApplication.objects.get(submit_key=key)
            if existing.identity_email!=exam_email(email) or existing.identity_phone!=exam_phone(cleaned['telefono']):
                return Response({'detail':'El identificador ya fue usado.'},status=409)
            return Response(receipt(existing))
        auto_link(row)
        return Response(receipt(row),status=201)


def application_data(row,detail=False):
    result=dict(id=row.id,name=row.name,email=row.email,phone=row.phone,position=row.position,
        submitted_at=row.submitted_at.isoformat(),receipt=str(row.receipt),link_status=row.link_status,
        attempt_id=row.attempt_id,exam_title=row.attempt.exam.title if row.attempt_id else None)
    if detail:
        result.update(fields=row.fields,candidates=[dict(id=a.id,name=a.name,email=a.email,phone=a.phone,exam_title=a.exam.title) for a in candidates(row,same_vacancy=False)])
    return result


class EmploymentFormsAdminView(APIView):
    permission_classes=[CanManageExams]

    def get(self,request,pk=None):
        rows=RecruitmentApplication.objects.select_related('attempt__exam')
        if pk is not None: return Response(application_data(get_object_or_404(rows,pk=pk),True))
        query=request.query_params.get('q','').strip()[:180]
        if query: rows=rows.filter(search_text__contains=normalized(query))
        position=request.query_params.get('position','').strip()[:180]
        if position: rows=rows.filter(position__icontains=position)
        status=request.query_params.get('status','')
        if status in {'linked','pending','review'}: rows=rows.filter(link_status=status)
        try: page=min(1000000,max(1,int(request.query_params.get('page',1))))
        except ValueError: raise ValidationError({'detail':'Página inválida.'})
        return Response(dict(public_url=FORM_URL,sections=SECTIONS,count=rows.count(),page=page,
            results=[application_data(r) for r in rows.defer('fields','search_text')[(page-1)*50:page*50]]))

    @transaction.atomic
    def post(self,request,pk):
        if not isinstance(request.data,dict) or set(request.data)-{'attempt_id'}:
            raise ValidationError({'detail':'Selecciona únicamente la entrega de examen.'})
        try: attempt_id=int(request.data.get('attempt_id'))
        except (ValueError,TypeError): raise ValidationError({'detail':'Selecciona una entrega de examen.'})
        attempt=get_object_or_404(RecruitmentExamAttempt.objects.select_for_update(),pk=attempt_id,submitted_at__isnull=False)
        row=get_object_or_404(RecruitmentApplication.objects.select_for_update(),pk=pk)
        if row.attempt_id and row.attempt_id!=attempt.pk:
            return Response({'detail':'Este formato ya está vinculado. No se modificó.'},status=409)
        if attempt not in candidates(row,same_vacancy=False):
            return Response({'detail':'No coincide el contacto o el puesto. Revisa la identidad antes de vincular.'},status=409)
        link_application(row,attempt,request.user)
        return Response(application_data(row,True))
