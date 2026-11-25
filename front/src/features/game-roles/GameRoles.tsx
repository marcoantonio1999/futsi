import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { BarChart3, CalendarDays, ChevronLeft, Clock, Pencil, Plus } from "lucide-react";
import { apiRequest } from "../../api";
import { Button, Card, Dialog, Input, Label, NativeSelect } from "../../components/ui/enrollment-ui";
import type { Site, StandingRow, Tournament } from "../../types";
import { useEnrollmentScrollReady, useEnrollmentViewState } from "../enrollments/EnrollmentNavigation";
import { GameRoleNotes, scheduleSuggestion, type GameRoleNote } from "./GameRoleNotes";
import { GameRoleScheduleEditor } from "./GameRoleScheduleEditor";
import { GameRoleStatistics } from "./GameRoleStatistics";
import { GameRoleShare } from "./GameRoleShare";
import { RolePageButtons } from "./RolePageButtons";
import { roleReminders } from "./roleReminders";
import { roleSlots, roleTimeLabel, showsKickoffOnly, type RoleSchedule, type WeeklyBlock, type RoleSlot as Slot } from "./roleSchedule";
import "./gameRoles.css";

export type Team = { id: number; name: string; is_active: boolean };
type TeamSelectionInput = { add_team_id: number } | { new_team_name: string } | {
  new_team: { name: string; representative_name: string; representative_phone: string };
};
export type Round = { id: number; number: number; starts_on: string; rest_team_id?: number };
export type Cross = {
  home_team_id: number; away_team_id: number; round_id: number;
  scheduled_on: string | null; starts_at: string | null; ends_at: string | null; played: boolean;
  home_goals?: number | null; away_goals?: number | null;
};
export type Matrix = {
  teams: Team[]; matrix_team_ids?: number[]; rounds: Round[]; crosses: Cross[]; starts_on: string | null;
  schedule_enabled?: boolean; weekly_schedule?: WeeklyBlock[]; team_notes?: GameRoleNote[]; standings?: StandingRow[];
};
type CrossEditor = { kind: "cross"; home: Team; away: Team; current?: Cross; slot?: Slot };
function overlaps(slot: Slot, cross: Cross) {
  return slot.day === cross.scheduled_on && cross.starts_at !== null && cross.ends_at !== null
    && slot.start < cross.ends_at.slice(0, 5) && slot.end > cross.starts_at.slice(0, 5);
}
type Editor = { kind: "round"; round?: Round } | { kind: "rest"; round: Round } | CrossEditor;

const roundColors = [
  "#1246a0", "#6d297a", "#805b00", "#9a3e10", "#8b2445",
  "#485e18", "#184e6c", "#79540e", "#832e75", "#385485",
  "#884724", "#326045", "#932821", "#3b356b", "#6d4c60",
  "#2c514b", "#3f5561", "#563723", "#5d5925", "#4a3f57",
];

export function roundColorStyle(number: number): CSSProperties {
  const hue = (number * 137.508) % 360;
  const color = roundColors[number - 1] ?? `hsl(${hue} 65% 27%)`;
  return { "--game-roles-round-color": color } as CSSProperties;
}

