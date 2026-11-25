import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, GripVertical, Plus, Shuffle, X } from "lucide-react";
import { apiRequest } from "../../api";
import { Button, Card, Input, Label, NativeSelect } from "../../components/ui/enrollment-ui";
import type { Site, Tournament } from "../../types";
import { useEnrollmentViewState } from "../enrollments/EnrollmentNavigation";
import { addDays, MatrixEditor, roundColorStyle, type Cross, type Matrix, type Round } from "./GameRoles";
import { makePlannerMatch, plannerOverlap, plannerPair, playedCounts, suggestPlannerMatches, type PlannerMatch, type ScheduledRange } from "./plannerSchedule";
import { datedRoleSlots, roleTimeLabel, type RoleSlot } from "./roleSchedule";
import "./gameRolePlanner.css";

type BoardSlot = RoleSlot & { tournament: Tournament; round?: Round; match?: Cross; occupied: boolean; preset: boolean; extra: boolean };
type OfferedSlot = RoleSlot & { sources: string[] };
type PickedTeam = { id: number; tournament: number; name: string };
type SlotSide = "home" | "away";
type StagedTeam = PickedTeam & { side: SlotSide };
type Relocation = { kind: "team"; key: string } | { kind: "match"; key: string; side: SlotSide };
const dragSources = { team: "application/x-bpower-staged-team", match: "application/x-bpower-scheduled-match" };
const slotSides = ["home", "away"] as const;
const sideLabels = { home: "Local", away: "Visitante" };
const dayLabel = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const weekLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const mexicoDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });
const matrixPath = (id: number) => `/player-enrollments/game-roles/${id}/`;
const during = (day: string, round: Round) => round.starts_on <= day && day <= addDays(round.starts_on, 6);
const roundForDay = (day: string, rounds: Round[], preferred?: Round) =>
  preferred && during(day, preferred) ? preferred : rounds.find(item => during(day, item));
const utc = (day: string) => new Date(day + "T00:00:00Z");
const slotsForDay = (matrix: Matrix, day: string) =>
  datedRoleSlots(matrix.weekly_schedule ?? [], matrix.rounds.flatMap(round => round.extra_schedule ?? []), day);
const rangeKey = ({ start, end }: RoleSlot) => `${start}/${end}`;
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
    const slots: BoardSlot[] = datedRoleSlots(matrix.weekly_schedule ?? [], round?.extra_schedule ?? [], day).map(slot => {
      const match = existing.find(item => item.starts_at?.slice(0, 5) === slot.start && item.ends_at?.slice(0, 5) === slot.end);
      return { ...slot, tournament, round, match, preset: true, occupied: occupied.some(item => plannerOverlap(slot, item)) };
    });
    for (const match of existing) {
      if (slots.some(slot => slot.match === match)) continue;
      slots.push({ day, start: match.starts_at!.slice(0, 5), end: match.ends_at!.slice(0, 5), tournament, round, match, occupied: true, preset: false, extra: false });
    }
    return slots.sort((a, b) => a.start.localeCompare(b.start));
  });
}

