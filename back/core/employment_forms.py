"""Employment form schema, validation and conservative on-demand exam linking."""
from django.db import transaction
from django.db.models import Q
from core.exam_models import RecruitmentApplication, RecruitmentExamAttempt, RecruitmentProfile
from core.exam_profiles import normalized

FORM_URL = 'https://futsi.bpoweracademy.mx/#/postulacion'


def field(key, label, required=False, kind='text', sensitive=False):
    return dict(key=key, label=label, required=required, kind=kind, sensitive=sensitive)


SECTIONS = [
    dict(title='Postulación', fields=[field('puesto_solicitado','Puesto que solicita',True),field('sueldo_deseado','Sueldo mensual deseado')]),
    dict(title='Datos personales', fields=[field('apellido_paterno','Apellido paterno',True),field('apellido_materno','Apellido materno'),
        field('nombres','Nombre(s)',True),field('correo','Correo electrónico',True,'email'),field('telefono','Teléfono',True,'tel'),
        field('edad','Edad',sensitive=True),field('sexo','Sexo',sensitive=True),field('estado_civil','Estado civil',sensitive=True),
        field('dependientes','Personas dependientes',sensitive=True),field('enfermedad_cronica','¿Padece una enfermedad crónica? ¿Cuál?',sensitive=True),
        field('tiempo_traslado','Tiempo de traslado al empleo (Santa Fe)'),field('medio_transporte','¿Automóvil propio u otro medio de transporte? Especifique.')]),
    dict(title='Datos escolares', groups=[dict(title=title, fields=[field(f'estudios_{i}_escuela','Nombre de la escuela'),field(f'estudios_{i}_carrera','Carrera profesional'),field(f'estudios_{i}_titulo','Título recibido')]) for i,title in enumerate(['Preparatoria','Licenciatura','Estudios o cursos adicionales'],1)] +
        [dict(title='Estudios que está efectuando en la actualidad',fields=[field('estudio_actual_escuela','Escuela'),field('estudio_actual_horario','Horario'),field('estudio_actual_carrera','Curso o carrera'),field('estudio_actual_grado','Grado')])]),
    dict(title='Conocimientos generales',fields=[field('otros_idiomas','Otros idiomas que habla'),field('funciones_oficina','Funciones de oficina que domina'),field('otras_funciones','Otros trabajos o funciones que domina'),field('software','Software que maneja')]),
    dict(title='Empleo actual y anteriores',description='Comience por el empleo más reciente. Si no tiene experiencia, puede dejar estos campos vacíos.',groups=[dict(title=title,fields=[field(f'empleo_{i}_{key}',label) for key,label in [
        ('compania','Nombre de la compañía'),('tiempo_servicio','Tiempo que prestó sus servicios'),('periodo_desde','Desde'),('periodo_hasta','Hasta'),('direccion','Dirección'),('puesto','Puesto desempeñado'),('sueldo','Sueldo mensual'),('telefono','Teléfono'),('jefe','Nombre de su jefe directo'),('referencias','¿Podemos solicitar referencias?'),('separacion','Motivo de separación')]]) for i,title in enumerate(['Actual o último empleo','Empleo anterior 01','Empleo anterior 02','Empleo anterior 03'],1)] +
        [dict(title='¿En cuál de sus empleos permaneció más tiempo?',fields=[field('mayor_antiguedad_compania','Nombre de la compañía'),field('mayor_antiguedad_tiempo','Tiempo que prestó sus servicios')])]),
    dict(title='Datos económicos',fields=[field('conyuge_trabaja','¿Su cónyuge trabaja?',sensitive=True),field('como_nos_conocio','¿Cómo nos conoció?'),field('firma_solicitante','Nombre completo del solicitante',True)]),
]
FIELDS = [f for section in SECTIONS for group in ([section] if 'fields' in section else section['groups']) for f in group['fields']]
LABELS = {f['key']:f['label'] for f in FIELDS}


def form_text(fields):
    return '\n'.join(f'{LABELS.get(k,k)}: {v}' for k,v in fields.items() if v and not k.startswith('_'))


def candidates(application, same_vacancy=True):
    rows = RecruitmentExamAttempt.objects.filter(submitted_at__isnull=False).select_related('exam')
    if application.exam_id:
        rows = rows.filter(exam_id=application.exam_id)
    rows = rows.filter(Q(identity_email=application.identity_email)|Q(identity_phone=application.identity_phone))
    # A generic form must not cross-link different vacancies by contact alone.
    return [a for a in rows.order_by('-id').iterator() if not same_vacancy or application.exam_id or normalized(a.exam.title)==normalized(application.position)]


def link_application(application, attempt, actor=None):
    application.attempt=attempt
    application.link_status='linked'
    application.linked_by=actor
    application.save(update_fields=['attempt','link_status','linked_by'])
    profile,_=RecruitmentProfile.objects.get_or_create(attempt=attempt,defaults={'updated_by':actor})
    # Never replace an existing/imported form or an administrator's corrections.
    if not profile.form_text:
        profile.form_fields=application.fields
        profile.form_text=form_text(application.fields)
        profile.form_search=normalized(profile.form_text)
        profile.updated_by=actor
        profile.save()


def auto_link(application):
    matches=candidates(application)
    if len(matches)==1 and matches[0].identity_email==application.identity_email and matches[0].identity_phone==application.identity_phone:
        attempt=RecruitmentExamAttempt.objects.select_for_update().get(pk=matches[0].pk)
        link_application(application,attempt)
    else:
        application.link_status='review' if matches or candidates(application,same_vacancy=False) else 'pending'
        application.save(update_fields=['link_status'])


@transaction.atomic
def link_forms_after_exam(attempt):
    # Event-driven only: no cron, worker, periodic scan or external request.
    forms=RecruitmentApplication.objects.select_for_update().filter(attempt__isnull=True,
        identity_email=attempt.identity_email,identity_phone=attempt.identity_phone).filter(Q(exam=attempt.exam)|Q(exam__isnull=True))
    for application in forms:
        auto_link(application)