export function addDays(value: string, days: number) {
  const date = new Date(value + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split("T")[0];
}

const dateLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const weekdayLabel = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const timeLabel = (value: string | null | undefined) => value?.slice(0, 5) ?? "";
const matchScore = (cross: Cross | undefined) => cross?.home_goals != null && cross.away_goals != null
  ? `${cross.home_goals}–${cross.away_goals}` : null;
function weekLabel(start: string) {
  return dateLabel.formatRange(new Date(start + "T00:00:00Z"), new Date(addDays(start, 6) + "T00:00:00Z"));
}

export function GameRoles({ token, tournaments, sites, loading, showSchedule, onOpenSchedule, onOpenMatrix, onTeamCreated }: {
  token: string; tournaments: Tournament[]; sites: Pick<Site, "id" | "name">[]; loading: boolean;
  showSchedule: boolean; onOpenSchedule: () => void; onOpenMatrix: () => void; onTeamCreated: () => void;
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
    {tournament && <TournamentMatrix key={tournament.id} token={token} tournament={tournament} showSchedule={showSchedule}
      onOpenSchedule={onOpenSchedule} onOpenMatrix={onOpenMatrix} onTeamCreated={onTeamCreated} />}
  </>;
}

function MatchDateSelect({ days, value, onChange, required }: {
  days: string[]; value: string; onChange: (day: string) => void; required: boolean;
}) {
  return <Label>Fecha del partido
    <NativeSelect aria-label="Fecha del partido" name="scheduled_on" required={required} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Sin fecha</option>
      {days.map(day => <option key={day} value={day}>{weekdayLabel.format(new Date(day + "T00:00:00Z"))}</option>)}
    </NativeSelect>
  </Label>;
}

function TournamentMatrix({ token, tournament, showSchedule, onOpenSchedule, onOpenMatrix, onTeamCreated }: {
  token: string; tournament: Tournament; showSchedule: boolean;
  onOpenSchedule: () => void; onOpenMatrix: () => void; onTeamCreated: () => void;
}) {
  const { id: tournamentId, name: tournamentName } = tournament;
  const path = `/player-enrollments/game-roles/${tournamentId}/`;
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useEnrollmentViewState(`gameRoles.round.${tournamentId}`, 0);
  const [view, setView] = useEnrollmentViewState<"matrix" | "statistics" | "next-role">("gameRoles.view", "matrix");
  const [rowPageIndex, setRowPage] = useState(0);
  const [columnPageIndex, setColumnPage] = useState(0);
  const [gridSize, setGridSize] = useState({ rows: 6, columns: 4 });
  const gridViewport = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [addingTeam, setAddingTeam] = useState<"select" | "quick" | null>(null);
  const [share, setShare] = useState<{ roundId: number; upcomingOnly?: boolean } | null>(null);
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

  useEffect(() => {
    const element = gridViewport.current;
    if (!element) return;
    const resize = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      const styles = getComputedStyle(element);
      const px = (name: string) => Number.parseFloat(styles.getPropertyValue(name));
      const rows = Math.max(1, Math.floor((element.clientHeight - px("--role-grid-heading") - 2) / px("--role-grid-row")));
      const columns = Math.max(1, Math.floor((element.clientWidth - px("--role-grid-label") - 2) / px("--role-grid-column")));
      setGridSize(current => current.rows === rows && current.columns === columns ? current : { rows, columns });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    return () => observer.disconnect();
  }, [matrix, view, showSchedule]);

  if (loadError || (matrix && !matrix.schedule_enabled)) return <Card as="section" className="operator-controls">
    <p className="error" role="alert">{loadError || "La programación de horarios se está actualizando."}</p>
    <Button onClick={() => setReload(value => value + 1)}>Volver a cargar matriz</Button>
  </Card>;
  if (!matrix) return <p role="status">Cargando matriz…</p>;

  const schedule = matrix.weekly_schedule ?? [];
  const selected = matrix.rounds.find(round => round.id === selectedId) ?? matrix.rounds[0];
  const teamsById = new Map(matrix.teams.map(team => [team.id, team]));
  const restingTeam = selected?.rest_team_id ? teamsById.get(selected.rest_team_id) : undefined;
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
  const rowPages = Math.max(1, Math.ceil(matrixTeams.length / gridSize.rows));
  const columnPages = Math.max(1, Math.ceil(matrixTeams.length / gridSize.columns));
  const rowPage = Math.min(rowPageIndex, rowPages - 1);
  const columnPage = Math.min(columnPageIndex, columnPages - 1);
  const visibleRows = matrixTeams.slice(rowPage * gridSize.rows, (rowPage + 1) * gridSize.rows);
  const visibleColumns = matrixTeams.slice(columnPage * gridSize.columns, (columnPage + 1) * gridSize.columns);
  const availableTeams = matrix.teams.filter(team => team.is_active && !matrixTeamIds.has(team.id));
  const openCross = (home: Team, away: Team, current?: Cross) => {
    let slot: Slot | undefined;
    if (!current && selected) {
      const week = Array.from({ length: 7 }, (_, index) => addDays(selected.starts_on, index));
      const scheduledDays = new Set(matrix.crosses.filter(cross => cross.round_id === selected.id).map(cross => cross.scheduled_on));
      const freeSlots = week.flatMap(day => roleSlots(schedule, day).filter(candidate => !matrix.crosses.some(cross => overlaps(candidate, cross))));
      slot = freeSlots.find(candidate => scheduledDays.has(candidate.day)) ?? freeSlots[0];
    }
    setEditor({ kind: "cross", home, away, current, slot });
  };
  const roundById = new Map(matrix.rounds.map(round => [round.id, round]));
  const crossByTeams = new Map(matrix.crosses.map(cross => [`${cross.home_team_id}:${cross.away_team_id}`, cross]));
  async function save(method: string, data: object, roundNumber?: number) {
    const result = await apiRequest<Matrix>(path, token, { method, body: JSON.stringify(data) });
    setMatrix(result);
    if (roundNumber !== undefined) setSelectedId(result.rounds.find(round => round.number === roundNumber)?.id ?? 0);
    setEditor(null);
    setAddingTeam(null);
    return result;
  }

  async function saveNote(payload: object) {
    const result = await apiRequest<{ team_notes: GameRoleNote[] }>(path + "team-notes/", token, {
      method: "POST", body: JSON.stringify(payload),
    });
    setMatrix(current => current && { ...current, team_notes: result.team_notes });
  }

  async function saveSchedule(blocks: WeeklyBlock[]) {
    const result = await apiRequest<Matrix>(path, token, {
      method: "PATCH", body: JSON.stringify({ weekly_schedule: blocks, previous_weekly_schedule: schedule }),
    });
    setMatrix(result);
    return result.weekly_schedule ?? [];
  }

  if (showSchedule) return <>
    <nav className="game-role-views" aria-label="Vistas de Roles de juego">
      <Button type="button" className="game-role-back" onClick={() => { setView("matrix"); onOpenMatrix(); }}>
        <ChevronLeft aria-hidden="true" />Volver a roles de juego
      </Button>
    </nav>
    {matrix.weekly_schedule
      ? <GameRoleScheduleEditor blocks={schedule} kickoffOnly={showsKickoffOnly(tournamentName)} canEdit={tournament.is_active} onSave={saveSchedule} />
      : <Card as="section" className="operator-controls">
        <p role="alert">No se pudieron cargar los horarios del torneo.</p>
        <Button type="button" onClick={() => setReload(value => value + 1)}>Volver a cargar horarios</Button>
      </Card>}
  </>;

  return <>
    <nav className="game-role-views" aria-label="Vistas de Roles de juego">
      {(view === "statistics" || view === "next-role") && <Button type="button" className="game-role-back" onClick={() => setView("matrix")}>
        <ChevronLeft aria-hidden="true" />Volver a roles de juego
      </Button>}
      <div className="game-role-view-options">
        <Button type="button" className="primary" onClick={onOpenSchedule}><Clock aria-hidden="true" />Horarios</Button>
        <Button type="button" className="primary" aria-pressed={view === "statistics"} onClick={() => setView("statistics")}>
          <BarChart3 aria-hidden="true" />Estadísticas
        </Button>
        <Button type="button" className="primary" aria-pressed={view === "next-role"} onClick={() => setView("next-role")}>
          <CalendarDays aria-hidden="true" />Siguiente rol
        </Button>
      </div>
      {roleReminders && <Button type="button" disabled={remindersEnabled} onClick={() => void enableReminders()}>
        {remindersEnabled ? "Notificaciones activas" : "Activar notificaciones"}
      </Button>}
    </nav>
    {reminderMessage && <p role="status">{reminderMessage}</p>}
    {view === "statistics"
      ? <div key="statistics" className="game-role-statistics-panel">
          <GameRoleStatistics rows={(matrix.standings ?? []).filter(row => matrixTeamIds.has(row.team))}
            withoutScore={matrix.crosses.filter(cross => cross.played && !matchScore(cross)).length} />
        </div>
      : view === "next-role"
        ? <NextGameRole matrix={matrix} tournamentName={tournamentName} onShare={roundId => setShare({ roundId, upcomingOnly: true })} />
        : <div className="game-roles-workspace">
    <Card as="section" className="game-roles-matrix" aria-labelledby="game-roles-matrix-title">
      <div className="game-role-panel-header">
        <div className="game-role-matrix-heading">
          <h2 id="game-roles-matrix-title">Matriz de equipos</h2>
          {tournament.is_active && matrix.matrix_team_ids && <Button type="button" className="game-role-quick-team"
            aria-label="Crear equipo por nombre" title="Crear equipo por nombre" onClick={() => setAddingTeam("quick")}>
            <Plus aria-hidden="true" />
          </Button>}
        </div>
        <Button type="button" className="primary" disabled={!matrix.matrix_team_ids || (!tournament.is_active && !availableTeams.length)} onClick={() => setAddingTeam("select")}>Agregar equipo</Button>
      </div>
      <div className="game-role-matrix-controls">
        {selected && <>
          <NativeSelect aria-label="Jornada de la matriz" value={selected.id} onChange={event => setSelectedId(Number(event.target.value))}>
            {matrix.rounds.map(round => <option key={round.id} value={round.id}>Jornada {round.number}</option>)}
          </NativeSelect>
          <Button type="button" className="primary" onClick={() => setEditor({ kind: "round", round: selected })}>Editar jornada</Button>
          <Button type="button" className="primary" onClick={() => setShare({ roundId: selected.id })}>Compartir jornada</Button>
        </>}
        <Button type="button" className="primary" onClick={() => setEditor({ kind: "round" })}>Agregar jornada</Button>
        <Button type="button" className="primary" disabled={!selected} onClick={() => { if (selected) setEditor({ kind: "rest", round: selected }); }}>
          {restingTeam ? "Editar descanso" : "Agregar descanso"}
        </Button>
        {restingTeam && <span><strong>Descanso</strong> · {restingTeam.name}</span>}
      </div>
      {!matrixTeams.length ? <p>Agrega los equipos del torneo uno por uno para armar la matriz.</p> :
        <>
        <div ref={gridViewport} className="game-roles-grid-scroll" role="region" aria-label="Matriz de cruces por equipo">
          <table className="game-roles-grid">
            <colgroup><col className="game-role-row-label" />{visibleColumns.map(team => <col key={team.id} />)}</colgroup>
            <thead><tr><th>Visitante / Local</th>{visibleColumns.map(team => <th key={team.id} scope="col"><span className="game-role-column-name" title={team.name}>{team.name}{!team.is_active && " · Inactivo"}</span></th>)}</tr></thead>
            <tbody>{visibleRows.map(away => <tr key={away.id}>
              <th scope="row"><span className="game-role-row-name" title={away.name}>{away.name}{!away.is_active && " · Inactivo"}</span></th>
              {visibleColumns.map(home => {
                if (home.id === away.id) return <td key={home.id} className="game-roles-diagonal">—</td>;
                const current = crossByTeams.get(`${home.id}:${away.id}`);
                const round = current && roundById.get(current.round_id);
                const day = current?.scheduled_on ? new Date(current.scheduled_on + "T00:00:00Z") : null;
                const range = roleTimeLabel(tournamentName, current?.starts_at, current?.ends_at);
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
                  {current?.played ? <small>{score ?? "✓"}</small> : day && <small>{roleTimeLabel(tournamentName, current?.starts_at)}</small>}
                </Button></td>;
              })}
            </tr>)}</tbody>
          </table>
        </div>
        <div className="game-role-matrix-pages">
          <RolePageButtons page={rowPage} count={rowPages} onChange={setRowPage} label="Visitantes" />
          <RolePageButtons page={columnPage} count={columnPages} onChange={setColumnPage} label="Locales" />
        </div>
      </>}
      {matrix.team_notes && <GameRoleNotes notes={matrix.team_notes} teams={matrix.teams} rounds={matrix.rounds}
        selectedRound={selected} onSave={saveNote} />}
    </Card>
    <GameRoleHistory matrix={matrix} tournamentName={tournamentName} onEdit={openCross} />
    </div>}
    {addingTeam && <TeamSelection teams={availableTeams} canCreate={tournament.is_active} quick={addingTeam === "quick"} onClose={() => setAddingTeam(null)}
      onSubmit={async data => {
        const result = await save("PATCH", data);
        if ("new_team_name" in data) {
          const lastIndex = (result.matrix_team_ids?.length ?? 1) - 1;
          setRowPage(Math.floor(lastIndex / gridSize.rows));
          setColumnPage(Math.floor(lastIndex / gridSize.columns));
        }
        if (!("add_team_id" in data)) onTeamCreated();
      }} />}
    {editor && <MatrixEditor editor={editor} matrix={matrix} tournamentName={tournamentName} schedule={schedule} selected={selected} onClose={() => setEditor(null)} onSave={save} />}
    {share && <GameRoleShare path={`${path}rounds/${share.roundId}/share/`} token={token}
      reminderKey={`${tournamentId}/${share.roundId}`} upcomingOnly={share.upcomingOnly} onClose={() => setShare(null)} />}
  </>;
}

const leagueDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });

