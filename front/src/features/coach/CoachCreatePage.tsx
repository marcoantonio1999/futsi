import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, UserRoundPlus } from "lucide-react";
import { SelectInput, TextInput } from "../../components/views/shared";
import type { AppData, User } from "../../types";
import { coachName } from "./coachWorkspaceModel";

export function CoachCreatePage({ data, onBack, onCreate }: { data: AppData; onBack: () => void; onCreate: (payload: unknown) => Promise<User> }) {
  const [site, setSite] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<User | null>(null);
  const groups = [...new Set(data.students.filter(student => String(student.site) === site).map(student => student.group_name).filter(Boolean))].sort();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving.current) return;
    const values = new FormData(event.currentTarget);
    saving.current = true; setBusy(true); setError("");
    try {
      const coach = await onCreate({
        username: String(values.get("username") || "").trim(), password: values.get("password"),
        first_name: String(values.get("first_name") || "").trim(), last_name: String(values.get("last_name") || "").trim(),
        email: String(values.get("email") || "").trim(), phone: String(values.get("phone") || "").trim(),
        role: "coach", is_active: true, primary_site: Number(site),
        coach_group_name: String(values.get("group") || "").trim(), coach_hourly_rate: values.get("rate"),
        section_permissions: [],
      });
      setCreated(coach);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo crear el coach. Revisa sus datos."); }
    finally { saving.current = false; setBusy(false); }
  }
  if (created) return <section className="coach-surface coach-success" role="status"><CheckCircle2 size={36} /><h2>Coach creado correctamente</h2><p>{coachName(created)} ya tiene su cuenta y sede asignadas.</p><div className="coach-actions"><button className="coach-button primary" onClick={onBack}>Ver resumen de coaches</button><button className="coach-button" onClick={() => { setCreated(null); setSite(""); setShowPassword(false); }}>Agregar otro coach</button></div></section>;
  return <>
    <button className="coach-back" onClick={onBack}><ArrowLeft size={16} /> Resumen de coaches</button>
    <header className="coach-heading"><div><p className="coach-eyebrow">Coaches / Nuevo registro</p><h2>Nuevo coach</h2><p>Asigna su sede, grupo y tarifa para comenzar a registrar su actividad.</p></div><UserRoundPlus size={28} /></header>
    <form className="coach-surface coach-create" onSubmit={submit}>
      <fieldset disabled={busy}><legend className="sr-only">Datos del nuevo coach</legend>
        <section><h3>Información personal</h3><div className="coach-form-grid">
          <TextInput name="first_name" label="Nombre" required maxLength={150} autoComplete="given-name" />
          <TextInput name="last_name" label="Apellidos" required maxLength={150} autoComplete="family-name" />
          <TextInput name="phone" label="Teléfono (opcional)" type="tel" maxLength={30} autoComplete="tel" />
          <TextInput name="email" label="Correo electrónico (opcional)" type="email" autoComplete="email" />
        </div></section>
        <section><h3>Asignación y tarifa</h3><div className="coach-form-grid">
          <SelectInput label="Sede" required value={site} onChange={event => setSite(event.target.value)}><option value="">Selecciona una sede</option>{data.sites.filter(row => row.is_active).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</SelectInput>
          <div><TextInput key={site} name="group" label="Grupo asignado (opcional)" disabled={!site} list="coach-existing-groups" maxLength={80} placeholder="Selecciona o escribe el grupo" /><datalist id="coach-existing-groups">{groups.map(group => <option key={group} value={group} />)}</datalist></div>
          <TextInput name="rate" label="Tarifa por hora (MXN)" type="number" min="0" max="99999999.99" step="0.01" required placeholder="0.00" />
        </div><p className="coach-hint">Sin un grupo específico, atenderá todos los grupos de la sede. La tarifa se conserva en cada registro de horas.</p></section>
        <section><h3>Acceso a Futsi</h3><div className="coach-form-grid">
          <TextInput name="username" label="Nombre de usuario" required maxLength={150} autoComplete="off" pattern="[A-Za-z0-9_@.+-]+" title="Usa letras sin acentos, números o los signos @ . + - _" />
          <div><TextInput name="password" label="Contraseña" type={showPassword ? "text" : "password"} required minLength={8} autoComplete="new-password" /><button type="button" className="coach-back mt-2" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}{showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}</button></div>
        </div><p className="coach-hint">Contraseña de al menos 8 caracteres. La cuenta tendrá el acceso habitual del rol coach.</p></section>
        {error && <p className="coach-notice error" role="alert">{error}</p>}
        <footer className="coach-actions"><button type="button" className="coach-button" onClick={onBack}>Cancelar</button><button className="coach-button primary" disabled={busy || !data.sites.some(row => row.is_active)}>{busy ? "Creando coach…" : "Crear coach"}</button></footer>
        {!data.sites.some(row => row.is_active) && <p className="coach-notice warning">Primero necesitas una sede activa para asignar al coach.</p>}
      </fieldset>
    </form>
  </>;
}
