from uuid import uuid4
import unicodedata
from django.db import transaction
from django.db.models import Q, Prefetch
from django.db.models.functions import Coalesce
from django.http import HttpResponse, Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView
from core.models import PlayerSanction, PlayerBlacklistEntry
from core.api.sanctions import SanctionPermission
from core.api.enrollments import enrollment_staff, enrollment_sites
from core.enrollment_access import enrollment_site_ids
from core.services.player_blacklist import identity_key, lock_identity
from core.enrollment_models import PlayerEnrollmentDocument
from core.services.disciplinary_photos import snapshot_photo, document_thumbnail, stored_thumbnail, thumbnail, legacy_thumbnail

def can_manage_blacklist(user):
    return user.role in {'admin','owner','dev'} or (user.username.casefold()=='emilio' and enrollment_staff(user))

def scoped_sanctions(user):
    rows=PlayerSanction.objects.select_related('team__tournament__site','created_by','enrollment','player','appeal_submitted_by','appeal_decided_by','payment_recorded_by').prefetch_related(Prefetch('enrollment__documents',queryset=PlayerEnrollmentDocument.objects.filter(kind='player_photo').defer('content'),to_attr='disciplinary_photos'))
    if enrollment_site_ids(user) is not None:
        sites = enrollment_sites(user)
        rows = rows.filter(Q(team__tournament__site__in=sites) | Q(team__isnull=True, origin_site_id__in=sites.values('pk')))
    if user.role=='site_coordinator':
        rows=rows.filter(Q(team__tournament__site_id=user.primary_site_id) | Q(team__isnull=True, origin_site_id=user.primary_site_id)) if user.primary_site_id else rows.none()
    return rows.annotate(history_site=Coalesce('team__tournament__site__name','origin_site'),
        history_tournament=Coalesce('team__tournament__name','origin_tournament'),
        history_team=Coalesce('team__name','origin_team'))

def scoped_blacklist(user):
    rows = PlayerBlacklistEntry.objects.select_related('created_by','revoked_by').defer('photo_content')
    if enrollment_site_ids(user) is not None:
        rows = rows.filter(origin_site__in=enrollment_sites(user).values('name'))
    return rows


def status_of(row):
    today=timezone.localdate()
    return 'scheduled' if row.starts_on>today else 'indefinite' if row.ends_on is None else ('awaiting_payment' if row.payment_required and not row.payment_folio else 'expired') if row.ends_on<today else 'active'

