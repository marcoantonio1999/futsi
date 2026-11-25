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
type SlotSide = "home" | "away";
type StagedTeam = PickedTeam & { side: SlotSide };
type Relocation = { kind: "team" | "match"; key: string };
const dragSources = { team: "application/x-bpower-staged-team", match: "application/x-bpower-scheduled-match" };
const slotSides = ["home", "away"] as const;
const sideLabels = { home: "Local", away: "Visitante" };
const francoSite = 27;
const dayLabel = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const weekLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const mexicoDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });
const matrixPath = (id: number) => `/player-enrollments/game-roles/${id}/`;
const during = (day: string, round: Round) => round.starts_on <= day && day <= addDays(round.starts_on, 6);
const roundForDay = (day: string, rounds: Round[], preferred?: Round) =>
  preferred && during(day, preferred) ? preferred : rounds.find(item => during(day, item));
const utc = (day: string) => new Date(day + "T00:00:00Z");
function mondayOf(day: string, fromRound = false) {
  const weekday = utc(day).getUTCDay();
  const offset = (weekday + 6) % 7;
  return addDays(day, fromRound && offset > 4 ? 7 - offset : -offset);
}
const keyOf = (id: number, day: string, start: string) => `${id}/${day}/${start}`;
const slotKey = (slot: BoardSlot) => keyOf(slot.tournament.id, slot.day, slot.start);
const displayName = (matrix: Matrix | undefined, id: number) => matrix?.teams.find(team => team.id === id)?.name ?? "Equipo";
const matchSource = ({ home_team_id, away_team_id, round_id, scheduled_on, starts_at, ends_at }: Cross) => ({
  home_team_id, away_team_id, round_id,
  schedule: { scheduled_on, starts_at: starts_at?.slice(0, 5), ends_at: ends_at?.slice(0, 5) },
});

