import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { apiRequest } from "../../api";
import { Button, Card, Dialog, Input, Label, NativeSelect } from "../../components/ui/enrollment-ui";
import type { Site, StandingRow, Tournament } from "../../types";
import { useEnrollmentScrollReady, useEnrollmentViewState } from "../enrollments/EnrollmentNavigation";
import { GameRoleNotes, scheduleSuggestion, type GameRoleNote } from "./GameRoleNotes";
import { GameRoleStatistics } from "./GameRoleStatistics";
import "./gameRoles.css";

type Team = { id: number; name: string; is_active: boolean };
type Round = { id: number; number: number; starts_on: string };
type Cross = {
  home_team_id: number; away_team_id: number; round_id: number;
  scheduled_on: string | null; starts_at: string | null; ends_at: string | null; played: boolean;
  home_goals?: number | null; away_goals?: number | null;
};
type Matrix = {
  teams: Team[]; rounds: Round[]; crosses: Cross[]; starts_on: string | null;
  schedule_enabled?: boolean; team_notes?: GameRoleNote[]; standings?: StandingRow[];
};
type CrossEditor = { kind: "cross"; home: Team; away: Team; current?: Cross };
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
const shortDate = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
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
    {tournament && <TournamentMatrix key={tournament.id} token={token} tournamentId={tournament.id} />}
  </>;
}

