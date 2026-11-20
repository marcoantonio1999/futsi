import { useState } from "react";
import { Card } from "../../components/ui/enrollment-ui";
import type { StandingRow } from "../../types";
import { RolePageButtons } from "./RolePageButtons";

const columns = [
  ["JJ", "Juegos jugados", "played"],
  ["JG", "Juegos ganados", "won"],
  ["JP", "Juegos perdidos", "lost"],
  ["JE", "Juegos empatados", "drawn"],
  ["GF", "Goles a favor", "goals_for"],
  ["GC", "Goles en contra", "goals_against"],
  ["DG", "Diferencia de goles", "goal_difference"],
  ["PTS", "Puntos", "points"],
] as const;

export function GameRoleStatistics({ rows, withoutScore }: { rows: StandingRow[]; withoutScore: number }) {
  const [positionIndex, setPositionPage] = useState(0);
  const [goalsIndex, setGoalsPage] = useState(0);
  const pageSize = 4;
  const scored = rows.some(row => row.played > 0);
  const scorers = rows.filter(row => row.played > 0)
    .sort((a, b) => b.goals_for - a.goals_for || a.position - b.position);
  const positionPages = Math.ceil(rows.length / pageSize);
  const goalsPages = Math.ceil(scorers.length / pageSize);
  const positionPage = Math.min(positionIndex, Math.max(0, positionPages - 1));
  const goalsPage = Math.min(goalsIndex, Math.max(0, goalsPages - 1));
  return <div className="game-role-statistics">
    {withoutScore > 0 && <p className="game-role-score-notice" role="status">
      {withoutScore === 1 ? "1 partido jugado sin marcador." : `${withoutScore} partidos jugados sin marcador.`}
    </p>}
    <Card as="section" className="game-role-history game-role-standings" aria-labelledby="game-role-standings-title">
      <h2 id="game-role-standings-title">Tabla de posiciones</h2>
      <div role="region" aria-label="Posiciones por equipo">
        <table className="game-role-stat-table">
          <colgroup><col className="game-role-stat-number" /><col />{columns.map(([label]) => <col key={label} className="game-role-stat-number" />)}</colgroup>
          <thead><tr>
            <th scope="col">Pos.</th><th scope="col">Equipo</th>
            {columns.map(([label, title]) => <th key={label} scope="col"><abbr title={title}>{label}</abbr></th>)}
          </tr></thead>
          <tbody>{rows.slice(positionPage * pageSize, (positionPage + 1) * pageSize).map(row => <tr key={row.team} data-leader={row.is_leader}>
            <td>{scored ? row.position : "—"}</td><th scope="row" title={row.team_name}>{row.team_name}</th>
            {columns.map(([, , key]) => <td key={key}>{key === "points" ? <strong>{row[key]}</strong> : row[key]}</td>)}
          </tr>)}
            {!rows.length && <tr><td colSpan={columns.length + 2}>Aún no hay equipos.</td></tr>}
          </tbody>
        </table>
        <RolePageButtons page={positionPage} count={positionPages} onChange={setPositionPage} label="Posiciones" />
      </div>
    </Card>
    <Card as="section" className="game-role-history game-role-scorers" aria-labelledby="game-role-scorers-title">
      <h2 id="game-role-scorers-title">Tabla de goleo</h2>
      {scorers.length ? <div role="region" aria-label="Goleo por equipo">
        <table className="game-role-stat-table">
          <colgroup><col className="game-role-stat-number" /><col /><col className="game-role-stat-number" /></colgroup>
          <thead><tr><th scope="col">Pos.</th><th scope="col">Equipo</th><th scope="col"><abbr title="Goles a favor">GF</abbr></th></tr></thead>
          <tbody>{scorers.slice(goalsPage * pageSize, (goalsPage + 1) * pageSize).map((row, index) => <tr key={row.team}>
            <td>{goalsPage * pageSize + index + 1}</td><th scope="row" title={row.team_name}>{row.team_name}</th><td><strong>{row.goals_for}</strong></td>
          </tr>)}</tbody>
        </table>
        <RolePageButtons page={goalsPage} count={goalsPages} onChange={setGoalsPage} label="Goleo" />
      </div> : <p>Todavía no hay marcadores registrados.</p>}
    </Card>
  </div>;
}
