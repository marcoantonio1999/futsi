import './ExamQuestionEditor.css';

export type Question = { id: string; kind: 'choice' | 'open'; prompt: string; options?: string[]; correct_answer?: number | string };
export const MAX_EXAM_OPTIONS = 26;
export const blankQuestion = (kind: Question['kind'] = 'choice'): Question => ({ id: '', kind, prompt: '', ...(kind === 'choice' ? { options: ['', ''] } : {}) });

export function ExamQuestionEditor({ question: q, index, busy, canRemove, onChange, onRemove }: {
  question: Question; index: number; busy: boolean; canRemove: boolean;
  onChange: (patch: Partial<Question>) => void; onRemove: () => void;
}) {
  const options = q.options || ['', ''];
  return <fieldset className="exam-question" disabled={busy}>
    <legend>Pregunta {index + 1}</legend>
    <label>Enunciado<textarea required maxLength={5000} value={q.prompt} onChange={e => onChange({ prompt: e.target.value })} /></label>
    <label>Tipo de respuesta<select aria-label="Tipo de respuesta" value={q.kind} onChange={e => onChange({ kind: e.target.value as Question['kind'], options })}>
      <option value="choice">Opción múltiple</option><option value="open">Pregunta abierta</option>
    </select></label>
    {q.kind === 'choice' ? <>
      <p className="exam-muted">Agrega o quita opciones según lo necesites (de 2 a {MAX_EXAM_OPTIONS}). El candidato elegirá una respuesta.</p>
      {options.map((option, j) => <div className="exam-option-editor" key={j}>
        <label>Opción {String.fromCharCode(65 + j)}<input required maxLength={2000} value={option} onChange={e => onChange({ options: options.map((value, k) => k === j ? e.target.value : value) })} /></label>
        <button type="button" disabled={options.length <= 2} aria-label={`Quitar opción ${String.fromCharCode(65 + j)} de pregunta ${index + 1}`} onClick={() => onChange({ options: options.filter((_, k) => k !== j), correct_answer: undefined })}>Quitar opción</button>
      </div>)}
      <button type="button" disabled={options.length >= MAX_EXAM_OPTIONS} onClick={() => onChange({ options: [...options, ''] })}>Agregar opción</button>
      <label>Respuesta correcta (privada)<select aria-label="Respuesta correcta (privada)" required value={typeof q.correct_answer === 'number' ? q.correct_answer : ''} onChange={e => onChange({ correct_answer: e.target.value === '' ? undefined : Number(e.target.value) })}><option value="">Elige la opción correcta</option>{options.map((_, j) => <option key={j} value={j}>Opción {String.fromCharCode(65 + j)}</option>)}</select></label>
    </> : <p className="exam-notice">El candidato escribirá su respuesta en un campo de texto. No necesitas agregar opciones.</p>}
    {q.kind === 'open' && <label>Respuesta esperada y criterios (privados)<textarea aria-label="Respuesta esperada y criterios (privados)" required maxLength={5000} value={typeof q.correct_answer === 'string' ? q.correct_answer : ''} onChange={e => onChange({ correct_answer: e.target.value })} /></label>}
    <div className="exam-actions"><button type="button" disabled={!canRemove} onClick={onRemove}>Quitar pregunta {index + 1}</button></div>
  </fieldset>;
}
