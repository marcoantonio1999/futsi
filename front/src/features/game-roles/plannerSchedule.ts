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
  const inRound = matrix.crosses.filter(cross => cross.round_id === round.id
    && [cross.home_team_id, cross.away_team_id].some(id => id === first || id === second));
  if (inRound.length) {
    const [cross] = inRound;
    if (inRound.length !== 1 || cross.played || cross.scheduled_on
      || ![first, second].includes(cross.home_team_id) || ![first, second].includes(cross.away_team_id)) return null;
    return [cross.home_team_id, cross.away_team_id] as const;
  }
  const exists = (home: number, away: number) => matrix.crosses.some(
    cross => cross.home_team_id === home && cross.away_team_id === away);
  if (!exists(first, second)) return [first, second] as const;
  return exists(second, first) ? null : [second, first] as const;
}

export function makePlannerMatch(round: Round, slot: RoleSlot, pair: readonly [number, number]): PlannerMatch {
  return { round_id: round.id, home_team_id: pair[0], away_team_id: pair[1],
    schedule: { scheduled_on: slot.day, starts_at: slot.start, ends_at: slot.end } };
}

export function suggestPlannerMatches(matrix: Matrix, round: Round, slots: RoleSlot[], reserved: ReadonlySet<number>) {
  const counts = playedCounts(matrix.crosses);
  const noteApplies = (id: number, slot: RoleSlot) => (matrix.team_notes ?? []).some(note => {
    if (note.team_id !== id) return false;
    if (note.kind === "permit") return note.round_id === round.id;
    return note.kind === "unavailable" && note.weekday === (new Date(slot.day + "T00:00:00Z").getUTCDay() + 6) % 7
      && (!note.starts_at || !note.ends_at || (note.starts_at.slice(0, 5) < slot.end && note.ends_at.slice(0, 5) > slot.start));
  });
  const eligible = matrix.teams.filter(team => team.is_active && !reserved.has(team.id) && team.id !== round.rest_team_id);
  const pairs = eligible.flatMap((first, index) => eligible.slice(index + 1).flatMap(second => {
    const pair = plannerPair(matrix, round, first.id, second.id);
    if (!pair) return [];
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
