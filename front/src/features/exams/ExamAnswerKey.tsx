import { useState, type ChangeEvent } from 'react';
import type { Question } from './ExamQuestionEditor';

export type AnswerKey = Record<string, number | string>;
export const draftKey = (questions: Question[]): AnswerKey => Object.fromEntries(questions.map((q, i) => [String(i + 1), q.correct_answer ?? '']));

export function ExamKeyImport({ questions, onImport, onError }: { questions: Question[]; onImport: (key: AnswerKey) => void; onError: (message: string) => void }) {
  async function read(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 600000) throw new Error('El archivo supera 600 KB.');
      const raw = JSON.parse(await file.text()); const data = raw.answer_key || raw;
      if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== questions.length) throw new Error('Incluye una respuesta por pregunta, con números del 1 en adelante.');
      const key: AnswerKey = {};
      questions.forEach((q, i) => {
        let value = data[String(i + 1)];
        if (q.kind === 'choice' && typeof value === 'string' && /^[A-Z]$/i.test(value.trim())) value = value.trim().toUpperCase().charCodeAt(0) - 65;
        if (q.kind === 'choice' ? !Number.isInteger(value) || value < 0 || value >= (q.options?.length || 0) : typeof value !== 'string' || !value.trim() || value.length > 5000) throw new Error(`Revisa la respuesta de la pregunta ${i + 1}.`);
        key[String(i + 1)] = value;
      });
      onImport(key);
    } catch (error) { onError(error instanceof Error ? error.message : 'Archivo de respuestas inválido.'); }
  }
  return <div className="exam-notice"><p>Escribe las respuestas debajo de cada pregunta o carga un JSON. Ejemplo: {'{"1":"B","2":"Respuesta esperada y criterios…"}'}. Opción múltiple: letra A–Z; abiertas: texto. La clave no se muestra a candidatos.</p><label>Cargar clave de respuestas (JSON)<input type="file" accept=".json,application/json" onChange={e => void read(e)} /></label></div>;
}

export function LegacyExamKey({ questions, busy, onSave, onError }: { questions: Question[]; busy: boolean; onSave: (key: AnswerKey) => void; onError: (message: string) => void }) {
  const [key, setKey] = useState<AnswerKey>({});
  return <form onSubmit={e => { e.preventDefault(); onSave(key); }}><h3>Agregar clave de respuestas</h3><p>Este examen se creó sin clave. No se inventarán respuestas ni notas. La clave se guarda una sola vez y permitirá calificar también entregas anteriores.</p><ExamKeyImport questions={questions} onImport={setKey} onError={onError} />{questions.map(q => <label key={q.id}>{q.id}. {q.prompt}{q.kind === 'choice' ? <select required value={key[q.id] ?? ''} onChange={e => setKey({ ...key, [q.id]: Number(e.target.value) })}><option value="">Elige la respuesta correcta</option>{q.options?.map((option, i) => <option value={i} key={i}>{String.fromCharCode(65 + i)}. {option}</option>)}</select> : <textarea required maxLength={5000} value={key[q.id] ?? ''} onChange={e => setKey({ ...key, [q.id]: e.target.value })} />}</label>)}<button className="exam-primary" disabled={busy}>Guardar clave de respuestas</button></form>;
}

export type Grading = { score?: number; review?: boolean; error?: string; questions?: Record<string, { points: number; reason: string; review: boolean }> };
export function ExamGrade({ status, grading }: { status?: string; grading?: Grading }) {
  if (status === 'review') return <span className="exam-late">{grading?.error || 'Requiere revisión manual'}</span>;
  if (status === 'graded') return <span><strong>{grading?.score} / 10</strong>{grading?.review && <small className="exam-late">Requiere revisión humana</small>}</span>;
  return <span>{status === 'error' ? grading?.error : status === 'processing' ? 'En proceso / revisar si se interrumpió' : 'Pendiente de calificar'}</span>;
}