function NextGameRole({ matrix, tournamentName, onShare }: { matrix: Matrix; tournamentName: string; onShare: (roundId: number) => void }) {
  const [roundId, setRoundId] = useState(0);
  const teamNames = new Map(matrix.teams.map(team => [team.id, team.name]));
  const today = leagueDay.format(new Date());
  const pending = matrix.crosses
    .filter(cross => !cross.played && cross.scheduled_on && cross.starts_at && cross.ends_at)
    .sort((a, b) => a.scheduled_on!.localeCompare(b.scheduled_on!) || timeLabel(a.starts_at).localeCompare(timeLabel(b.starts_at)));
  const rounds = matrix.rounds.slice().sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.number - b.number);
  const nextRoundId = pending.find(cross => cross.scheduled_on! >= today)?.round_id ?? pending.at(-1)?.round_id;
  const round = rounds.find(row => row.id === roundId) ?? rounds.find(row => row.id === nextRoundId) ?? rounds.at(-1);
  const matches = pending.filter(cross => cross.round_id === round?.id);
  const restTeam = round?.rest_team_id ? teamNames.get(round.rest_team_id) : undefined;

  return <Card as="section" className="game-role-history game-role-next" aria-labelledby="game-role-next-title">
      <div className="game-role-panel-header">
        <h2 id="game-role-next-title">Próximos partidos</h2>
        {round && <Label>Jornada<NativeSelect aria-label="Jornada del rol" value={round.id} onChange={event => setRoundId(Number(event.target.value))}>
          {rounds.map(row => <option key={row.id} value={row.id}>Jornada {row.number} · {weekLabel(row.starts_on)}</option>)}
        </NativeSelect></Label>}
      </div>
      <table className="game-role-stat-table">
        <thead><tr><th scope="col">Fecha</th><th scope="col">Horario</th><th scope="col">Local</th><th scope="col">Visitante</th></tr></thead>
        <tbody>{matches.map(cross => <tr key={`${cross.home_team_id}:${cross.away_team_id}`}>
          <td>{weekdayLabel.format(new Date(cross.scheduled_on + "T00:00:00Z"))}</td>
          <td>{roleTimeLabel(tournamentName, cross.starts_at, cross.ends_at)}</td>
          <td>{teamNames.get(cross.home_team_id)}</td>
          <td>{teamNames.get(cross.away_team_id)}</td>
        </tr>)}
          {!matches.length && <tr><td colSpan={4}>{round ? "Aún no hay próximos partidos en esta jornada." : "Agrega una jornada para programar partidos."}</td></tr>}
        </tbody>
      </table>
      {restTeam && <p><strong>Descanso</strong> · {restTeam}</p>}
      {round && <footer><Button type="button" className="primary" disabled={!matches.length && !restTeam} onClick={() => onShare(round.id)}>Compartir rol de juego</Button></footer>}
  </Card>;
}

