import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, HeartPulse } from "lucide-react";
import type { AppData, Student } from "../../types";
import { SelectInput, TextInput } from "./shared";
import { StudentAvatar, StudentPhotoInput } from "./studentPhoto";
import { studentFormData } from "./studentEnrollment";
import { statusLabels } from "../../appState";

export function StudentEditor({ student, data, token, onBack, onUpdate }: {
  student: Student; data: AppData; token: string; onBack: () => void;
  onUpdate: (studentId: number, payload: unknown) => Promise<boolean>;
}) {
  const [form, setForm] = useState({
    full_name: student.full_name, site: String(student.site), guardian: String(student.guardian),
    birth_date: student.birth_date || "", category: student.category, group_name: student.group_name,
    status: student.status, waiver_url: student.waiver_url || "", medical_notes: student.medical_notes || "",
    emergency_contact: student.emergency_contact || "", emergency_phone: student.emergency_phone || "",
    uniform_status: student.uniform_status || "pending", pause_start: student.pause_start || "",
    pause_end: student.pause_end || "", pause_reason: student.pause_reason || "",
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { window.scrollTo({ top: 0, behavior: "instant" }); title.current?.focus({ preventScroll: true }); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true; setBusy(true); setError("");
    try {
      if (await onUpdate(student.id, studentFormData(form, photo))) onBack();
      else setError("No se guardaron los cambios. Revisa el mensaje de error y vuelve a intentarlo.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudieron guardar los cambios."); }
    finally { saving.current = false; setBusy(false); }
  }
  const change = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm(previous => ({ ...previous, [key]: event.target.value }));
  return <div className="student-enrollment" data-testid="student-editor-page">
    <button className="student-text-button student-back" onClick={onBack} disabled={busy}><ArrowLeft size={16} /> Volver a gestionar alumnos</button>
    <header className="student-enrollment-header"><div><p className="student-eyebrow">Alumnos / Gestión / Editar</p><h2 ref={title} tabIndex={-1}>Editar alumno</h2><p className="student-hint">{student.full_name}</p></div></header>
    <form onSubmit={submit}><fieldset disabled={busy} className="student-fields"><legend className="sr-only">Editar datos del alumno</legend>
      <section className="student-section"><div className="student-section-title"><h3>Datos del alumno</h3><p>Actualiza su información, sede y estado de inscripción.</p></div><div className="student-details-layout"><div className="student-fields">
        <TextInput label="Nombre completo" required maxLength={160} value={form.full_name} onChange={change("full_name")} />
        <div className="student-grid"><TextInput label="Fecha de nacimiento" type="date" max={new Date().toLocaleDateString("en-CA")} value={form.birth_date} onChange={change("birth_date")} /><SelectInput label="Sede de la academia" required value={form.site} onChange={change("site")}>{data.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</SelectInput></div>
        <div className="student-grid"><TextInput label="Categoría" maxLength={60} value={form.category} onChange={change("category")} /><TextInput label="Grupo" maxLength={80} value={form.group_name} onChange={change("group_name")} /></div>
        <div className="student-grid"><SelectInput label="Estado del alumno" value={form.status} onChange={change("status")}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectInput><SelectInput label="Uniforme" value={form.uniform_status} onChange={change("uniform_status")}><option value="pending">Pendiente</option><option value="paid">Pagado</option><option value="delivered">Entregado</option></SelectInput></div>
      </div><StudentPhotoInput file={photo} onChange={setPhoto} disabled={busy} current={<StudentAvatar student={student} token={token} />} /></div></section>
      <section className="student-section"><div className="student-section-title"><h3>Papá o tutor responsable de pago</h3><p>Un tutor puede tener varios alumnos a su cargo.</p></div><SelectInput label="Tutor asignado" required value={form.guardian} onChange={change("guardian")}>
        {!data.guardians.some(guardian => guardian.id === student.guardian) && <option value={student.guardian}>{student.guardian_name || "Tutor actual"}</option>}
        {data.guardians.map(guardian => <option key={guardian.id} value={guardian.id}>{guardian.full_name} · {guardian.phone}</option>)}
      </SelectInput></section>
      <section className="student-section"><div className="student-section-title"><h3><HeartPulse size={18} /> Salud y emergencias</h3></div><div className="student-grid"><TextInput label="Contacto de emergencia" maxLength={160} value={form.emergency_contact} onChange={change("emergency_contact")} /><TextInput label="Teléfono de emergencia" type="tel" maxLength={30} value={form.emergency_phone} onChange={change("emergency_phone")} /></div><label className="student-textarea-label mt-4">Alergias, lesiones o cuidados especiales<textarea rows={3} value={form.medical_notes} onChange={change("medical_notes")} /></label></section>
      <section className="student-section"><div className="student-section-title"><h3>Documentos y pausas</h3></div><TextInput label="Enlace a la responsiva (opcional)" type="url" value={form.waiver_url} onChange={change("waiver_url")} /><div className="student-grid mt-4"><TextInput label="Inicio de la pausa" type="date" value={form.pause_start} onChange={change("pause_start")} /><TextInput label="Fin de la pausa" type="date" min={form.pause_start || undefined} value={form.pause_end} onChange={change("pause_end")} /></div><div className="mt-4"><TextInput label="Motivo de la pausa" maxLength={180} value={form.pause_reason} onChange={change("pause_reason")} /></div></section>
      {error && <p className="student-error" role="alert">{error}</p>}
      <footer className="student-editor-footer"><button type="button" className="student-button secondary" onClick={onBack}>Cancelar</button><button className="student-button primary" disabled={busy}><Check size={16} />{busy ? "Guardando cambios…" : "Guardar cambios"}</button></footer>
    </fieldset></form>
  </div>;
}
