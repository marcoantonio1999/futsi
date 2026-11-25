import { useEffect, useState, type DragEvent } from "react";
import { ArrowLeft, ArrowRight, GripVertical, Plus, Shuffle, X } from "lucide-react";
import { apiRequest } from "../../api";
import { Button, Card, Label, NativeSelect } from "../../components/ui/enrollment-ui";
import type { Site, Tournament } from "../../types";
import { useEnrollmentViewState } from "../enrollments/EnrollmentNavigation";
import { TournamentDialog } from "../tournaments/TournamentDialog";
import { addDays, MatrixEditor, roundColorStyle, type Cross, type Matrix, type Round } from "./GameRoles";
import { makePlannerMatch, plannerOverlap, plannerPair, playedCounts, suggestPlannerMatches, type PlannerMatch } from "./plannerSchedule";
import { roleSlots, roleTimeLabel, type RoleSlot } from "./roleSchedule";
import "./gameRolePlanner.css";

type BoardSlot = RoleSlot & { tournament: Tournament; round?: Round; match?: Cross; occupied: boolean };
type PickedTeam = { id: number; tournament: number; name: string };
const francoSite = 27;
const dayLabel = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const weekLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const mexicoDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });
const matrixPath = (id: number) => `/player-enrollments/game-roles/${id}/`;
const during = (day: string, round: Round) => round.starts_on <= day && day <= addDays(round.starts_on, 6);
const utc = (day: string) => new Date(day + "T00:00:00Z");
function mondayOf(day: string, fromRound = false) {
  const weekday = utc(day).getUTCDay();
  const offset = (weekday + 6) % 7;
  return addDays(day, fromRound && offset > 4 ? 7 - offset : -offset);
}
const keyOf = (id: number, day: string, start: string) => `${id}/${day}/${start}`;
const slotKey = (slot: BoardSlot) => keyOf(slot.tournament.id, slot.day, slot.start);
const displayName = (matrix: Matrix | undefined, id: number) => matrix?.teams.find(team => team.id === id)?.name ?? "Equipo";

function calendarSlots(tournaments: Tournament[], data: Record<number, Matrix>, days: string[], preferredId: number, preferred?: Round) {
  const bySite = new Map<number, Cross[]>();
  for (const tournament of tournaments) {
    const matches = data[tournament.id]?.crosses ?? [];
    bySite.set(tournament.site, [...(bySite.get(tournament.site) ?? []), ...matches]);
  }
  return days.map(day => tournaments.flatMap(tournament => {
    const matrix = data[tournament.id];
    if (!matrix) return [];
    const round = tournament.id === preferredId && preferred && during(day, preferred) ? preferred
      : matrix.rounds.find(item => during(day, item));
    const existing = matrix.crosses.filter(match => match.scheduled_on === day && match.starts_at && match.ends_at);
    const occupied = tournament.site === francoSite ? bySite.get(tournament.site) ?? [] : existing;
    const slots: BoardSlot[] = roleSlots(matrix.weekly_schedule ?? [], day).map(slot => {
      const match = existing.find(item => item.starts_at?.slice(0, 5) === slot.start && item.ends_at?.slice(0, 5) === slot.end);
      return { ...slot, tournament, round, match, occupied: occupied.some(item => plannerOverlap(slot, item)) };
    });
    for (const match of existing) {
      if (slots.some(slot => slot.match === match)) continue;
      slots.push({ day, start: match.starts_at!.slice(0, 5), end: match.ends_at!.slice(0, 5), tournament, round, match, occupied: true });
    }
    return slots;
  }).sort((a, b) => a.start.localeCompare(b.start) || a.tournament.name.localeCompare(b.tournament.name)));
}

