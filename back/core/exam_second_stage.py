"""Complementary evaluation and conservative linking to the first attempt."""
import json
from functools import lru_cache
from pathlib import Path

from core.exam_skills import SKILLS, attempt_skills, signature

QUESTIONS = [
    {'id': '1', 'kind': 'open', 'prompt': 'Cuéntanos una situación real de un trabajo anterior en la que identificaste un problema o una oportunidad de mejora y decidiste hacer algo sin que tu jefe te lo pidiera. ¿Qué hiciste específicamente y cuál fue el resultado?'},
    {'id': '2', 'kind': 'open', 'prompt': 'Describe una situación real en la que tuviste mucho trabajo, varios pendientes importantes o dificultades para cumplir con tus responsabilidades. ¿Cómo te organizaste, qué hiciste cuando surgieron problemas y cómo terminó la situación?'},
    {'id': '3', 'kind': 'open', 'prompt': 'Trabajas en una academia de fútbol infantil. Una mamá interesada en inscribir a su hijo te escribe por WhatsApp:\n\n"Gracias por la información, pero se me hace un poco caro. Voy a pensarlo".\n\nEscribe exactamente qué le contestarías para intentar conseguir su inscripción. Explica también qué harías si no te responde.'},
]

GENERAL = (' Califica de 0 a 10 usando exclusivamente estos criterios y crédito parcial. '
    'Valora acciones específicas, iniciativa, resultados y ejecución. No agregues puntos por longitud, '
    'vocabulario o redacción elegante; reduce puntos por respuestas vagas o buenas intenciones sin acciones. '
    'No supongas que una experiencia sea verdadera ni infieras comportamiento laboral a partir de la respuesta. '
    'Indica en la justificación si falta evidencia concreta que se pueda comprobar después y marca review=true '
    'ante evidencia insuficiente o ambigüedad. La nota es orientativa para revisión humana.')
KEY = {
    '1': 'Proactividad: máximo 3 puntos por identificar por iniciativa propia un problema u oportunidad; máximo 4 por acciones concretas sin esperar instrucciones; máximo 3 por resultado positivo y contribución explicada.' + GENERAL,
    '2': 'Responsabilidad, constancia y capacidad de trabajo: máximo 3 puntos por organización y prioridades; máximo 4 por esfuerzo sostenido, perseverancia y superación de obstáculos; máximo 3 por cumplimiento, seguimiento y resultados concretos. No premies trabajar muchas horas; valora cumplir y concluir tareas.' + GENERAL,
    '3': 'Habilidad comercial y persuasión por WhatsApp: máximo 2 puntos por empatía y trato amable ante la objeción; máximo 3 por destacar beneficios sin inventar información; máximo 3 por iniciativa para avanzar hacia clase muestra o inscripción; máximo 2 por seguimiento adecuado si no hay respuesta.' + GENERAL,
}
LABELS = {'1': 'Proactividad', '2': 'Responsabilidad y constancia', '3': 'Habilidad comercial por WhatsApp'}


@lru_cache(maxsize=1)
def expected_skill_signatures():
    template = json.loads(Path(__file__).with_name('exam_template.json').read_text(encoding='utf-8'))['questions']
    return {key: {signature(q) for q in template if int(q['id']) in SKILLS[key][1]}
            for key in ('management', 'sales')}


def complete_skill_questions(questions):
    """Recognize the complete original areas, without guessing from titles or IDs."""
    if not isinstance(questions, list) or not all(isinstance(q, dict) for q in questions):
        return False
    for required in expected_skill_signatures().values():
        matched = [signature(q) for q in questions if signature(q) in required]
        if len(matched) != len(required) or set(matched) != required:
            return False
    return True


def eligibility(attempt):
    questions = attempt.snapshot.get('questions', []) if isinstance(attempt.snapshot, dict) else []
    if not attempt.submitted_at or not complete_skill_questions(questions):
        return {'status': 'incomplete', 'management': None, 'sales': None}
    grades = attempt.grading.get('questions', {}) if isinstance(attempt.grading, dict) else {}
    skills = attempt_skills(questions, attempt.grading_status, grades)
    management, sales = (skills.get(key, (None, 0))[0] for key in ('management', 'sales'))
    if management is None or sales is None:
        return {'status': 'incomplete', 'management': management, 'sales': sales}
    return {'status': 'eligible' if management >= 8 and sales >= 8 else 'below_threshold',
            'management': management, 'sales': sales}


def complementary_grade(attempt):
    """Derive the /30 score from all three validated question scores, never a rounded mean."""
    import math
    grade = attempt.grading if isinstance(attempt.grading, dict) else {}
    items = grade.get('questions', {})
    if attempt.grading_status != 'graded' or not isinstance(items, dict):
        return None
    scores = [items.get(i, {}).get('points') if isinstance(items.get(i), dict) else None for i in LABELS]
    if not all(type(x) in (int, float) and math.isfinite(x) and 0 <= x <= 10 for x in scores):
        return None
    total = round(sum(scores), 2)
    return {'total': total, 'scale': 30,
            'meets_suggested_priority': all(x >= 7 for x in scores) and sum(scores) >= 24}