function calendarSlots(tournament: Tournament, matrix: Matrix, occupied: Cross[], days: string[], preferred?: Round) {
  return days.map(day => {
    const round = roundForDay(day, matrix.rounds, preferred);
    const existing = matrix.crosses.filter(match => match.scheduled_on === day && match.starts_at && match.ends_at);
    const slots: BoardSlot[] = roleSlots(matrix.weekly_schedule ?? [], day).map(slot => {
      const match = existing.find(item => item.starts_at?.slice(0, 5) === slot.start && item.ends_at?.slice(0, 5) === slot.end);
      return { ...slot, tournament, round, match, occupied: occupied.some(item => plannerOverlap(slot, item)) };
    });
    for (const match of existing) {
      if (slots.some(slot => slot.match === match)) continue;
      slots.push({ day, start: match.starts_at!.slice(0, 5), end: match.ends_at!.slice(0, 5), tournament, round, match, occupied: true });
    }
    return slots.sort((a, b) => a.start.localeCompare(b.start));
  });
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
  const [moving, setMoving] = useState<Relocation | null>(null);
  const [staged, setStaged] = useState<Record<string, StagedTeam>>({});
  const [suggestions, setSuggestions] = useState<PlannerMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.allSettled(tournaments.filter(item => item.is_active).map(async tournament =>
      [tournament.id, await apiRequest<Matrix>(matrixPath(tournament.id), token, { signal: controller.signal, cache: "no-store" })] as const
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
  const weekRoundNumbers = [...new Set(days.flatMap(day => {
    const visibleRound = roundForDay(day, rounds, round);
    return visibleRound ? [visibleRound.number] : [];
  }))];
  const weekRoundLabel = weekRoundNumbers.length
    ? `${weekRoundNumbers.length === 1 ? "Jornada" : "Jornadas"} ${weekRoundNumbers.join(", ")}`
    : "Sin jornada";
  const occupied = tournament?.site === francoSite
    ? active.filter(row => row.site === tournament.site).flatMap(row => data[row.id]?.crosses ?? [])
    : matrix?.crosses ?? [];
  const calendar = matrix ? calendarSlots(tournament, matrix, occupied, days, round) : days.map(() => []);
  const suggestedBySlot = new Map(suggestions.map(match => [keyOf(tournament.id, match.schedule.scheduled_on, match.schedule.starts_at), match]));
  const counts = playedCounts(matrix?.crosses ?? []);
  const activeTeams = matrix?.teams.filter(team => team.is_active) ?? [];

  function resetDraft() {
    setPicked(null); setMoving(null); setStaged({}); setSuggestions([]); setError(""); setMessage("");
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

  async function save(id: number, payload: object, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await apiRequest<Matrix>(matrixPath(id), token, { method: "PATCH", body: JSON.stringify(payload) });
      setData(current => ({ ...current, [id]: result }));
      setMessage(success);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar la programación.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function removeMatch({ tournament: league, match }: NonNullable<typeof removingMatch>) {
    const result = await apiRequest<Matrix>(matrixPath(league.id), token, {
      method: "PATCH",
      body: JSON.stringify({ remove_planner_match: matchSource(match) }),
    });
    setData(current => ({ ...current, [league.id]: result }));
    setError("");
    setMessage("Partido eliminado.");
  }

  async function place(slot: BoardSlot, team: PickedTeam | null, side: SlotSide, sourceKey?: string) {
    if (busy || !team || !slot.round || slot.occupied || suggestedBySlot.has(slotKey(slot))) return;
    setError(""); setMessage("");
    if (team.tournament !== slot.tournament.id) { setError("Elige un horario del torneo de este equipo."); return; }
    const key = slotKey(slot);
    const first = staged[key];
    const slotMatrix = data[slot.tournament.id];
    if (slot.round.rest_team_id === team.id) { setError("Este equipo tiene descanso en la jornada."); return; }
    if (sourceKey && sourceKey !== key && first?.side === side) {
      setError("Elige el lado vacío de ese horario.");
      return;
    }
    if (!first || first.side === side || sourceKey === key) {
      setStaged(current => ({ ...withoutStaged(current, sourceKey), [key]: { ...team, side } }));
      setPicked(null);
      setMoving(null);
      return;
    }
    if (first.id === team.id) { setError("Selecciona un rival distinto para este horario."); return; }
    const [home, away] = side === "home" ? [team.id, first.id] : [first.id, team.id];
    const pair = plannerPair(slotMatrix, slot.round, home, away);
    if (!pair) { setError("Los cruces entre estos equipos ya están registrados. Elige otro rival."); return; }
    if (!(await save(slot.tournament.id, { planner_matches: [makePlannerMatch(slot.round, slot, pair)] }, "Partido programado."))) return;
    setStaged(current => withoutStaged(current, key, sourceKey));
    setPicked(null);
    setMoving(null);
  }

  async function relocate(source: Relocation, slot: BoardSlot, side: SlotSide) {
    if (source.kind === "team") {
      await place(slot, staged[source.key] ?? null, side, source.key);
      return;
    }
    if (busy || !slot.round || slot.occupied || suggestedBySlot.has(slotKey(slot))) return;
    if (staged[slotKey(slot)]) { setError("Elige un horario con ambos espacios vacíos para mover el partido."); return; }
    const match = calendar.flat().find(item => item.match && slotKey(item) === source.key)?.match;
    if (!match || match.played) return;
    const destination = { round_id: slot.round.id, schedule: { scheduled_on: slot.day, starts_at: slot.start, ends_at: slot.end } };
    if (await save(slot.tournament.id, { move_planner_match: { source: matchSource(match), destination } }, "Partido movido.")) {
      setMoving(null);
      setPicked(null);
    }
  }

  function startMove(source: Relocation) {
    setMoving(source); setPicked(null); setError("");
    setMessage(source.kind === "match" ? "Elige un horario libre para mover el partido." : "Elige un espacio para mover el equipo.");
  }

  function startDrag(event: DragEvent, source: Relocation) {
    event.dataTransfer.setData(dragSources[source.kind], source.key);
    event.dataTransfer.effectAllowed = "move";
  }

  function drop(event: DragEvent, slot: BoardSlot, side: SlotSide) {
    event.preventDefault();
    const teamSource = event.dataTransfer.getData(dragSources.team);
    const matchSourceKey = event.dataTransfer.getData(dragSources.match);
    if (teamSource || matchSourceKey) {
      void relocate(teamSource ? { kind: "team", key: teamSource } : { kind: "match", key: matchSourceKey }, slot, side);
      return;
    }
    const transferredId = Number(event.dataTransfer.getData("text/plain"));
    const team = activeTeams.find(item => item.id === transferredId);
    if (team) void place(slot, { id: team.id, name: team.name, tournament: tournament.id }, side);
  }

  function allowDrop(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.some(type => type === dragSources.team || type === dragSources.match) ? "move" : "copy";
  }

  function propose() {
    if (!matrix || !round || !tournament) return;
    const free = calendar.flat().filter(slot => slot.round?.id === round.id && !slot.occupied && !staged[slotKey(slot)]);
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
    {loading && <p role="status">Cargando programación…</p>}
    {failed && <p role="alert" className="error">Algunos torneos no se pudieron cargar. <Button type="button" disabled={busy} onClick={() => { resetDraft(); setRevision(value => value + 1); }}>Actualizar programación</Button></p>}
    {error && <p className="error role-planner-notice" role="alert">{error} <Button type="button" disabled={busy} onClick={() => { resetDraft(); setRevision(value => value + 1); }}>Actualizar programación</Button></p>}
    {(message || moving) && <div className="role-planner-relocation">
      {message && <p className="role-planner-notice" role="status">{message}</p>}
      {moving && <Button type="button" disabled={busy} onClick={() => { setMoving(null); setMessage(""); }}>Cancelar movimiento</Button>}
    </div>}
    {!!suggestions.length && <div className="role-planner-review">
      <strong>{suggestions.length} {suggestions.length === 1 ? "partido sugerido" : "partidos sugeridos"}</strong>
      <Button type="button" disabled={busy} onClick={() => setSuggestions([])}>Descartar</Button>
      <Button type="button" className="primary" disabled={busy} onClick={async () => {
        const notice = suggestions.length === 1 ? "Partido programado." : `${suggestions.length} partidos programados.`;
        if (await save(tournament.id, { planner_matches: suggestions }, notice)) setSuggestions([]);
      }}>Confirmar sugerencia</Button>
    </div>}
    {!loading && active.length > 0 && (matrix || failed) && <div className="role-planner-board">
      <Card as="aside" key={tournament?.id} className="role-planner-teams" aria-label="Equipos para programar">
        <h2>Equipos</h2>
        {activeTeams.length ? <>
          <p>Arrastra un equipo a un espacio vacío o selecciónalo y toca el espacio.</p>
          <div className="role-planner-team-list">{activeTeams.map(team => {
            const selected = picked?.id === team.id;
            const item = { id: team.id, name: team.name, tournament: tournament.id };
            return <Button key={team.id} type="button" className={selected ? "primary" : ""} aria-pressed={selected}
              disabled={busy} draggable={!busy} onDragStart={event => { event.dataTransfer.setData("text/plain", String(team.id)); event.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => { if (moving) setMessage(""); setMoving(null); setPicked(selected ? null : item); }}>
              <GripVertical aria-hidden="true" /><span>{team.name}</span><small title="Partidos jugados">{counts.get(team.id) ?? 0} PJ</small>
            </Button>;
          })}</div>
        </> : <p>{matrix ? "Este torneo aún no tiene equipos activos." : "No se pudieron cargar los equipos del torneo."}</p>}
      </Card>
      <div className="role-planner-workspace">
      <Card as="section" className="role-planner-schedule" aria-label="Horarios de lunes a viernes">
        <header>
          <Button type="button" aria-label="Semana anterior" disabled={busy} onClick={() => { setWeek(addDays(monday, -7)); resetDraft(); }}><ArrowLeft aria-hidden="true" /></Button>
          <h2>
            <span>{weekLabel.formatRange(utc(days[0]), utc(days[4]))}</span>
            <span className="role-planner-week-round" style={weekRoundNumbers.length === 1 ? roundColorStyle(weekRoundNumbers[0]) : undefined}>
              {weekRoundLabel}
            </span>
          </h2>
          <Button type="button" aria-label="Semana siguiente" disabled={busy} onClick={() => { setWeek(addDays(monday, 7)); resetDraft(); }}><ArrowRight aria-hidden="true" /></Button>
        </header>
        <div className="role-planner-schedule-scroll">
          {calendar.some(slots => slots.length) ? <div className="role-planner-list-heading" aria-hidden="true">
            <span>Fecha</span><span>Hora</span><span>Jornada</span>
            <div className="role-planner-encounter"><span>Local</span><span></span><span>Visitante</span></div>
          </div> : <p>Sin horarios en esta semana.</p>}
          {calendar.map((slots, weekday) => slots.length > 0 && <div key={days[weekday]} className="role-planner-day" data-weekday={weekday}>
            {slots.map(slot => {
              const key = slotKey(slot);
              const suggested = suggestedBySlot.get(key);
              const shown = slot.match ?? suggested;
              const first = staged[key];
              const names = data[slot.tournament.id];
              const bookable = !!slot.round && !slot.occupied && !suggested;
              const removable = slot.match && !slot.match.played && slot.match.home_goals == null && slot.match.away_goals == null ? slot.match : null;
              const date = dayLabel.format(utc(slot.day));
              const time = roleTimeLabel(slot.tournament.name, slot.start, slot.end);
              const matchRound = slot.match ? rounds.find(item => item.id === slot.match?.round_id) : slot.round;
              const slotLabel = `${date} · ${time}`;
              const homeName = shown && displayName(names, shown.home_team_id);
              const awayName = shown && displayName(names, shown.away_team_id);
              return <div key={`${key}/${slot.end}`} className="role-planner-slot" data-state={slot.match ? "scheduled" : suggested ? "suggested" : first ? "staged" : "available"}
                data-target={bookable && (picked?.tournament === slot.tournament.id || !!moving)}>
                <time dateTime={slot.day} className="role-planner-slot-date">{date}</time>
                <strong>{time}</strong>
                <span className="role-planner-slot-round">{matchRound ? `J${matchRound.number}` : "—"}</span>
                {shown ? <Button type="button" className="role-planner-encounter role-planner-confirmed-match" disabled={!removable || busy}
                  draggable={!!removable && !busy} onDragStart={event => startDrag(event, { kind: "match", key })}
                  title={removable ? "Arrastra para mover el partido o toca para ver opciones" : undefined}
                  onClick={() => { if (removable) setRemovingMatch({ tournament: slot.tournament, match: removable }); }}
                  aria-label={`${homeName} vs. ${awayName} · ${slotLabel}${suggested ? " · Sugerido" : ""}`}>
                  <span>{homeName}{suggested && <small>Sugerido</small>}</span><span className="role-planner-vs">VS</span><span>{awayName}</span>
                </Button> : bookable ? <div className="role-planner-encounter">
                  {slotSides.map(side => {
                    const placed = first?.side === side ? first : undefined;
                    return <div key={side} className={`role-planner-drop-zone role-planner-${side}`}>
                      <Button type="button" className="role-planner-drop" disabled={busy}
                        draggable={!!placed && !busy} onDragStart={event => startDrag(event, { kind: "team", key })}
                        aria-label={`${sideLabels[side]} · ${slotLabel} · ${placed?.name ?? "Disponible"}`}
                        title={sideLabels[side]} onDragOver={allowDrop} onDrop={event => drop(event, slot, side)}
                        onClick={() => {
                          if (moving) void relocate(moving, slot, side);
                          else if (picked) void place(slot, picked, side);
                          else if (placed) startMove({ kind: "team", key });
                          else setMessage("Selecciona un equipo de la lista para colocarlo en este horario.");
                        }}>{placed?.name}</Button>
                      {placed && <Button type="button" className="role-planner-clear" disabled={busy}
                        aria-label={`Quitar a ${placed.name} de este horario`}
                        onClick={() => {
                          setStaged(current => withoutStaged(current, key));
                          if (moving?.key === key) { setMoving(null); setMessage(""); }
                        }}>
                        <X aria-hidden="true" />
                      </Button>}
                    </div>;
                  })}
                  <span className="role-planner-vs" onDragOver={busy ? undefined : allowDrop}
                    onDrop={busy ? undefined : event => drop(event, slot, first?.side === "home" ? "away" : "home")}>VS</span>
                </div> : <span className="role-planner-slot-unavailable">{slot.occupied ? "Ocupado en la sede" : "Sin jornada"}</span>}
              </div>;
            })}
          </div>)}
        </div>
      </Card>
      {matrix && round && <PlannerMatrix matrix={matrix} round={round} />}
      </div>
    </div>}
    {addingRound && matrix && <MatrixEditor editor={{ kind: "round" }} matrix={matrix} tournamentName={tournament.name}
      schedule={matrix.weekly_schedule ?? []} selected={round}
      initialRoundDate={!rounds.length || (week && !rounds.some(item => days.some(day => during(day, item)))) ? monday : undefined}
      onClose={() => setAddingRound(false)} onSave={addRound} />}
    {removingMatch && <TournamentDialog title="Partido programado" description={removingMatch.tournament.name}
      submitLabel="Confirmar eliminación" danger onClose={() => setRemovingMatch(null)} onSubmit={() => removeMatch(removingMatch)}>
      <p><strong>{displayName(data[removingMatch.tournament.id], removingMatch.match.home_team_id)} vs. {displayName(data[removingMatch.tournament.id], removingMatch.match.away_team_id)}</strong></p>
      {removingMatch.match.scheduled_on && <p>{dayLabel.format(utc(removingMatch.match.scheduled_on))} · {roleTimeLabel(removingMatch.tournament.name, removingMatch.match.starts_at, removingMatch.match.ends_at)}</p>}
      {removingMatch.match.scheduled_on && removingMatch.match.starts_at && <Button type="button" className="primary" onClick={() => {
        const { scheduled_on, starts_at } = removingMatch.match;
        if (!scheduled_on || !starts_at) return;
        const key = keyOf(removingMatch.tournament.id, scheduled_on, starts_at.slice(0, 5));
        setRemovingMatch(null);
        startMove({ kind: "match", key });
      }}>Mover partido</Button>}
    </TournamentDialog>}
  </div>;
}

function withoutStaged(current: Record<string, StagedTeam>, ...keys: (string | undefined)[]) {
  return Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key)));
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
