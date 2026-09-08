import { useState } from "react";
import { Radio, Trophy } from "lucide-react";
import type { AppData, Match } from "../../types";
import { SelectInput } from "./shared";
import { MatchScoreCard } from "./sportsDetails";
import { standingsForTournament } from "./sportsViewModel";

const statusLabels = { live: "En vivo", scheduled: "Programado", finished: "Finalizado", canceled: "Cancelado" };
const statusOrder = { live: 0, scheduled: 1, finished: 2, canceled: 3 };

export function SportsCompetition({ data, canEdit, onUpdateMatch }: { data: AppData; canEdit: boolean; onUpdateMatch: (id: number, payload: unknown) => Promise<void> }) {
  const [tournamentId, setTournamentId] = useState("");
  const [status, setStatus] = useState("active");
  const [limit, setLimit] = useState(6);
  const tournament = data.tournaments.find(row => String(row.id) === tournamentId) || data.tournaments.find(row => row.is_active) || data.tournaments[0];
  const matches = data.matches.filter(row => row.tournament === tournament?.id);
  const standings = standingsForTournament(data.standings, tournament?.id);
  const filtered = matches.filter(row => !status || (status === "active" ? ["live", "scheduled"].includes(row.status) : row.status === status))
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || (a.status === "finished" ? b.played_on.localeCompare(a.played_on) : a.played_on.localeCompare(b.played_on)) || (a.starts_at || "").localeCompare(b.starts_at || "") || a.id - b.id);
  return <div data-testid="sports-competition">
    <header className="sports-header"><div><p className="sports-eyebrow">Torneos / Competición</p><h2>Marcadores y posiciones</h2></div><SelectInput label="Torneo" value={String(tournament?.id || "")} onChange={event => { setTournamentId(event.target.value); setLimit(6); }}>{!data.tournaments.length && <option value="">Sin torneos registrados</option>}{data.tournaments.map(row => <option key={row.id} value={row.id}>{row.name}{row.is_active ? "" : " · Inactivo"}</option>)}</SelectInput></header>
    <div className="sports-summary" aria-label="Estado de los partidos">
      <div className="live"><span>En vivo</span><strong>{matches.filter(row => row.status === "live").length}</strong></div>
      <div className="upcoming"><span>Programados</span><strong>{matches.filter(row => row.status === "scheduled").length}</strong></div>
      <div className="done"><span>Finalizados</span><strong>{matches.filter(row => row.status === "finished").length}</strong></div>
    </div>
    <section className="sports-surface">
      <header className="sports-section-header"><div><h3><Radio size={18} />Marcadores</h3><p>En vivo primero, después los próximos partidos.</p></div><SelectInput label="Mostrar partidos" value={status} onChange={event => { setStatus(event.target.value); setLimit(6); }}><option value="active">En vivo y programados</option><option value="live">Solo en vivo</option><option value="scheduled">Programados</option><option value="finished">Finalizados</option><option value="canceled">Cancelados</option><option value="">Todos</option></SelectInput></header>
      <div className="sports-matches">{filtered.slice(0, limit).map(match => <Scoreboard key={match.id} match={match} canEdit={canEdit} onUpdateMatch={onUpdateMatch} />)}</div>
      {!filtered.length && <p className="sports-empty">{tournament ? "No hay partidos con este estado en el torneo seleccionado." : "Registra un torneo y sus partidos para ver los marcadores."}</p>}
      {filtered.length > limit && <div className="sports-more"><button className="sports-button secondary" onClick={() => setLimit(current => current + 6)}>Ver más partidos ({filtered.length - limit} restantes)</button></div>}
    </section>
    <section className="sports-surface sports-standings">
      <header className="sports-section-header"><div><h3><Trophy size={18} />Tabla de posiciones</h3><p>{tournament?.name || "Sin torneo seleccionado"}</p></div><span className="sports-badge done">{standings.length} equipos</span></header>
      <div className="sports-table-scroll" role="region" aria-label="Tabla de posiciones, desplázate horizontalmente para ver todas las columnas" tabIndex={0}><table><caption className="sr-only">Posiciones de {tournament?.name || "torneo"}</caption><thead><tr><th scope="col">Pos.</th><th scope="col">Equipo</th>{[["PJ", "Partidos jugados"], ["G", "Ganados"], ["E", "Empatados"], ["P", "Perdidos"], ["GF", "Goles a favor"], ["GC", "Goles en contra"], ["DG", "Diferencia de goles"], ["Pts", "Puntos"]].map(([label, title]) => <th key={label} scope="col"><abbr title={title}>{label}</abbr></th>)}</tr></thead><tbody>
        {standings.map(row => <tr key={row.team} className={row.is_leader ? "sports-leader" : ""}><td><span className="sports-position">{row.position}</span></td><th scope="row">{row.team_name}{row.is_leader && <span className="sports-leader-label">Líder</span>}</th><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.goals_for}</td><td>{row.goals_against}</td><td>{row.goal_difference > 0 ? "+" : ""}{row.goal_difference}</td><td className="sports-points">{row.points}</td></tr>)}
        {!standings.length && <tr><td colSpan={10} className="sports-empty">Aún no hay posiciones disponibles para este torneo.</td></tr>}
      </tbody></table></div>
      <p className="sports-table-note">Orden: puntos, diferencia de goles y goles a favor. Los partidos en vivo pueden cambiar las posiciones.</p>
    </section>
  </div>;
}

export function Scoreboard({ match, canEdit, onUpdateMatch }: { match: Match; canEdit: boolean; onUpdateMatch: (id: number, payload: unknown) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const playedOn = new Date(`${match.played_on}T12:00:00`);
  const date = Number.isNaN(playedOn.getTime()) ? match.played_on : playedOn.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  return <article className={`sports-scoreboard ${match.status}`}>
    <header><span className={`sports-badge ${match.status === "finished" ? "done" : match.status === "scheduled" ? "upcoming" : match.status}`}>{statusLabels[match.status]}</span><span>Jornada {match.round_number || "—"}</span></header>
    <div className="sports-scoreline"><span>{match.home_team_name}</span><strong aria-label={`Marcador ${match.home_goals} a ${match.away_goals}`}>{match.home_goals}<i>:</i>{match.away_goals}</strong><span>{match.away_team_name}</span></div>
    <p className="sports-match-time">{date} · {match.starts_at?.slice(0, 5) || "Horario por definir"}{match.site_name ? ` · ${match.site_name}` : ""}</p>
    {canEdit && <><button className="sports-edit-score" aria-expanded={editing} aria-label={`${editing ? "Cerrar edición" : "Editar marcador"}: ${match.home_team_name} contra ${match.away_team_name}`} onClick={() => setEditing(value => !value)}>{editing ? "Cerrar edición" : "Editar marcador y partido"}</button>{editing && <div className="sports-match-editor"><MatchScoreCard match={match} canEdit onUpdateMatch={onUpdateMatch} /></div>}</>}
  </article>;
}