export function GameRolePlanner({ token, userId, tournaments, sites, onOpenMatrix }: {
  token: string; userId?: number; tournaments: Tournament[]; sites: Pick<Site, "id" | "name">[]; onOpenMatrix: () => void;
}) {
  const [data, setData] = useState<Record<number, Matrix>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const [tournamentId, setTournamentId] = useEnrollmentViewState("gameRoles.tournament", "");
  const [addingRound, setAddingRound] = useState(false);
  const [slotOccupancy, setSlotOccupancy] = useState<ScheduledRange[] | null>(null);
  const [week, setWeek] = useState("");
  const [picked, setPicked] = useState<PickedTeam | null>(null);
  const [moving, setMoving] = useState<Relocation | null>(null);
  const draftKey = userId ? `bpower.gameRoles.pendingTeams.${userId}` : null;
  const [staged, setStaged] = useState<Record<string, StagedTeam>>(() => {
    try { return draftKey ? JSON.parse(sessionStorage.getItem(draftKey) ?? "{}") ?? {} : {}; }
    catch { return {}; }
  });
  const [suggestions, setSuggestions] = useState<PlannerMatch[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    try { if (draftKey) sessionStorage.setItem(draftKey, JSON.stringify(staged)); }
    catch { /* Drafts remain available while the planner is open. */ }
  }, [draftKey, staged]);
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
  const sameSite = active.filter(row => row.site === tournament?.site);
  const occupied = sameSite.flatMap(row => data[row.id]?.crosses ?? []);
  const calendar = matrix ? calendarSlots(tournament, matrix, occupied, days, round) : days.map(() => []);
  const extraSlotDays = round ? days.filter(day => during(day, round)) : [];
  const suggestedBySlot = new Map(suggestions.map(match => [keyOf(tournament.id, match.schedule.scheduled_on, match.schedule.starts_at), match]));
  const counts = playedCounts(matrix?.crosses ?? []);
  const activeTeams = matrix?.teams.filter(team => team.is_active) ?? [];

  function resetDraft() {
    setPicked(null); setMoving(null); setSuggestions([]); setError(""); setMessage(""); setSlotOccupancy(null);
  }

  function canAddSlot(slot: RoleSlot) {
    return !!matrix && slot.start < slot.end && !slotOccupancy?.some(match => plannerOverlap(slot, match))
      && !slotsForDay(matrix, slot.day).some(other => slot.start < other.end && slot.end > other.start);
  }

  async function openExtraSlot() {
    setBusy(true);
    setError("");
    try {
      setSlotOccupancy(await apiRequest<ScheduledRange[]>(
        `${matrixPath(tournament.id)}?week_occupancy=${monday}`, token, { cache: "no-store" },
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo consultar la disponibilidad de la sede.");
    } finally {
      setBusy(false);
    }
  }

  function availableExtraSlots(day: string) {
    const offered = new Map<string, OfferedSlot>();
    for (const other of sameSite) {
      if (other.id === tournament.id || !data[other.id]) continue;
      for (const slot of slotsForDay(data[other.id], day)) {
        if (!canAddSlot(slot)) continue;
        const key = rangeKey(slot);
        const option = offered.get(key);
        if (option) option.sources.push(other.name);
        else offered.set(key, { ...slot, sources: [other.name] });
      }
    }
    return [...offered.values()].sort((first, second) => first.start.localeCompare(second.start));
  }

  async function addExtraSlot(round: Round, slot: RoleSlot) {
    setBusy(true);
    try {
      const result = await apiRequest<Matrix>(matrixPath(tournament.id), token, {
        method: "PATCH",
        body: JSON.stringify({ add_extra_slot: {
          round_id: round.id, schedule: { scheduled_on: slot.day, starts_at: slot.start, ends_at: slot.end },
        } }),
      });
      setData(current => ({ ...current, [tournament.id]: result }));
      setSlotOccupancy(null);
      setError("");
      setMessage("Horario extra agregado.");
    } finally {
      setBusy(false);
    }
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
    const previous = calendar.flat().find(item => item.match && slotKey(item) === source.key);
    const match = previous?.match;
    if (!previous?.preset || !match || match.played) return;
    const movedId = source.side === "home" ? match.home_team_id : match.away_team_id;
    const remainingId = source.side === "home" ? match.away_team_id : match.home_team_id;
    const key = slotKey(slot);
    const rival = staged[key];
    if (rival?.side === side) { setError("Elige el lado vacío de ese horario."); return; }
    if (rival?.id === remainingId || rival?.id === movedId) { setError("Selecciona otro horario para este equipo."); return; }
    const selectedMatrix = data[slot.tournament.id];
    const pair = rival ? plannerPair(selectedMatrix, slot.round, side === "home" ? movedId : rival.id, side === "away" ? movedId : rival.id) : null;
    if (rival && !pair) { setError("Los cruces entre estos equipos ya están registrados. Elige otro rival."); return; }
    const destination = { round_id: slot.round.id, schedule: { scheduled_on: slot.day, starts_at: slot.start, ends_at: slot.end } };
    if (await save(slot.tournament.id, { split_planner_match: {
      source: matchSource(match), destination, team_id: movedId, opponent_id: rival?.id ?? null,
      side: pair ? (pair[0] === movedId ? "home" : "away") : side,
    } }, "Equipo movido.")) {
      setStaged(current => ({
        ...withoutStaged(current, key),
        [source.key]: { id: remainingId, name: displayName(selectedMatrix, remainingId), tournament: slot.tournament.id,
          side: source.side === "home" ? "away" : "home" },
        ...(!rival ? { [key]: { id: movedId, name: displayName(selectedMatrix, movedId), tournament: slot.tournament.id, side } } : {}),
      }));
      setMoving(null);
      setPicked(null);
    }
  }

  function startMove(source: Relocation) {
    setMoving(source); setPicked(null); setError("");
    setMessage("Elige un espacio para mover el equipo.");
  }

  function startDrag(event: DragEvent, source: Relocation) {
    event.dataTransfer.setData(dragSources[source.kind], source.kind === "match" ? `${source.key}|${source.side}` : source.key);
    event.dataTransfer.effectAllowed = "move";
  }

  function drop(event: DragEvent, slot: BoardSlot, side: SlotSide) {
    event.preventDefault();
    const teamSource = event.dataTransfer.getData(dragSources.team);
    if (teamSource) {
      void relocate({ kind: "team", key: teamSource }, slot, side);
      return;
    }
    const [matchSourceKey, matchSide] = event.dataTransfer.getData(dragSources.match).split("|");
    if (matchSourceKey && (matchSide === "home" || matchSide === "away")) {
      void relocate({ kind: "match", key: matchSourceKey, side: matchSide }, slot, side);
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
    const reserved = new Set(calendar.flat().flatMap(slot => {
      const team = staged[slotKey(slot)];
      return team && !slot.occupied ? [team.id] : [];
    }));
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
        <div className="role-planner-extra">
          {slotOccupancy && round ? <ExtraSlotForm days={extraSlotDays} optionsForDay={availableExtraSlots}
            canAdd={canAddSlot} onSave={slot => addExtraSlot(round, slot)} onClose={() => setSlotOccupancy(null)} />
            : <Button type="button" className="primary" onClick={openExtraSlot}
              disabled={!matrix || loading || busy || !extraSlotDays.length || sameSite.some(row => !data[row.id])}>
              <Plus aria-hidden="true" />Agregar horario
            </Button>}
        </div>
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
              const movable = slot.preset && slot.match && !slot.match.played && slot.match.home_goals == null && slot.match.away_goals == null;
              const date = dayLabel.format(utc(slot.day));
              const time = roleTimeLabel(slot.tournament.name, slot.start, slot.end);
              const matchRound = slot.match ? rounds.find(item => item.id === slot.match?.round_id) : slot.round;
              const slotLabel = `${date} · ${time}`;
              const homeName = shown && displayName(names, shown.home_team_id);
              const awayName = shown && displayName(names, shown.away_team_id);
              return <div key={`${key}/${slot.end}`} className="role-planner-slot" data-state={slot.match ? "scheduled" : suggested ? "suggested" : first ? "staged" : "available"}
                data-target={bookable && (picked?.tournament === slot.tournament.id || !!moving)}>
                <time dateTime={slot.day} className="role-planner-slot-date">{date}</time>
                <div title={slot.extra ? `${slot.start}–${slot.end}` : undefined}>
                  <strong>{time}</strong>{slot.extra && <small className="role-planner-extra-label">Horario extra</small>}
                </div>
                <span className="role-planner-slot-round">{matchRound ? `J${matchRound.number}` : "—"}</span>
                {shown ? <div className="role-planner-encounter">
                  {slotSides.map(side => {
                    const name = side === "home" ? homeName : awayName;
                    const className = `role-planner-assigned-team role-planner-${side}`;
                    const source = { kind: "match", key, side } as const;
                    return movable ? <Button key={side} type="button" className={className} disabled={busy} draggable={!busy}
                      title={`Mover a ${name}`} aria-label={`Mover a ${name} · ${sideLabels[side]} · ${slotLabel}`}
                      aria-pressed={moving?.kind === "match" && moving.key === key && moving.side === side}
                      onDragStart={event => startDrag(event, source)} onClick={() => startMove(source)}>{name}</Button>
                      : <span key={side} className={className}>{name}{suggested && side === "home" && <small>Sugerido</small>}</span>;
                  })}
                  <span className="role-planner-vs">VS</span>
                </div> : bookable ? <div className="role-planner-encounter">
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
  </div>;
}

function ExtraSlotForm({ days, optionsForDay, canAdd, onSave, onClose }: {
  days: string[]; optionsForDay: (day: string) => OfferedSlot[];
  canAdd: (slot: RoleSlot) => boolean; onSave: (slot: RoleSlot) => Promise<void>; onClose: () => void;
}) {
  const [day, setDay] = useState(() => days.find(date => optionsForDay(date).length) ?? days[0]);
  const [choice, setChoice] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const options = optionsForDay(day);
  const custom = choice === "custom";
  const slot = custom ? { day, start, end } : options.find(option => rangeKey(option) === choice);
  const available = !!slot?.start && !!slot.end && canAdd(slot);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!available || saving) return;
    setSaving(true);
    setError("");
    try { await onSave(slot); }
    catch (reason) {
      setSaving(false);
      setError(reason instanceof Error ? reason.message : "No se pudo agregar el horario.");
    }
  }

  return <form aria-label="Agregar horario" onSubmit={submit}>
    <fieldset className="role-planner-extra-fields" disabled={saving}>
    <Label>Fecha<NativeSelect aria-label="Fecha" value={day} onChange={event => { setDay(event.target.value); setChoice(""); }}>
      {days.map(date => <option key={date} value={date}>{dayLabel.format(utc(date))}</option>)}
    </NativeSelect></Label>
    <Label>Horario<NativeSelect aria-label="Horario" value={choice} onChange={event => setChoice(event.target.value)}>
      <option value="">Selecciona un horario</option>
      {options.map(option => <option key={rangeKey(option)} value={rangeKey(option)}>
        {`${option.start}–${option.end} · ${option.sources.join(", ")}`}
      </option>)}
      <option value="custom">Horario personalizado</option>
    </NativeSelect></Label>
    {custom && <>
      <Label>Hora de inicio<Input type="time" value={start} onChange={event => setStart(event.target.value)} required /></Label>
      <Label>Hora de fin<Input type="time" value={end} onChange={event => setEnd(event.target.value)} required /></Label>
    </>}
    <Button type="submit" className="primary" disabled={!available}>{saving ? "Guardando…" : "Agregar a la jornada"}</Button>
    <Button type="button" onClick={onClose}>Cancelar</Button>
    </fieldset>
    {custom && start && end && !available && <p role="status">{end <= start ? "La hora de fin debe ser posterior a la de inicio." : "El rango coincide con un horario del torneo o con un partido en la sede."}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
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
