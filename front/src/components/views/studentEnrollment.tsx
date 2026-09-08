import { useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, HeartPulse, Plus, Search, UserRound, UsersRound } from "lucide-react";
import type { AppData, Guardian, Student } from "../../types";
import { SelectInput, TextInput } from "./shared";
import { statusLabels } from "../../appState";
import { StudentPhotoInput } from "./studentPhoto";
import "./students.css";

const emptyStudent = { full_name: "", site: "", birth_date: "", category: "", group_name: "", status: "trial", waiver_url: "", medical_notes: "", emergency_contact: "", emergency_phone: "", uniform_status: "pending", pause_start: "", pause_end: "", pause_reason: "" };
const emptyGuardian = { full_name: "", phone: "", email: "" };

export function studentFormData(values: Record<string, string>, photo: File | null) {
  const payload = new FormData();
  Object.entries(values).forEach(([key, value]) => payload.append(key, value.trim()));
  if (photo) payload.append("photo", photo);
  return payload;
}

export function StudentEnrollment({ data, onCreate, onCreateGuardian }: {
  data: AppData;
  onCreate: (payload: FormData) => Promise<Student>;
  onCreateGuardian: (payload: unknown) => Promise<Guardian>;
}) {
  const [guardian, setGuardian] = useState<Guardian | null>(null);
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [query, setQuery] = useState("");
  const [guardianForm, setGuardianForm] = useState(emptyGuardian);
  const [form, setForm] = useState(() => ({ ...emptyStudent, site: data.sites.length === 1 ? String(data.sites[0].id) : "" }));
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<Student | null>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-MX");
    const needle = normalize(query.trim());
    return data.guardians.filter(person => normalize(`${person.full_name} ${person.phone} ${person.email}`).includes(needle));
  }, [data.guardians, query]);
  const siblings = guardian ? data.students.filter(student => student.guardian === guardian.id) : [];

  function selectGuardian(person: Guardian) {
    setGuardian(person); setError("");
    requestAnimationFrame(() => nameRef.current?.querySelector("input")?.focus());
  }
  async function createGuardian(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const person = await onCreateGuardian(Object.fromEntries(Object.entries(guardianForm).map(([key, value]) => [key, value.trim()])));
      selectGuardian(person); setGuardianForm(emptyGuardian);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar al tutor."); }
    finally { submitting.current = false; setBusy(false); }
  }
  async function createStudent(event: FormEvent) {
    event.preventDefault();
    if (!guardian || submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      const student = await onCreate(studentFormData({ ...form, guardian: String(guardian.id) }, photo));
      setSaved(student); setPhoto(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar al alumno. Revisa los datos e inténtalo de nuevo."); }
    finally { submitting.current = false; setBusy(false); }
  }
  function anotherStudent(sameGuardian: boolean) {
    setSaved(null); setError(""); setPhoto(null);
    setForm({ ...emptyStudent, site: form.site });
    if (!sameGuardian) { setGuardian(null); setQuery(""); setMode("existing"); }
    else requestAnimationFrame(() => nameRef.current?.querySelector("input")?.focus());
  }
  const change = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(previous => ({ ...previous, [key]: event.target.value }));

  if (saved) return <section className="student-enrollment student-success" aria-live="polite">
    <CheckCircle2 size={42} /><h2>Alumno registrado</h2>
    <p><strong>{saved.full_name}</strong> quedó asignado a <strong>{guardian?.full_name}</strong>, responsable de sus pagos.</p>
    {saved.photo_url && <p className="student-hint">La foto se guardó correctamente.</p>}
    <div className="student-actions"><button type="button" className="student-button primary" onClick={() => anotherStudent(true)}><Plus size={16} /> Agregar hermano o hermana</button><button type="button" className="student-button secondary" onClick={() => anotherStudent(false)}>Registrar con otro tutor</button></div>
  </section>;

  return <div className="student-enrollment">
    <header className="student-enrollment-header"><div><p className="student-eyebrow">Academia · Inscripción</p><h2>Nuevo alumno</h2></div><ol className="student-steps" aria-label="Pasos de inscripción"><li className={guardian ? "complete" : "active"} aria-current={!guardian ? "step" : undefined}><span>{guardian ? <Check size={14} /> : "1"}</span>Papá o tutor</li><li className={guardian ? "active" : ""} aria-current={guardian ? "step" : undefined}><span>2</span>Alumno</li></ol></header>
    {!guardian ? <section className="student-section">
      <div className="student-notice"><UsersRound size={23} /><div><h3>Primero debes crear un tutor o papá para asignarle un nuevo alumno.</h3><p>Será el responsable de los pagos. Si ya está registrado, selecciónalo: un mismo tutor puede tener varios niños.</p></div></div>
      <div className="student-mode-switch"><button type="button" aria-pressed={mode === "existing"} className={mode === "existing" ? "active" : ""} onClick={() => { setMode("existing"); setError(""); }}><Search size={17} /> Buscar tutor existente</button><button type="button" aria-pressed={mode === "new"} className={mode === "new" ? "active" : ""} onClick={() => { setMode("new"); setError(""); }}><Plus size={17} /> Crear papá o tutor</button></div>
      {mode === "existing" ? <div className="student-guardian-search">
        <TextInput label="Buscar papá o tutor" type="search" placeholder="Nombre, teléfono o correo" value={query} onChange={event => setQuery(event.target.value)} />
        <p className="student-hint">{matches.length} {matches.length === 1 ? "tutor disponible" : "tutores disponibles"}{matches.length > 30 ? " · Escribe para afinar la búsqueda" : ""}</p>
        <div className="student-guardian-list">{matches.slice(0, 30).map(person => {
          const children = data.students.filter(student => student.guardian === person.id);
          return <button type="button" key={person.id} className="student-guardian-option" onClick={() => selectGuardian(person)}><span className="student-person-icon"><UserRound size={19} /></span><span className="min-w-0 flex-1"><strong>{person.full_name}</strong><span>{person.phone}{person.email ? ` · ${person.email}` : ""}</span>{children.length > 0 && <small>{children.length} {children.length === 1 ? "alumno" : "alumnos"}: {children.slice(0, 2).map(student => student.full_name).join(", ")}{children.length > 2 ? ` y ${children.length - 2} más` : ""}</small>}</span><ArrowRight size={17} /></button>;
        })}</div>
        {!matches.length && <div className="student-empty"><UsersRound size={26} /><h3>{query ? "No encontramos un tutor con esos datos" : "Aún no hay tutores disponibles"}</h3><p>Créalo aquí y después podrás registrar al niño.</p><button type="button" className="student-button primary" onClick={() => setMode("new")}><Plus size={15} /> Crear papá o tutor</button></div>}
      </div> : <form onSubmit={createGuardian}>
        <fieldset disabled={busy} className="student-fields"><legend className="sr-only">Datos del responsable de pago</legend><div className="student-section-title"><h3>Datos del responsable de pago</h3><p>Registra al adulto, no al niño. El correo es opcional.</p></div>
          <TextInput label="Nombre completo del papá o tutor" required maxLength={160} autoComplete="name" value={guardianForm.full_name} onChange={event => setGuardianForm({ ...guardianForm, full_name: event.target.value })} />
          <div className="student-grid"><TextInput label="Teléfono de contacto" required type="tel" maxLength={30} autoComplete="tel" placeholder="Ej. 55 1234 5678" value={guardianForm.phone} onChange={event => setGuardianForm({ ...guardianForm, phone: event.target.value })} /><TextInput label="Correo electrónico (opcional)" type="email" autoComplete="email" value={guardianForm.email} onChange={event => setGuardianForm({ ...guardianForm, email: event.target.value })} /></div>
          {error && <p role="alert" className="student-error">{error}</p>}
          <div className="student-footer"><p>Podrás asignarle más alumnos después.</p><button className="student-button primary" disabled={busy}>{busy ? "Guardando tutor…" : "Guardar tutor y continuar"}<ArrowRight size={16} /></button></div>
        </fieldset>
      </form>}
    </section> : <>
      <div className="student-selected-guardian"><span className="student-person-icon"><CheckCircle2 size={23} /></span><div className="min-w-0 flex-1"><p className="student-eyebrow">Responsable de pago asignado</p><strong>{guardian.full_name}</strong><p>{guardian.phone}{siblings.length ? ` · ${siblings.length} ${siblings.length === 1 ? "alumno a su cargo" : "alumnos a su cargo"}` : ""}</p></div><button type="button" disabled={busy} className="student-button secondary" onClick={() => { setGuardian(null); setError(""); }}><ArrowLeft size={14} /> Cambiar tutor</button></div>
      <form onSubmit={createStudent}><fieldset disabled={busy} className="student-fields"><legend className="sr-only">Datos del alumno</legend>
        <section className="student-section"><div className="student-section-title"><h3>Datos del alumno</h3><p>Los campos con * son obligatorios.</p></div>
          <div className="student-details-layout"><div className="student-fields"><div ref={nameRef}><TextInput label="Nombre completo del niño o niña" required maxLength={160} autoComplete="off" value={form.full_name} onChange={change("full_name")} /></div><div className="student-grid"><TextInput label="Fecha de nacimiento" type="date" max={new Date().toLocaleDateString("en-CA")} value={form.birth_date} onChange={change("birth_date")} /><SelectInput label="Sede de la academia" required value={form.site} onChange={change("site")}><option value="">Selecciona una sede</option>{data.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</SelectInput></div><div className="student-grid"><TextInput label="Categoría" placeholder="Ej. Sub-10" maxLength={60} value={form.category} onChange={change("category")} /><TextInput label="Grupo" placeholder="Ej. Lunes y miércoles · 16:00" maxLength={80} value={form.group_name} onChange={change("group_name")} /></div></div><StudentPhotoInput file={photo} onChange={setPhoto} disabled={busy} /></div>
        </section>
        <section className="student-section"><div className="student-section-title"><h3><HeartPulse size={18} /> Salud y contacto de emergencia</h3><p>Completa lo que el equipo debe conocer para cuidar al alumno.</p></div><div className="student-grid"><TextInput label="Nombre del contacto de emergencia" maxLength={160} value={form.emergency_contact} onChange={change("emergency_contact")} /><TextInput label="Teléfono de emergencia" type="tel" maxLength={30} value={form.emergency_phone} onChange={change("emergency_phone")} /></div><button className="student-text-button" type="button" onClick={() => setForm({ ...form, emergency_contact: guardian.full_name, emergency_phone: guardian.phone })}>Usar los datos del papá o tutor</button><label className="student-textarea-label">Alergias, lesiones o cuidados especiales<textarea rows={2} placeholder="Si aplica, describe lo que debe saber el entrenador." value={form.medical_notes} onChange={change("medical_notes")} /></label></section>
        <details className="student-section student-extra"><summary><div><h3>Inscripción y documentos</h3><p>{statusLabels[form.status as Student["status"]]} · Uniforme {form.uniform_status === "pending" ? "pendiente" : form.uniform_status === "paid" ? "pagado" : "entregado"}</p></div><ChevronDown size={18} /></summary><div className="student-fields"><div className="student-grid"><SelectInput label="Estado del alumno" value={form.status} onChange={change("status")}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectInput><SelectInput label="Uniforme" value={form.uniform_status} onChange={change("uniform_status")}><option value="pending">Pendiente</option><option value="paid">Pagado</option><option value="delivered">Entregado</option></SelectInput></div><TextInput label="Enlace a la responsiva (opcional)" type="url" placeholder="https://…" value={form.waiver_url} onChange={change("waiver_url")} />{form.status === "paused" && <><div className="student-grid"><TextInput label="Inicio de la pausa" type="date" value={form.pause_start} onChange={change("pause_start")} /><TextInput label="Fin de la pausa" type="date" min={form.pause_start || undefined} value={form.pause_end} onChange={change("pause_end")} /></div><TextInput label="Motivo de la pausa" maxLength={180} value={form.pause_reason} onChange={change("pause_reason")} /></>}</div></details>
        {error && <p role="alert" className="student-error">{error}</p>}
        <div className="student-footer"><p>El alumno quedará vinculado a <strong>{guardian.full_name}</strong>.</p><button disabled={busy} className="student-button primary"><Check size={17} />{busy ? photo ? "Subiendo foto y guardando…" : "Guardando alumno…" : "Guardar alumno"}</button></div>
      </fieldset></form>
    </>}
  </div>;
}