function GameRoleHistory({ matrix, tournamentName, onEdit }: { matrix: Matrix; tournamentName: string; onEdit: (home: Team, away: Team, cross: Cross) => void }) {
  const teams = new Map(matrix.teams.map(team => [team.id, team]));
  const matchesByRound = new Map<number, Cross[]>();
  for (const cross of matrix.crosses) {
    if (!cross.played && !cross.scheduled_on) continue;
    const matches = matchesByRound.get(cross.round_id) ?? [];
    matches.push(cross);
    matchesByRound.set(cross.round_id, matches);
  }
  const rounds = matrix.rounds.filter(round => matchesByRound.has(round.id))
    .sort((a, b) => b.starts_on.localeCompare(a.starts_on) || b.number - a.number);
  const [roundId, setRoundId] = useState(0);
  const selectedRound = rounds.find(round => round.id === roundId);
  const matches = (selectedRound ? [selectedRound] : rounds).flatMap(round =>
    (matchesByRound.get(round.id) ?? []).sort((a, b) =>
      (b.scheduled_on ?? "").localeCompare(a.scheduled_on ?? "") || timeLabel(b.starts_at).localeCompare(timeLabel(a.starts_at)))
      .map(cross => ({ round, cross })));
  const columns = [
    { title: "Jugados", matches: matches.filter(({ cross }) => cross.played), empty: "Aún no hay partidos jugados." },
    { title: "Programados", matches: matches.filter(({ cross }) => !cross.played), empty: "Aún no hay partidos programados." },
  ];
  return <Card as="section" className="game-role-history game-role-match-history" aria-label="Historial de partidos">
    <div className="game-role-panel-header">
      <h2>Historial de partidos</h2>
      {rounds.length > 1 && <NativeSelect aria-label="Jornada del historial" title={selectedRound && weekLabel(selectedRound.starts_on)}
        value={selectedRound?.id ?? 0} onChange={event => setRoundId(Number(event.target.value))}>
        <option value={0}>Todas las jornadas</option>
        {rounds.map(row => <option key={row.id} value={row.id}>Jornada {row.number}</option>)}
      </NativeSelect>}
    </div>
    <div className="game-role-history-columns">
      {columns.map(column => <section key={column.title} className="game-role-history-column" aria-label={column.title}>
        <h3>{column.title}</h3>
        {column.matches.length ? <ul key={selectedRound?.id ?? 0} className="game-role-history-list" aria-label={column.title} tabIndex={0}>
          {column.matches.map(({ round, cross }) => {
            const home = teams.get(cross.home_team_id), away = teams.get(cross.away_team_id);
            if (!home || !away) return null;
            const score = matchScore(cross);
            const teamsLabel = `${home.name} vs. ${away.name}`;
            const action = cross.played && matrix.standings ? (score ? "Editar marcador" : "Capturar marcador") : "Editar partido";
            const date = cross.scheduled_on ? weekdayLabel.format(new Date(cross.scheduled_on + "T00:00:00Z")) : "Sin horario";
            return <li key={`${round.id}:${cross.home_team_id}:${cross.away_team_id}`} style={roundColorStyle(round.number)}>
              <Button type="button" className="game-role-history-row" onClick={() => onEdit(home, away, cross)}
                aria-label={`${action}: ${teamsLabel}, jornada ${round.number}, ${date}`}
                title={`${teamsLabel} · ${action}`}>
                <strong>{teamsLabel}</strong>
                <span className="game-role-history-meta">
                  <span className="game-role-history-round">J{round.number}</span>
                  {cross.scheduled_on ? <time dateTime={cross.scheduled_on}>{date}</time> : <span>{date}</span>}
                  {cross.scheduled_on && <span>{roleTimeLabel(tournamentName, cross.starts_at, cross.ends_at)}</span>}
                  {score && <span aria-label={`Marcador ${score}`}>{score}</span>}
                </span>
                <Pencil aria-hidden="true" />
              </Button>
            </li>;
          })}
        </ul> : <p>{column.empty}</p>}
      </section>)}
    </div>
  </Card>;
}

