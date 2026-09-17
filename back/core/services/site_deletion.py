"""Explicit, reviewed deletion of a site and its local data graph."""
import hashlib
import json
from collections import defaultdict
from decimal import Decimal

from django.core import signing
from django.db import transaction
from django.db.models import Exists, OuterRef, Sum
from django.db.models.deletion import ProtectedError, RestrictedError
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.authtoken.models import Token

from core.models import Site, User, Guardian, Student, AuditLog, Charge, Payment, Discount
from core.domain_serializers.money import charge_balance
from .student_deletion import collect_owned_files

SALT = 'futsi.site-deletion.v3'
OWNERSHIP_FIELDS = {
    'site', 'primary_site', 'tournament', 'team', 'student', 'session', 'device', 'report',
    'booking', 'conversation', 'charge', 'payment', 'home_team', 'away_team', 'round',
}
LABELS = {
    'Site': 'Sede', 'User': 'Cuentas de caja a eliminar', 'Guardian': 'Fichas de tutores',
    'Student': 'Alumnos', 'Court': 'Canchas', 'Tournament': 'Torneos', 'Team': 'Equipos',
    'Player': 'Jugadores', 'Round': 'Jornadas', 'Match': 'Partidos',
    'StudentTournamentRegistration': 'Inscripciones a torneos', 'Charge': 'Cargos',
    'Payment': 'Pagos', 'Discount': 'Descuentos', 'Expense': 'Gastos', 'Invoice': 'Facturas',
    'StaffPaymentRequest': 'Solicitudes de pago al personal', 'CashMovement': 'Movimientos de caja',
    'CoachWorkLog': 'Horas trabajadas de coaches', 'DailyClosure': 'Cierres de caja',
    'AttendanceSession': 'Sesiones de asistencia', 'AttendanceRecord': 'Asistencias de alumnos',
    'PlayerAttendanceRecord': 'Asistencias de jugadores', 'StudentAssessment': 'Evaluaciones deportivas',
    'StudentValueAssessment': 'Evaluaciones de valores', 'BillingPlan': 'Planes de cobro',
    'FaceRecognitionAttempt': 'Intentos de reconocimiento facial', 'FaceStationDevice': 'Dispositivos FaceGuard',
    'FaceStationEvent': 'Eventos FaceGuard', 'FaceStationUnknownLink': 'Vínculos FaceGuard',
    'FaceStationDailyReport': 'Reportes diarios FaceGuard', 'FaceStationDailyPresence': 'Presencias FaceGuard',
    'FaceStationMonthlyPolicy': 'Configuración mensual FaceGuard', 'TrialBooking': 'Reservas de prueba',
    'TrialVisit': 'Visitas de prueba', 'TrialAvailabilityRule': 'Horarios de pruebas',
    'VoiceCall': 'Registros de llamadas', 'CallTranscriptSegment': 'Transcripciones de llamadas',
    'WhatsAppConversation': 'Conversaciones de WhatsApp', 'WhatsAppMessage': 'Mensajes de WhatsApp',
    'WhatsAppAutomationSettings': 'Configuración del asistente', 'WhatsAppOutboundDispatch': 'Envíos de WhatsApp',
    'WhatsAppHumanResponseEvent': 'Seguimiento de respuestas', 'HistoricalImport': 'Importaciones',
    'HistoricalImportRow': 'Filas de importación', 'AuditLog': 'Registros de auditoría asociados',
    'Token': 'Sesiones de acceso por token', 'LogEntry': 'Historial administrativo',
}


class DeletionConflict(APIException):
    status_code = 409
    default_detail = 'Los datos cambiaron. Actualiza el detalle y vuelve a confirmar.'


def owner_sites(row, seen=None, cache=None):
    seen = set() if seen is None else seen
    cache = {} if cache is None else cache
    key = (type(row), row.pk)
    if key in cache:
        return cache[key]
    if key in seen:
        return set()
    seen.add(key)
    if isinstance(row, Site):
        return {row.pk}
    owners = set()
    for field in row._meta.fields:
        if field.name in OWNERSHIP_FIELDS and field.is_relation and getattr(row, field.attname):
            owners.update(owner_sites(getattr(row, field.name), seen, cache))
    cache[key] = owners
    return owners


