import { useEffect, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, GripVertical, Plus, Shuffle, X } from "lucide-react";
import { apiRequest } from "../../api";
import { Button, Card, Input, Label, NativeSelect } from "../../components/ui/enrollment-ui";
import type { Site, Tournament } from "../../types";
import { useEnrollmentViewState } from "../enrollments/EnrollmentNavigation";
import { addDays, MatrixEditor, roundColorStyle, type Cross, type Matrix, type Round } from "./GameRoles";
import { gameRoleMatrixCells, makePlannerMatch, plannerOverlap, plannerPair, playedCounts, suggestPlannerMatches, type PlannerMatch, type ScheduledRange } from "./plannerSchedule";
import { datedRoleSlots, roleTimeLabel, type ExtraScheduleBlock, type RoleSchedule, type RoleSlot } from "./roleSchedule";
import "./gameRolePlanner.css";

type BoardSlot = RoleSlot & { tournament: Tournament; round?: Round; match?: Cross; occupied: boolean; preset: boolean; extra: boolean };
type PlannerDay = { day: string; round?: Round };
type OfferedSlot = RoleSlot & { sources: string[] };
type PlannerWeek = { occupied: ScheduledRange[]; schedules: { name: string; weekly_schedule: RoleSchedule; extra_schedule: ExtraScheduleBlock[] }[] };
type PickedTeam = { id: number; tournament: number; name: string };
type SlotSide = "home" | "away";
type StagedTeam = PickedTeam & { side: SlotSide };
type Relocation = { kind: "team"; key: string } | { kind: "match" | "suggestion"; key: string; side: SlotSide };
type PlannerDraft = Omit<PlannerMatch, "home_team_id" | "away_team_id"> & { home_team_id: number | null; away_team_id: number | null };
const dragSources = { team: "application/x-bpower-staged-team", match: "application/x-bpower-scheduled-match", suggestion: "application/x-bpower-suggested-team" };
const slotSides = ["home", "away"] as const;
const sideLabels = { home: "Local", away: "Visitante" };
const teamField = { home: "home_team_id", away: "away_team_id" } as const;
const completeDraft = (draft: PlannerDraft): draft is PlannerMatch => draft.home_team_id != null && draft.away_team_id != null;
const dayLabel = new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
const weekLabel = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const mexicoDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" });
const matrixPath = (id: number) => `/player-enrollments/game-roles/${id}/`;
const during = (day: string, round: Round) => round.starts_on <= day && day <= addDays(round.starts_on, 6);
const weekdays = (monday: string) => Array.from({ length: 5 }, (_, index) => addDays(monday, index));
const roundEnded = (round: Round | undefined, today: string) => !!round && addDays(round.starts_on, 6) < today;
function roundForWeek(monday: string, rounds: Round[]) {
  const days = weekdays(monday);
  return rounds.reduce<{ round: Round; overlap: number } | undefined>((best, round) => {
    const overlap = days.filter(day => during(day, round)).length;
    if (overlap === 0) return best;
    if (!best || overlap > best.overlap || (overlap === best.overlap && round.starts_on > best.round.starts_on)) {
      return { round, overlap };
    }
    return best;
  }, undefined)?.round;
}
function roundForDay(day: string, rounds: Round[], today: string, preferred?: Round) {
  const matching = rounds.filter(round => during(day, round));
  const open = matching.filter(round => !roundEnded(round, today));
  const options = open.length ? open : matching;
  return options.find(round => round.id === preferred?.id) ?? options.reduce<Round | undefined>(
    (latest, round) => !latest || round.starts_on >= latest.starts_on ? round : latest, undefined,
  );
}
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
const matchSource = ({ id, home_team_id, away_team_id, round_id, scheduled_on, starts_at, ends_at }: Cross) => ({
  cross_id: id, home_team_id, away_team_id, round_id,
  schedule: { scheduled_on, starts_at: starts_at?.slice(0, 5), ends_at: ends_at?.slice(0, 5) },
});