function TeamSelection({ teams, canCreate, quick, onClose, onSubmit }: {
  teams: Team[]; canCreate: boolean; quick: boolean; onClose: () => void; onSubmit: (data: TeamSelectionInput) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selection, setSelection] = useState("");
  const [creating, setCreating] = useState(quick);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <Dialog ref={dialog} className="game-roles-dialog" aria-labelledby="game-role-team-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={async event => {
      event.preventDefault();
      if (busy || (!creating && !selection)) return;
      const form = new FormData(event.currentTarget);
      const value = (field: string) => String(form.get(field) ?? "").trim();
      const name = value("name");
      if (creating && !name) {
        setError("Ingresa el nombre del equipo.");
        return;
      }
      const data: TeamSelectionInput = quick ? { new_team_name: name } : creating ? {
        new_team: { name, representative_name: value("representative_name"), representative_phone: value("representative_phone") },
      } : { add_team_id: Number(selection) };
      setBusy(true); setError("");
      try { await onSubmit(data); }
      catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
      finally { setBusy(false); }
    }}>
      <h2 id="game-role-team-title">{quick ? "Crear equipo" : "Agregar equipo"}</h2>
      {!creating && teams.length > 0 && <Label>Equipo<NativeSelect aria-label="Equipo" required disabled={busy} value={selection} onChange={event => { setSelection(event.target.value); setError(""); }}>
        <option value="">Selecciona un equipo</option>
        {teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </NativeSelect></Label>}
      {creating && <Label>Nombre del equipo<Input name="name" maxLength={140} required readOnly={busy} autoFocus={quick} /></Label>}
      {creating && !quick && <>
        <Label>Delegado<Input name="representative_name" maxLength={160} required readOnly={busy} /></Label>
        <Label>Teléfono del delegado (opcional)<Input name="representative_phone" type="tel" maxLength={30} readOnly={busy} /></Label>
      </>}
      {error && <p role="alert" className="error">{error}</p>}
      <footer><Button type="button" disabled={busy} onClick={onClose}>Cancelar</Button>
        {canCreate && !creating && <Button type="button" className={teams.length ? undefined : "primary"}
          onClick={() => { setCreating(true); setError(""); }}>Crear equipo nuevo</Button>}
        {creating && !quick && teams.length > 0 && <Button type="button" disabled={busy}
          onClick={() => { setCreating(false); setError(""); }}>Elegir equipo existente</Button>}
        {creating || teams.length > 0 ? <Button type="submit" className="primary"
          disabled={busy || (!creating && !selection)}>{creating ? "Crear y agregar" : "Agregar equipo"}</Button> : null}</footer>
    </form>
  </Dialog>;
}

