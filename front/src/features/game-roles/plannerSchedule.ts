import type { Cross, Matrix, Round } from "./GameRoles";
import type { RoleSlot } from "./roleSchedule";

export type PlannerMatch = {
  round_id: number;
  home_team_id: number;
  away_team_id: number;
  schedule: { scheduled_on: string; starts_at: string; ends_at: string };
};

export function plannerOverlap(slot: RoleSlot, cross: Cross) {
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

export function plannerPair(matrix: Matrix, round: Round, first: number, second: number) {
  if (first === second || round.rest_team_id === first || round.rest_team_id === second) return null;
  const find = (home: number, away: number) => matrix.crosses.find(
    cross => cross.home_team_id === home && cross.away_team_id === away);
  const direct = find(first, second);
  const reverse = find(second, first);
  const awaitingSchedule = (cross?: Cross) => cross && cross.round_id === round.id && !cross.played && !cross.scheduled_on;
  if (awaitingSchedule(direct)) return [first, second] as const;
  if (awaitingSchedule(reverse)) return [second, first] as const;
  if (!direct) return [first, second] as const;
  return reverse ? null : [second, first] as const;
}

export function makePlannerMatch(round: Round, slot: RoleSlot, pair: readonly [number, number]): PlannerMatch {
  return { round_id: round.id, home_team_id: pair[0], away_team_id: pair[1],
    schedule: { scheduled_on: slot.day, starts_at: slot.start, ends_at: slot.end } };
}

export function suggestPlannerMatches(matrix: Matrix, round: Round, slots: RoleSlot[], reserved: ReadonlySet<number>) {
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
  const eligible = matrix.teams.filter(team => team.is_active && !reserved.has(team.id) && team.id !== round.rest_team_id
    && !assignments.get(team.id)?.some(cross => cross.played || cross.scheduled_on));
  const pairs = eligible.flatMap((first, index) => eligible.slice(index + 1).flatMap(second => {
    const pair = plannerPair(matrix, round, first.id, second.id);
    if (!pair) return [];
    if ([...(assignments.get(first.id) ?? []), ...(assignments.get(second.id) ?? [])]
      .some(cross => cross.home_team_id !== pair[0] || cross.away_team_id !== pair[1])) return [];
    const a = counts.get(first.id) ?? 0;
    const b = counts.get(second.id) ?? 0;
    return [{ pair, played: a + b, fewest: Math.min(a, b) }];
  }));
  const candidates = slots.map(slot => ({ slot, options: pairs.filter(({ pair }) => !pair.some(id => noteApplies(id, slot))) }))
    .sort((a, b) => a.options.length - b.options.length);
  let bestPlan: PlannerMatch[] = [];
  let bestPlayed = Infinity;
  // Try a few tie orders to avoid leaving a slot empty because of an equivalent pairing.
  for (let attempt = 0; attempt < 6; attempt++) {
    const used = new Set<number>();
    let played = 0;
    const plan: PlannerMatch[] = [];
    for (const { slot, options } of candidates) {
      const best = options.filter(item => !item.pair.some(id => used.has(id)))
        .map(item => ({ ...item, tie: Math.random() }))
        .sort((a, b) => a.played - b.played || a.fewest - b.fewest || a.tie - b.tie)[0];
      if (!best) continue;
      best.pair.forEach(id => used.add(id));
      played += best.played;
      plan.push(makePlannerMatch(round, slot, best.pair));
    }
    if (plan.length > bestPlan.length || (plan.length === bestPlan.length && played < bestPlayed)) {
      bestPlan = plan;
      bestPlayed = played;
    }
  }
  return bestPlan;
}