def ownership_select_paths(model):
    """Forward relation paths needed by owner_sites, suitable for select_related."""
    paths = []

    def visit(current_model, prefix, ancestors):
        if current_model in ancestors:
            return
        ancestors = ancestors | {current_model}
        for field in current_model._meta.fields:
            if field.name not in OWNERSHIP_FIELDS or not field.is_relation:
                continue
            path = f'{prefix}__{field.name}' if prefix else field.name
            paths.append(path)
            if field.related_model != Site:
                visit(field.related_model, path, ancestors)

    visit(model, '', set())
    return paths


def plan(site, actor, lock=False):
    records = defaultdict(dict)
    retained = {}
    blocked = set()
    queue = defaultdict(dict)
    ownership_cache = {}

    def row_owner_sites(row):
        return owner_sites(row, cache=ownership_cache)

    site_guardians = list(
        Guardian.objects.filter(students__site=site)
        .annotate(
            has_other_site=Exists(
                Student.objects.filter(guardian_id=OuterRef('pk')).exclude(site=site)
            )
        )
        .select_related('user__primary_site')
        .distinct()
    )
    shared = [guardian for guardian in site_guardians if guardian.has_other_site]
    surviving_sites = {}
    for guardian_id, site_id in (
        Student.objects.filter(guardian__in=shared).exclude(site=site)
        .order_by('guardian_id', 'site_id').values_list('guardian_id', 'site_id')
    ):
        surviving_sites.setdefault(guardian_id, site_id)
    active_users = {
        guardian.user_id: surviving_sites[guardian.pk]
        for guardian in shared if guardian.user_id and guardian.pk in surviving_sites
    }
    debt_candidates = list(
        Charge.objects.filter(site=site, student__guardian__in=shared)
        .select_related('student__guardian').exclude(status__in=['paid', 'canceled'])
    )
    candidate_ids = [charge.pk for charge in debt_candidates]
    paid_by_charge = dict(
        Payment.objects.filter(charge_id__in=candidate_ids, status__in=['registered', 'reconciled'])
        .values('charge_id').annotate(total=Sum('amount')).values_list('charge_id', 'total')
    )
    discounted_by_charge = dict(
        Discount.objects.filter(charge_id__in=candidate_ids, status='approved')
        .values('charge_id').annotate(total=Sum('amount')).values_list('charge_id', 'total')
    )
    debts = []
    for charge in debt_candidates:
        charge._site_deletion_balance = max(
            charge.amount
            - (paid_by_charge.get(charge.pk) or Decimal('0'))
            - (discounted_by_charge.get(charge.pk) or Decimal('0')),
            Decimal('0'),
        )
        if charge._site_deletion_balance > 0:
            debts.append(charge)
    preserved = {(Charge, c.pk): c for c in debts}
    for model in (Payment, Discount):
        for row in model.objects.filter(charge__in=debts):
            preserved[(model, row.pk)] = row
    for row in preserved.values():
        if row_owner_sites(row) - {site.pk}:
            blocked.add('Un adeudo que se conservaría tiene referencias financieras inconsistentes con otra sede. Revisa ese registro antes de eliminar.')
    releases = {}

    def release_actor(row, field, user):
        releases[(type(row), row.pk, field.name)] = (row, field, user.username)

    def add(row):
        model = type(row)
        if (model, row.pk) in preserved or (isinstance(row, User) and row.pk in active_users):
            return
        if row.pk in records[model] or (isinstance(row, User) and row.pk in retained):
            return
        if row_owner_sites(row) - {site.pk}:
            blocked.add(f'Hay registros de {LABELS.get(model.__name__, model.__name__)} relacionados con otra sede. Es necesario separar esas relaciones antes de eliminar; no se borrarán datos de otras sedes.')
            return
        if isinstance(row, User) and row.pk == actor.pk:
            blocked.add('Tu cuenta está asignada a esta sede. Otra cuenta administradora debe realizar la eliminación.')
        # Keep identities for future enrolment/reassignment. Do not traverse
        # their historical actor references into unrelated records.
        if isinstance(row, User) and row.role != 'cashier':
            retained[row.pk] = row
            return
        records[model][row.pk] = row
        queue[model][row.pk] = row

    add(site)
    # Tutors and their logins are forward references, not owned reverse FKs.
    for guardian in site_guardians:
        if guardian.has_other_site:
            continue  # Keep the tutor and their access in the surviving site.
        else:
            add(guardian)
            if guardian.user_id:
                add(guardian.user)
    while queue:
        model = next(iter(queue))
        batch = list(queue.pop(model).values())
        batch_by_pk = {row.pk: row for row in batch}
        # Include adult logins even for older imports lacking primary_site.
        forward_user_ids = set()
        if model._meta.model_name == 'player':
            forward_user_ids.update(row.user_id for row in batch if row.user_id)
        if model._meta.model_name == 'team':
            forward_user_ids.update(row.representative_user_id for row in batch if row.representative_user_id)
        for user in User.objects.filter(pk__in=forward_user_ids).select_related(*ownership_select_paths(User)):
            add(user)
        for relation in model._meta.related_objects:
            if relation.many_to_many:
                continue  # Memberships disappear, shared roles/groups do not.
            dependents = relation.related_model._base_manager.filter(
                **{f'{relation.field.name}__in': batch}
            ).select_related(*ownership_select_paths(relation.related_model)).order_by('pk')
            for dependent in dependents:
                if model == User and (row_owner_sites(dependent) - {site.pk} or (type(dependent), dependent.pk) in preserved):
                    if relation.field.null:
                        parent = batch_by_pk[getattr(dependent, relation.field.attname)]
                        release_actor(dependent, relation.field, parent)
                        continue
                add(dependent)
    groups = [{'model': model, 'label': LABELS.get(model.__name__, str(model._meta.verbose_name_plural)),
               'rows': list(rows.values())} for model, rows in sorted(records.items(), key=lambda pair: pair[0]._meta.label) if rows]
    if lock:
        for group in groups:
            list(
                group['model']._base_manager.select_for_update()
                .filter(pk__in=[row.pk for row in group['rows']])
                .values_list('pk', flat=True)
            )
    files = collect_owned_files(groups)
    watched = list(preserved.values()) + list(User.objects.filter(pk__in=active_users))
    watched += list(Student.objects.filter(guardian__in=shared))
    watched += [r for r, _, _ in releases.values()]
    if lock:
        watched_by_model = defaultdict(set)
        for row in watched:
            watched_by_model[type(row)].add(row.pk)
        for model, ids in watched_by_model.items():
            list(model.objects.select_for_update().filter(pk__in=ids).values_list('pk', flat=True))
    fingerprint_groups = groups + [{'model': User, 'rows': list(retained.values())}]
    fingerprint_groups += [{'model': type(row), 'rows': [row]} for row in watched]
    fingerprint = hashlib.sha256(json.dumps([
        [g['model']._meta.label, [
            [str(r.pk), {f.attname: str(getattr(r, f.attname)) for f in r._meta.fields}] for r in sorted(g['rows'], key=lambda r: str(r.pk))]] for g in fingerprint_groups
    ], sort_keys=True).encode()).hexdigest()
    return {'groups': groups, 'retained': list(retained.values()), 'files': files, 'fingerprint': fingerprint, 'blocked': sorted(blocked),
            'debts': debts, 'preserved': list(preserved.values()), 'active_users': active_users, 'releases': list(releases.values())}