function TournamentMatrix({ token, tournamentId }: { token: string; tournamentId: number }) {
  const path = `/player-enrollments/game-roles/${tournamentId}/`;
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useEnrollmentViewState(`gameRoles.round.${tournamentId}`, 0);
  const [view, setView] = useEnrollmentViewState<"matrix" | "history" | "statistics">("gameRoles.view", "matrix");
  const [editor, setEditor] = useState<Editor | null>(null);
  useEnrollmentScrollReady(Boolean(matrix));

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
  }

  async function saveNote(payload: object) {
    const result = await apiRequest<{ team_notes: GameRoleNote[] }>(path + "team-notes/", token, {
      method: "POST", body: JSON.stringify(payload),
    });
    setMatrix(current => current && { ...current, team_notes: result.team_notes });
  }

  return <>
    <nav className="game-role-views" aria-label="Vistas de Roles de juego">
      <Button type="button" aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>Matriz</Button>
      <Button type="button" aria-pressed={view === "history"} onClick={() => setView("history")}>Historial</Button>
      {matrix.standings && <Button type="button" aria-pressed={view === "statistics"} onClick={() => setView("statistics")}>Estadísticas</Button>}
      {view === "matrix" && matrix.team_notes && <>
        <Button type="button" onClick={() => document.getElementById("game-role-notes-permit")?.scrollIntoView()}>Permisos</Button>
        <Button type="button" onClick={() => document.getElementById("game-role-notes-preferred")?.scrollIntoView()}>Sugerencias de horario</Button>
      </>}
    </nav>
    {view === "statistics" && matrix.standings
      ? <GameRoleStatistics rows={matrix.standings} withoutScore={matrix.crosses.filter(cross => cross.played && !matchScore(cross)).length} />
      : view === "history" ? <GameRoleHistory matrix={matrix} onEdit={(home, away, current) => setEditor({ kind: "cross", home, away, current })} /> : <>
    <div className="game-roles-workspace" style={roundColorStyle(selected?.number ?? 1)}>
    <Card as="aside" className="game-roles-rounds" aria-labelledby="game-roles-rounds-title">
      <h2 id="game-roles-rounds-title">Jornadas</h2>
      <Button type="button" className="primary" onClick={() => setEditor({ kind: "round" })}>Agregar jornada</Button>
      {selected ? <>
        <Label className="game-roles-round-select"><span id="game-roles-visible-round-label">Jornada visible</span>
          <NativeSelect aria-labelledby="game-roles-visible-round-label" value={selected.id} onChange={event => setSelectedId(Number(event.target.value))}>
            {matrix.rounds.map(round => <option key={round.id} value={round.id}>Jornada {round.number}</option>)}
          </NativeSelect>
        </Label>
        <div className="game-roles-round-list">
          {matrix.rounds.map(round => <Button key={round.id} type="button" style={roundColorStyle(round.number)}
            aria-pressed={round.id === selected.id} onClick={() => setSelectedId(round.id)}>
            <strong>Jornada {round.number}</strong><span>{weekLabel(round.starts_on)}</span>
          </Button>)}
        </div>
        <p className="game-roles-mobile-week">{weekLabel(selected.starts_on)}</p>
        <Button type="button" onClick={() => setEditor({ kind: "round", round: selected })}>Editar jornada {selected.number}</Button>
      </> : <p>Agrega la primera jornada para asignar cruces.</p>}
    </Card>

    <Card as="section" className="game-roles-matrix" aria-labelledby="game-roles-matrix-title">
      <h2 id="game-roles-matrix-title">Matriz de equipos</h2>
      <p>Los locales están en las columnas y los visitantes en las filas. Selecciona un cruce para editar su jornada y horario.</p>
      <ul className="game-roles-legend" aria-label="Estados del partido">
        <li><b aria-hidden="true">×</b> Sin horario</li>
        <li><b aria-hidden="true">09:00</b> Pendiente</li>
        <li><b className="game-roles-played-key" aria-hidden="true">✓</b> Jugado</li>
        <li><b className="game-roles-round-key" aria-hidden="true">J</b> Color de la jornada</li>
      </ul>
      {selected && <p className="game-roles-selection" role="status"><strong>Jornada {selected.number}</strong> · {crosses} {crosses === 1 ? "cruce" : "cruces"}</p>}
      {matrix.teams.length < 2 ? <p>El torneo necesita al menos dos equipos para asignar cruces.</p> :
        <div className="game-roles-grid-scroll" role="region" aria-label="Matriz de cruces por equipo" tabIndex={0}>
          <table className="game-roles-grid">
            <thead><tr><th>Visitante / Local</th>{matrix.teams.map(team => <th key={team.id} scope="col">{team.name}{!team.is_active && <small>Inactivo</small>}</th>)}</tr></thead>
            <tbody>{matrix.teams.map(away => <tr key={away.id}>
              <th scope="row">{away.name}{!away.is_active && <small>Inactivo</small>}</th>
              {matrix.teams.map(home => {
                if (home.id === away.id) return <td key={home.id} className="game-roles-diagonal">—</td>;
                const current = crossByTeams.get(`${home.id}:${away.id}`);
                const round = current && roundById.get(current.round_id);
                const day = current?.scheduled_on ? new Date(current.scheduled_on + "T00:00:00Z") : null;
                const range = `${timeLabel(current?.starts_at)}–${timeLabel(current?.ends_at)}`;
                const score = matchScore(current);
                const status = current?.played ? `Jugado${score ? ", " + score : ""}` : day ? `Pendiente, ${dateLabel.format(day)}, ${range}` : "Sin horario";
                return <td key={home.id}><Button type="button" className="game-roles-cell" disabled={!selected}
                  style={round ? roundColorStyle(round.number) : undefined}
                  data-assigned={Boolean(round)}
                  data-highlighted={Boolean(selected && round?.id === selected.id)}
                  data-played={Boolean(current?.played)}
                  aria-label={`${home.name} local, ${away.name} visitante, ${round ? "jornada " + round.number + ", " : ""}${status}`}
                  onClick={() => setEditor({ kind: "cross", home, away, current })}>
                  {round && (current?.played
                    ? <strong>Jornada {round.number}</strong>
                    : <small>J{round.number}</small>)}
                  {current?.played ? <span>{score ? `✓ ${score}` : "✓ Jugado"}</span> : day ? <>
                    <span>{shortDate.format(day)}</span><span className="game-roles-time">{range}</span>
                  </> : <span className="game-roles-unassigned">×</span>}
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
    {editor && <MatrixEditor editor={editor} matrix={matrix} selected={selected} onClose={() => setEditor(null)} onSave={save} />}
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
            <strong>{home.name} vs. {away.name}</strong>
            <span>{cross.scheduled_on ? `${dateLabel.format(new Date(cross.scheduled_on + "T00:00:00Z"))} · ${timeLabel(cross.starts_at)}–${timeLabel(cross.ends_at)}` : "Sin horario"}</span>
            <span className="game-role-history-status">{cross.played ? (score ? `✓ Jugado · ${score}` : "✓ Jugado") : cross.scheduled_on ? "Pendiente" : "× Sin asignar horario"}</span>
            {cross.played && matrix.standings && <Button type="button" onClick={() => onEdit(home, away, cross)}>{score ? "Editar marcador" : "Capturar marcador"}</Button>}
          </li>;
        })}</ul>
      </details>;
    })}
  </Card>;
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
  const [roundId, setRoundId] = useState(editor.current?.round_id ?? selected?.id ?? 0);
  const [day, setDay] = useState(editor.current?.scheduled_on ?? "");
  const [start, setStart] = useState(timeLabel(editor.current?.starts_at));
  const [end, setEnd] = useState(timeLabel(editor.current?.ends_at));
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
      name="round_id" value={roundId || ""} onChange={event => setRoundId(Number(event.target.value))}>
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
        min={round.starts_on} max={addDays(round.starts_on, 6)} onChange={event => setDay(event.target.value)} /></Label>
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