export function MatrixEditor({ editor, matrix, tournamentName, schedule, selected, initialRoundDate, onClose, onSave }: {
  editor: Editor; matrix: Matrix; tournamentName: string; schedule: RoleSchedule; selected: Round | undefined; onClose: () => void;
  initialRoundDate?: string;
  onSave: (method: string, data: object, roundNumber?: number) => Promise<Matrix>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
        if (confirmingDelete && editor.current) {
          await onSave("PUT", { home_team_id: editor.home.id, away_team_id: editor.away.id, round_id: null });
          return;
        }
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
      } else if (editor.kind === "rest") {
        const teamId = form.get("rest_team");
        await onSave("PATCH", { round_id: editor.round.id, rest_team_id: teamId ? Number(teamId) : null });
      } else {
        const number = Number(form.get("number"));
        await onSave(round ? "PATCH" : "POST", { round_id: round?.id, number, starts_on: form.get("starts_on") }, number);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : confirmingDelete ? "No se pudo eliminar el partido." : "No se pudo guardar el cambio.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  function cancelDelete() {
    setConfirmingDelete(false);
    setError("");
  }

  return <Dialog ref={dialog} className="game-roles-dialog" aria-labelledby="game-roles-dialog-title"
    onCancel={event => {
      event.preventDefault();
      if (!busy) {
        if (confirmingDelete) cancelDelete();
        else onClose();
      }
    }}>
    <h2 id="game-roles-dialog-title">{confirmingDelete ? "Eliminar partido" : editor.kind === "cross" ? "Jornada y horario del partido" : editor.kind === "rest" ? `Descanso · Jornada ${editor.round.number}` : round ? "Editar jornada" : "Agregar jornada"}</h2>
    <form hidden={confirmingDelete} onSubmit={submit}>
      {editor.kind === "cross" ? <CrossScheduleFields editor={editor} matrix={matrix} tournamentName={tournamentName} schedule={schedule} selected={selected} />
        : editor.kind === "rest" ? <Label>Equipo que descansa
          <NativeSelect aria-label="Equipo que descansa" name="rest_team" defaultValue={editor.round.rest_team_id ?? ""}>
            <option value="">Sin descanso</option>
            {matrix.teams.filter(team => team.is_active || team.id === editor.round.rest_team_id).map(team =>
              <option key={team.id} value={team.id}>{team.name}</option>)}
          </NativeSelect>
        </Label> : <>
        <Label>Número de jornada<Input type="number" name="number" min={1} max={999} required defaultValue={round?.number ?? Math.min(999, (last?.number ?? 0) + 1)} /></Label>
        <Label>Inicio de la semana<Input type="date" name="starts_on" required defaultValue={round?.starts_on ?? initialRoundDate ?? (last ? addDays(last.starts_on, 7) : matrix.starts_on ?? "")} /></Label>
        <p>La jornada abarca siete días desde la fecha de inicio.</p>
      </>}
      {error && <p className="error" role="alert">{error}</p>}
      <footer>
        {editor.kind === "cross" && editor.current && <Button type="button" className="destructive" disabled={busy}
          onClick={() => { setConfirmingDelete(true); setError(""); }}>Eliminar partido</Button>}
        <Button type="button" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button type="submit" className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
      </footer>
    </form>
    {confirmingDelete && editor.kind === "cross" && <form onSubmit={submit}>
      <p>¿Quieres eliminar el partido <strong>{editor.home.name} vs. {editor.away.name}</strong>?</p>
      <p>Se borrarán su horario y su marcador, si ya se capturaron.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <footer>
        <Button type="button" autoFocus disabled={busy} onClick={cancelDelete}>Volver</Button>
        <Button type="submit" className="destructive" disabled={busy}>{busy ? "Eliminando…" : "Confirmar eliminación"}</Button>
      </footer>
    </form>}
  </Dialog>;
}

