import { useState } from "react";
import type { AppData, StudentTournamentRegistration, Team, Tournament } from "../../types";
import { SelectInput, TextInput } from "../../components/views/shared";
import { TournamentDialog } from "./TournamentDialog";
import { durationFromRange, today } from "./utils";

export function CreateTeamDialog({ tournament, adult, onSave, onClose }: { tournament: Tournament; adult: boolean; onSave: (payload: unknown) => Promise<void>; onClose: () => void }) {
  return <TournamentDialog title="Crear equipo" description={tournament.name} submitLabel="Crear equipo" onClose={onClose} onSubmit={async form => onSave({ tournament: tournament.id, name: String(form.get("name")).trim(), representative_name: adult ? form.get("representative_name") : "Equipo infantil", representative_phone: adult ? form.get("representative_phone") : "N/A", representative_email: adult ? form.get("representative_email") : "", is_active: true })}>
    <TextInput label="Nombre del equipo" name="name" required maxLength={140} placeholder="Ej. Halcones Sub-12" />
    {adult ? <><TextInput label="Representante del equipo" name="representative_name" required maxLength={160} /><div className="tournament-form-grid"><TextInput label="Teléfono" type="tel" name="representative_phone" required maxLength={30} /><TextInput label="Correo (opcional)" name="representative_email" type="email" /></div></> : <p className="tournament-info">Una vez creado, podrás agregar alumnos desde el botón «Inscribir alumnos» del equipo.</p>}
  </TournamentDialog>;
}

export function EnrollmentDialog({ tournament, students, teams, registrations, existing, initialTeam, onSave, onClose }: {
  tournament: Tournament; students: AppData["students"]; teams: Team[]; registrations: StudentTournamentRegistration[]; existing?: StudentTournamentRegistration; initialTeam?: number;
  onSave: (payload: unknown, id?: number) => Promise<void>; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [studentId, setStudentId] = useState(existing ? String(existing.student) : "");
  const eligible = students.filter(student => student.site === tournament.site && !registrations.some(row => row.student === student.id && row.status === "registered"));
  const filtered = eligible.filter(student => student.full_name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) || String(student.id) === studentId);
  const previous = existing || registrations.find(row => String(row.student) === studentId);
  const [billingType, setBillingType] = useState(existing?.billing_type || tournament.billing_type);
  return <TournamentDialog title={existing?.status === "registered" ? "Editar inscripción" : previous ? "Reinscribir alumno" : "Inscribir alumno"} description={tournament.name} submitLabel={existing?.status === "registered" ? "Guardar cambios" : "Confirmar inscripción"} onClose={onClose} onSubmit={async form => {
    await onSave({ tournament: tournament.id, student: Number(studentId), team: form.get("team") ? Number(form.get("team")) : null, jersey_number: form.get("jersey_number") ? Number(form.get("jersey_number")) : null, billing_type: billingType, weekly_amount: billingType === "weekly_match" ? form.get("amount") : previous?.weekly_amount || "0", full_amount: billingType === "full_tournament" ? form.get("amount") : previous?.full_amount || "0", billing_starts_on: form.get("billing_starts_on"), status: "registered", notes: form.get("notes") || "" }, previous?.id);
  }}>
    {existing ? <div className="tournament-context"><strong>{existing.student_name}</strong><span>{existing.status === "registered" ? "Inscripción activa" : "El alumno volverá a estar inscrito en este torneo."}</span></div> : <><TextInput label="Buscar alumno de la sede" value={query} placeholder="Nombre del alumno" onChange={event => setQuery(event.target.value)} /><SelectInput label="Alumno" required value={studentId} onChange={event => { setStudentId(event.target.value); const row = registrations.find(item => String(item.student) === event.target.value); setBillingType(row?.billing_type || tournament.billing_type); }}><option value="">Selecciona un alumno</option>{filtered.map(student => <option key={student.id} value={student.id}>{student.full_name}{registrations.some(row => row.student === student.id) ? " · Reinscribir" : ""}</option>)}</SelectInput>{!eligible.length && <p className="tournament-info">Todos los alumnos disponibles de esta sede ya están inscritos.</p>}</>}
    <div key={studentId} className="tournament-dialog-fields"><div className="tournament-form-grid"><SelectInput label="Equipo del torneo" name="team" defaultValue={initialTeam || previous?.team || ""}><option value="">Asignar equipo después</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</SelectInput><TextInput label="Número de camiseta (opcional)" name="jersey_number" type="number" min={1} max={99} step={1} defaultValue={previous?.jersey_number || ""} /></div><div className="tournament-form-grid"><SelectInput label="Plan de pago" value={billingType} onChange={event => setBillingType(event.target.value)}><option value="weekly_match">Pago semanal</option><option value="full_tournament">Torneo completo</option></SelectInput><TextInput key={billingType} label={billingType === "weekly_match" ? "Importe semanal (MXN)" : "Importe del torneo (MXN)"} name="amount" type="number" min={0} step="0.01" required defaultValue={previous ? billingType === "weekly_match" ? previous.weekly_amount : previous.full_amount : ""} /></div><TextInput label="Inicio de cobro" name="billing_starts_on" type="date" required defaultValue={existing?.status === "registered" ? existing.billing_starts_on || today() : today()} /><p className="tournament-muted">Al ingresar a un torneo iniciado, elige desde qué fecha corresponde el cobro.</p><TextInput label="Notas (opcional)" name="notes" defaultValue={previous?.notes || ""} /></div>
  </TournamentDialog>;
}

export function ScheduleMatchDialog({ tournament, teams, onSave, onClose }: { tournament: Tournament; teams: Team[]; onSave: (payload: unknown) => Promise<void>; onClose: () => void }) {
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  return <TournamentDialog title="Agendar partido" description={tournament.name} submitLabel="Agendar partido" onClose={onClose} onSubmit={async form => {
    const starts = String(form.get("starts_at")); const ends = String(form.get("ends_at"));
    if (!home || !away || home === away) throw new Error("Selecciona dos equipos diferentes de este torneo.");
    if (starts === ends) throw new Error("La hora de inicio y fin deben ser diferentes.");
    await onSave({ tournament: tournament.id, site: tournament.site, home_team: Number(home), away_team: Number(away), played_on: form.get("played_on"), starts_at: starts, duration_minutes: durationFromRange(starts, ends), status: "scheduled" });
  }}><div className="tournament-form-grid"><SelectInput label="Equipo local" required value={home} onChange={event => { setHome(event.target.value); if (away === event.target.value) setAway(""); }}><option value="">Selecciona equipo</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</SelectInput><SelectInput label="Equipo visitante" required value={away} onChange={event => setAway(event.target.value)}><option value="">Selecciona equipo</option>{teams.filter(team => String(team.id) !== home).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</SelectInput></div><TextInput label="Fecha del partido" name="played_on" type="date" required defaultValue={today()} /><div className="tournament-form-grid"><TextInput label="Hora de inicio" name="starts_at" type="time" required defaultValue="18:00" /><TextInput label="Hora de fin" name="ends_at" type="time" required defaultValue="19:00" /></div><p className="tournament-info">El partido se guardará como programado. Si termina después de medianoche, indica la hora de fin del día siguiente.</p></TournamentDialog>;
}
