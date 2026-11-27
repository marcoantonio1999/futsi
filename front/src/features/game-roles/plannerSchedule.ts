import type { Cross, Matrix, Round } from "./GameRoles";
import type { RoleSlot } from "./roleSchedule";

export type PlannerMatch = {
  round_id: number;
  home_team_id: number;
  away_team_id: number;
  schedule: { scheduled_on: string; starts_at: string; ends_at: string };
};

export type ScheduledRange = Pick<Cross, "scheduled_on" | "starts_at" | "ends_at">;
export type PlannerSuggestionSlot = RoleSlot & { placed?: { id: number; side: "home" | "away" } };

export function plannerOverlap(slot: RoleSlot, cross: ScheduledRange) {
  return cross.scheduled_on === slot.day && !!cross.starts_at && !!cross.ends_at
    && cross.starts_at.slice(0, 5) < slot.end && cross.ends_at.slice(0, 5) > slot.start;
}

export function playedCounts(crosses: Cross[]) {
  const counts = new Map<number, number>();
  for (const cross of crosses) if (cross.played) {
    for (const id of [cross.home_team_id, cross.away_team_id]) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export function plannerPair(round: Round, first: number, second: number) {
  if (first === second || round.rest_team_id === first || round.rest_team_id === second) return null;
  return [first, second] as const;
}

export function gameRoleMatrixCells(matrix: Matrix, teamIds: number[]) {
  const order = new Map(teamIds.map((id, index) => [id, index]));
  const rounds = new Map(matrix.rounds.map(round => [round.id, round]));
  const day = (cross: Cross) => cross.scheduled_on ?? rounds.get(cross.round_id)?.starts_on ?? "";
  const encounters = [...matrix.crosses].sort((first, second) =>
    day(first).localeCompare(day(second)) ||
    (first.starts_at ?? "").localeCompare(second.starts_at ?? "") ||
    (rounds.get(first.round_id)?.number ?? 0) - (rounds.get(second.round_id)?.number ?? 0) ||
    (first.id ?? 0) - (second.id ?? 0));
  const counts = new Map<string, number>();
  const cells = new Map<string, { cross: Cross; meeting: number }[]>();
  for (const cross of encounters) {
    const homeIndex = order.get(cross.home_team_id);
    const awayIndex = order.get(cross.away_team_id);
    if (homeIndex === undefined || awayIndex === undefined) continue;
    const [earlier, later] = homeIndex < awayIndex ? [cross.home_team_id, cross.away_team_id] : [cross.away_team_id, cross.home_team_id];
    const lower = `${earlier}/${later}`;
    const meeting = (counts.get(lower) ?? 0) + 1;
    counts.set(lower, meeting);
    const cell = meeting % 2 ? lower : `${later}/${earlier}`;
    const entries = cells.get(cell) ?? [];
    entries.push({ cross, meeting });
    cells.set(cell, entries);
  }
  return cells;
}

export function makePlannerMatch(round: Round, slot: RoleSlot, pair: readonly [number, number]): PlannerMatch {
  return { round_id: round.id, home_team_id: pair[0], away_team_id: pair[1],
    schedule: { scheduled_on: slot.day, starts_at: slot.start, ends_at: slot.end } };
}

export function suggestPlannerMatches(matrix: Matrix, round: Round, slots: PlannerSuggestionSlot[], reserved: ReadonlySet<number>) {
  const counts = playedCounts(matrix.crosses);
  const assignments = new Map<number, Cross[]>();
  for (const cross of matrix.crosses.filter(item => item.round_id === round.id)) {
    for (const id of [cross.home_team_id, cross.away_team_id]) assignments.set(id, [...(assignments.get(id) ?? []), cross]);
  }
  const noteApplies = (id: number, slot: RoleSlot) => (matrix.team_notes ?? []).some(note => {
    if (note.team_id !== id) return false;
    if (note.kind === "permit") return note.round_id === round.id;
    return note.kind === "unavailable" && note.weekday === (new Date(slot.day + "T00:00:00Z").getUTCDay() + 6) % 7
      && (!note.starts_at || !note.ends_at || (note.starts_at.slice(0, 5) < slot.end && note.ends_at.slice(0, 5) > slot.start));
  });
  const activeTeams = matrix.teams.filter(team => team.is_active);
  const eligible = activeTeams.filter(team => !reserved.has(team.id) && team.id !== round.rest_team_id
    && !assignments.get(team.id)?.some(cross => cross.played || cross.scheduled_on));
  function pairing(home: number, away: number, autoIds: number[], keepSide = false) {
    const pair = plannerPair(round, home, away);
    if (!pair || (keepSide && pair[0] !== home)) return [];
    if (autoIds.some(id => assignments.get(id)?.some(cross => cross.home_team_id !== pair[0] || cross.away_team_id !== pair[1]))) return [];
    const games = autoIds.map(id => counts.get(id) ?? 0);
    return [{ pair, autoIds, played: games.reduce((total, count) => total + count, 0), fewest: Math.min(...games) }];
  }
  const pairs = eligible.flatMap((first, index) => eligible.slice(index + 1).flatMap(second =>
    pairing(first.id, second.id, [first.id, second.id])));
  const candidates = slots.map(slot => {
    const placed = slot.placed;
    if (placed && !activeTeams.some(team => team.id === placed.id)) return { slot, options: [] };
    const options = placed ? eligible.flatMap(opponent => {
      const [home, away] = placed.side === "home" ? [placed.id, opponent.id] : [opponent.id, placed.id];
      return pairing(home, away, [opponent.id], true);
    }) : pairs;
    return { slot, options: options.filter(({ autoIds }) => !autoIds.some(id => noteApplies(id, slot))) };
  }).sort((a, b) => Number(!!b.slot.placed) - Number(!!a.slot.placed) || a.options.length - b.options.length);
  let bestPlan: PlannerMatch[] = [];
  let bestPlayed = Infinity;
  let bestFilled = 0;
  // Try a few tie orders to avoid leaving a slot empty because of an equivalent pairing.
  for (let attempt = 0; attempt < 6; attempt++) {
    const used = new Set<number>();
    let played = 0;
    let filled = 0;
    const plan: PlannerMatch[] = [];
    for (const { slot, options } of candidates) {
      const best = options.filter(item => !item.autoIds.some(id => used.has(id)))
        .map(item => ({ ...item, tie: Math.random() }))
        .sort((a, b) => a.played - b.played || a.fewest - b.fewest || a.tie - b.tie)[0];
      if (!best) continue;
      best.autoIds.forEach(id => used.add(id));
      if (slot.placed) filled++;
      played += best.played;
      plan.push(makePlannerMatch(round, slot, best.pair));
    }
    if (filled > bestFilled || (filled === bestFilled && (plan.length > bestPlan.length || (plan.length === bestPlan.length && played < bestPlayed)))) {
      bestPlan = plan;
      bestPlayed = played;
      bestFilled = filled;
    }
  }
  return bestPlan;
}