export function GameRolePlanner({ token, tournaments, sites, onOpenMatrix }: {
  token: string; tournaments: Tournament[]; sites: Pick<Site, "id" | "name">[]; onOpenMatrix: () => void;
}) {
  const [data, setData] = useState<Record<number, Matrix>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [tournamentId, setTournamentId] = useEnrollmentViewState("gameRoles.tournament", "");
  const [addingRound, setAddingRound] = useState(false);
  const [removingMatch, setRemovingMatch] = useState<{ tournament: Tournament; match: Cross } | null>(null);
  const [week, setWeek] = useState("");
  const [picked, setPicked] = useState<PickedTeam | null>(null);
  const [staged, setStaged] = useState<Record<string, PickedTeam>>({});
  const [suggestions, setSuggestions] = useState<PlannerMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.allSettled(tournaments.filter(item => item.is_active).map(async tournament =>
      [tournament.id, await apiRequest<Matrix>(matrixPath(tournament.id), token, { signal: controller.signal })] as const
    )).then(results => {
      if (controller.signal.aborted) return;
      setData(Object.fromEntries(results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])));
      setFailed(results.some(result => result.status === "rejected"));
      setLoading(false);
    });
    return () => controller.abort();
  }, [token, tournaments, revision]);

  const active = tournaments.filter(tournament => tournament.is_active);
  const tournament = active.find(row => String(row.id) === tournamentId) ?? active.find(row => data[row.id]?.rounds.length) ?? active[0];
  const [roundId, setRoundId] = useEnrollmentViewState(`gameRoles.round.${tournament?.id ?? 0}`, 0);
  const matrix = tournament && data[tournament.id];
  const today = mexicoDate.format(new Date());
  const rounds = matrix?.rounds ?? [];
  const round = rounds.find(row => row.id === roundId) ?? rounds.find(row => addDays(row.starts_on, 6) >= today) ?? rounds.at(-1);
  const monday = week || (round ? mondayOf(round.starts_on, true) : mondayOf(today));
  const days = Array.from({ length: 5 }, (_, index) => addDays(monday, index));
  const calendar = calendarSlots(active, data, days, tournament?.id ?? 0, round);
  const suggestedBySlot = new Map(suggestions.map(match => [keyOf(tournament.id, match.schedule.scheduled_on, match.schedule.starts_at), match]));
  const counts = playedCounts(matrix?.crosses ?? []);

  function resetDraft() {
    setPicked(null); setStaged({}); setSuggestions([]); setError(""); setMessage("");
  }

  async function addRound(method: string, payload: object, number?: number) {
    const result = await apiRequest<Matrix>(matrixPath(tournament.id), token, { method, body: JSON.stringify(payload) });
    const created = result.rounds.find(item => item.number === number);
    setData(current => ({ ...current, [tournament.id]: result }));
    setAddingRound(false);
    resetDraft();
    if (created) {
      setRoundId(created.id);
      setWeek("");
      setMessage(`Jornada ${created.number} lista para programar.`);
    }
    return result;
  }

  async function save(id: number, matches: PlannerMatch[]) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<Matrix>(matrixPath(id), token, { method: "PATCH", body: JSON.stringify({ planner_matches: matches }) });
      setData(current => ({ ...current, [id]: result }));
      setMessage(matches.length === 1 ? "Partido programado." : `${matches.length} partidos programados.`);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la programación.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeMatch({ tournament: league, match }: NonNullable<typeof removingMatch>) {
    const { home_team_id, away_team_id, round_id, scheduled_on, starts_at, ends_at } = match;
    const result = await apiRequest<Matrix>(matrixPath(league.id), token, {
      method: "PATCH",
      body: JSON.stringify({ remove_planner_match: {
        home_team_id, away_team_id, round_id,
        schedule: { scheduled_on, starts_at: starts_at?.slice(0, 5), ends_at: ends_at?.slice(0, 5) },
      } }),
    });
    setData(current => ({ ...current, [league.id]: result }));
    setError("");
    setMessage("Partido eliminado.");
  }

  async function place(slot: BoardSlot, team: PickedTeam | null) {
    if (busy || !team || !slot.round || slot.occupied || suggestedBySlot.has(slotKey(slot))) return;
    setError(""); setMessage("");
    if (team.tournament !== slot.tournament.id) { setError("Elige un horario del torneo de este equipo."); return; }
    const key = slotKey(slot);
    const first = staged[key];
    const slotMatrix = data[slot.tournament.id];
    if (Object.entries(staged).some(([otherKey, other]) => otherKey !== key && other.id === team.id)
      || suggestions.some(match => match.home_team_id === team.id || match.away_team_id === team.id)
      || slot.round.rest_team_id === team.id
      || slotMatrix.crosses.some(match => match.round_id === slot.round?.id && (match.played || match.scheduled_on)
        && [match.home_team_id, match.away_team_id].includes(team.id))) {
      setError("El equipo ya tiene un horario, un partido o descanso en esta jornada.");
      return;
    }
    if (!first) {
      setStaged(current => ({ ...current, [key]: team }));
      setPicked(null);
      return;
    }
    const pair = plannerPair(slotMatrix, slot.round, first.id, team.id);
    if (!pair) { setError("Elige otro rival. Este cruce ya está registrado o los equipos tienen otro cruce en la jornada."); return; }
    if (!(await save(slot.tournament.id, [makePlannerMatch(slot.round, slot, pair)]))) return;
    setStaged(current => Object.fromEntries(Object.entries(current).filter(([otherKey]) => otherKey !== key)));
    setPicked(null);
  }

  function drop(event: DragEvent, slot: BoardSlot) {
    event.preventDefault();
    const transferredId = Number(event.dataTransfer.getData("text/plain"));
    const team = active.flatMap(row => (data[row.id]?.teams ?? []).filter(team => team.id === transferredId && team.is_active)
      .map(team => ({ ...team, tournament: row.id })))[0];
    void place(slot, team ?? null);
  }

  function propose() {
    if (!matrix || !round || !tournament) return;
    const free = calendar.flat().filter(slot => slot.tournament.id === tournament.id
      && slot.round?.id === round.id && !slot.occupied && !staged[slotKey(slot)]);
    const reserved = new Set(Object.values(staged).map(team => team.id));
    const proposed = suggestPlannerMatches(matrix, round, free, reserved);
    setSuggestions(proposed); setError("");
    setMessage(proposed.length ? "" : free.length ? "No hay suficientes equipos disponibles para los horarios libres de esta jornada."
      : "No hay horarios libres de esta jornada en la semana visible.");
  }

  return <div className="game-role-planner">
    <Card as="section" className="role-planner-controls" aria-label="Controles de programación">
      <Label>Torneo<NativeSelect aria-label="Torneo" value={tournament?.id ?? ""} disabled={loading || busy}
        onChange={event => { setTournamentId(event.target.value); setWeek(""); resetDraft(); }}>
        {!active.length && <option value="">Sin torneos activos</option>}
        {active.map(row => <option key={row.id} value={row.id}>{row.name} · {sites.find(site => site.id === row.site)?.name}</option>)}
      </NativeSelect></Label>
      <Label>Jornada<NativeSelect aria-label="Jornada" value={round?.id ?? ""} disabled={!round || loading || busy}
        onChange={event => { setRoundId(Number(event.target.value)); setWeek(""); resetDraft(); }}>
        {!round && <option value="">Sin jornadas</option>}
        {rounds.map(row => <option key={row.id} value={row.id}>Jornada {row.number}</option>)}
      </NativeSelect></Label>
      <Button type="button" className="primary" onClick={() => setAddingRound(true)} disabled={!matrix || loading || busy}>
        <Plus aria-hidden="true" />Agregar jornada
      </Button>
      <Button type="button" className="primary" onClick={propose} disabled={!round || loading || busy}><Shuffle aria-hidden="true" />Sugerir jornada</Button>
      <Button type="button" onClick={() => {
        if (tournament) setTournamentId(String(tournament.id));
        if (round) setRoundId(round.id);
        onOpenMatrix();
      }}>Abrir matriz</Button>
    </Card>
    {loading && <p role="status">Cargando calendario…</p>}
    {failed && <p role="alert" className="error">Algunos torneos no se pudieron cargar. <Button type="button" disabled={busy} onClick={() => { resetDraft(); setRevision(value => value + 1); }}>Actualizar calendario</Button></p>}
    {error && <p className="error role-planner-notice" role="alert">{error} <Button type="button" disabled={busy} onClick={() => { resetDraft(); setRevision(value => value + 1); }}>Actualizar calendario</Button></p>}
    {message && <p className="role-planner-notice" role="status">{message}</p>}
    {!!suggestions.length && <div className="role-planner-review">
      <strong>{suggestions.length} {suggestions.length === 1 ? "partido sugerido" : "partidos sugeridos"}</strong>
      <Button type="button" disabled={busy} onClick={() => setSuggestions([])}>Descartar</Button>
      <Button type="button" className="primary" disabled={busy} onClick={async () => {
        if (await save(tournament.id, suggestions)) setSuggestions([]);
      }}>Confirmar sugerencia</Button>
    </div>}
    {!loading && active.length > 0 && <div className="role-planner-board">
      <Card as="aside" className="role-planner-teams" aria-label="Equipos para programar">
        <h2>Equipos</h2>
        <p>Arrastra o selecciona un equipo y elige su horario.</p>
        {active.filter(row => data[row.id]?.teams.some(team => team.is_active)).map(row => {
          const teamCounts = row.id === tournament?.id ? counts : playedCounts(data[row.id].crosses);
          return <details key={row.id} open={row.id === tournament?.id}>
            <summary>{row.name}</summary>
            <div className="role-planner-team-list">{data[row.id].teams.filter(team => team.is_active).map(team => {
              const selected = picked?.id === team.id;
              const item = { id: team.id, name: team.name, tournament: row.id };
              return <Button key={team.id} type="button" className={selected ? "primary" : ""} aria-pressed={selected}
                disabled={busy} draggable={!busy} onDragStart={event => { event.dataTransfer.setData("text/plain", String(team.id)); event.dataTransfer.effectAllowed = "copy"; }}
                onClick={() => setPicked(selected ? null : item)}>
                <GripVertical aria-hidden="true" /><span>{team.name}</span><small title="Partidos jugados">{teamCounts.get(team.id) ?? 0} PJ</small>
              </Button>;
            })}</div>
          </details>;
        })}
      </Card>
      <div className="role-planner-workspace">
      <Card as="section" className="role-planner-calendar" aria-label="Calendario de lunes a viernes">
        <header>
          <Button type="button" aria-label="Semana anterior" disabled={busy} onClick={() => { setWeek(addDays(monday, -7)); resetDraft(); }}><ArrowLeft aria-hidden="true" /></Button>
          <h2>{weekLabel.formatRange(utc(days[0]), utc(days[4]))}</h2>
          <Button type="button" aria-label="Semana siguiente" disabled={busy} onClick={() => { setWeek(addDays(monday, 7)); resetDraft(); }}><ArrowRight aria-hidden="true" /></Button>
        </header>
        <div className="role-planner-days">
          {calendar.map((slots, index) => <section key={days[index]}>
            <h3>{dayLabel.format(utc(days[index]))}</h3>
            {!slots.length && <p>Sin horarios</p>}
            {slots.map(slot => {
              const key = slotKey(slot);
              const suggested = suggestedBySlot.get(key);
              const shown = slot.match ?? suggested;
              const first = staged[key];
              const names = data[slot.tournament.id];
              const bookable = !!slot.round && !slot.occupied && !suggested;
              const removable = slot.match && !slot.match.played && slot.match.home_goals == null && slot.match.away_goals == null ? slot.match : null;
              const title = roleTimeLabel(slot.tournament.name, slot.start, slot.end);
              const description = shown ? `${displayName(names, shown.home_team_id)} vs. ${displayName(names, shown.away_team_id)}`
                : first ? `${first.name} · Falta rival` : slot.occupied ? "Ocupado en la sede" : !slot.round ? "Sin jornada" : "Disponible";
              return <div key={`${key}/${slot.end}`} className="role-planner-slot" data-state={slot.match ? "scheduled" : suggested ? "suggested" : first ? "staged" : "available"}
                data-target={bookable && picked?.tournament === slot.tournament.id}
                onDragOver={bookable && !busy ? event => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } : undefined}
                onDrop={bookable && !busy ? event => drop(event, slot) : undefined}>
                <Button type="button" disabled={(!bookable && !removable) || busy}
                  title={removable ? "Eliminar partido programado" : undefined} onClick={() => {
                  if (removable) setRemovingMatch({ tournament: slot.tournament, match: removable });
                  else if (picked) void place(slot, picked);
                  else setMessage("Selecciona un equipo de la lista para colocarlo en este horario.");
                }} aria-label={`${slot.tournament.name} · ${dayLabel.format(utc(slot.day))} · ${title} · ${description}`}>
                  <span className="role-planner-slot-time"><strong>{title}</strong><small>{slot.tournament.name}</small></span>
                  <span>{description}</span>
                  {suggested && <small>Sugerido</small>}
                </Button>
                {first && bookable && <Button type="button" className="role-planner-clear" disabled={busy}
                  aria-label={`Quitar a ${first.name} de este horario`} onClick={() => setStaged(current => Object.fromEntries(Object.entries(current).filter(([item]) => item !== key)))}><X aria-hidden="true" /></Button>}
              </div>;
            })}
          </section>)}
        </div>
      </Card>
      {matrix && round && <PlannerMatrix matrix={matrix} round={round} />}
      </div>
    </div>}
    {addingRound && matrix && <MatrixEditor editor={{ kind: "round" }} matrix={matrix} tournamentName={tournament.name}
      schedule={matrix.weekly_schedule ?? []} selected={round}
      initialRoundDate={!rounds.length || (week && !rounds.some(item => days.some(day => during(day, item)))) ? monday : undefined}
      onClose={() => setAddingRound(false)} onSave={addRound} />}
    {removingMatch && <TournamentDialog title="Eliminar partido" description={removingMatch.tournament.name}
      submitLabel="Confirmar eliminación" danger onClose={() => setRemovingMatch(null)} onSubmit={() => removeMatch(removingMatch)}>
      <p><strong>{displayName(data[removingMatch.tournament.id], removingMatch.match.home_team_id)} vs. {displayName(data[removingMatch.tournament.id], removingMatch.match.away_team_id)}</strong></p>
      {removingMatch.match.scheduled_on && <p>{dayLabel.format(utc(removingMatch.match.scheduled_on))} · {roleTimeLabel(removingMatch.tournament.name, removingMatch.match.starts_at, removingMatch.match.ends_at)}</p>}
      <p>El horario quedará libre y el partido se quitará de la matriz.</p>
    </TournamentDialog>}
  </div>;
}