function calendarSlots(tournament: Tournament, matrix: Matrix, occupied: ScheduledRange[], days: PlannerDay[]) {
  return days.map(({ day, round }) => {
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
  const [addingSlot, setAddingSlot] = useState(false);
  const [availability, setAvailability] = useState<{ key: string; value: PlannerWeek | null } | null>(null);
  const [week, setWeek] = useState("");
  const [picked, setPicked] = useState<PickedTeam | null>(null);
  const [moving, setMoving] = useState<Relocation | null>(null);
  const draftKey = userId ? `bpower.gameRoles.pendingTeams.${userId}` : null;
  const [staged, setStaged] = useState<Record<string, StagedTeam>>(() => {
    try { return draftKey ? JSON.parse(sessionStorage.getItem(draftKey) ?? "{}") ?? {} : {}; }
    catch { return {}; }
  });
  const [suggestions, setSuggestions] = useState<PlannerDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    try { if (draftKey) sessionStorage.setItem(draftKey, JSON.stringify(staged)); }
    catch { /* Drafts remain available while the planner is open. */ }
  }, [draftKey, staged]);
  const active = tournaments.filter(tournament => tournament.is_active);
  const tournament = active.find(row => String(row.id) === tournamentId) ?? active[0];
  const selectedTournamentId = tournament?.id;
  useEffect(() => {
    if (!selectedTournamentId) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void apiRequest<Matrix>(matrixPath(selectedTournamentId), token, { signal: controller.signal, cache: "no-store" })
      .then(result => {
        if (!controller.signal.aborted) setData({ [selectedTournamentId]: result });
      }).catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token, selectedTournamentId, revision]);

  const [roundId, setRoundId] = useEnrollmentViewState(`gameRoles.round.${tournament?.id ?? 0}`, 0);
  const matrix = tournament && data[tournament.id];
  const today = mexicoDate.format(new Date());
  const rounds = matrix?.rounds ?? [];
  const selectedRound = rounds.find(row => row.id === roundId);
  const round = week ? roundForWeek(week, rounds)
    : selectedRound ?? rounds.find(row => addDays(row.starts_on, 6) >= today) ?? rounds.at(-1);
  const monday = week || (round ? mondayOf(round.starts_on, true) : mondayOf(today));
  const days = weekdays(monday);
  const visibleDays = days.map(day => ({ day, round: roundForDay(day, rounds, today, round) }));
  const openDays = visibleDays.flatMap(({ day, round }) => round && !roundEnded(round, today) ? [{ day, round }] : []);
  const weekRoundNumbers = [...new Set(visibleDays.flatMap(({ round }) => round ? [round.number] : []))];
  const weekRoundLabel = weekRoundNumbers.length
    ? `${weekRoundNumbers.length === 1 ? "Jornada" : "Jornadas"} ${weekRoundNumbers.join(", ")}`
    : "Sin jornada";
  const availabilityKey = `${selectedTournamentId}/${monday}/${revision}`;
  const weekReady = !!matrix && !loading && !failed;
  useEffect(() => {
    if (!selectedTournamentId || !weekReady) return;
    const controller = new AbortController();
    void apiRequest<PlannerWeek>(`${matrixPath(selectedTournamentId)}?planner_week=${monday}`, token, { signal: controller.signal, cache: "no-store" })
      .then(result => {
        if (!controller.signal.aborted) {
          setAvailability({ key: availabilityKey, value: Array.isArray(result.occupied) && Array.isArray(result.schedules) ? result : null });
        }
      }).catch(() => {
        if (!controller.signal.aborted) setAvailability({ key: availabilityKey, value: null });
      });
    return () => controller.abort();
  }, [token, selectedTournamentId, monday, availabilityKey, weekReady]);
  const weekAvailability = availability?.key === availabilityKey ? availability.value : null;
  const occupied = [...(matrix?.crosses ?? []), ...(weekAvailability?.occupied ?? [])];
  const calendar = matrix ? calendarSlots(tournament, matrix, occupied, visibleDays) : days.map(() => []);
  const suggestionRound = openDays.find(item => item.round.id === round?.id)?.round ?? openDays[0]?.round;
  const closedWeek = weekRoundNumbers.length > 0 && !openDays.length;
  const draftKeyOf = (draft: PlannerDraft) => keyOf(tournament.id, draft.schedule.scheduled_on, draft.schedule.starts_at);
  const suggestedBySlot = new Map(suggestions.map(draft => [draftKeyOf(draft), draft]));
  const completeSuggestions = suggestions.filter(completeDraft);
  const counts = playedCounts(matrix?.crosses ?? []);
  const activeTeams = matrix?.teams.filter(team => team.is_active) ?? [];
  const weekAssigned = new Set(calendar.flat().flatMap(slot => {
    if (slot.match) return [slot.match.home_team_id, slot.match.away_team_id];
    const placed = staged[slotKey(slot)];
    return placed && !slot.occupied ? [placed.id] : [];
  }));

  function resetDraft() {
    setPicked(null); setMoving(null); setSuggestions([]); setError(""); setMessage(""); setAddingSlot(false);
  }

  function navigateWeek(offset: number) {
    const next = addDays(monday, offset);
    setWeek(next);
    setRoundId(roundForWeek(next, rounds)?.id ?? 0);
    resetDraft();
  }

  function canAddSlot(slot: RoleSlot) {
    return !!matrix && !!weekAvailability && slot.start < slot.end && !occupied.some(match => plannerOverlap(slot, match))
      && !slotsForDay(matrix, slot.day).some(other => slot.start < other.end && slot.end > other.start);
  }

  function availableExtraSlots(day: string) {
    const offered = new Map<string, OfferedSlot>();
    for (const other of weekAvailability?.schedules ?? []) {
      for (const slot of datedRoleSlots(other.weekly_schedule, other.extra_schedule, day)) {
        if (!canAddSlot(slot)) continue;
        const key = rangeKey(slot);
        const option = offered.get(key);
        if (option) option.sources.push(other.name);
        else offered.set(key, { ...slot, sources: [other.name] });
      }
    }
    return [...offered.values()].sort((first, second) => first.start.localeCompare(second.start));
  }

  async function addExtraSlot(slot: RoleSlot) {
    const destination = openDays.find(({ day }) => day === slot.day);
    if (!destination) throw new Error("Selecciona una fecha de una jornada abierta.");
    setBusy(true);
    try {
      const result = await apiRequest<Matrix>(matrixPath(tournament.id), token, {
        method: "PATCH",
        body: JSON.stringify({ add_extra_slot: {
          round_id: destination.round.id, schedule: { scheduled_on: slot.day, starts_at: slot.start, ends_at: slot.end },
        } }),
      });
      setData(current => ({ ...current, [tournament.id]: result }));
      setAddingSlot(false);
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
    if (busy || !weekAvailability || !team || !slot.round || roundEnded(slot.round, today) || slot.occupied) return;
    setError(""); setMessage("");
    if (team.tournament !== slot.tournament.id) { setError("Elige un horario del torneo de este equipo."); return; }
    const key = slotKey(slot);
    const preview = suggestedBySlot.get(key);
    if (preview) {
      if (!sourceKey) updateSuggestions([{ ...preview, [teamField[side]]: team.id }], [key]);
      return;
    }
    const first = staged[key];
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
    const pair = plannerPair(slot.round, home, away);
    if (!pair) { setError("Selecciona equipos distintos que tengan actividad en esta jornada."); return; }
    if (!(await save(slot.tournament.id, { planner_matches: [makePlannerMatch(slot.round, slot, pair)] }, "Partido programado."))) return;
    setStaged(current => withoutStaged(current, key, sourceKey));
    setPicked(null);
    setMoving(null);
  }

  async function relocate(source: Relocation, slot: BoardSlot, side: SlotSide) {
    if (source.kind === "suggestion") {
      moveSuggestion(source.key, source.side, slot, side);
      return;
    }
    if (source.kind === "team") {
      await place(slot, staged[source.key] ?? null, side, source.key);
      return;
    }
    if (busy || !weekAvailability || !slot.round || roundEnded(slot.round, today) || slot.occupied || suggestedBySlot.has(slotKey(slot))) return;
    const previous = calendar.flat().find(item => item.match && slotKey(item) === source.key);
    const match = previous?.match;
    if (!previous?.preset || !match || match.played || roundEnded(rounds.find(item => item.id === match.round_id), today)) return;
    const movedId = source.side === "home" ? match.home_team_id : match.away_team_id;
    const remainingId = source.side === "home" ? match.away_team_id : match.home_team_id;
    const key = slotKey(slot);
    const rival = staged[key];
    if (rival?.side === side) { setError("Elige el lado vacío de ese horario."); return; }
    if (rival?.id === remainingId || rival?.id === movedId) { setError("Selecciona otro horario para este equipo."); return; }
    const selectedMatrix = data[slot.tournament.id];
    const pair = rival ? plannerPair(slot.round, side === "home" ? movedId : rival.id, side === "away" ? movedId : rival.id) : null;
    if (rival && !pair) { setError("Selecciona equipos distintos que tengan actividad en esta jornada."); return; }
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

  function moveSuggestion(sourceKey: string, sourceSide: SlotSide, slot: BoardSlot, side: SlotSide) {
    if (busy || !weekAvailability || !slot.round || roundEnded(slot.round, today) || slot.occupied) return;
    const key = slotKey(slot);
    const previous = suggestedBySlot.get(sourceKey);
    const team = previous?.[teamField[sourceSide]];
    if (!previous || team == null || (key === sourceKey && side === sourceSide)) return;
    const placed = staged[key];
    const target = suggestedBySlot.get(key) ?? {
      round_id: slot.round.id,
      schedule: { scheduled_on: slot.day, starts_at: slot.start, ends_at: slot.end },
      home_team_id: placed?.side === "home" ? placed.id : null,
      away_team_id: placed?.side === "away" ? placed.id : null,
    };
    const source = { ...previous, [teamField[sourceSide]]: target[teamField[side]] };
    const destination = { ...(key === sourceKey ? source : target), [teamField[side]]: team };
    const changed = key === sourceKey ? [destination] : [source, destination];
    updateSuggestions(changed, [key, sourceKey]);
  }

  function updateSuggestions(changed: PlannerDraft[], keys: string[]) {
    const remaining = suggestions.filter(draft => !keys.includes(draftKeyOf(draft)));
    for (const draft of changed) {
      const round = rounds.find(row => row.id === draft.round_id);
      if (!round || roundEnded(round, today) || (round.rest_team_id != null && slotSides.some(side => draft[teamField[side]] === round.rest_team_id))) {
        setError("El equipo tiene descanso o la jornada está cerrada.");
        return;
      }
      if (!completeDraft(draft)) continue;
      if (!plannerPair(round, draft.home_team_id, draft.away_team_id)) {
        setError("Un equipo no puede jugar contra sí mismo.");
        return;
      }
    }
    setSuggestions([...remaining, ...changed]);
    setMoving(null); setPicked(null); setError(""); setMessage("");
  }

  async function unassign(slot: BoardSlot, side: SlotSide, preview?: PlannerDraft) {
    const key = slotKey(slot);
    if (preview) {
      setSuggestions(current => current.map(draft => draftKeyOf(draft) === key ? { ...draft, [teamField[side]]: null } : draft));
      if (moving?.key === key) { setMoving(null); setMessage(""); }
      return;
    }
    const match = slot.match;
    if (match && !(await save(slot.tournament.id, { remove_planner_match: matchSource(match) }, "Equipo retirado del horario."))) return;
    const otherSide = side === "home" ? "away" : "home";
    setStaged(current => {
      const remaining = withoutStaged(current, key);
      if (!match) return remaining;
      const id = match[teamField[otherSide]];
      return { ...remaining, [key]: { id, name: displayName(data[slot.tournament.id], id), tournament: slot.tournament.id, side: otherSide } };
    });
    if (moving?.key === key) setMoving(null);
    if (!match) setMessage("");
  }

  function startMove(source: Relocation) {
    setMoving(source); setPicked(null); setError("");
    setMessage("Elige un espacio para mover el equipo.");
  }

  function startDrag(event: DragEvent, source: Relocation) {
    event.dataTransfer.setData(dragSources[source.kind], source.kind === "team" ? source.key : `${source.key}|${source.side}`);
    event.dataTransfer.effectAllowed = "move";
  }

  function drop(event: DragEvent, slot: BoardSlot, side: SlotSide) {
    event.preventDefault();
    const teamSource = event.dataTransfer.getData(dragSources.team);
    if (teamSource) {
      void relocate({ kind: "team", key: teamSource }, slot, side);
      return;
    }
    for (const kind of ["suggestion", "match"] as const) {
      const [sourceKey, sourceSide] = event.dataTransfer.getData(dragSources[kind]).split("|");
      if (sourceKey && (sourceSide === "home" || sourceSide === "away")) {
        void relocate({ kind, key: sourceKey, side: sourceSide }, slot, side);
        return;
      }
    }
    const transferredId = Number(event.dataTransfer.getData("text/plain"));
    const team = activeTeams.find(item => item.id === transferredId);
    if (team) void place(slot, { id: team.id, name: team.name, tournament: tournament.id }, side);
  }

  function allowDrop(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = Object.values(dragSources).some(type => event.dataTransfer.types.includes(type)) ? "move" : "copy";
  }

  function propose() {
    if (!matrix || !weekAvailability || !suggestionRound || !tournament) return;
    const free = calendar.flat().filter(slot => slot.round?.id === suggestionRound.id && !slot.occupied)
      .map(slot => ({ ...slot, placed: staged[slotKey(slot)] }));
    const proposed = suggestPlannerMatches(matrix, suggestionRound, free, weekAssigned);
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
      <Label>Jornada<NativeSelect aria-label="Jornada" value={round?.id ?? ""} disabled={!rounds.length || loading || busy}
        onChange={event => { setRoundId(Number(event.target.value)); setWeek(""); resetDraft(); }}>
        {!round && <option value="" disabled>{rounds.length ? "Sin jornada en esta semana" : "Sin jornadas"}</option>}
        {rounds.map(row => <option key={row.id} value={row.id}>Jornada {row.number}</option>)}
      </NativeSelect></Label>
      <Button type="button" className="primary" onClick={() => setAddingRound(true)} disabled={!matrix || loading || busy}>
        <Plus aria-hidden="true" />Agregar jornada
      </Button>
      <Button type="button" className="primary" onClick={propose} disabled={!suggestionRound || !weekAvailability || loading || busy}><Shuffle aria-hidden="true" />Sugerir jornada</Button>
      <Button type="button" onClick={() => {
        if (tournament) setTournamentId(String(tournament.id));
        if (round) setRoundId(round.id);
        onOpenMatrix();
      }}>Abrir matriz</Button>
    </Card>
    {loading && <p role="status">Cargando programación…</p>}
    {failed && <p role="alert" className="error">No se pudo cargar el torneo. <Button type="button" disabled={busy} onClick={() => { resetDraft(); setRevision(value => value + 1); }}>Actualizar programación</Button></p>}
    {weekReady && !weekAvailability && (availability?.key === availabilityKey
      ? <p role="alert" className="error">No se pudo consultar la disponibilidad de la sede. <Button type="button" disabled={busy} onClick={() => { resetDraft(); setRevision(value => value + 1); }}>Actualizar programación</Button></p>
      : <p role="status">Consultando disponibilidad de la sede…</p>)}
    {error && <p className="error role-planner-notice" role="alert">{error} <Button type="button" disabled={busy} onClick={() => { resetDraft(); setRevision(value => value + 1); }}>Actualizar programación</Button></p>}
    {(message || moving) && <div className="role-planner-relocation">
      {message && <p className="role-planner-notice" role="status">{message}</p>}
      {moving && <Button type="button" disabled={busy} onClick={() => { setMoving(null); setMessage(""); }}>Cancelar movimiento</Button>}
    </div>}
    {!!suggestions.length && suggestionRound && <div className="role-planner-review">
      <strong>{completeSuggestions.length} {completeSuggestions.length === 1 ? "partido sugerido" : "partidos sugeridos"}</strong>
      <Button type="button" disabled={busy} onClick={() => { setSuggestions([]); setMoving(null); setMessage(""); }}>Descartar</Button>
      <Button type="button" className="primary" disabled={busy || !completeSuggestions.length} onClick={async () => {
        const notice = completeSuggestions.length === 1 ? "Partido programado." : `${completeSuggestions.length} partidos programados.`;
        if (await save(tournament.id, { planner_matches: completeSuggestions }, notice)) {
          const singles = suggestions.flatMap(draft => {
            if (completeDraft(draft)) return [];
            const side = draft.home_team_id != null ? "home" : "away";
            const id = draft[teamField[side]];
            return id == null ? [] : [[draftKeyOf(draft), { id, name: displayName(matrix, id), tournament: tournament.id, side } as StagedTeam] as const];
          });
          setStaged(current => ({ ...withoutStaged(current, ...suggestedBySlot.keys()), ...Object.fromEntries(singles) }));
          setSuggestions([]);
          setMoving(null);
        }
      }}>Confirmar sugerencia</Button>
    </div>}
    {!loading && active.length > 0 && (matrix || failed) && <div className="role-planner-board" data-closed={closedWeek}>
      {!closedWeek && <Card as="aside" key={tournament?.id} className="role-planner-teams" aria-label="Equipos para programar">
        <h2>Equipos</h2>
        {activeTeams.length ? <>
          <p>Arrastra un equipo a un espacio vacío o selecciónalo y toca el espacio.</p>
          <div className="role-planner-team-list">{activeTeams.map(team => {
            const selected = picked?.id === team.id;
            const item = { id: team.id, name: team.name, tournament: tournament.id };
            return <Button key={team.id} type="button" className={selected ? "primary" : ""} aria-pressed={selected}
              data-assigned={weekAssigned.has(team.id)} title={weekAssigned.has(team.id) ? "Ya tiene horario esta semana" : undefined}
              disabled={busy} draggable={!busy} onDragStart={event => { event.dataTransfer.setData("text/plain", String(team.id)); event.dataTransfer.effectAllowed = "copy"; }}
              onClick={() => { if (moving) setMessage(""); setMoving(null); setPicked(selected ? null : item); }}>
              <GripVertical aria-hidden="true" /><span>{team.name}</span><small title="Partidos jugados">{counts.get(team.id) ?? 0} PJ</small>
            </Button>;
          })}</div>
        </> : <p>{matrix ? "Este torneo aún no tiene equipos activos." : "No se pudieron cargar los equipos del torneo."}</p>}
      </Card>}
      <div className="role-planner-workspace">
      <Card as="section" className="role-planner-schedule" aria-label="Horarios de lunes a viernes">
        <header>
          <Button type="button" aria-label="Semana anterior" disabled={busy} onClick={() => navigateWeek(-7)}><ArrowLeft aria-hidden="true" /></Button>
          <h2>
            <span>{weekLabel.formatRange(utc(days[0]), utc(days[4]))}</span>
            <span className="role-planner-week-round" style={weekRoundNumbers.length === 1 ? roundColorStyle(weekRoundNumbers[0]) : undefined}>
              {weekRoundLabel}
            </span>
          </h2>
          <Button type="button" aria-label="Semana siguiente" disabled={busy} onClick={() => navigateWeek(7)}><ArrowRight aria-hidden="true" /></Button>
        </header>
        {closedWeek && <strong className="role-planner-closed">Jornada cerrada</strong>}
        <div>
          {calendar.some(slots => slots.length) ? <div className="role-planner-list-heading" aria-hidden="true">
            <span>Fecha</span><span>Hora</span><span>Jornada</span>
            <div className="role-planner-encounter"><span>Local</span><span></span><span>Visitante</span></div>
          </div> : <p>Sin horarios en esta semana.</p>}
          {calendar.map((slots, weekday) => slots.length > 0 && <div key={days[weekday]} className="role-planner-day" data-weekday={weekday}>
            {slots.map(slot => {
              const key = slotKey(slot);
              const match = slot.match;
              const matchRound = match ? rounds.find(item => item.id === match.round_id) : slot.round;
              const closed = roundEnded(matchRound, today);
              const suggested = closed ? undefined : suggestedBySlot.get(key);
              const shown = match ?? suggested;
              const first = staged[key];
              const names = data[slot.tournament.id];
              const bookable = !!weekAvailability && !!slot.round && !closed && !slot.occupied && !suggested;
              const movable = !closed && slot.preset && match && !match.played && match.home_goals == null && match.away_goals == null;
              const canCaptureScore = !!match && (match.played || (!!matchRound && matchRound.starts_on <= today));
              const date = dayLabel.format(utc(slot.day));
              const time = roleTimeLabel(slot.tournament.name, slot.start, slot.end);
              const slotLabel = `${date} · ${time}`;
              const homeName = shown?.home_team_id == null ? undefined : displayName(names, shown.home_team_id);
              const awayName = shown?.away_team_id == null ? undefined : displayName(names, shown.away_team_id);
              return <div key={`${key}/${slot.end}`} className="role-planner-slot" data-state={match ? "scheduled" : suggested ? "suggested" : first ? "staged" : "available"}
                data-target={bookable && (picked?.tournament === slot.tournament.id || !!moving)}>
                <time dateTime={slot.day} className="role-planner-slot-date">{date}</time>
                <div title={slot.extra ? `${slot.start}–${slot.end}` : undefined}>
                  <strong>{time}</strong>{slot.extra && <small className="role-planner-extra-label">Horario extra</small>}
                </div>
                <span className="role-planner-slot-round">{matchRound ? `J${matchRound.number}` : "—"}</span>
                {shown ? <PlannerEncounter key={`${shown.home_team_id}/${shown.away_team_id}`}
                  match={canCaptureScore ? match : undefined} home={homeName} away={awayName} label={slotLabel} busy={busy}
                  onSave={match && (score => save(slot.tournament.id, {
                    planner_score: { cross_id: match.id, home_team_id: match.home_team_id, away_team_id: match.away_team_id, round_id: match.round_id, score },
                  }, "Marcador guardado."))}>
                  {slotSides.map(side => {
                    const name = side === "home" ? homeName : awayName;
                    const className = name ? "role-planner-assigned-team" : "role-planner-drop";
                    const source = { kind: suggested ? "suggestion" : "match", key, side } as const;
                    const suggestedSide = suggested && (first ? first.side !== side : side === "home");
                    const description = name && (!suggested || completeDraft(suggested))
                      ? `Mover a ${name} · ${sideLabels[side]} · ${slotLabel}`
                      : `${sideLabels[side]} · ${slotLabel} · ${name ?? "Disponible"}`;
                    return <div key={side} className={`role-planner-drop-zone role-planner-${side}`}>
                      {movable || suggested ? <Button type="button" className={className} disabled={busy} draggable={!!name && !busy}
                        title={name ? `Mover a ${name}` : sideLabels[side]} aria-label={description}
                        aria-pressed={moving?.kind === source.kind && moving.key === key && moving.side === side}
                        onDragStart={event => startDrag(event, source)}
                        onDragOver={suggested ? allowDrop : undefined}
                        onDrop={suggested ? event => drop(event, slot, side) : undefined}
                        onClick={() => {
                          if (suggested && moving?.kind === "suggestion") void relocate(moving, slot, side);
                          else if (suggested && picked) void place(slot, picked, side);
                          else if (name) startMove(source);
                        }}>
                        {name && <><GripVertical className="role-planner-drag-grip" aria-hidden="true" /><span>{name}{suggestedSide && <small>Sugerido</small>}</span></>}
                      </Button> : <span className={className}>{name}{suggestedSide && <small>Sugerido</small>}</span>}
                      {name && (movable || suggested) && <Button type="button" className="role-planner-clear" disabled={busy}
                        aria-label={`Quitar a ${name} de este horario`} onClick={() => void unassign(slot, side, suggested)}>
                        <X aria-hidden="true" />
                      </Button>}
                    </div>;
                  })}
                  <span className="role-planner-vs">VS</span>
                </PlannerEncounter> : bookable ? <div className="role-planner-encounter">
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
                        }}>{placed && <><GripVertical className="role-planner-drag-grip" aria-hidden="true" /><span>{placed.name}</span></>}</Button>
                      {placed && <Button type="button" className="role-planner-clear" disabled={busy}
                        aria-label={`Quitar a ${placed.name} de este horario`}
                        onClick={() => void unassign(slot, side)}>
                        <X aria-hidden="true" />
                      </Button>}
                    </div>;
                  })}
                  <span className="role-planner-vs" onDragOver={busy ? undefined : allowDrop}
                    onDrop={busy ? undefined : event => drop(event, slot, first?.side === "home" ? "away" : "home")}>VS</span>
                </div> : <span className="role-planner-slot-unavailable">{closed ? "Sin partido" : slot.occupied ? "Ocupado en la sede" : slot.round ? "Disponibilidad pendiente" : "Sin jornada"}</span>}
              </div>;
            })}
          </div>)}
          {!closedWeek && <div className="role-planner-extra">
            {addingSlot && openDays.length ? <ExtraSlotForm days={openDays} optionsForDay={availableExtraSlots}
              canAdd={canAddSlot} onSave={addExtraSlot} onClose={() => setAddingSlot(false)} />
              : <Button type="button" className="role-planner-add-slot" onClick={() => setAddingSlot(true)}
                disabled={!matrix || !weekAvailability || loading || busy || !openDays.length}>
                <Plus aria-hidden="true" />Agregar horario
              </Button>}
          </div>}
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

