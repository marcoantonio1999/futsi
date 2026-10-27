import { useEffect, useRef, useState, type FormEvent } from 'react';
import { API_URL, apiRequest } from '../../api';
import { isSoccerWa } from '../../appBrand';
import { ExamQuestionEditor, blankQuestion as blank, type Question } from './ExamQuestionEditor';
import { ExamWorkspace, useExamSection, examSectionLabel, type ExamSection } from './ExamWorkspace';
import { ExamBrand, useExamBranding } from './ExamBrand';
import { remainingExamSeconds, formatExamCountdown } from './examCountdown';
import { ExamKeyImport, LegacyExamKey, ExamGrade, draftKey, type Grading, type AnswerKey } from './ExamAnswerKey';
import { ExamProfiles } from './ExamProfiles';
import { EmploymentFormsAdmin } from './EmploymentForms';
import { ExamStatistics } from './ExamStatistics';
import { ExamResultFilters, emptyFilters, filterQuery, type ResultFilter } from './ExamResultFilters';
import { ExamExportButton } from './ExamExportButton';
import './exams.css';

type Exam = { id: number; title: string; instructions: string; duration_minutes: number; questions: Question[]; public_token: string; accepting: boolean; attempt_count: number; answer_key: AnswerKey };
type Attempt = { skill_score?: number | null; id: number; name: string; email: string; phone: string; started_at: string | null; submitted_at: string | null; submitted?: boolean; elapsed_seconds: number | null; over_time: boolean; timed_out?: boolean; deadline_at?: string | null; offline_import?: {source?:string;completed_on:string|null;imported_at:string;correct_count?:number;question_count?:number;answers_available?:boolean;ambiguous_answers?:Record<string,string[]>}; snapshot: Pick<Exam, 'title' | 'instructions' | 'duration_minutes' | 'questions'>; answers: Record<string, number | string>; access_token?: string; grading_status?: string; grading?: Grading };
type Results = { filters?: {skill_label?: string}; exam: Exam; results: Attempt[]; count: number; page: number };
const errorText = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar la operación.';
const duration = (seconds: number | null) => seconds === null ? 'Sin tiempo registrado' : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
const date = (value: string | null) => value ? new Date(value).toLocaleString('es-MX') : 'Sin hora registrada';
function AttemptDates({attempt:a}:{attempt:Attempt}) {
  if(a.offline_import) return <><span className="exam-tag">{a.offline_import.source==='xlsx_results'?'Carga de Excel':'Carga manual de PDF'}</span><br/>{a.offline_import.completed_on ? `Fecha del examen: ${a.offline_import.completed_on.split('-').reverse().join('/')}` : 'Fecha del examen no registrada'}<br/><small>Sin horas de inicio o entrega registradas</small></>;
  return <>{date(a.started_at)}<br/>{a.submitted_at ? date(a.submitted_at) : 'Sin entregar'}</>;
}
const examBase = () => isSoccerWa ? 'https://futsi.bpoweracademy.mx/' : `${window.location.origin}${window.location.pathname}`;