function PlannerMatrix({ matrix, round }: { matrix: Matrix; round: Round }) {
  const crosses = matrix.crosses.filter(cross => cross.round_id === round.id);
  const teams = [...new Set([...(matrix.matrix_team_ids ?? []), ...crosses.flatMap(cross => [cross.home_team_id, cross.away_team_id])])];
  const cells = new Map(crosses.map(cross => [`${cross.home_team_id}/${cross.away_team_id}`, cross]));
  if (!teams.length) return null;
  return <Card as="section" className="role-planner-matrix" aria-label={`Matriz · Jornada ${round.number}`} style={roundColorStyle(round.number)}>
    <h2>Matriz · Jornada {round.number}</h2>
    <div className="role-planner-matrix-scroll" tabIndex={0} aria-label="Cruces de la jornada">
      <table style={{ minWidth: 116 + teams.length * 35 }}>
        <colgroup><col className="role-planner-matrix-team" />{teams.map(id => <col key={id} />)}</colgroup>
        <thead><tr><th scope="col">Visitante / Local</th>{teams.map(id => <th key={id} scope="col" title={displayName(matrix, id)}>{displayName(matrix, id)}</th>)}</tr></thead>
        <tbody>{teams.map(away => <tr key={away}><th scope="row" title={displayName(matrix, away)}>{displayName(matrix, away)}</th>{teams.map(home => {
          const match = cells.get(`${home}/${away}`);
          const state = match ? match.played ? "played" : "pending" : undefined;
          const time = match?.starts_at?.slice(0, 5);
          const description = match ? `${match.played ? "Jugado" : "Pendiente"} · ${time ?? "Sin horario"}` : undefined;
          return <td key={home} data-match-state={state} title={description}>
            {home === away ? "—" : time ?? "·"}
          </td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  </Card>;
}