function PlannerEncounter({ match, home, away, label, busy, onSave, children }: {
  match?: Cross; home?: string; away?: string; label: string; busy: boolean; children: ReactNode;
  onSave?: (score: { home_goals: number; away_goals: number }) => Promise<boolean>;
}) {
  const [homeGoals, setHomeGoals] = useState(String(match?.home_goals ?? ""));
  const [awayGoals, setAwayGoals] = useState(String(match?.away_goals ?? ""));
  const saving = useRef(false);
  async function saveScore() {
    if (!match || !onSave || busy || saving.current) return;
    if (!/^\d{1,3}$/.test(homeGoals) || !/^\d{1,3}$/.test(awayGoals)) return;
    const score = { home_goals: Number(homeGoals), away_goals: Number(awayGoals) };
    if (match.played && score.home_goals === match.home_goals && score.away_goals === match.away_goals) return;
    saving.current = true;
    try { await onSave(score); }
    finally { saving.current = false; }
  }
  if (!match) return <div className="role-planner-encounter">{children}</div>;
  return <div className="role-planner-encounter role-planner-score" role="group"
    aria-label={`Marcador · ${home} vs. ${away} · ${label}`} data-played={match.played}
    onBlur={event => {
      if (event.target instanceof HTMLInputElement &&
          !(event.relatedTarget instanceof HTMLInputElement && event.currentTarget.contains(event.relatedTarget))) {
        void saveScore();
      }
    }}
    onKeyDown={event => {
      if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        void saveScore();
      }
    }}>
    <Input className="role-planner-goals-home" aria-label={`Goles de ${home} (local)`} placeholder="–"
      type="number" inputMode="numeric" min={0} max={999} readOnly={busy} value={homeGoals} onChange={event => setHomeGoals(event.target.value)} />
    <Input className="role-planner-goals-away" aria-label={`Goles de ${away} (visitante)`} placeholder="–"
      type="number" inputMode="numeric" min={0} max={999} readOnly={busy} value={awayGoals} onChange={event => setAwayGoals(event.target.value)} />
    {children}
  </div>;
}

