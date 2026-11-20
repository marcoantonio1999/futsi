import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { apiRequest } from "../../api";
import { Button, Card, Dialog, Input, Label, NativeSelect } from "../../components/ui/enrollment-ui";
import type { Site, StandingRow, Tournament } from "../../types";
import { useEnrollmentScrollReady, useEnrollmentViewState } from "../enrollments/EnrollmentNavigation";
import { GameRoleNotes, scheduleSuggestion, type GameRoleNote } from "./GameRoleNotes";
import { GameRoleStatistics } from "./GameRoleStatistics";
import { GameRoleShare } from "./GameRoleShare";
import { roleReminders } from "./roleReminders";
import "./gameRoles.css";

type Team = { id: number; name: string; is_active: boolean };
type Round = { id: number; number: number; starts_on: string };
type Cross = {
  home_team_id: number; away_team_id: number; round_id: number;
  scheduled_on: string | null; starts_at: string | null; ends_at: string | null; played: boolean;
  home_goals?: number | null; away_goals?: number | null;
};
type Matrix = {
  teams: Team[]; matrix_team_ids?: number[]; rounds: Round[]; crosses: Cross[]; starts_on: string | null;
  schedule_enabled?: boolean; team_notes?: GameRoleNote[]; standings?: StandingRow[];
};
type Slot = { day: string; start: string; end: string };
type CrossEditor = { kind: "cross"; home: Team; away: Team; current?: Cross; slot?: Slot };
const startTimes = [
  "09:00", "09:50", "10:40", "11:30", "12:20", "13:10", "14:00", "14:50", "15:40",
  "16:30", "17:20", "18:10", "19:00", "19:50", "20:10", "21:00", "21:50", "22:40",
];
function slotsFor(day: string): Slot[] {
  return startTimes.map(start => {
    const [hour, minute] = start.split(":").map(Number);
    const end = hour * 60 + minute + 50;
    return { day, start, end: [Math.floor(end / 60), end % 60].map(value => String(value).padStart(2, "0")).join(":") };
  });
}
function overlaps(slot: Slot, cross: Cross) {
  return slot.day === cross.scheduled_on && cross.starts_at !== null && cross.ends_at !== null
    && slot.start < cross.ends_at.slice(0, 5) && slot.end > cross.starts_at.slice(0, 5);
}
type Editor = { kind: "round"; round?: Round } | CrossEditor;

const roundColors = [
  "#1246a0", "#6d297a", "#00645b", "#9a3e10", "#8b2445",
  "#485e18", "#184e6c", "#79540e", "#832e75", "#385485",
  "#884724", "#326045", "#932821", "#3b356b", "#6d4c60",
  "#2c514b", "#3f5561", "#563723", "#5d5925", "#4a3f57",
];

function roundColorStyle(number: number): CSSProperties {
  const hue = (number * 137.508) % 360;
  const color = roundColors[number - 1] ?? `hsl(${hue} 65% 27%)`;
  return { "--game-roles-round-color": color } as CSSProperties;
}

function addDays(value: string, days: number) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

const dateLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const timeLabel = (value: string | null | undefined) => value?.slice(0, 5) ?? "";
const matchScore = (cross: Cross | undefined) => cross?.home_goals != null && cross.away_goals != null
  ? `${cross.home_goals}–${cross.away_goals}` : null;
function weekLabel(start: string) {
  return dateLabel.formatRange(new Date(start + "T00:00:00Z"), new Date(addDays(start, 6) + "T00:00:00Z"));
}

