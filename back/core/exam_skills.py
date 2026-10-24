"""Versioned subject mapping for the original Business Operations & AI questions.

Only exact question content (including choice order) identifies a known question.
No inference from exam title, question number, answers, or candidate information.
"""
import json
import math
from functools import lru_cache
from pathlib import Path

SKILLS = {
    'mathematics': ('Matemáticas y análisis numérico', [2, 9, 12, 16, 19, 26, 31]),
    'sales': ('Ventas y marketing', [5, 20, 29, 40]),
    'ai': ('Uso de IA', [1, 8, 15, 22, 28, 32]),
    'processes': ('Procesos y automatización', [3, 6, 11, 18, 23, 30, 35, 36, 39]),
    'management': ('Gestión y prioridades', [4, 7, 10, 17, 21, 24, 27, 33, 38]),
    'information': ('Análisis de información', [13, 14, 25, 34, 37]),
}


def signature(question):
    return json.dumps([question.get('kind'), question.get('prompt'), question.get('options')], ensure_ascii=False)


@lru_cache(maxsize=1)
def question_skills():
    template = json.loads(Path(__file__).with_name('exam_template.json').read_text(encoding='utf-8'))
    by_id = {str(n): key for key, (_, ids) in SKILLS.items() for n in ids}
    return {signature(q): by_id[q['id']] for q in template['questions']}


def skill_statistics(rows):
    """Stream private question/grade fragments only; never read contacts or answers."""
    groups = {key: dict(id=key, label=label, delivered=0, graded=0, without_breakdown=0,
                        question_count=0, average_score=None, lowest_score=None, highest_score=None,
                        per_exam=[]) for key, (label, _) in SKILLS.items()}
    scores = {key: [] for key in SKILLS}
    exam_scores = {key: {} for key in SKILLS}
    unclassified = 0
    for row in rows.values('exam_id', 'exam__title', 'snapshot__questions', 'grading_status', 'grading__questions').iterator(chunk_size=200):
        questions = row['snapshot__questions']
        if not isinstance(questions, list):
            unclassified += 1
            continue
        matched = {}
        for q in questions:
            if not isinstance(q, dict):
                continue
            skill = question_skills().get(signature(q))
            if skill:
                matched.setdefault(skill, []).append(str(q.get('id')))
        if not matched:
            unclassified += 1
        grades = row['grading__questions']
        for skill, ids in matched.items():
            group = groups[skill]
            group['delivered'] += 1
            points = [grades.get(i, {}).get('points') if isinstance(grades.get(i), dict) else None for i in ids] if isinstance(grades, dict) else []
            if row['grading_status'] != 'graded' or len(points) != len(ids) or not all(type(p) in (int, float) and math.isfinite(p) and 0 <= p <= 10 for p in points):
                group['without_breakdown'] += 1
                continue
            score = sum(points) / len(points)
            scores[skill].append(score)
            group['graded'] += 1
            group['question_count'] += len(ids)
            entry = exam_scores[skill].setdefault(row['exam_id'], dict(exam_id=row['exam_id'], title=row['exam__title'], scores=[]))
            entry['scores'].append(score)
    for key, group in groups.items():
        values = scores[key]
        if values:
            group.update(average_score=round(sum(values)/len(values), 2), lowest_score=round(min(values), 2), highest_score=round(max(values), 2))
        group['per_exam'] = [dict(exam_id=e['exam_id'], title=e['title'], graded=len(e['scores']), average_score=round(sum(e['scores'])/len(e['scores']), 2)) for e in exam_scores[key].values()]
    return dict(mapping_version='business-operations-v1', results=list(groups.values()), unclassified=unclassified)
