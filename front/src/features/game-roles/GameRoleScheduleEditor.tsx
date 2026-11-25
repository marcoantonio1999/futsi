import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Card, Input, Label, NativeSelect } from "../../components/ui/enrollment-ui";
import type { RoleSchedule, WeeklyBlock } from "./roleSchedule";

const days = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const weekdays = [1, 2, 3, 4, 5, 6, 0];
type DraftBlock = WeeklyBlock & { id: number };

function minutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function endForKickoff(start: string, original?: WeeklyBlock) {
  if (!start) return "";
  const duration = original ? minutes(original.ends_at) - minutes(original.starts_at) : 50;
  const end = minutes(start) + duration;
  if (end >= 24 * 60) return "";
  return [Math.floor(end / 60), end % 60].map(value => String(value).padStart(2, "0")).join(":");
}

export function GameRoleScheduleEditor({ blocks, kickoffOnly, canEdit, onSave }: {
  blocks: RoleSchedule; kickoffOnly: boolean; canEdit: boolean; onSave: (blocks: WeeklyBlock[]) => Promise<RoleSchedule>;
}) {
  const nextId = useRef(blocks.length);
  const [rows, setRows] = useState<DraftBlock[]>(() => blocks.map((block, id) => ({ ...block, id })));
  const [weekday, setWeekday] = useState(blocks[0]?.weekday ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dayRows = rows.filter(row => row.weekday === weekday);
  const hasChanges = rows.length !== blocks.length || rows.some((row, index) => {
    const savedBlock = blocks[index];
    return row.weekday !== savedBlock.weekday || row.starts_at !== savedBlock.starts_at || row.ends_at !== savedBlock.ends_at;
  });

  function changeRows(change: (current: DraftBlock[]) => DraftBlock[]) {
    setRows(change);
    setError("");
    setSaved(false);
  }

  return <Card as="section" className="game-role-schedule-editor" aria-labelledby="game-role-schedule-title">
    <form onSubmit={async event => {
      event.preventDefault();
      if (!canEdit || busy) return;
      const incomplete = rows.find(row => !row.starts_at || !row.ends_at || row.ends_at <= row.starts_at);
      if (incomplete) {
        setWeekday(incomplete.weekday);
        setError(kickoffOnly ? "Elige una hora de inicio que permita terminar antes de medianoche." : "Completa el bloque con una hora de fin posterior a la de inicio.");
        return;
      }
      setBusy(true);
      setError("");
      setSaved(false);
      try {
        const updated = await onSave(rows.map(({ weekday, starts_at, ends_at }) => ({ weekday, starts_at, ends_at })));
        setRows(updated.map((block, id) => ({ ...block, id })));
        nextId.current = updated.length;
        setSaved(true);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "No se pudieron guardar los horarios.");
      } finally {
        setBusy(false);
      }
    }}>
      <div className="game-role-panel-header">
        <h2 id="game-role-schedule-title">Horarios semanales</h2>
        {canEdit && <Button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar horarios"}</Button>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {saved && <p role="status">Horarios guardados.</p>}
      {hasChanges && !busy && !error && !saved && <p role="status">Cambios sin guardar. Pulsa «Guardar horarios» para actualizar Programar jornada.</p>}
      <div className="game-role-panel-header">
        <Label>Día de juego<NativeSelect aria-label="Día de juego" value={weekday} disabled={busy}
          onChange={event => setWeekday(Number(event.target.value))}>
          {weekdays.map(day => <option key={day} value={day}>{days[day]}</option>)}
        </NativeSelect></Label>
        {canEdit && <Button type="button" disabled={busy} onClick={() => {
          const id = nextId.current++;
          changeRows(current => [...current, { id, weekday, starts_at: "", ends_at: "" }]);
        }}><Plus size={16} aria-hidden="true" />Agregar bloque</Button>}
      </div>
      {dayRows.length === 0 && <p>Este día no tiene horarios.</p>}
      {dayRows.map((row, index) => <div className="game-role-schedule-block" data-kickoff-only={kickoffOnly} key={row.id}>
        <Label>Inicio<Input type="time" aria-label={`Inicio del bloque ${index + 1}`} required
          value={row.starts_at} readOnly={!canEdit || busy}
          onChange={event => {
            const starts_at = event.target.value;
            changeRows(current => current.map(block => block.id === row.id ? {
              ...block, starts_at, ends_at: kickoffOnly ? endForKickoff(starts_at, blocks[block.id]) : block.ends_at,
            } : block));
          }} /></Label>
        {!kickoffOnly && <Label>Fin<Input type="time" aria-label={`Fin del bloque ${index + 1}`} required
          value={row.ends_at} readOnly={!canEdit || busy}
          onChange={event => {
            const ends_at = event.target.value;
            changeRows(current => current.map(block => block.id === row.id ? { ...block, ends_at } : block));
          }} /></Label>}
        {canEdit && <Button type="button" aria-label={`Quitar bloque ${index + 1}`} disabled={busy}
          onClick={() => changeRows(current => current.filter(block => block.id !== row.id))}>
          <Trash2 size={16} aria-hidden="true" />
        </Button>}
      </div>)}
    </form>
  </Card>;
}