function ExtraSlotForm({ days, optionsForDay, canAdd, onSave, onClose }: {
  days: { day: string; round: Round }[]; optionsForDay: (day: string) => OfferedSlot[];
  canAdd: (slot: RoleSlot) => boolean; onSave: (slot: RoleSlot) => Promise<void>; onClose: () => void;
}) {
  const [day, setDay] = useState(() => (days.find(item => optionsForDay(item.day).length) ?? days[0]).day);
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
      {days.map(({ day, round }) => <option key={day} value={day}>{dayLabel.format(utc(day))} · Jornada {round.number}</option>)}
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
  const teams = [...new Set([...(matrix.matrix_team_ids ?? []), ...matrix.crosses.flatMap(cross => [cross.home_team_id, cross.away_team_id])])];
  const cells = gameRoleMatrixCells(matrix, teams, round.id);
  if (!teams.length) return null;
  return <Card as="section" className="role-planner-matrix" aria-label={`Matriz · Jornada ${round.number}`} style={roundColorStyle(round.number)}>
    <h2>Matriz · Jornada {round.number}</h2>
    <div className="role-planner-matrix-scroll" tabIndex={0} aria-label="Cruces de la jornada">
      <table style={{ minWidth: 116 + teams.length * 35 }}>
        <colgroup><col className="role-planner-matrix-team" />{teams.map(id => <col key={id} />)}</colgroup>
        <thead><tr><th scope="col">Equipos</th>{teams.map(id => <th key={id} scope="col" title={displayName(matrix, id)}>{displayName(matrix, id)}</th>)}</tr></thead>
        <tbody>{teams.map(away => <tr key={away}><th scope="row" title={displayName(matrix, away)}>{displayName(matrix, away)}</th>{teams.map(home => {
          const entries = cells.get(`${home}/${away}`);
          return <td key={home} data-match-state={entries ? entries[0].cross.played ? "played" : "pending" : undefined}>{entries ? entries.map(({ cross, meeting }) => {
            const time = cross.starts_at?.slice(0, 5);
            const score = cross.played && cross.home_goals != null && cross.away_goals != null ? `${cross.home_goals}–${cross.away_goals}` : null;
            const description = `Encuentro ${meeting} · ${displayName(matrix, cross.home_team_id)} vs. ${displayName(matrix, cross.away_team_id)} · ${cross.played ? "Jugado" : "Pendiente"}`;
            return <span key={cross.id ?? meeting} className="game-role-meeting" data-repeat={meeting >= 3}
              data-match-state={cross.played ? "played" : "pending"} title={description}>{score ?? time ?? "·"}</span>;
          }) : home === away ? "—" : "·"}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  </Card>;
}
