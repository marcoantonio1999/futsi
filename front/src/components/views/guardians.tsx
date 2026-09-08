import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import type { AppData, Guardian, StudentDeletionConfirmation, StudentDeletionResult } from "../../types";
import type { GuardiansSubsection } from "../layout/adminShellModel";
import { SelectInput, TextInput } from "./shared";
import { AcademyDeleteDialog } from "./studentDeleteDialog";
import "./students.css";
import "./guardians.css";

type Props = {
  data: AppData; token: string; section: GuardiansSubsection; editingId: number | null;
  onSelectSection: (section: GuardiansSubsection) => void; onEdit: (id: number) => void;
  onCreate: (payload: unknown) => Promise<Guardian>;
  onUpdate: (id: number, payload: unknown) => Promise<boolean>;
  onDelete: (id: number, confirmation: StudentDeletionConfirmation) => Promise<StudentDeletionResult>;
};

export function GuardiansPanel(props: Props) {
  const { data, section, onSelectSection } = props;
  const [query, setQuery] = useState("");
  const [assignment, setAssignment] = useState("");
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState<Guardian | null>(null);
  const [notice, setNotice] = useState("");
  const children = useMemo(() => {
    const result = new Map<number, AppData["students"]>();
    data.students.forEach(student => result.set(student.guardian, [...(result.get(student.guardian) || []), student]));
    return result;
  }, [data.students]);
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return data.guardians.filter(guardian => {
      const students = children.get(guardian.id) || [];
      const text = [guardian.full_name, guardian.phone, guardian.email, guardian.tax_id, guardian.tax_name, ...students.map(row => row.full_name)].join(" ").toLocaleLowerCase();
      return (!search || text.includes(search)) && (!assignment || (assignment === "with" ? students.length > 0 : students.length === 0));
    });
  }, [data.guardians, children, query, assignment]);
  const pages = Math.max(1, Math.ceil(filtered.length / 8));
  useEffect(() => setPage(0), [query, assignment]);
  useEffect(() => setPage(current => Math.min(current, pages - 1)), [pages]);
  useEffect(() => setDeleting(null), [section]);
  const back = () => onSelectSection("registered");
  if (section === "create") return <GuardianEditor key="create" onBack={back} onSave={async payload => { const result = await props.onCreate(payload); setNotice(`Tutor creado: ${result.full_name}. Ya puedes asignarlo al registrar un alumno.`); back(); }} />;
  if (section === "edit") {
    const guardian = data.guardians.find(row => row.id === props.editingId);
    if (!guardian) return <div className="student-enrollment"><p role="alert">No se encontró este tutor.</p><button className="student-button secondary" onClick={back}>Volver a gestionar tutores</button></div>;
    return <GuardianEditor key={guardian.id} guardian={guardian} onBack={back} onSave={async payload => {
      if (!await props.onUpdate(guardian.id, payload)) throw new Error("No se pudieron guardar los cambios.");
      setNotice("Información del tutor actualizada."); back();
    }} />;
  }
  return <div className="student-enrollment guardian-management" data-testid="guardian-management">
    <header className="student-enrollment-header"><div><p className="student-eyebrow">Academia / Tutores</p><h2>Papás y tutores</h2><p className="student-hint">{data.guardians.length} responsables de pago registrados</p></div><button className="student-button primary" onClick={() => onSelectSection("create")}><Plus size={17} />Crear tutor</button></header>
    {notice && <p className="guardian-success" role="status"><Check size={16} />{notice}<button onClick={() => setNotice("")} aria-label="Cerrar aviso">×</button></p>}
    <section className="student-section">
      <div className="guardian-filters"><TextInput label="Buscar tutor o alumno" placeholder="Nombre, teléfono, correo o RFC" value={query} onChange={event => setQuery(event.target.value)} /><SelectInput label="Alumnos a su cargo" value={assignment} onChange={event => setAssignment(event.target.value)}><option value="">Todos los tutores</option><option value="with">Con alumnos</option><option value="without">Sin alumnos asignados</option></SelectInput></div>
      <div className="guardian-list-meta"><p>{filtered.length} {filtered.length === 1 ? "tutor encontrado" : "tutores encontrados"}</p>{(query || assignment) && <button className="student-text-button" onClick={() => { setQuery(""); setAssignment(""); }}>Limpiar filtros</button>}</div>
      <div className="guardian-grid">{filtered.slice(page * 8, (page + 1) * 8).map(guardian => {
        const students = children.get(guardian.id) || [];
        return <article key={guardian.id} className="guardian-card">
          <div className="guardian-card-heading"><span className="guardian-avatar"><UsersRound size={20} /></span><div><h3>{guardian.full_name}</h3><span className={`guardian-badge ${!guardian.phone ? "attention" : students.length ? "assigned" : "unassigned"}`}>{!guardian.phone ? "Falta teléfono" : students.length ? `${students.length} ${students.length === 1 ? "alumno a su cargo" : "alumnos a su cargo"}` : "Sin alumnos asignados"}</span></div></div>
          <dl className="guardian-contact"><div><dt>Teléfono</dt><dd>{guardian.phone || "Sin registrar"}</dd></div><div><dt>Correo</dt><dd>{guardian.email || "Sin registrar"}</dd></div></dl>
          <div className="guardian-children"><span>Alumnos</span><p>{students.length ? students.slice(0, 3).map(row => row.full_name).join(" · ") : "Disponible para asignar al crear un alumno."}</p>{students.length > 3 && <details><summary>Ver {students.length - 3} alumnos más</summary><p>{students.slice(3).map(row => row.full_name).join(" · ")}</p></details>}</div>
          <footer><button className="student-button secondary" onClick={() => props.onEdit(guardian.id)} aria-label={`Editar a ${guardian.full_name}`}><Pencil size={14} />Editar información</button><button className="guardian-delete" onClick={() => setDeleting(guardian)} aria-label={`Eliminar a ${guardian.full_name}`} title="Eliminar tutor"><Trash2 size={16} /></button></footer>
        </article>;
      })}</div>
      {!filtered.length && <div className="guardian-empty"><UsersRound size={28} /><h3>{data.guardians.length ? "No hay coincidencias" : "Aún no hay tutores registrados"}</h3><p>{data.guardians.length ? "Prueba con otro nombre o limpia los filtros." : "Crea al papá o tutor responsable del pago antes de registrar a sus alumnos."}</p></div>}
      {pages > 1 && <nav className="guardian-pagination" aria-label="Páginas de tutores"><button className="student-button secondary" disabled={!page} onClick={() => setPage(current => current - 1)}>Anterior</button><span>{page + 1} / {pages}</span><button className="student-button secondary" disabled={page >= pages - 1} onClick={() => setPage(current => current + 1)}>Siguiente</button></nav>}
    </section>
    {deleting && <AcademyDeleteDialog kind="guardian" record={deleting} token={props.token} onClose={() => setDeleting(null)} onDelete={props.onDelete} />}
  </div>;
}