function CrossScheduleFields({ editor, matrix, tournamentName, schedule, selected }: { editor: CrossEditor; matrix: Matrix; tournamentName: string; schedule: RoleSchedule; selected?: Round }) {
  const [roundId, setRoundId] = useState((editor.slot ? selected?.id : editor.current?.round_id) ?? selected?.id ?? 0);
  const [day, setDay] = useState(editor.slot?.day ?? editor.current?.scheduled_on ?? "");
  const [start, setStart] = useState(editor.slot?.start ?? timeLabel(editor.current?.starts_at));
  const [end, setEnd] = useState(editor.slot?.end ?? timeLabel(editor.current?.ends_at));
  const [played, setPlayed] = useState(editor.current?.played ?? false);
  const round = matrix.rounds.find(row => row.id === roundId);
  const hasSchedule = Boolean(day || start || end);
  const usesPresets = schedule.length > 0 || showsKickoffOnly(tournamentName);
  const occupied = matrix.crosses.filter(cross => cross.scheduled_on
    && (cross.home_team_id !== editor.home.id || cross.away_team_id !== editor.away.id));
  const freeSlots = (date: string) => roleSlots(schedule, date).filter(slot => !occupied.some(cross => overlaps(slot, cross)));
  const availableSlots = freeSlots(day);
  const daysInWeek = (week: Round) => Array.from({ length: 7 }, (_, index) => addDays(week.starts_on, index));
  const gameDays = round ? daysInWeek(round).filter(date =>
    !usesPresets || (date === day && start && end) || freeSlots(date).length > 0) : [];
  const overlap = occupied.some(cross => overlaps({ day, start, end }, cross));
  function changeDay(nextDay: string) {
    setDay(nextDay);
    if (!usesPresets && nextDay) return;
    const slots = freeSlots(nextDay);
    const slot = slots.find(row => row.start === start && row.end === end) ?? slots[0];
    setStart(slot?.start ?? "");
    setEnd(slot?.end ?? "");
  }
  const teams = new Map(matrix.teams.map(team => [team.id, team.name]));
  const teamNotes = matrix.team_notes?.filter(row =>
    (row.team_id === editor.home.id || row.team_id === editor.away.id) && (row.kind !== "permit" || row.round_id === roundId)) ?? [];

  return <>
    <p><strong>{editor.home.name}</strong> (local) vs. <strong>{editor.away.name}</strong> (visitante)</p>
    <Label><span id="game-roles-cross-round-label">Jornada</span><NativeSelect aria-labelledby="game-roles-cross-round-label"
      name="round_id" value={roundId || ""} onChange={event => {
        const next = matrix.rounds.find(row => row.id === Number(event.target.value));
        setRoundId(Number(event.target.value));
        if (!next || !daysInWeek(next).includes(day)) {
          const first = next && daysInWeek(next).find(date => freeSlots(date).length);
          changeDay(first ?? "");
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
      <MatchDateSelect days={gameDays} value={day} onChange={changeDay} required={Boolean(start || end)} />
      {usesPresets && !gameDays.length && <p>No hay horarios disponibles para esta jornada.</p>}
      {usesPresets ? <>
        {day && <Label>Horario disponible<NativeSelect aria-label="Horario disponible" required value={start && end ? `${start}–${end}` : ""} onChange={event => {
          const [slotStart, slotEnd] = event.target.value.split("–");
          setStart(slotStart);
          setEnd(slotEnd);
        }}>
          <option value="" disabled>Selecciona un horario</option>
          {availableSlots.map(slot =>
            <option key={slot.start} value={`${slot.start}–${slot.end}`}>{roleTimeLabel(tournamentName, slot.start, slot.end)}</option>)}
          {start && end && !availableSlots.some(slot => slot.start === start && slot.end === end)
            && <option value={`${start}–${end}`}>{roleTimeLabel(tournamentName, start, end)}</option>}
        </NativeSelect></Label>}
        <input type="hidden" name="starts_at" value={start} />
        <input type="hidden" name="ends_at" value={end} />
      </> : <div className="game-roles-hour-fields">
        <Label>Hora de inicio<Input type="time" name="starts_at" value={start} required={hasSchedule} onChange={event => setStart(event.target.value)} /></Label>
        <Label>Hora de fin<Input type="time" name="ends_at" value={end} required={hasSchedule} onChange={event => setEnd(event.target.value)} /></Label>
      </div>}
      {day && start && end && (end <= start || overlap) && <p role="status">
        {end <= start ? "La hora de fin debe ser posterior a la de inicio." : "El rango elegido se cruza con otro partido."}
      </p>}
      {hasSchedule && <Button type="button" onClick={() => { setDay(""); setStart(""); setEnd(""); }}>Quitar horario</Button>}
      <Label className="game-roles-played-input"><Input type="checkbox" name="played" checked={played} onChange={event => setPlayed(event.target.checked)} /> Marcar como jugado</Label>
      {matrix.standings && <div hidden={!played}>
        <fieldset className="game-roles-score" disabled={!played}>
          <legend>Marcador</legend>
          <div className="game-roles-hour-fields game-roles-score-fields">
            <Label>Goles local <strong>{editor.home.name}</strong>
              <Input name="home_goals" type="number" min={0} max={999} defaultValue={editor.current?.home_goals ?? ""} />
            </Label>
            <Label>Goles visitante <strong>{editor.away.name}</strong>
              <Input name="away_goals" type="number" min={0} max={999} defaultValue={editor.current?.away_goals ?? ""} />
            </Label>
          </div>
        </fieldset>
      </div>}
    </>}
  </>;
}
