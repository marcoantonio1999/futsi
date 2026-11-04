import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Card, Dialog, Input, Label, NativeSelect, Textarea } from "../../components/ui/enrollment-ui";

type NoteKind = "permit" | "preferred" | "unavailable";
type NoteFormKind = "permit" | "preferred";
export type GameRoleNote = {
  id: number; kind: NoteKind; team_id: number; round_id: number | null; weekday: number | null;
  starts_at: string | null; ends_at: string | null; note: string;
};
type Team = { id: number; name: string; is_active: boolean };
type Round = { id: number; number: number };

const weekdays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const titles = { permit: "Permisos", preferred: "Sugerencias de horario" };

export function scheduleSuggestion(row: GameRoleNote) {
  const kind = row.kind === "preferred" ? "Prefiere" : "No disponible";
  const hours = row.starts_at && row.ends_at ? ` · ${row.starts_at.slice(0, 5)}–${row.ends_at.slice(0, 5)}` : " · Todo el día";
  return `${kind} · ${weekdays[row.weekday ?? 0]}${hours}`;
}

export function GameRoleNotes({ notes, teams, rounds, selectedRound, onSave }: {
  notes: GameRoleNote[]; teams: Team[]; rounds: Round[]; selectedRound?: Round;
  onSave: (payload: object) => Promise<void>;
}) {
  const [form, setForm] = useState<NoteFormKind | null>(null);
  const names = new Map(teams.map(team => [team.id, team.name]));
  const numbers = new Map(rounds.map(round => [round.id, round.number]));
  const activeTeams = teams.filter(team => team.is_active);
  return <div className="game-role-notes-grid">
    {(["permit", "preferred"] as const).map(kind => {
      const permit = kind === "permit";
      const rows = notes.filter(row => (row.kind === "permit") === permit);
      return <Card as="section" className="game-role-notes" id={`game-role-notes-${kind}`} key={kind}>
        <header className="game-role-panel-header">
          <h2>{titles[kind]}</h2>
          <Button type="button" className="primary" disabled={!activeTeams.length || (permit && !rounds.length)} onClick={() => setForm(kind)}>
            {permit ? "Agregar permiso" : "Agregar sugerencia"}
          </Button>
        </header>
        <p>{permit ? "Permisos de equipo por jornada." : "Días y horarios que los equipos prefieren o tienen ocupados."}</p>
        {permit && !rounds.length && <p>Agrega una jornada para registrar un permiso.</p>}
        {rows.length ? <ul className="game-role-note-list">{rows.map(row => <li key={row.id}>
          <strong>{names.get(row.team_id)}</strong>
          <span>{permit ? `Jornada ${numbers.get(row.round_id ?? 0)}` : scheduleSuggestion(row)}</span>
          {row.note && <p>{row.note}</p>}
        </li>)}</ul> : <p>{permit ? "Todavía no hay permisos registrados." : "Todavía no hay sugerencias registradas."}</p>}
      </Card>;
    })}
    {form && <GameRoleNoteForm kind={form} teams={activeTeams} rounds={rounds} selectedRound={selectedRound}
      onClose={() => setForm(null)} onSave={onSave} />}
  </div>;
}

function GameRoleNoteForm({ kind, teams, rounds, selectedRound, onClose, onSave }: {
  kind: NoteFormKind; teams: Team[]; rounds: Round[]; selectedRound?: Round;
  onClose: () => void; onSave: (payload: object) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const permit = kind === "permit";
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const values = new FormData(event.currentTarget);
    const common = { team_id: Number(values.get("team_id")), note: String(values.get("note") ?? "").trim() };
    const payload = permit ? { ...common, kind, round_id: Number(values.get("round_id")) } : {
      ...common, kind: values.get("preference"), weekday: Number(values.get("weekday")),
      starts_at: values.get("starts_at") || null, ends_at: values.get("ends_at") || null,
    };
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await onSave(payload);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el registro.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <Dialog ref={dialog} className="game-roles-dialog" aria-labelledby="game-role-note-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <h2 id="game-role-note-title">{permit ? "Agregar permiso de equipo" : "Agregar sugerencia de horario"}</h2>
      <Label>Equipo<NativeSelect name="team_id" aria-label="Equipo" defaultValue="" required disabled={busy}>
        <option value="">Selecciona un equipo</option>
        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </NativeSelect></Label>
      {permit ? <Label>Jornada<NativeSelect name="round_id" aria-label="Jornada" defaultValue={selectedRound?.id ?? ""} required disabled={busy}>
        <option value="">Selecciona una jornada</option>
        {rounds.map(round => <option key={round.id} value={round.id}>Jornada {round.number}</option>)}
      </NativeSelect></Label> : <>
        <Label>Preferencia<NativeSelect name="preference" aria-label="Preferencia" disabled={busy}>
          <option value="preferred">Horario preferido</option><option value="unavailable">Horario no disponible</option>
        </NativeSelect></Label>
        <Label>Día<NativeSelect name="weekday" aria-label="Día" defaultValue="" required disabled={busy}>
          <option value="">Selecciona un día</option>
          {weekdays.map((day, index) => <option key={day} value={index}>{day}</option>)}
        </NativeSelect></Label>
        <div className="game-roles-hour-fields">
          <Label>Desde<Input name="starts_at" type="time" disabled={busy} /></Label>
          <Label>Hasta<Input name="ends_at" type="time" disabled={busy} /></Label>
        </div>
        <p>Deja ambas horas vacías para indicar todo el día.</p>
      </>}
      <Label>{permit ? "Motivo (opcional)" : "Nota (opcional)"}<Textarea name="note" maxLength={300} rows={3} disabled={busy} /></Label>
      {error && <p className="error" role="alert">{error}</p>}
      <footer>
        <Button type="button" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
      </footer>
    </form>
  </Dialog>;
}
