import type { StandingRow } from "../../types";
import { TableHeader } from "./shared";

export function TournamentStandingsTable({ rows }: { rows: StandingRow[] }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title="Tabla del torneo" count={rows.length} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Pos</th>
              <th className="px-4 py-3">Equipo</th>
              <th className="px-4 py-3">PJ</th>
              <th className="px-4 py-3">DG</th>
              <th className="px-4 py-3">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.team} className={`border-b border-zinc-100 ${row.is_leader ? "bg-amber-50" : ""}`}>
                <td className="px-4 py-3"><span className="grid size-8 place-items-center rounded-full bg-zinc-950 font-semibold text-white">{row.position}</span></td>
                <td className="px-4 py-3 font-medium">{row.team_name}{row.is_leader && <span className="ml-2 rounded-md bg-amber-200 px-2 py-1 text-xs text-amber-900">Lider</span>}</td>
                <td className="px-4 py-3">{row.played}</td>
                <td className={`px-4 py-3 font-semibold ${row.goal_difference >= 0 ? "text-emerald-700" : "text-red-700"}`}>{row.goal_difference > 0 ? "+" : ""}{row.goal_difference}</td>
                <td className="px-4 py-3 text-lg font-bold">{row.points}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">La tabla se calcula cuando hay partidos finalizados o en vivo.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