class DisciplinaryHistoryView(APIView):
    permission_classes=[SanctionPermission]
    blacklist=False

    def get(self,request):
        rows=scoped_blacklist(request.user) if self.blacklist else scoped_sanctions(request.user)
        mappings={'site':'origin_site','tournament':'origin_tournament','team':'origin_team'} if self.blacklist else {'site':'history_site','tournament':'history_tournament','team':'history_team'}
        filters={key:list(rows.order_by().values_list(field,flat=True).distinct()) for key,field in mappings.items()}
        for key,field in mappings.items():
            if request.query_params.get(key):rows=rows.filter(**{field:request.query_params[key][:160]})
        if request.query_params.get('search'):rows=rows.filter(player_name__icontains=request.query_params['search'].strip()[:160])
        datefield=serializers.DateField(); dates={}
        for key in ('date_from','date_to'):
            if request.query_params.get(key):dates[key]=datefield.run_validation(request.query_params[key])
        if dates.get('date_from') and dates.get('date_to') and dates['date_from']>dates['date_to']:raise ValidationError('Revisa el rango de fechas.')
        if 'date_from' in dates:rows=rows.filter(created_at__date__gte=dates['date_from'])
        if 'date_to' in dates:rows=rows.filter(created_at__date__lte=dates['date_to'])
        status=request.query_params.get('status','')
        today=timezone.localdate()
        if self.blacklist:
            if status in {'active','revoked'}:rows=rows.filter(is_active=status=='active')
            elif status:raise ValidationError('Estado inválido.')
        else:
            if status=='active':rows=rows.filter(starts_on__lte=today).filter(Q(ends_on__isnull=True)|Q(ends_on__gte=today))
            elif status=='expired':rows=rows.filter(ends_on__lt=today).exclude(payment_required=True,payment_folio='')
            elif status=='awaiting_payment':rows=rows.filter(ends_on__lt=today,payment_required=True,payment_folio='')
            elif status=='scheduled':rows=rows.filter(starts_on__gt=today)
            elif status=='indefinite':rows=rows.filter(starts_on__lte=today,ends_on__isnull=True)
            elif status:raise ValidationError('Estado inválido.')
        page=serializers.IntegerField(min_value=1,max_value=100000).run_validation(request.query_params.get('page',1))
        count=rows.count(); result=[]
        for row in rows.order_by('-created_at','-pk')[(page-1)*25:page*25]:
            common={'id':row.pk,'player_name':row.player_name,'offense':row.offense_label,'reason':row.reason,'created_at':row.created_at,'applied_by':row.created_by.username}
            common['has_photo']=bool(row.photo_storage_path or row.photo_sha256 or row.photo_legacy_file) if self.blacklist else bool((row.enrollment_id and row.enrollment.disciplinary_photos) or (row.player_id and row.player.photo))
            if self.blacklist:common.update(site=row.origin_site,tournament=row.origin_tournament,team=row.origin_team,birth_date=row.birth_date,status='active' if row.is_active else 'revoked',revoked_at=row.revoked_at,revoked_by=row.revoked_by.username if row.revoked_by else None,revocation_reason=row.revocation_reason)
            else:common.update(site=row.history_site,tournament=row.history_tournament,team=row.history_team,birth_date=row.enrollment.birth_date if row.enrollment_id else None,status=status_of(row),starts_on=row.starts_on,ends_on=row.ends_on,recommendation=row.recommended_duration)
            if not self.blacklist:
                common.update(payment_required=row.payment_required,fine_amount=row.fine_amount,payment_folio=row.payment_folio,
                    payment_recorded_at=row.payment_recorded_at,payment_recorded_by=row.payment_recorded_by.username if row.payment_recorded_by_id else None,
                    appeal_status=row.appeal_status,appeal_reason=row.appeal_reason,has_appeal_letter=bool(row.appeal_letter_path),
                    appeal_submitted_at=row.appeal_submitted_at,appeal_submitted_by=row.appeal_submitted_by.username if row.appeal_submitted_by_id else None,
                    appeal_decision_reason=row.appeal_decision_reason,appeal_decided_at=row.appeal_decided_at,
                    appeal_decided_by=row.appeal_decided_by.username if row.appeal_decided_by_id else None)
            result.append(common)
        response=Response({'results':result,'count':count,'filters':filters,'can_manage_blacklist':can_manage_blacklist(request.user)})
        response['Cache-Control']='no-store';return response

