import { useMemo, useRef, useState, type FormEvent } from "react";
import { CheckCircle2, ClipboardCheck, Save } from "lucide-react";
import type { AppData, StudentAssessment } from "../../types";
import { SelectInput, TextInput } from "./shared";
import { StudentStatsCard } from "./sportsDetails";

const skills = [["pace", "Ritmo"], ["shooting", "Tiro"], ["passing", "Pase"], ["dribbling", "Regate"], ["defense", "Defensa"], ["physical", "Físico"], ["attitude", "Actitud"]] as const;
type Skill = typeof skills[number][0];

export function SportsMonthlyExams({ data, canEdit, onSaveAssessment }: { data: AppData; canEdit: boolean; onSaveAssessment: (payload: unknown) => Promise<void> }) {
  const [month, setMonth] = useState(() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`; });
  const [site, setSite] = useState("");
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState("");
  const [busy, setBusy] = useState(false);
  const monthLabel = new Date(`${month}-01T12:00:00`).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const students = useMemo(() => data.students.filter(student => (!site || String(student.site) === site) && `${student.full_name} ${student.group_name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [data.students, site, query]);
  const student = students.find(row => String(row.id) === studentId) || students[0];
  const exams = useMemo(() => {
    const result = new Map<number, StudentAssessment>();
    [...data.studentAssessments].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).forEach(exam => { if (exam.assessment_month.slice(0, 7) === month && !result.has(exam.student)) result.set(exam.student, exam); });
    return result;
  }, [data.studentAssessments, month]);
  const evaluated = students.flatMap(row => exams.has(row.id) ? [exams.get(row.id)!] : []);
  const current = student ? exams.get(student.id) : undefined;
  return <div data-testid="sports-monthly-exams">
    <header className="sports-header"><div><p className="sports-eyebrow">Rendimiento de alumnos</p><h2>Evaluación mensual</h2><p>Consulta y registra la evaluación de cada alumno por mes.</p></div></header>
    <fieldset className="sports-exam-filters" disabled={busy}><legend className="sr-only">Filtrar evaluaciones</legend><TextInput label="Mes de evaluación" type="month" required value={month} onChange={event => { if (event.target.value) setMonth(event.target.value); }} /><SelectInput label="Sede" value={site} onChange={event => setSite(event.target.value)}><option value="">Todas las sedes</option>{data.sites.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</SelectInput><TextInput label="Buscar alumno o grupo" placeholder="Escribe un nombre" value={query} onChange={event => setQuery(event.target.value)} /></fieldset>
    <div className="sports-summary" aria-label="Evaluación del mes seleccionado"><div className="done"><span>Evaluados este mes</span><strong>{evaluated.length}<small> / {students.length}</small></strong></div><div className="pending"><span>Pendientes de evaluación</span><strong>{students.length - evaluated.length}</strong></div><div className="upcoming"><span>Promedio del mes</span><strong>{evaluated.length ? Math.round(evaluated.reduce((sum, exam) => sum + Number(exam.overall_rating), 0) / evaluated.length) : "—"}<small> / 100</small></strong></div></div>
    <section className="sports-surface sports-student-selection"><SelectInput label="Alumno a evaluar o consultar" disabled={busy || !students.length} value={String(student?.id || "")} onChange={event => setStudentId(event.target.value)}>{!students.length && <option value="">Sin alumnos con estos filtros</option>}{students.map(row => <option key={row.id} value={row.id}>{row.full_name} · {exams.has(row.id) ? "Evaluado" : "Pendiente"}</option>)}</SelectInput>{student && <p>{student.site_name} · {student.group_name || "Sin grupo"} · {student.category || "Sin categoría"}</p>}</section>
    {student ? <div className={`sports-monthly-layout ${canEdit ? "" : "readonly"}`}>
      {canEdit && <ExamForm key={`${student.id}:${month}`} studentId={student.id} month={month} current={current} onSave={onSaveAssessment} onBusyChange={setBusy} />}
      <section className="sports-saved-result"><h3><ClipboardCheck size={18} />Resultado guardado</h3>{current ? <StudentStatsCard assessment={current} /> : <div className="sports-surface sports-empty"><ClipboardCheck size={30} /><h4>Evaluación pendiente</h4><p>{student.full_name} aún no tiene una evaluación registrada para {monthLabel}.</p></div>}</section>
    </div> : <div className="sports-surface sports-empty">{data.students.length ? "No hay alumnos con estos filtros. Prueba con otro nombre o sede." : "Registra alumnos para comenzar sus evaluaciones mensuales."}</div>}
  </div>;
}

function ExamForm({ studentId, month, current, onSave, onBusyChange }: { studentId: number; month: string; current?: StudentAssessment; onSave: (payload: unknown) => Promise<void>; onBusyChange: (busy: boolean) => void }) {
  const [scores, setScores] = useState(() => Object.fromEntries(skills.map(([key]) => [key, current ? String(current[key]) : ""])) as Record<Skill, string>);
  const [notes, setNotes] = useState(current?.notes || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const saving = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving.current) return;
    saving.current = true; setBusy(true); onBusyChange(true); setError(""); setMessage("");
    try {
      await onSave({ student: studentId, assessment_month: current?.assessment_month || `${month}-01`, ...Object.fromEntries(skills.map(([key]) => [key, Number(scores[key])])), notes });
      setMessage("Evaluación mensual guardada correctamente.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar la evaluación."); }
    finally { saving.current = false; setBusy(false); onBusyChange(false); }
  }
  return <form className="sports-surface sports-exam-form" onSubmit={submit}>
    <header className="sports-section-header"><div><h3>{current ? "Actualizar evaluación" : "Registrar evaluación"}</h3><p>Califica cada habilidad de 0 a 100.</p></div><span className={`sports-badge ${current ? "done" : "pending"}`}>{current ? "Registrado" : "Pendiente"}</span></header>
    <fieldset disabled={busy}><legend className="sr-only">Calificaciones de la evaluación mensual</legend><div className="sports-skills">{skills.map(([key, label]) => <label key={key}><span>{label}</span><input type="number" min={0} max={100} step={1} required inputMode="numeric" placeholder="0–100" value={scores[key]} onChange={event => { setScores(previous => ({ ...previous, [key]: event.target.value })); setMessage(""); }} /><div className="sports-skill-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, Number(scores[key]) || 0))}%` }} /></div></label>)}</div><label className="sports-notes">Observaciones de la evaluación<textarea rows={3} placeholder="Avances y habilidades que debe trabajar el alumno" value={notes} onChange={event => { setNotes(event.target.value); setMessage(""); }} /></label>
    {error && <p className="sports-feedback error" role="alert">{error}</p>}{message && <p className="sports-feedback success" role="status"><CheckCircle2 size={17} />{message}</p>}
    <footer><button className="sports-button primary" disabled={busy}><Save size={16} />{busy ? "Guardando evaluación…" : current ? "Guardar cambios" : "Guardar evaluación mensual"}</button></footer></fieldset>
  </form>;
}