function GuardianEditor({ guardian, onBack, onSave }: { guardian?: Guardian; onBack: () => void; onSave: (payload: unknown) => Promise<void> }) {
  const [form, setForm] = useState({ full_name: guardian?.full_name || "", phone: guardian?.phone || "", email: guardian?.email || "", tax_name: guardian?.tax_name || "", tax_id: guardian?.tax_id || "", notes: guardian?.notes || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); title.current?.focus({ preventScroll: true }); }, []);
  const change = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(current => ({ ...current, [key]: event.target.value }));
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try { await onSave(Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar el tutor."); }
    finally { saving.current = false; setBusy(false); }
  }
  return <div className="student-enrollment guardian-editor" data-testid="guardian-editor-page">
    <button className="student-text-button student-back" disabled={busy} onClick={onBack}><ArrowLeft size={16} />Volver a gestionar tutores</button>
    <header className="student-enrollment-header"><div><p className="student-eyebrow">Tutores / {guardian ? "Editar" : "Crear"}</p><h2 ref={title} tabIndex={-1}>{guardian ? "Editar tutor" : "Crear papá o tutor"}</h2><p className="student-hint">{guardian ? guardian.full_name : "Registra al adulto responsable del pago. Puedes asignarle varios alumnos."}</p></div></header>
    <form onSubmit={submit}><fieldset className="student-fields" disabled={busy}><legend className="sr-only">Información del tutor</legend>
      <section className="student-section"><div className="student-section-title"><h3>Datos de contacto</h3><p>Nombre y teléfono son obligatorios.</p></div><div className="student-fields"><TextInput label="Nombre completo" required maxLength={160} autoComplete="name" value={form.full_name} onChange={change("full_name")} /><div className="student-grid"><TextInput label="Teléfono" required type="tel" maxLength={30} autoComplete="tel" value={form.phone} onChange={change("phone")} /><TextInput label="Correo electrónico (opcional)" type="email" autoComplete="email" value={form.email} onChange={change("email")} /></div></div></section>
      <section className="student-section"><div className="student-section-title"><h3>Datos de facturación <span className="student-hint">Opcionales</span></h3></div><div className="student-grid"><TextInput label="Nombre o razón social" maxLength={180} value={form.tax_name} onChange={change("tax_name")} /><TextInput label="RFC" maxLength={20} value={form.tax_id} onChange={change("tax_id")} /></div></section>
      <section className="student-section"><label className="student-textarea-label">Notas internas (opcional)<textarea rows={3} placeholder="Indicaciones relevantes sobre el contacto o el pago" value={form.notes} onChange={change("notes")} /></label></section>
      {error && <p className="student-error" role="alert">{error}</p>}
      <footer className="student-editor-footer"><button type="button" className="student-button secondary" onClick={onBack}>Cancelar</button><button className="student-button primary" disabled={busy}><Check size={16} />{busy ? "Guardando…" : guardian ? "Guardar cambios" : "Guardar tutor"}</button></footer>
    </fieldset></form>
  </div>;
}