def preview(site, actor):
    data = plan(site, actor)
    return {
        'full_name': site.name,
        'items': [{'label': g['label'], 'count': len(g['rows'])} for g in data['groups']],
        'accounts': [{'username': u.username, 'role': u.get_role_display()} for g in data['groups'] if g['model'] == User for u in g['rows']],
        'retained_accounts': [{'username': u.username, 'role': u.get_role_display()} for u in data['retained']],
        'preserved_debts': [{'student': c.student.full_name, 'guardian': c.student.guardian.full_name,
                             'balance': str(c._site_deletion_balance if hasattr(c, '_site_deletion_balance') else charge_balance(c))} for c in data['debts']],
        'active_guardians': len(data['active_users']),
        'preserved_payments': sum(isinstance(r, Payment) for r in data['preserved']),
        'detached_actor_references': len(data['releases']),
        'file_count': len(data['files']), 'blockers': data['blocked'],
        'confirmation_token': signing.dumps({'site': site.pk, 'actor': actor.pk, 'fingerprint': data['fingerprint']}, salt=SALT),
    }


def permanently_delete(site, actor, payload):
    try:
        confirmation = signing.loads(payload.get('confirmation_token', ''), salt=SALT, max_age=600)
    except (signing.BadSignature, TypeError) as exc:
        raise ValidationError('Revisa el detalle y vuelve a confirmar la eliminación.') from exc
    if confirmation.get('site') != site.pk or confirmation.get('actor') != actor.pk:
        raise ValidationError('La confirmación no corresponde a esta sede o usuario.')
    with transaction.atomic():
        site = Site.objects.select_for_update().get(pk=site.pk)
        if payload.get('confirmation_name', '').strip() != site.name.strip() or payload.get('accept_permanent') is not True:
            raise ValidationError('Escribe el nombre de la sede y acepta la eliminación de sus datos y cuentas de caja; las demás cuentas se conservarán inactivas.')
        data = plan(site, actor, lock=True)
        if data['blocked']:
            raise DeletionConflict(' '.join(data['blocked']))
        if confirmation['fingerprint'] != data['fingerprint']:
            raise DeletionConflict()
        for user_id, surviving_site in data['active_users'].items():
            User.objects.filter(pk=user_id, primary_site=site).update(primary_site_id=surviving_site)
        for charge in data['debts']:
            Charge.objects.filter(pk=charge.pk).update(
                retained_guardian_id=charge.student.guardian_id,
                original_student_name=charge.student.full_name, original_site_name=site.name,
                site=None, student=None, team=None, tournament_registration=None, billing_plan=None)
            for model in (Payment, Discount):
                model.objects.filter(charge=charge).update(site=None, student=None, team=None)
        detached = []
        for row, field, username in data['releases']:
            type(row).objects.filter(pk=row.pk).update(**{field.name: None})
            detached.append({'model': row._meta.label, 'id': str(row.pk), 'field': field.name, 'username': username})
        retained_ids = [u.pk for u in data['retained']]
        User.objects.filter(pk__in=retained_ids).update(primary_site=None, is_active=False)
        Token.objects.filter(user_id__in=retained_ids).delete()
        pending = list(data['groups'])
        # Delete dependent tables first without disabling constraints or widening
        # the reviewed set. Savepoints make failed PROTECT attempts reversible.
        while pending:
            progress = False
            for group in pending[:]:
                try:
                    with transaction.atomic():
                        group['model']._base_manager.filter(pk__in=[r.pk for r in group['rows']]).delete()
                except (ProtectedError, RestrictedError):
                    continue
                pending.remove(group)
                progress = True
            if not progress:
                raise DeletionConflict('Hay dependencias que requieren revisión. No se eliminó ningún dato.')
        audit = AuditLog.objects.create(actor=actor, action='site_deleted', table_name='sites', record_id=str(site.pk),
            metadata={'site_name': site.name, 'counts': {g['model']._meta.label: len(g['rows']) for g in data['groups']},
                      'retained_account_ids': retained_ids, 'preserved_charge_ids': [c.pk for c in data['debts']],
                      'detached_actor_references': detached, 'pending_files': data['files']})
    # Files are explicitly reported as pending; local testing must never delete
    # production storage files referenced by a local database copy.
    return {'deletion_id': audit.pk, 'cleanup_pending': len(data['files']), 'retained_accounts_count': len(retained_ids)}