export function GameRoles({ token, tournaments, sites, loading }: {
  token: string; tournaments: Tournament[]; sites: Pick<Site, "id" | "name">[]; loading: boolean;
}) {
  const [tournamentId, setTournamentId] = useEnrollmentViewState("gameRoles.tournament", "");
  const tournament = tournaments.find(row => String(row.id) === tournamentId);
  return <>
    <Card as="section" className="operator-controls game-roles-intro">
      <Label><span id="game-roles-tournament-label">Torneo</span><NativeSelect aria-labelledby="game-roles-tournament-label"
        value={tournament?.id ?? ""} disabled={loading} onChange={event => setTournamentId(event.target.value)}>
        <option value="">{loading ? "Cargando torneos…" : "Selecciona un torneo"}</option>
        {tournaments.map(row => <option key={row.id} value={row.id}>
          {row.name} · {sites.find(site => site.id === row.site)?.name}{row.is_active ? "" : " · Inactivo"}
        </option>)}
      </NativeSelect></Label>
    </Card>
    {tournament && <TournamentMatrix key={tournament.id} token={token} tournamentId={tournament.id} tournamentName={tournament.name} />}
  </>;
}

function TournamentMatrix({ token, tournamentId, tournamentName }: { token: string; tournamentId: number; tournamentName: string }) {
  const path = `/player-enrollments/game-roles/${tournamentId}/`;
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useEnrollmentViewState(`gameRoles.round.${tournamentId}`, 0);
  const [view, setView] = useEnrollmentViewState<"matrix" | "history" | "statistics">("gameRoles.view", "matrix");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [scheduleDay, setScheduleDay] = useState("");
  const [addingTeam, setAddingTeam] = useState(false);
  const [slotToAssign, setSlotToAssign] = useState<Slot | null>(null);
  const [shareRoundId, setShareRoundId] = useState<number | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [reminderMessage, setReminderMessage] = useState("");
  useEnrollmentScrollReady(Boolean(matrix));

  useEffect(() => {
    const reminders = roleReminders;
    if (!reminders) return;
    const refresh = () => void reminders.status()
      .then(({ enabled }) => setRemindersEnabled(enabled))
      .catch(() => setReminderMessage("No se pudo consultar el permiso de notificaciones."));
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, []);

  useEffect(() => {
    if (!roleReminders || !matrix?.schedule_enabled || !remindersEnabled) return;
    const endsByRound = new Map<number, string>();
    for (const cross of matrix.crosses) {
      if (!cross.scheduled_on || !cross.ends_at) continue;
      const ends = `${cross.scheduled_on} ${cross.ends_at.slice(0, 5)}`;
      if (ends > (endsByRound.get(cross.round_id) ?? "")) endsByRound.set(cross.round_id, ends);
    }
    const rounds = matrix.rounds.flatMap(round => {
      const ends = endsByRound.get(round.id);
      return ends ? [{ id: round.id, number: round.number, ends }] : [];
    });
    setReminderMessage("");
    void roleReminders.sync({ tournament: String(tournamentId), name: tournamentName, rounds })
      .catch(() => setReminderMessage("No se pudieron programar los recordatorios."));
  }, [matrix, remindersEnabled, tournamentId, tournamentName]);

  async function enableReminders() {
    if (!roleReminders) return;
    try {
      const { enabled } = await roleReminders.enable();
      setRemindersEnabled(enabled);
      setReminderMessage(enabled ? "" : "Permite las notificaciones de Inscripciones en los ajustes de Android.");
    } catch {
      setReminderMessage("No se pudo activar el permiso de notificaciones.");
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    apiRequest<Matrix>(path, token, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setMatrix(result); })
      .catch(reason => { if (!controller.signal.aborted) setLoadError(reason.message); });
    return () => controller.abort();
  }, [path, token, reload]);

  if (loadError || (matrix && !matrix.schedule_enabled)) return <Card as="section" className="operator-controls">
    <p className="error" role="alert">{loadError || "La programación de horarios se está actualizando."}</p>
    <Button onClick={() => setReload(value => value + 1)}>Volver a cargar matriz</Button>
  </Card>;
  if (!matrix) return <p role="status">Cargando matriz…</p>;

  const selected = matrix.rounds.find(round => round.id === selectedId) ?? matrix.rounds[0];
  const teamsById = new Map(matrix.teams.map(team => [team.id, team]));
  // Keep the chosen order, then show the teams needed by existing matches.
  const matrixTeamIds = new Set(matrix.matrix_team_ids ?? []);
  for (const cross of matrix.crosses) {
    matrixTeamIds.add(cross.home_team_id);
    matrixTeamIds.add(cross.away_team_id);
  }
  const matrixTeams = Array.from(matrixTeamIds).flatMap(id => {
    const team = teamsById.get(id);
    return team ? [team] : [];
  });
  const availableTeams = matrix.teams.filter(team => team.is_active && !matrixTeamIds.has(team.id));
  const assignableTeams = matrixTeams.filter(team => team.is_active);
  const nextScheduledDay = selected && matrix.crosses
    .flatMap(cross => cross.round_id === selected.id && cross.scheduled_on ? [cross.scheduled_on] : [])
    .sort()[0];
  const day = selected
    ? (scheduleDay >= selected.starts_on && scheduleDay <= addDays(selected.starts_on, 6) ? scheduleDay : nextScheduledDay || selected.starts_on)
    : "";
  const slots = day ? slotsFor(day) : [];
  const openCross = (home: Team, away: Team, current?: Cross) => {
    const slot = current ? undefined : slots.find(item => !matrix.crosses.some(cross => overlaps(item, cross)));
    setEditor({ kind: "cross", home, away, current, slot });
  };
  const roundById = new Map(matrix.rounds.map(round => [round.id, round]));
  const crossByTeams = new Map(matrix.crosses.map(cross => [`${cross.home_team_id}:${cross.away_team_id}`, cross]));
  const counts = new Map<number, number>();
  for (const cross of matrix.crosses) counts.set(cross.round_id, (counts.get(cross.round_id) ?? 0) + 1);
  const crosses = selected ? counts.get(selected.id) ?? 0 : 0;

  async function save(method: string, data: object, roundNumber?: number) {
    const result = await apiRequest<Matrix>(path, token, { method, body: JSON.stringify(data) });
    setMatrix(result);
    if (roundNumber !== undefined) setSelectedId(result.rounds.find(round => round.number === roundNumber)?.id ?? 0);
    setEditor(null);
    setAddingTeam(false);
  }

  async function saveNote(payload: object) {
    const result = await apiRequest<{ team_notes: GameRoleNote[] }>(path + "team-notes/", token, {
      method: "POST", body: JSON.stringify(payload),
    });
    setMatrix(current => current && { ...current, team_notes: result.team_notes });
  }

  return <>
    {roleReminders && <Card as="section" className="operator-controls" aria-label="Notificaciones de jornadas">
      <h2>Notificaciones de jornadas</h2>
      <p>Recibe un aviso al terminar la jornada y otro al día siguiente.</p>
      {remindersEnabled ? <p>Notificaciones activadas en este celular.</p>
        : <Button type="button" onClick={() => void enableReminders()}>Activar notificaciones</Button>}
      {reminderMessage && <p role="status">{reminderMessage}</p>}
    </Card>}
    <nav className="game-role-views" aria-label="Vistas de Roles de juego">
      <Button type="button" aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>Matriz</Button>
      <Button type="button" aria-pressed={view === "history"} onClick={() => setView("history")}>Historial</Button>
      {matrix.standings && <Button type="button" aria-pressed={view === "statistics"} onClick={() => setView("statistics")}>Estadísticas</Button>}
    </nav>
    {view === "statistics" && matrix.standings
      ? <GameRoleStatistics rows={matrix.standings} withoutScore={matrix.crosses.filter(cross => cross.played && !matchScore(cross)).length} />
      : view === "history" ? <GameRoleHistory matrix={matrix} onEdit={(home, away, current) => setEditor({ kind: "cross", home, away, current })} /> : <>
    <div className="game-roles-workspace" style={roundColorStyle(selected?.number ?? 1)}>
    <aside className="game-roles-rounds">
      <Card as="section" className="game-role-history">
        <div className="game-role-panel-header">
          <h2>Horarios</h2>
          <Button type="button" onClick={() => setEditor({ kind: "round" })}>Agregar jornada</Button>
        </div>
        {selected ? <>
          <div className="game-roles-hour-fields">
            <Label>Jornada<NativeSelect value={selected.id} onChange={event => setSelectedId(Number(event.target.value))}>
              {matrix.rounds.map(round => <option key={round.id} value={round.id}>Jornada {round.number}</option>)}
            </NativeSelect></Label>
            <Label>Fecha<Input type="date" min={selected.starts_on} max={addDays(selected.starts_on, 6)}
              value={day} onChange={event => setScheduleDay(event.target.value)} /></Label>
          </div>
          <div className="game-role-panel-header">
            <Button type="button" onClick={() => setEditor({ kind: "round", round: selected })}>Editar jornada</Button>
            <Button type="button" className="primary" onClick={() => setShareRoundId(selected.id)}>Generar rol de juego</Button>
          </div>
          <ul className="game-role-slots" aria-label="Horarios de la fecha">{slots.map(slot => {
            const conflicts = matrix.crosses.filter(cross => overlaps(slot, cross));
            return <li key={slot.start}><Button type="button" disabled={!conflicts.length && assignableTeams.length < 2}
              onClick={() => {
                if (!conflicts.length) { setSlotToAssign(slot); return; }
                const [cross] = conflicts;
                const home = teamsById.get(cross.home_team_id), away = teamsById.get(cross.away_team_id);
                if (home && away) openCross(home, away, cross);
              }}>
              <strong>{slot.start}–{slot.end}</strong>
              <span>{conflicts.length ? conflicts.map(cross => `${teamsById.get(cross.home_team_id)?.name} vs. ${teamsById.get(cross.away_team_id)?.name}`).join(" · ") : "Disponible"}</span>
            </Button></li>;
          })}</ul>
        </> : <p>Agrega una jornada para consultar horarios.</p>}
      </Card>
      <GameRoleHistory matrix={matrix} onEdit={openCross} />
    </aside>

    <Card as="section" className="game-roles-matrix" aria-labelledby="game-roles-matrix-title">
      <div className="game-role-panel-header">
        <h2 id="game-roles-matrix-title">Matriz de equipos</h2>
        <Button type="button" disabled={!matrix.matrix_team_ids || !availableTeams.length} onClick={() => setAddingTeam(true)}>Agregar equipo</Button>
      </div>
      <ul className="game-roles-legend" aria-label="Estados del partido">
        <li><b aria-hidden="true">×</b> Sin horario</li>
        <li><b aria-hidden="true">09:00</b> Pendiente</li>
        <li><b className="game-roles-played-key" aria-hidden="true">✓</b> Jugado</li>
        <li><b className="game-roles-round-key" aria-hidden="true">J</b> Color de la jornada</li>
      </ul>
      {selected && <p className="game-roles-selection" role="status"><strong>Jornada {selected.number}</strong> · {crosses} {crosses === 1 ? "cruce" : "cruces"}</p>}
      {!matrixTeams.length ? <p>Agrega los equipos del torneo uno por uno para armar la matriz.</p> :
        <div className="game-roles-grid-scroll" role="region" aria-label="Matriz de cruces por equipo" tabIndex={0}>
          <table className="game-roles-grid" style={{ "--game-role-team-count": matrixTeams.length } as CSSProperties}>
            <colgroup><col className="game-role-row-label" />{matrixTeams.map(team => <col key={team.id} />)}</colgroup>
            <thead><tr><th>Visitante / Local</th>{matrixTeams.map(team => <th key={team.id} scope="col"><span className="game-role-column-name" title={team.name}>{team.name}{!team.is_active && " · Inactivo"}</span></th>)}</tr></thead>
            <tbody>{matrixTeams.map(away => <tr key={away.id}>
              <th scope="row">{away.name}{!away.is_active && <small>Inactivo</small>}</th>
              {matrixTeams.map(home => {
                if (home.id === away.id) return <td key={home.id} className="game-roles-diagonal">—</td>;
                const current = crossByTeams.get(`${home.id}:${away.id}`);
                const round = current && roundById.get(current.round_id);
                const day = current?.scheduled_on ? new Date(current.scheduled_on + "T00:00:00Z") : null;
                const range = `${timeLabel(current?.starts_at)}–${timeLabel(current?.ends_at)}`;
                const score = matchScore(current);
                const status = current?.played ? `Jugado${score ? ", " + score : ""}` : day ? `Pendiente, ${dateLabel.format(day)}, ${range}` : "Sin horario";
                return <td key={home.id}><Button type="button" className="game-roles-cell" disabled={!selected || (!current && (!home.is_active || !away.is_active))}
                  style={round ? roundColorStyle(round.number) : undefined}
                  data-assigned={Boolean(round)}
                  data-highlighted={Boolean(selected && round?.id === selected.id)}
                  data-played={Boolean(current?.played)}
                  aria-label={`${home.name} local, ${away.name} visitante, ${round ? "jornada " + round.number + ", " : ""}${status}`}
                  onClick={() => openCross(home, away, current)}>
                  {round ? <strong>J{round.number}</strong> : <span className="game-roles-unassigned">×</span>}
                  {current?.played ? <small>{score ?? "✓"}</small> : day && <small>{timeLabel(current?.starts_at)}</small>}
                </Button></td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>}
    </Card>
    </div>
    {matrix.team_notes && <GameRoleNotes notes={matrix.team_notes} teams={matrix.teams} rounds={matrix.rounds}
      selectedRound={selected} onSave={saveNote} />}
    </>}
    {addingTeam && <TeamSelection teams={availableTeams} onClose={() => setAddingTeam(false)}
      onSubmit={team => save("PATCH", { add_team_id: team.id })} />}
    {slotToAssign && <TeamSelection teams={assignableTeams} slot={slotToAssign}
      onClose={() => setSlotToAssign(null)} onSubmit={async (home, away) => {
        if (!away) return;
        const current = crossByTeams.get(`${home.id}:${away.id}`);
        if (current?.played) throw new Error("Ese cruce ya se jugó. Selecciona otro encuentro.");
        setEditor({ kind: "cross", home, away, current, slot: slotToAssign });
        setSlotToAssign(null);
      }} />}
    {editor && <MatrixEditor editor={editor} matrix={matrix} selected={selected} onClose={() => setEditor(null)} onSave={save} />}
    {shareRoundId !== null && <GameRoleShare path={`${path}rounds/${shareRoundId}/share/`} token={token} reminderKey={`${tournamentId}/${shareRoundId}`} onClose={() => setShareRoundId(null)} />}
  </>;
}

function GameRoleHistory({ matrix, onEdit }: { matrix: Matrix; onEdit: (home: Team, away: Team, cross: Cross) => void }) {
  const teams = new Map(matrix.teams.map(team => [team.id, team]));
  const matchesByRound = new Map<number, Cross[]>();
  for (const cross of matrix.crosses) {
    const matches = matchesByRound.get(cross.round_id) ?? [];
    matches.push(cross);
    matchesByRound.set(cross.round_id, matches);
  }
  const rounds = matrix.rounds.filter(round => matchesByRound.has(round.id))
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on) || b.number - a.number);
  return <Card as="section" className="game-role-history" aria-labelledby="game-role-history-title">
    <h2 id="game-role-history-title">Historial de partidos</h2>
    {!rounds.length && <p>Los cruces asignados aparecerán aquí agrupados por jornada.</p>}
    {rounds.map((round, index) => {
      const matches = matchesByRound.get(round.id)!.sort((a, b) =>
        (b.scheduled_on ?? "").localeCompare(a.scheduled_on ?? "") || timeLabel(a.starts_at).localeCompare(timeLabel(b.starts_at)));
      return <details key={round.id} className="game-role-history-round" style={roundColorStyle(round.number)} open={index === 0}>
        <summary><strong>Jornada {round.number}</strong><span>{weekLabel(round.starts_on)} · {matches.length} {matches.length === 1 ? "cruce" : "cruces"}</span></summary>
        <ul className="game-role-history-list">{matches.map(cross => {
          const home = teams.get(cross.home_team_id);
          const away = teams.get(cross.away_team_id);
          if (!home || !away) return null;
          const score = matchScore(cross);
          return <li key={`${home.id}:${away.id}`} data-played={cross.played}>
            <div className="game-role-history-match">
              <strong>{home.name} vs. {away.name}</strong>
              <span>{cross.scheduled_on ? `${dateLabel.format(new Date(cross.scheduled_on + "T00:00:00Z"))} · ${timeLabel(cross.starts_at)}–${timeLabel(cross.ends_at)}` : "Sin horario"}</span>
            </div>
            <div className="game-role-history-actions">
              <span className="game-role-history-status">{cross.played ? (score ? `✓ Jugado · ${score}` : "✓ Jugado") : cross.scheduled_on ? "Pendiente" : "× Sin asignar horario"}</span>
              <Button type="button" onClick={() => onEdit(home, away, cross)}>{cross.played && matrix.standings ? (score ? "Editar marcador" : "Capturar marcador") : "Editar partido"}</Button>
            </div>
          </li>;
        })}</ul>
      </details>;
    })}
  </Card>;
}

function TeamSelection({ teams, slot, onClose, onSubmit }: {
  teams: Team[]; slot?: Slot; onClose: () => void; onSubmit: (home: Team, away?: Team) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [homeId, setHomeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <Dialog ref={dialog} className="game-roles-dialog" aria-labelledby="game-role-team-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      const values = new FormData(event.currentTarget);
      const home = teams.find(team => String(team.id) === homeId);
      const away = teams.find(team => String(team.id) === values.get("away"));
      if (!home || (slot && (!away || away.id === home.id))) return;
      setBusy(true); setError("");
      try { await onSubmit(home, away); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
      finally { setBusy(false); }
    }}>
      <h2 id="game-role-team-title">{slot ? `Asignar partido · ${slot.start}–${slot.end}` : "Agregar equipo"}</h2>
      <Label>{slot ? "Equipo local" : "Equipo disponible"}<NativeSelect required value={homeId} onChange={event => setHomeId(event.target.value)}>
        <option value="">Selecciona un equipo</option>
        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </NativeSelect></Label>
      {slot && <Label>Equipo visitante<NativeSelect required name="away">
        <option value="">Selecciona un equipo</option>
        {teams.filter(team => String(team.id) !== homeId).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </NativeSelect></Label>}
      {error && <p role="alert" className="error">{error}</p>}
      <footer><Button type="button" disabled={busy} onClick={onClose}>Cancelar</Button>
        <Button type="submit" className="primary" disabled={busy}>{slot ? "Continuar" : "Agregar equipo"}</Button></footer>
    </form>
  </Dialog>;
}

function MatrixEditor({ editor, matrix, selected, onClose, onSave }: {
  editor: Editor; matrix: Matrix; selected: Round | undefined; onClose: () => void;
  onSave: (method: string, data: object, roundNumber?: number) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const last = matrix.rounds.at(-1);
  const round = editor.kind === "round" ? editor.round : undefined;
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    const form = new FormData(event.currentTarget);
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (editor.kind === "cross") {
        const roundId = form.get("round_id");
        const scheduledOn = form.get("scheduled_on");
        const played = form.has("played");
        const homeGoals = form.get("home_goals");
        const awayGoals = form.get("away_goals");
        if (played && Boolean(homeGoals) !== Boolean(awayGoals)) throw new Error("Captura los goles de ambos equipos.");
        await onSave("PUT", {
          home_team_id: editor.home.id, away_team_id: editor.away.id, round_id: roundId ? Number(roundId) : null,
          schedule: scheduledOn ? { scheduled_on: scheduledOn, starts_at: form.get("starts_at"), ends_at: form.get("ends_at") } : null,
          played,
          ...(played && matrix.standings ? {
            score: homeGoals && awayGoals ? { home_goals: Number(homeGoals), away_goals: Number(awayGoals) } : null,
          } : {}),
        });
      } else {
        const number = Number(form.get("number"));
        await onSave(round ? "PATCH" : "POST", { round_id: round?.id, number, starts_on: form.get("starts_on") }, number);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el cambio.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return <Dialog ref={dialog} className="game-roles-dialog" aria-labelledby="game-roles-dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={submit}>
      <h2 id="game-roles-dialog-title">{editor.kind === "cross" ? "Jornada y horario del partido" : round ? "Editar jornada" : "Agregar jornada"}</h2>
      {editor.kind === "cross" ? <CrossScheduleFields editor={editor} matrix={matrix} selected={selected} /> : <>
        <Label>Número de jornada<Input type="number" name="number" min={1} max={999} required defaultValue={round?.number ?? Math.min(999, (last?.number ?? 0) + 1)} /></Label>
        <Label>Inicio de la semana<Input type="date" name="starts_on" required defaultValue={round?.starts_on ?? (last ? addDays(last.starts_on, 7) : matrix.starts_on ?? "")} /></Label>
        <p>La jornada abarca siete días desde la fecha de inicio.</p>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <footer>
        <Button type="button" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
      </footer>
    </form>
  </Dialog>;
}

function CrossScheduleFields({ editor, matrix, selected }: { editor: CrossEditor; matrix: Matrix; selected?: Round }) {
  const [roundId, setRoundId] = useState((editor.slot ? selected?.id : editor.current?.round_id) ?? selected?.id ?? 0);
  const [day, setDay] = useState(editor.slot?.day ?? editor.current?.scheduled_on ?? "");
  const [start, setStart] = useState(editor.slot?.start ?? timeLabel(editor.current?.starts_at));
  const [end, setEnd] = useState(editor.slot?.end ?? timeLabel(editor.current?.ends_at));
  const [played, setPlayed] = useState(editor.current?.played ?? false);
  const round = matrix.rounds.find(row => row.id === roundId);
  const hasSchedule = Boolean(day || start || end);
  const occupied = matrix.crosses.filter(cross => cross.scheduled_on && cross.scheduled_on === day
    && (cross.home_team_id !== editor.home.id || cross.away_team_id !== editor.away.id))
    .sort((a, b) => timeLabel(a.starts_at).localeCompare(timeLabel(b.starts_at)));
  const overlap = occupied.some(cross => start < timeLabel(cross.ends_at) && end > timeLabel(cross.starts_at));
  const teams = new Map(matrix.teams.map(team => [team.id, team.name]));
  const teamNotes = matrix.team_notes?.filter(row =>
    (row.team_id === editor.home.id || row.team_id === editor.away.id) && (row.kind !== "permit" || row.round_id === roundId)) ?? [];

  return <>
    <p><strong>{editor.home.name}</strong> (local) vs. <strong>{editor.away.name}</strong> (visitante)</p>
    <Label><span id="game-roles-cross-round-label">Jornada</span><NativeSelect aria-labelledby="game-roles-cross-round-label"
      name="round_id" value={roundId || ""} onChange={event => {
        const next = matrix.rounds.find(row => row.id === Number(event.target.value));
        setRoundId(Number(event.target.value));
        if (!next || (day && (day < next.starts_on || day > addDays(next.starts_on, 6)))) {
          setDay(next?.starts_on ?? ""); setStart(""); setEnd("");
        }
      }}>
      <option value="">Sin jornada</option>
      {matrix.rounds.map(row => <option key={row.id} value={row.id}>Jornada {row.number}</option>)}
    </NativeSelect></Label>
    {teamNotes.length > 0 && <div className="game-roles-availability">
      <strong>Permisos y sugerencias de los equipos</strong>
      <ul>{teamNotes.map(row => <li key={row.id}>
        <b>{teams.get(row.team_id)}</b> · {row.kind === "permit" ? `Permiso en la jornada ${round?.number}` : scheduleSuggestion(row)}
        {row.note && <> · {row.note}</>}
      </li>)}</ul>
    </div>}
    {round && <>
      <Label>Fecha del partido<Input type="date" name="scheduled_on" value={day} required={Boolean(start || end)}
        min={round.starts_on} max={addDays(round.starts_on, 6)} onChange={event => {
          const nextDay = event.target.value;
          setDay(nextDay);
          if (!nextDay) { setStart(""); setEnd(""); return; }
          const first = slotsFor(nextDay).find(slot => !matrix.crosses.some(cross =>
            (cross.home_team_id !== editor.home.id || cross.away_team_id !== editor.away.id) && overlaps(slot, cross)));
          if (!start || !end) { setStart(first?.start ?? ""); setEnd(first?.end ?? ""); }
        }} /></Label>
      {day && <Label>Horario disponible<NativeSelect value={start && end ? `${start}–${end}` : ""} onChange={event => {
        const [slotStart, slotEnd] = event.target.value.split("–");
        if (slotStart && slotEnd) { setStart(slotStart); setEnd(slotEnd); }
      }}>
        <option value="">Selecciona un horario</option>
        {slotsFor(day).filter(slot => !occupied.some(cross => overlaps(slot, cross))).map(slot =>
          <option key={slot.start} value={`${slot.start}–${slot.end}`}>{slot.start}–{slot.end}</option>)}
        {start && end && !slotsFor(day).some(slot => slot.start === start && slot.end === end && !occupied.some(cross => overlaps(slot, cross)))
          && <option value={`${start}–${end}`}>{start}–{end}</option>}
      </NativeSelect></Label>}
      <div className="game-roles-hour-fields">
        <Label>Hora de inicio<Input type="time" name="starts_at" value={start} required={hasSchedule} onChange={event => setStart(event.target.value)} /></Label>
        <Label>Hora de fin<Input type="time" name="ends_at" value={end} required={hasSchedule} onChange={event => setEnd(event.target.value)} /></Label>
      </div>
      {day && <div className="game-roles-availability">
        <strong>Horarios ocupados en este torneo</strong>
        {occupied.length ? <ul>{occupied.map(cross => <li key={`${cross.home_team_id}:${cross.away_team_id}`}>
          {timeLabel(cross.starts_at)}–{timeLabel(cross.ends_at)} · {teams.get(cross.home_team_id)} vs. {teams.get(cross.away_team_id)}
        </li>)}</ul> : <p>No hay horarios ocupados para esta fecha.</p>}
        {start && end && <p role="status">{end <= start ? "La hora de fin debe ser posterior a la de inicio." : overlap ? "El rango elegido se cruza con otro partido." : "El rango elegido está disponible."}</p>}
      </div>}
      {hasSchedule && <Button type="button" onClick={() => { setDay(""); setStart(""); setEnd(""); }}>Quitar horario</Button>}
      <Label className="game-roles-played-input"><Input type="checkbox" name="played" checked={played} onChange={event => setPlayed(event.target.checked)} /> Marcar como jugado</Label>
      {matrix.standings && <div hidden={!played}>
        <fieldset className="game-roles-score" disabled={!played}>
          <legend>Marcador</legend>
          <div className="game-roles-hour-fields">
            <Label>Goles local<Input name="home_goals" type="number" min={0} max={999} defaultValue={editor.current?.home_goals ?? ""} /></Label>
            <Label>Goles visitante<Input name="away_goals" type="number" min={0} max={999} defaultValue={editor.current?.away_goals ?? ""} /></Label>
          </div>
        </fieldset>
      </div>}
    </>}
  </>;
}
