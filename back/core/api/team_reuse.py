from django.db import transaction, IntegrityError
from django.shortcuts import get_object_or_404
from rest_framework import permissions, serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView
from core.models import Team, Tournament
from core.domain_serializers.sports import TeamSerializer
from core.api.enrollments import enrollment_staff, enrollment_sites
from core.enrollment_access import enrollment_site_ids


class TeamReusePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return user.is_authenticated and (enrollment_staff(user) or user.role in {'site_coordinator', 'cashier'})


class TeamReuseView(APIView):
    permission_classes = [TeamReusePermission]

    def teams(self, request):
        rows = Team.objects.select_related('tournament__site').all()
        if enrollment_site_ids(request.user) is not None:
            rows = rows.filter(tournament__site__in=enrollment_sites(request.user))
        if request.user.role == 'cashier':
            rows = rows.filter(tournament__site_id=request.user.primary_site_id)
        return rows

    def get(self, request):
        rows = self.teams(request)
        tournaments = list(rows.order_by().values('tournament_id', 'tournament__name', 'tournament__site__name').distinct())
        for key, lookup in [('target_id', 'tournament_id'), ('source_id', 'tournament_id')]:
            value = request.query_params.get(key)
            if value:
                number = serializers.IntegerField(min_value=1).run_validation(value)
                rows = rows.exclude(**{lookup: number}) if key == 'target_id' else rows.filter(**{lookup: number})
        search = request.query_params.get('search', '').strip()[:140]
        if search:
            rows = rows.filter(name__icontains=search)
        page = serializers.IntegerField(min_value=1, max_value=100000).run_validation(request.query_params.get('page', 1))
        count = rows.count()
        result = list(rows.order_by('name', 'pk').values('id', 'name', 'tournament_id', 'tournament__name', 'tournament__site__name', 'is_active')[(page - 1) * 50:page * 50])
        response = Response({'results': result, 'count': count, 'tournaments': tournaments})
        response['Cache-Control'] = 'no-store'
        return response

    def post(self, request):
        class Input(serializers.Serializer):
            target_id = serializers.IntegerField(min_value=1)
            team_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), min_length=1, max_length=100)
        serializer = Input(data=request.data); serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data['team_ids']
        if len(set(ids)) != len(ids):
            raise ValidationError('No repitas equipos en la selección.')
        try:
            with transaction.atomic():
                targets = Tournament.objects.select_for_update().filter(is_active=True, site__is_active=True)
                if enrollment_site_ids(request.user) is not None:
                    targets = targets.filter(site__in=enrollment_sites(request.user))
                if request.user.role == 'cashier':
                    targets = targets.filter(site_id=request.user.primary_site_id)
                target = get_object_or_404(targets, pk=serializer.validated_data['target_id'])
                sources = list(self.teams(request).filter(pk__in=ids).exclude(tournament=target).order_by('pk'))
                if len(sources) != len(ids):
                    raise ValidationError('Selecciona equipos de otros torneos a los que tengas acceso.')
                names = [' '.join(row.name.split()).casefold() for row in sources]
                if len(names) != len(set(names)):
                    raise ValidationError('Hay equipos con el mismo nombre en la selección. Elige una sola versión de cada equipo.')
                existing = {' '.join(name.split()).casefold() for name in Team.objects.filter(tournament=target).values_list('name', flat=True)}
                created, skipped = [], []
                for source, name in zip(sources, names):
                    if name in existing:
                        skipped.append(source.name); continue
                    created.append(Team.objects.create(tournament=target, name=source.name.strip(),
                        representative_name=source.representative_name, representative_phone=source.representative_phone,
                        representative_email=source.representative_email, is_active=True))
                    existing.add(name)
        except IntegrityError:
            raise ValidationError('Un equipo ya fue agregado al torneo. Actualiza y vuelve a intentarlo.')
        return Response({'created': TeamSerializer(created, many=True).data, 'skipped': skipped}, status=201)
