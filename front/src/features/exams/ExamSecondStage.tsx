import { useEffect, useState } from 'react';
import type { Question } from './ExamQuestionEditor';
import type { Grading } from './ExamAnswerKey';

export type SecondExam = { id: number; title: string; public_token: string; duration_minutes: number; accepting: boolean };
export type SecondAttempt = { submitted_at: string | null; grading_status?: string; grading?: Grading;
  snapshot: { questions: Question[] }; answers: Record<string, number | string>;
  complementary_grade?: { total: number; scale: number; meets_suggested_priority: boolean } | null };
export type SecondProgress = { status: 'eligible' | 'below_threshold' | 'incomplete'; management: number | null; sales: number | null; attempt: SecondAttempt | null };

const labels: Record<string, string> = { '1': 'Proactividad', '2': 'Responsabilidad, constancia y capacidad de trabajo', '3': 'Habilidad comercial y persuasión por WhatsApp' };
const score = (value: number | null) => value == null ? 'Sin desglose' : `${value.toFixed(2)} / 10`;

export function SecondStageControls({ stage, link, busy, onToggle, onGrade, onCopy, onDuration }: {
  stage: SecondExam | null; link: string; busy: boolean;
  onToggle: () => void; onCopy: () => void; onGrade?: () => void; onDuration: (minutes: number) => void;
}) {
  const [minutes, setMinutes] = useState(stage?.duration_minutes ?? 40);
  useEffect(() => { if (stage) setMinutes(stage.duration_minutes); }, [stage?.id, stage?.duration_minutes]);
  return <section className="exam-second-controls" aria-label="Segunda fase">
    <div><p className="exam-eyebrow">EVALUACIÓN COMPLEMENTARIA</p><h3>Segunda fase</h3>
      <p>Para participantes con al menos 8 en Gestión y 8 en Ventas. Incluye tres preguntas abiertas. La primera fase sigue disponible de forma independiente.</p></div>
    {!stage ? <p role="status">Preparando el segundo enlace. Actualiza la página en unos momentos.</p> : <>
      <span className="exam-tag">{stage.accepting ? 'Segundo enlace abierto' : 'Segundo enlace cerrado'} · {stage.duration_minutes} min</span>
      <label>Enlace de la segunda fase<input readOnly value={link} onFocus={e => e.currentTarget.select()} /></label>
      <p className="exam-muted">Comparte este enlace. El candidato solo necesita el mismo correo de la primera fase.</p>
      <label>Duración de la segunda fase (minutos)<input type="number" min={1} max={480} value={minutes} onChange={e => setMinutes(Number(e.target.value))} /></label>
      <div className="exam-actions"><button type="button" disabled={busy || !Number.isInteger(minutes) || minutes < 1 || minutes > 480 || minutes === stage.duration_minutes} onClick={() => onDuration(minutes)}>Guardar duración</button></div>
      <p className="exam-muted">La duración nueva aplica a quienes inicien después de guardarla; no cambia exámenes en curso.</p>
      <div className="exam-actions"><button type="button" disabled={busy} onClick={onCopy}>Copiar segundo enlace</button>
        <button type="button" disabled={busy} onClick={onToggle}>{stage.accepting ? 'Cerrar segundo enlace' : 'Reabrir segundo enlace'}</button>
        {onGrade && <button type="button" className="exam-primary" disabled={busy} onClick={onGrade}>Calificar segunda fase</button>}</div>
      {onGrade && <p className="exam-muted">Las respuestas abiertas se califican bajo solicitud y requieren revisión humana. Se aplica el filtro sugerido de 7 por pregunta y 24 de 30 solo como orientación.</p>}
    </>}
  </section>;
}

export function SecondStageStatus({ progress }: { progress?: SecondProgress }) {
  if (!progress) return <span>Sin información de la segunda fase</span>;
  const a = progress.attempt;
  return <div className="exam-second-status">
    <span>{progress.status === 'eligible' ? 'Cumple filtro inicial' : progress.status === 'below_threshold' ? 'No alcanza el filtro inicial' : 'Sin desglose completo'}</span>
    <small>Gestión: {score(progress.management)}<br />Ventas: {score(progress.sales)}</small>
    {a ? <strong>{!a.submitted_at ? 'En curso' : a.complementary_grade ? `${a.complementary_grade.total} / 30` : a.grading_status === 'error' ? 'Error al calificar' : 'Entregado · pendiente de calificar'}</strong> : progress.status === 'eligible' ? <span>Segunda fase sin iniciar</span> : null}
  </div>;
}

export function SecondStageDetail({ progress }: { progress?: SecondProgress }) {
  if (!progress) return null;
  const a = progress.attempt;
  return <section className="exam-second-detail"><h3>Segunda fase · evaluación complementaria</h3>
    <SecondStageStatus progress={progress} />
    {!a ? <p>La segunda fase aún no se ha iniciado.</p> : !a.submitted_at ? <p>La evaluación está en curso; sus respuestas se mostrarán al entregar.</p> : <>
      {a.complementary_grade && <p className="exam-notice"><strong>Total: {a.complementary_grade.total} / 30.</strong> {a.complementary_grade.meets_suggested_priority ? 'Cumple el filtro preliminar sugerido.' : 'No alcanza el filtro preliminar sugerido.'} La decisión corresponde a Recursos Humanos.</p>}
      {a.grading_status === 'error' && <p className="exam-error">{a.grading?.error || 'No se pudo calificar; requiere revisión.'}</p>}
      {a.snapshot.questions.map(q => <article className="exam-question exam-second-answer" key={q.id}>
        <h4>{q.id}. {labels[q.id]}</h4><p className="exam-preline">{q.prompt}</p><p className="exam-preline"><strong>Respuesta:</strong> {a.answers[q.id] ?? 'Sin respuesta'}</p>
        {a.grading?.questions?.[q.id] && <p className="exam-notice"><strong>{a.grading.questions[q.id].points} / 10</strong> · {a.grading.questions[q.id].reason}{a.grading.questions[q.id].review && ' · Revisar evidencia'}</p>}
      </article>)}
    </>}
  </section>;
}
