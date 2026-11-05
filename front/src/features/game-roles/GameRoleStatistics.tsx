import { Card } from "../../components/ui/enrollment-ui";
import type { StandingRow } from "../../types";

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
  const scored = rows.some(row => row.played > 0);
  const scorers = rows.filter(row => row.played > 0)
    .sort((a, b) => b.goals_for - a.goals_for || a.position - b.position);
  return <div className="game-role-statistics">
    <Card as="section" className="game-role-history" aria-labelledby="game-role-standings-title">
      <h2 id="game-role-standings-title">Tabla de posiciones</h2>
      <p>Orden por puntos, diferencia de goles y goles a favor.</p>
      {withoutScore > 0 && <p className="game-role-score-notice" role="status">
        {withoutScore === 1 ? "Hay 1 partido jugado sin marcador." : `Hay ${withoutScore} partidos jugados sin marcador.`}
        {" "}Captura los resultados en Historial para incluirlos en las tablas.
      </p>}
      {!scored && <p>La clasificación se calcula al guardar el primer marcador.</p>}
      {rows.length > 0 && <div className="game-roles-grid-scroll" role="region" aria-label="Posiciones por equipo" tabIndex={0}>
        <table className="game-role-stat-table">
          <thead><tr>
            <th scope="col">Pos.</th><th scope="col">Equipo</th>
            {columns.map(([label, title]) => <th key={label} scope="col"><abbr title={title}>{label}</abbr></th>)}
          </tr></thead>
          <tbody>{rows.map(row => <tr key={row.team} data-leader={row.is_leader}>
            <td>{scored ? row.position : "—"}</td><th scope="row">{row.team_name}</th>
            {columns.map(([, , key]) => <td key={key}>{key === "points" ? <strong>{row[key]}</strong> : row[key]}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    </Card>
    <Card as="section" className="game-role-history" aria-labelledby="game-role-scorers-title">
      <h2 id="game-role-scorers-title">Tabla de goleo</h2>
      <p>Equipos ordenados por goles a favor. En empate, se conserva el orden de la tabla de posiciones.</p>
      {scorers.length ? <div className="game-roles-grid-scroll" role="region" aria-label="Goleo por equipo" tabIndex={0}>
        <table className="game-role-stat-table">
          <thead><tr><th scope="col">Pos.</th><th scope="col">Equipo</th><th scope="col"><abbr title="Goles a favor">GF</abbr></th></tr></thead>
          <tbody>{scorers.map((row, index) => <tr key={row.team}>
            <td>{index + 1}</td><th scope="row">{row.team_name}</th><td><strong>{row.goals_for}</strong></td>
          </tr>)}</tbody>
        </table>
      </div> : <p>Todavía no hay marcadores registrados.</p>}
    </Card>
  </div>;
}