async function publicApi<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const r = await fetch(`${API_URL}/public-exams/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Exam ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail || 'No se pudo guardar. Tu avance permanece en este navegador; vuelve a intentar cuando tengas conexión.');
  return data;
}

export default function ExamPortal() {
  useExamBranding();
  const [token, setToken] = useState(localStorage.getItem('futsi_token') || '');
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!token) { setChecked(true); return; }
    apiRequest<{ role: string; section_permissions?: string[] }>('/auth/me/', token).then(u => {
      if (active) { const p = u.section_permissions || []; setAllowed(!p.includes('player_enrollments_only') && !p.includes('court_communications_only') && (['admin', 'owner', 'dev'].includes(u.role) || (u.role === 'collaborator' && p.includes('veronica_only')))); setChecked(true); }
    }).catch(e => { if (active) { setError(errorText(e)); setToken(''); setChecked(true); } });
    return () => { active = false; };
  }, [token]);
  async function login(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(''); const data = new FormData(e.currentTarget);
    try { const r = await apiRequest<{ token: string }>('/auth/login/', '', { method: 'POST', body: JSON.stringify({ username: data.get('username'), password: data.get('password') }) }); localStorage.setItem('futsi_token', r.token); setChecked(false); setToken(r.token); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function logout() { setBusy(true); try { await apiRequest('/auth/logout/', token, { method: 'POST' }); } catch { /* Local logout still removes the session. */ } finally { localStorage.removeItem('futsi_token'); setToken(''); setAllowed(false); setBusy(false); } }
  return <main className="exam-app"><header className="exam-top"><ExamBrand />{token && <button disabled={busy} onClick={logout}>Cerrar sesión</button>}</header>
    {error && <p role="alert" className="exam-error">{error}</p>}
    {!checked ? <p role="status">Comprobando acceso…</p> : !token ? <section className="exam-card exam-login"><p className="exam-eyebrow">RECURSOS HUMANOS</p><h1>Tu espacio de evaluaciones</h1><p>Crea exámenes, comparte el enlace y revisa cada respuesta.</p><form onSubmit={login}><label>Usuario<input name="username" autoComplete="username" required /></label><label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label><button className="exam-primary" disabled={busy}>{busy ? 'Entrando…' : 'Iniciar sesión'}</button></form></section> : allowed ? <ExamAdmin token={token} standalone /> : <section className="exam-card"><h1>Sin acceso a Exámenes</h1><p>Este portal es para Recursos Humanos y administración.</p></section>}
  </main>;
}

export function ExamAdmin({ token, standalone = false }: { token: string; standalone?: boolean }) {
  const [exams, setExams] = useState<Exam[]>([]);
  const { section, navigate } = useExamSection(standalone);
  const editing = section === 'create';
  function setEditing(value: boolean) { navigate(value ? 'create' : 'list'); }
  const [choosingQuestion, setChoosingQuestion] = useState(false);
  const [draft, setDraft] = useState({ title: '', instructions: '', duration_minutes: 40, questions: [blank()] });
  const [results, setResults] = useState<Results | null>(null);
  const [resultFilters, setResultFilters] = useState<ResultFilter>(emptyFilters);
  const [detail, setDetail] = useState<Attempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function run(action: () => Promise<void>) { setBusy(true); setError(''); setMessage(''); try { await action(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function load() { const r = await apiRequest<{ results: Exam[] }>('/recruitment-exams/', token); setExams(r.results); }
  useEffect(() => { void run(load); }, [token]);
  const link = (e: Exam) => `${examBase()}#/examen/${e.public_token}`;
  async function view(e: Exam, page = 1, filters = results?.exam.id === e.id ? resultFilters : emptyFilters) { navigate('evaluations'); setResults(await apiRequest<Results>(`/recruitment-exams/${e.id}/?${filterQuery({ ...filters, page })}`, token)); setResultFilters(filters); setDetail(null); }
  function selectSection(next: ExamSection) { navigate(next); setResults(null); setDetail(null); setChoosingQuestion(false); setError(''); setMessage(''); }
  function question(index: number, patch: Partial<Question>) { setDraft(d => ({ ...d, questions: d.questions.map((q, i) => i === index ? { ...q, ...patch } : q) })); }
  async function create(e: FormEvent) { e.preventDefault(); await run(async () => { await apiRequest('/recruitment-exams/', token, { method: 'POST', body: JSON.stringify({ ...draft, answer_key: draftKey(draft.questions) }) }); setEditing(false); await load(); setMessage('Examen creado. Ya puedes copiar y compartir su enlace.'); }); }
  async function gradeAll() {
    if (!results || !window.confirm('¿Calificar todas las entregas pendientes? Las preguntas abiertas usan Luna (bajo) con costo de API. Los resultados requieren revisión humana y no deciden una contratación.')) return;
    const exam = results.exam;
    await run(async () => {
      let count = 0, errors = 0;
      while (true) {
        const r = await apiRequest<{ processed: boolean; remaining: number; status?: string }>(`/recruitment-exams/${exam.id}/grade/`, token, { method: 'POST', body: '{}' });
        if (!r.processed) break;
        count++; if (r.status === 'error') errors++;
        setMessage(`Procesadas ${count} entregas. ${r.remaining} pendientes. No cierres esta pestaña.`);
        if (!r.remaining) break;
      }
      await view(exam); setMessage(`${count} entregas procesadas${errors ? `; ${errors} con error documentado, sin reintento automático` : ''}. Consulta las notas y el detalle de cada respuesta.`);
    });
  }
  const selfManaged=section==='profiles'||section==='applications'||section==='statistics';
  const description=section==='statistics'?'Consulta actividad, promedios y resultados de las evaluaciones.':section==='applications'?'Comparte el formulario de empleo y consulta los datos recibidos, con o sin examen.':section==='profiles'?'Consulta perfiles, puestos y conocimientos junto con sus evaluaciones.':section==='evaluations'?'Consulta participantes, tiempos y respuestas de cada examen.':section==='create'?'Diseña tu evaluación y genera el enlace para compartirla.':'Administra tus exámenes y sus enlaces de participación.';
  return <ExamWorkspace section={section} onNavigate={selectSection}><section className="exam-admin exam-scope"><div className="exam-heading"><div><p className="exam-eyebrow">RECURSOS HUMANOS · EVALUACIONES</p><h1>{examSectionLabel(section)}</h1><p>{description}</p></div>{(!standalone || !selfManaged) && <div className="exam-actions">{!standalone && <a className="exam-button" href={`${examBase()}#/examenes`}>Abrir portal</a>}{(section==='evaluations'||section==='list')&&<ExamExportButton token={token} examId={results?.exam.id} filters={results ? resultFilters : undefined} disabled={busy} onError={setError}/>} {!selfManaged && <button disabled={busy} onClick={() => void run(load)}>Actualizar</button>}</div>}</div>
    {error && <p role="alert" className="exam-error">{error}</p>}{message && <p role="status" className="exam-notice">{message}</p>}{busy && <p role="status">Procesando…</p>}
    {section === 'statistics' ? <ExamStatistics token={token} exams={exams}/> : section === 'applications' ? <EmploymentFormsAdmin token={token} exams={exams}/> : section === 'profiles' ? <ExamProfiles token={token} exams={exams} /> : editing ? <form className="exam-card" onSubmit={create}><div className="exam-heading"><h2>Nuevo examen</h2><button type="button" disabled={busy} onClick={() => void run(async () => { setDraft(await apiRequest('/recruitment-exams/template/', token)); })}>Usar evaluación Business Operations & AI (40 preguntas)</button></div><label>Nombre del examen<input required maxLength={180} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label><label>Instrucciones<textarea maxLength={10000} value={draft.instructions} onChange={e => setDraft({ ...draft, instructions: e.target.value })} /></label><label>Tiempo de referencia (minutos)<input type="number" min="1" max="480" required value={draft.duration_minutes} onChange={e => setDraft({ ...draft, duration_minutes: Number(e.target.value) })} /></label><p className="exam-muted">El tiempo inicia al comenzar cada intento. Al agotarse se bloquean los cambios y se entrega lo guardado hasta ese momento.</p>
      <ExamKeyImport questions={draft.questions} onError={setError} onImport={key => setDraft(d => ({ ...d, questions: d.questions.map((q, i) => ({ ...q, correct_answer: key[String(i + 1)] })) }))} />
      {draft.questions.map((q, i) => <ExamQuestionEditor key={i} question={q} index={i} busy={busy} canRemove={draft.questions.length > 1} onChange={patch => question(i, patch)} onRemove={() => setDraft(d => ({ ...d, questions: d.questions.filter((_, k) => k !== i) }))} />)}
      {choosingQuestion && <div className="exam-type-picker" role="group" aria-label="Elegir tipo de pregunta"><h3>¿Qué tipo de pregunta quieres agregar?</h3><div className="exam-actions"><button type="button" disabled={busy} onClick={() => { setDraft(d => ({ ...d, questions: [...d.questions, blank('open')] })); setChoosingQuestion(false); }}>Pregunta abierta</button><button type="button" disabled={busy} onClick={() => { setDraft(d => ({ ...d, questions: [...d.questions, blank('choice')] })); setChoosingQuestion(false); }}>Opción múltiple</button><button type="button" onClick={() => setChoosingQuestion(false)}>Cancelar selección</button></div></div>}
      <div className="exam-actions"><button type="button" disabled={draft.questions.length >= 100 || busy || choosingQuestion} onClick={() => setChoosingQuestion(true)}>Agregar pregunta</button><button type="button" disabled={busy} onClick={() => { setEditing(false); setChoosingQuestion(false); }}>Cancelar</button><button className="exam-primary" disabled={busy || choosingQuestion}>Crear y obtener enlace</button></div><p className="exam-muted">Opción múltiple se califica al entregar. Las abiertas se califican con Luna (bajo) al pulsar «Calificar todos los exámenes». La clave publicada no se puede cambiar.</p></form> : section === 'evaluations' && results ? <section className="exam-card"><div className="exam-heading"><div><h2>{results.exam.title}</h2><p>{results.count} participantes · {results.exam.duration_minutes} minutos de referencia</p></div><button disabled={busy} onClick={() => selectSection('list')}>Volver a exámenes</button></div>
      {!Object.keys(results.exam.answer_key || {}).length ? <LegacyExamKey key={results.exam.id} questions={results.exam.questions} busy={busy} onError={setError} onSave={key => void run(async () => { const e = await apiRequest<Exam>(`/recruitment-exams/${results.exam.id}/`, token, { method: 'POST', body: JSON.stringify({ answer_key: key }) }); await view(e); })} /> : <div className="exam-actions"><button className="exam-primary" disabled={busy} onClick={() => void gradeAll()}>Calificar todos los exámenes</button><p className="exam-muted">Solo entregas pendientes de este examen. Las abiertas usan Luna (bajo). No se repiten calificaciones ni consultas fallidas automáticamente.</p></div>}
      {!detail && <ExamResultFilters key={results.exam.id} initialFilters={resultFilters} busy={busy} error={error} onApply={async filters => { let success = false; await run(async () => { await view(results.exam, 1, filters); success = true; }); return success; }} />}
      {detail ? <><button onClick={() => setDetail(null)}>Volver a participantes</button><h3>{detail.name}</h3><p>{detail.email || 'Correo no registrado'} · {detail.phone || 'Teléfono no registrado'}</p><p><AttemptDates attempt={detail}/><br/>{duration(detail.elapsed_seconds)}{detail.over_time ? ' · Fuera de tiempo' : ''}</p><ExamGrade status={detail.grading_status} grading={detail.grading} />{detail.offline_import?.answers_available===false && <p className="exam-notice">{detail.offline_import.correct_count} aciertos de {detail.offline_import.question_count}. El Excel contiene únicamente resultados totales; no incluye respuestas por pregunta, fecha, tiempos ni datos de contacto.</p>}{detail.snapshot.questions.map(q => <article key={q.id} className="exam-question"><h3>{q.id}. {q.prompt}</h3><p>{detail.offline_import?.ambiguous_answers?.[q.id]?.length ? `Varias opciones marcadas: ${detail.offline_import.ambiguous_answers[q.id].join(', ')}. ${detail.grading_status === 'graded' && detail.grading?.accepted_multiple_answers?.includes(q.id) ? 'Aceptada por criterio confirmado: incluye la opción correcta.' : 'Requiere confirmación manual.'}` : detail.answers[q.id] === undefined ? 'Sin entregar' : q.kind === 'choice' ? `${String.fromCharCode(65 + Number(detail.answers[q.id]))}. ${q.options?.[Number(detail.answers[q.id])]}` : detail.answers[q.id]}</p>{detail.grading?.questions?.[q.id] && <p className="exam-notice">{detail.grading.questions[q.id].points} / 10 · {detail.grading.questions[q.id].reason}{detail.grading.questions[q.id].review && ' · Revisar manualmente'}</p>}</article>)}</> : <><div className="exam-table-wrap"><table><thead><tr>{['Participante', 'Contacto', 'Inicio / entrega', 'Tiempo', 'Estado', results.filters?.skill_label || 'Calificación', 'Respuestas'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{results.results.map(a => <tr key={a.id}><td>{a.name}</td><td>{a.email || 'Correo no registrado'}<br />{a.phone || 'Teléfono no registrado'}</td><td><AttemptDates attempt={a}/></td><td>{duration(a.elapsed_seconds)}{a.over_time && <strong className="exam-late">Fuera de tiempo</strong>}</td><td>{(a.submitted ?? !!a.submitted_at) ? 'Entregado' : 'En curso / sin entregar'}</td><td>{(a.submitted ?? !!a.submitted_at) ? resultFilters.skill ? <span>{a.skill_score == null ? 'Sin desglose' : `${a.skill_score.toFixed(2)} / 10`}</span> : <ExamGrade status={a.grading_status} grading={a.grading} /> : '—'}</td><td><button onClick={() => setDetail(a)}>Ver respuestas</button></td></tr>)}</tbody></table>{!results.results.length && <p>Aún no hay participantes.</p>}</div><div className="exam-actions"><button disabled={busy || results.page <= 1} onClick={() => void run(() => view(results.exam, results.page - 1))}>Anterior</button><span>Página {results.page} de {Math.max(1, Math.ceil(results.count / 50))}</span><button disabled={busy || results.page * 50 >= results.count} onClick={() => void run(() => view(results.exam, results.page + 1))}>Siguiente</button></div></>}
    </section> : <div className="exam-grid">{exams.map(e => <article className="exam-card" key={e.id}><span className="exam-tag">{e.accepting ? 'Enlace abierto' : 'Enlace cerrado'}</span><h2>{e.title}</h2><p>{e.questions.length} preguntas · {e.duration_minutes} min</p><p>{e.attempt_count} participantes</p>{section === 'list' && <label>Enlace para candidatos<input readOnly value={link(e)} onFocus={ev => ev.target.select()} /></label>}<div className="exam-actions">{section === 'list' && <button disabled={busy} onClick={() => void run(async () => { await navigator.clipboard.writeText(link(e)); setMessage('Enlace copiado.'); })}>Copiar enlace</button>}<button className="exam-primary" disabled={busy} onClick={() => void run(() => view(e))}>Ver respuestas</button>{section === 'list' && <button disabled={busy} onClick={() => void run(async () => { await apiRequest(`/recruitment-exams/${e.id}/`, token, { method: 'POST', body: JSON.stringify({ accepting: !e.accepting }) }); await load(); })}>{e.accepting ? 'Cerrar enlace' : 'Reabrir enlace'}</button>}</div></article>)}{!exams.length && !busy && <section className="exam-card"><h2>Tu primera evaluación empieza aquí</h2><p>Crea un examen o utiliza las 40 preguntas de Business Operations & AI.</p></section>}</div>}
  </section></ExamWorkspace>;
}

export function PublicExam({ invitation }: { invitation: string }) {
  useExamBranding();
  const storageKey = `bpower-exam:${invitation}`;
  const [info, setInfo] = useState<{ title: string; instructions: string; duration_minutes: number; question_count: number; accepting: boolean } | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [access, setAccess] = useState('');
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [storageWarning, setStorageWarning] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [clipboardWarning, setClipboardWarning] = useState('');
  function blockClipboard(event: { preventDefault(): void }) {
    event.preventDefault();
    setClipboardWarning('Durante el examen no está permitido copiar, cortar ni pegar preguntas o respuestas.');
  }
  useEffect(() => {
    if (!attempt || submitted) return;
    // Covers menu/keyboard copying whose event targets the document rather
    // than a question. Removed on receipt/unmount; applicant details are unaffected.
    const events = ['copy', 'cut', 'paste', 'contextmenu', 'dragstart'];
    events.forEach(type => document.addEventListener(type, blockClipboard));
    return () => events.forEach(type => document.removeEventListener(type, blockClipboard));
  }, [Boolean(attempt), submitted]);
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  const expiryRequested = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  function acceptReceipt(a: Attempt) {
    setAttempt(a); setElapsed(a.elapsed_seconds ?? 0); setSubmitted(Boolean(a.submitted_at));
    if (a.submitted_at) { setAnswers(a.answers); sessionStorage.removeItem(storageKey); setError(''); }
  }
  function persistDraft(next: Attempt['answers']) {
    setSaveStatus('Guardando respuestas…');
    const task = draftQueue.current.catch(() => {}).then(async () => {
      const a = await publicApi<Attempt>('attempt/', { action: 'draft', answers: next }, access);
      if (a.submitted_at) acceptReceipt(a);
      else setSaveStatus('Respuestas guardadas en el servidor.');
    });
    draftQueue.current = task;
    void task.catch(() => setSaveStatus('No se confirmó el guardado. Revisa tu conexión; no hay reintentos automáticos.'));
  }
  async function confirmExpiry() {
    setBusy(true); setError('');
    try {
      const a = await publicApi<Attempt>('attempt/', undefined, access);
      if (!a.submitted_at) throw new Error('El servidor aún no confirmó el cierre. Pulsa «Confirmar cierre» para comprobarlo.');
      acceptReceipt(a);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function remember(value: unknown) { try { sessionStorage.setItem(storageKey, JSON.stringify(value)); } catch { setStorageWarning('No se pudo guardar el avance local. No cierres ni recargues esta pestaña antes de enviar.'); } }
  function saved(): Record<string, unknown> { try { return JSON.parse(sessionStorage.getItem(storageKey) || '{}'); } catch { return {}; } }
  useEffect(() => { let active = true; setBusy(true); void (async () => { try { const i = await publicApi<typeof info>(`${encodeURIComponent(invitation)}/`); if (!active) return; setInfo(i); const s = saved(); if (typeof s.access === 'string') { const a = await publicApi<Attempt>('attempt/', undefined, s.access); if (!active) return; setAttempt(a); setAccess(s.access); setSubmitted(Boolean(a.submitted_at)); setAnswers(a.submitted_at ? a.answers : (s.answers as Attempt['answers'] || {})); if (a.submitted_at) sessionStorage.removeItem(storageKey); } } catch (e) { if (active) setError(errorText(e)); } finally { if (active) setBusy(false); } })(); return () => { active = false; }; }, [invitation]);
  useEffect(() => { if (!attempt || submitted) return; const base = attempt.elapsed_seconds ?? 0; const start = Date.now(); const tick = () => setElapsed(base + Math.floor((Date.now() - start) / 1000)); tick(); const id = window.setInterval(tick, 1000); return () => clearInterval(id); }, [attempt, submitted]);
  useEffect(() => {
    if (!attempt || submitted || !access || elapsed < attempt.snapshot.duration_minutes * 60 || expiryRequested.current) return;
    expiryRequested.current = true;
    void confirmExpiry();
  }, [elapsed, attempt, submitted, access]);
  useEffect(() => {
    if (!attempt || submitted || !access) return;
    const sync = () => {
      if (document.visibilityState !== 'visible') return;
      void publicApi<Attempt>('attempt/', undefined, access).then(a => {
        if (a.submitted_at) acceptReceipt(a);
        else setAttempt(a);
      }).catch(e => setError(errorText(e)));
    };
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [attempt, submitted, access]);
  useEffect(() => { if (!attempt || submitted) return; const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [attempt, submitted]);
  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError('');
    try { const s = saved(); const key = typeof s.start_key === 'string' ? s.start_key : crypto.randomUUID(); remember({ ...s, start_key: key }); const a = await publicApi<Attempt>(`${encodeURIComponent(invitation)}/`, { start_key: key, name: f.get('name'), email: f.get('email'), phone: f.get('phone'), consent: f.get('consent') === 'on' }); setAttempt(a); setAccess(a.access_token!); setSubmitted(Boolean(a.submitted_at)); remember({ start_key: key, access: a.access_token, answers: {} }); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  const textSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (textSaveTimer.current) clearTimeout(textSaveTimer.current); }, []);
  function answer(id: string, value: string | number) {
    if (!attempt || submitted || busy || elapsed >= attempt.snapshot.duration_minutes * 60) return;
    const next = { ...answersRef.current, [id]: value }; answersRef.current = next;
    setAnswers(next); setMissing(m => m.filter(v => v !== id)); remember({ ...saved(), access, answers: next });
    if (textSaveTimer.current) clearTimeout(textSaveTimer.current);
    if (typeof value === 'number') persistDraft(next);
    else textSaveTimer.current = setTimeout(() => persistDraft(answersRef.current), 300);
  }
  async function submit(e: FormEvent) {
    if (attempt && elapsed >= attempt.snapshot.duration_minutes * 60) { e.preventDefault(); void confirmExpiry(); return; }
    e.preventDefault(); const gaps = attempt!.snapshot.questions.filter(q => answers[q.id] === undefined || String(answers[q.id]).trim() === '').map(q => q.id); setMissing(gaps);
    if (gaps.length) { setError(`Faltan ${gaps.length} preguntas. Revisa los campos marcados en rojo.`); document.getElementById(`question-${gaps[0]}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    if (!window.confirm('¿Enviar tus respuestas? Después de entregar no podrás modificarlas.')) return;
    setBusy(true); setError(''); try { const a = await publicApi<Attempt>('attempt/', { answers }, access); setAttempt(a); setSubmitted(true); setElapsed(a.elapsed_seconds ?? 0); sessionStorage.removeItem(storageKey); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  const completed = attempt?.snapshot.questions.filter(q => answers[q.id] !== undefined && String(answers[q.id]).trim() !== '').length || 0;
  const remaining = attempt ? remainingExamSeconds(attempt.snapshot.duration_minutes, elapsed) : 0;
  return <main className="exam-app"><header className="exam-top"><ExamBrand publicView /><span className="exam-muted">RECURSOS HUMANOS</span></header><div className="exam-public">
    {error && <p className="exam-error" role="alert">{error}</p>}{storageWarning && <p className="exam-error">{storageWarning}</p>}
    {submitted && attempt ? <section className="exam-card exam-receipt"><p className="exam-eyebrow">ENTREGA CONFIRMADA</p><h1>{attempt.timed_out ? 'Gracias por tu tiempo. El tiempo del examen terminó.' : 'Gracias. Recibimos tus respuestas.'}</h1>{attempt.timed_out && <p>Se guardaron las respuestas recibidas hasta el límite de tiempo. El examen se envió automáticamente y ya no permite cambios.</p>}<p>{attempt.snapshot.title}</p><p>Entrega: {date(attempt.submitted_at!)}<br />Tiempo registrado: {duration(attempt.elapsed_seconds)}</p><p>Recursos Humanos revisará tu evaluación. Ya puedes cerrar esta pestaña.</p></section> : attempt ? <form noValidate onSubmit={submit} onCopy={blockClipboard} onCut={blockClipboard} onPaste={blockClipboard} onContextMenu={blockClipboard} onDragStart={blockClipboard}><div className="exam-progress"><div><strong>{attempt.snapshot.title}</strong><span>{completed} de {attempt.snapshot.questions.length} respondidas</span></div><div aria-live="off"><span>Tiempo restante</span><strong className={`exam-countdown ${remaining === 0 ? 'exam-countdown-finished' : ''}`} data-testid="exam-countdown">{formatExamCountdown(remaining)}</strong></div></div><p className="exam-muted" role="status">{saveStatus}</p>{clipboardWarning && <p className="exam-notice" role="status">{clipboardWarning}</p>}<p className="exam-muted">El tiempo continúa si recargas o sales. Tus respuestas se guardan mientras contestas. Al llegar a cero, el examen se cierra automáticamente con lo recibido hasta ese momento.</p>{elapsed >= attempt.snapshot.duration_minutes * 60 && <section className="exam-card" role="status"><h2>El tiempo del examen terminó.</h2><p>Las respuestas están bloqueadas. {busy ? 'Confirmando el envío automático…' : 'Pulsa el botón para confirmar el cierre; no se aceptarán respuestas nuevas.'}</p>{!busy && <button type="button" className="exam-primary" onClick={() => void confirmExpiry()}>Confirmar cierre</button>}</section>}<section className="exam-card"><h1>{attempt.snapshot.title}</h1><p className="exam-preline">{attempt.snapshot.instructions}</p></section>{attempt.snapshot.questions.map(q => <fieldset disabled={busy || remaining === 0} tabIndex={-1} id={`question-${q.id}`} key={q.id} className={`exam-card exam-question ${missing.includes(q.id) ? 'exam-invalid' : ''}`} aria-invalid={missing.includes(q.id)}><legend>Pregunta {q.id}</legend><h2>{q.prompt}</h2>{q.kind === 'choice' ? q.options?.map((o, i) => <label className={`exam-choice ${answers[q.id] === i ? 'selected' : ''}`} key={i}><input type="radio" name={`q-${q.id}`} checked={answers[q.id] === i} onChange={() => answer(q.id, i)} disabled={busy} /><span><b>{String.fromCharCode(65 + i)}.</b> {o}</span></label>) : <label>Tu respuesta<textarea maxLength={10000} value={answers[q.id] || ''} onChange={e => answer(q.id, e.target.value)} disabled={busy} /></label>}{missing.includes(q.id) && <p className="exam-late">Responde esta pregunta.</p>}</fieldset>)}<div className="exam-card"><p>Revisa tus respuestas antes de enviar. La entrega es definitiva.</p><button className="exam-primary" disabled={busy || remaining === 0}>{busy ? 'Guardando entrega…' : 'Enviar examen'}</button></div></form> : info ? <section className="exam-card"><p className="exam-eyebrow">EVALUACIÓN EN LÍNEA</p><h1>{info.title}</h1><div className="exam-actions"><span className="exam-tag">{info.question_count} preguntas</span><span className="exam-tag">{info.duration_minutes} minutos</span></div><p className="exam-preline">{info.instructions}</p>{info.accepting ? <form onSubmit={start}><h2>Antes de comenzar</h2><p>El tiempo empieza al pulsar «Iniciar examen».</p><label>Nombre completo<input name="name" required autoComplete="name" maxLength={180} /></label><label>Correo electrónico<input name="email" type="email" required autoComplete="email" maxLength={254} /></label><label>Teléfono<input name="phone" type="tel" required autoComplete="tel" maxLength={30} /></label><label className="exam-consent"><input name="consent" type="checkbox" required /><span>Autorizo a BPower y su equipo de Recursos Humanos a guardar mis datos, respuestas y tiempo de evaluación para revisar mi postulación.</span></label><button className="exam-primary" disabled={busy}>{busy ? 'Iniciando…' : 'Iniciar examen'}</button></form> : <p className="exam-notice">Este enlace ya no admite nuevos participantes.</p>}</section> : busy ? <p role="status">Cargando examen…</p> : <p>No se pudo abrir el examen. Verifica el enlace o recarga la página.</p>}
  </div></main>;
}