class BlacklistView(DisciplinaryHistoryView):
    blacklist=True
    def post(self,request):
        if not can_manage_blacklist(request.user):raise PermissionDenied('Solo administración puede decidir una exclusión de todas las sedes.')
        class Input(serializers.Serializer):
            sanction_id=serializers.IntegerField(min_value=1)
            player_name=serializers.CharField(max_length=160,min_length=3)
            birth_date=serializers.DateField()
            reason=serializers.CharField(max_length=2000,min_length=10)
            confirmed=serializers.BooleanField()
            request_id=serializers.UUIDField(default=uuid4)
        serializer=Input(data=request.data);serializer.is_valid(raise_exception=True)
        data=serializer.validated_data
        if not data['confirmed']:raise ValidationError('Confirma la exclusión permanente de todas las sedes.')
        if data['birth_date']>timezone.localdate() or data['birth_date'].year<timezone.localdate().year-110:raise ValidationError('Revisa la fecha de nacimiento.')
        source=get_object_or_404(scoped_sanctions(request.user),pk=data['sanction_id'])
        if source.enrollment_id and data['birth_date']!=source.enrollment.birth_date:raise ValidationError('La fecha debe coincidir con la inscripción del jugador.')
        name=' '.join(data['player_name'].split())
        if len(name.split())<3 or not any(char.isalpha() for char in name):raise ValidationError('Indica los nombres y ambos apellidos completos para evitar homónimos.')
        if any(not (char.isalpha() or char in " '-’." or unicodedata.category(char).startswith('M')) for char in name):
            raise ValidationError('El nombre completo no puede contener números ni símbolos.')
        key=identity_key(name,data['birth_date'])
        with transaction.atomic():
            lock_identity(key)
            previous=PlayerBlacklistEntry.objects.filter(request_id=data['request_id']).first()
            if previous:
                if previous.identity_key!=key or previous.reason!=data['reason'] or previous.created_by_id!=request.user.pk:raise ValidationError('La solicitud ya fue usada con otros datos.')
                return Response({'id':previous.pk,'created':False})
            if PlayerBlacklistEntry.objects.filter(identity_key=key,is_active=True).exists():raise ValidationError('Este jugador ya tiene una exclusión activa.')
            row=PlayerBlacklistEntry.objects.create(source_sanction=source,source_player=source.player,
                player_name=name,birth_date=data['birth_date'],identity_key=key,origin_site=source.history_site,
                origin_tournament=source.history_tournament,origin_team=source.history_team,offense_label=source.offense_label,
                reason=data['reason'],created_by=request.user,request_id=data['request_id'],**snapshot_photo(source))
        return Response({'id':row.pk,'created':True},status=201)

class BlacklistRevokeView(APIView):
    permission_classes=[SanctionPermission]
    def post(self,request,pk):
        if not can_manage_blacklist(request.user):raise PermissionDenied('Solo administración puede retirar una exclusión.')
        reason=serializers.CharField(min_length=10,max_length=2000).run_validation(request.data.get('reason'))
        confirmed=serializers.BooleanField().run_validation(request.data.get('confirmed'))
        if not confirmed:raise ValidationError('Confirma el retiro de la exclusión.')
        with transaction.atomic():
            row=get_object_or_404(PlayerBlacklistEntry.objects.select_for_update(),pk=pk)
            lock_identity(row.identity_key)
            if not row.is_active:return Response({'completed':True})
            row.is_active=False;row.revoked_at=timezone.now();row.revoked_by=request.user;row.revocation_reason=reason
            row.save(update_fields=['is_active','revoked_at','revoked_by','revocation_reason'])
        return Response({'completed':True})


class DisciplinaryPhotoView(APIView):
    permission_classes=[SanctionPermission]
    blacklist=False
    def get(self,request,pk):
        if self.blacklist:
            row=get_object_or_404(scoped_blacklist(request.user),pk=pk)
            if not(row.photo_storage_path or row.photo_sha256 or row.photo_legacy_file):raise Http404()
        else:
            row=get_object_or_404(scoped_sanctions(request.user),pk=pk)
            document=row.enrollment.disciplinary_photos[0] if row.enrollment_id and row.enrollment.disciplinary_photos else None
            if not document and not(row.player_id and row.player.photo):raise Http404()
        try:
            if self.blacklist:
                if row.photo_storage_path:content=stored_thumbnail(row.photo_storage_path,row.photo_sha256)
                elif row.photo_sha256:
                    from hashlib import sha256
                    original=bytes(row.photo_content)
                    if sha256(original).hexdigest()!=row.photo_sha256:raise ValueError('Foto inválida.')
                    content=thumbnail(original)
                else:content=legacy_thumbnail(row.photo_legacy_file)
            else:content=document_thumbnail(document) if document else legacy_thumbnail(row.player.photo.name)
        except Exception:
            return Response({'detail':'Foto no disponible.'},status=503)
        response=HttpResponse(content,content_type='image/jpeg')
        response['Cache-Control']='private, no-store'
        response['X-Content-Type-Options']='nosniff'
        response['Referrer-Policy']='no-referrer'
        return response


class BlacklistPhotoView(DisciplinaryPhotoView):
    blacklist=True
