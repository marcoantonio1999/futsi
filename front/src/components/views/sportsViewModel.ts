import type { StandingRow } from "../../types";

export function standingsForTournament(rows: StandingRow[], tournamentId?: number): StandingRow[] {
  // The combined endpoint ranks all tournaments together. Preserve its sporting
  // tiebreak order, then number the selected tournament independently.
  return rows.filter(row => row.tournament === tournamentId)
    .sort((a, b) => a.position - b.position)
    .map((row, index) => ({ ...row, position: index + 1, is_leader: index === 0 && row.played > 0 }));
}
