import { useEffect, useState } from 'react';
import { Search, UsersRound } from 'lucide-react';
import { apiRequest } from '../../api';
import { useEnrollmentNavigation, useEnrollmentScrollReady, useEnrollmentViewState } from './EnrollmentNavigation';
import { EnrollmentRegistrationSheet } from './EnrollmentRegistrationSheet';
import './playersDirectory.css';

type Option = { id: number; name: string; site_id: number | null; tournament_id: number | null };
type Participation = { id: string; team: string; tournament: string; site: string; status: string;
  is_active: boolean; is_delegate: boolean; signed_at: string | null; withdrawn_at: string | null };
type Player = { id: string; name: string; birth_date: string | null; is_active: boolean; legacy: boolean; participations: Participation[] };
type Result = { results: Player[]; count: number; page: number;
  totals: { total: number; active: number; inactive: number; participations: number; legacy: number };
  filters: { sites: Option[]; tournaments: Option[]; teams: Option[] } };
const empty: Result = { results: [], count: 0, page: 1, totals: { total: 0, active: 0, inactive: 0, participations: 0, legacy: 0 }, filters: { sites: [], tournaments: [], teams: [] } };
const dateLabel = (date: string) => new Date(date.length === 10 ? date + 'T12:00:00' : date).toLocaleDateString('es-MX');

export function PlayersDirectory({ token, revision }: { token: string; revision: number }) {
  const navigation=useEnrollmentNavigation();
  const [localSheet,setLocalSheet]=useState<number|null>(null);
  const sheetId=navigation ? navigation.screen.detail : localSheet;
  function openSheet(id:number) { if(navigation)navigation.navigate({detail:id});else setLocalSheet(id); }
  const [search, setSearch] = useEnrollmentViewState('players.search', '');
  const [query, setQuery] = useEnrollmentViewState('players.query', '');
  const [site, setSite] = useEnrollmentViewState('players.site', '');
  const [tournament, setTournament] = useEnrollmentViewState('players.tournament', '');
  const [team, setTeam] = useEnrollmentViewState('players.team', '');
  const [status, setStatus] = useEnrollmentViewState('players.status', '');
  const [source, setSource] = useEnrollmentViewState('players.source', 'enrollments');
  const [page, setPage] = useEnrollmentViewState('players.page', 1);
  const [result, setResult] = useState<Result>(empty);
  const [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEnrollmentScrollReady(!busy);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries({ search: query, site_id: site, tournament_id: tournament, team_id: team, status, source })) if (value) params.set(key, value);
    setBusy(true); setError('');
    apiRequest<Result>('/player-enrollments/players/?' + params, token, { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) { setResult(body); if (body.page !== page) setPage(body.page); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No pudimos cargar los jugadores.'); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [token, revision, query, site, tournament, team, status, source, page, retry]);
  const tournaments = result.filters.tournaments.filter(item => !site || String(item.site_id) === site);
  const teams = result.filters.teams.filter(item => (!site || String(item.site_id) === site) && (!tournament || String(item.tournament_id) === tournament));
  if(sheetId) return <EnrollmentRegistrationSheet key={sheetId} enrollmentId={sheetId} token={token} onBack={()=>{if(navigation)navigation.back();else setLocalSheet(null);}}/>;
  return <section className="operator-controls players-directory no-print" aria-labelledby="players-title" aria-busy={busy}>
    <header className="players-intro"><p className="players-eyebrow">TORNEOS / DIRECTORIO HISTÓRICO</p><h2 id="players-title"><UsersRound size={25} aria-hidden="true" />Jugadores</h2><p>Una persona, todas sus participaciones. Consulta sus equipos y torneos activos y anteriores.</p></header>
    <div className="players-totals" aria-label="Totales del historial autorizado">
      <div><span>{source === 'legacy' ? 'Fichas anteriores' : 'Jugadores únicos'}</span><strong>{busy && !result.totals.total ? '—' : result.totals.total}</strong></div>
      <div className="players-total-active"><span>Activos</span><strong>{busy && !result.totals.total ? '—' : result.totals.active}</strong></div>
      <div><span>Inactivos</span><strong>{busy && !result.totals.total ? '—' : result.totals.inactive}</strong></div>
    </div>
    <details className="players-count-help"><summary>Cómo se cuentan los jugadores · {result.totals.participations} participaciones</summary><p className="players-explanation">Totales de todo el historial disponible. Activo significa que conserva al menos una inscripción vigente en un equipo, torneo y sede activos. Una sanción temporal no equivale a una baja.</p>
    {result.totals.legacy > 0 && <p className="players-legacy-note">Fichas anteriores sin fecha de nacimiento: {result.totals.legacy}. Consúltalas cambiando el origen. No se incluyen en el conteo de jugadores únicos ni se fusionan por nombre. Las inscripciones con el mismo nombre completo y nacimiento se agrupan.</p>}
    </details>
    <form className="players-filters" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}>
      <label className="players-search">Jugador<div><input value={search} maxLength={160} onChange={event => setSearch(event.target.value)} placeholder="Buscar nombre completo" /><button type="submit"><Search size={17} aria-hidden="true" />Buscar</button></div></label>
      <label>Sede<select value={site} onChange={event => { setSite(event.target.value); setTournament(''); setTeam(''); setPage(1); }}><option value="">Todas las sedes</option>{result.filters.sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Torneo<select value={tournament} onChange={event => { setTournament(event.target.value); setTeam(''); setPage(1); }}><option value="">Todos los torneos</option>{tournaments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Equipo<select value={team} onChange={event => { setTeam(event.target.value); setPage(1); }}><option value="">Todos los equipos</option>{teams.map(item => <option key={item.id} value={item.id}>{item.name} · {result.filters.tournaments.find(t => t.id === item.tournament_id)?.name}</option>)}</select></label>
      <label>Estado del jugador<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></select></label>
      <label>Origen de los registros<select value={source} onChange={event => { setSource(event.target.value); setSite(''); setTournament(''); setTeam(''); setPage(1); }}><option value="enrollments">Inscripciones · jugadores únicos</option><option value="legacy">Fichas anteriores · sin nacimiento</option></select></label>
    </form>
    {error && <p className="error" role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Volver a intentar</button></p>}
    <p className="players-result-count" role="status">{busy ? 'Cargando jugadores…' : `${result.count} ${source === 'legacy' ? 'fichas anteriores' : 'jugadores'} encontrados con estos filtros`}</p>
    {!busy && !error && <><div className="players-table-scroll"><table className="players-table"><thead><tr><th scope="col">Jugador</th><th scope="col">Estado general</th><th scope="col">Equipos y torneos · historial completo</th><th scope="col">Hoja de inscripción</th></tr></thead><tbody>
      {result.results.map(player => <tr key={player.id}><th scope="row"><strong>{player.name}</strong><small>{player.birth_date ? `Nacimiento: ${dateLabel(player.birth_date)}` : 'Ficha anterior · sin nacimiento'}</small></th><td><span className={`players-state ${player.is_active ? 'is-active' : 'is-inactive'}`}>{player.is_active ? 'Activo' : 'Inactivo'}</span><small>{player.participations.length} {player.participations.length === 1 ? 'participación' : 'participaciones'}</small></td><td><ul className="players-participations">{player.participations.map(item => <li key={item.id}><div><strong>{item.team}</strong><span>{item.tournament} · {item.site}</span>{item.is_delegate && <small>Delegado de este equipo</small>}<small>{item.signed_at ? `Inscripción: ${dateLabel(item.signed_at)}` : 'Registro anterior'}{item.withdrawn_at ? ` · Baja: ${dateLabel(item.withdrawn_at)}` : ''}</small></div><span className={`players-state ${item.is_active ? 'is-active' : 'is-inactive'}`}>{item.status}</span></li>)}</ul></td><td><div className="players-registration-actions">{player.participations.map(item => /^enrollment:[1-9]\d*$/.test(item.id) ? <div key={item.id}><button type="button" aria-label={`Ver hoja de inscripción de ${player.name}, ${item.team}, ${item.tournament}`} onClick={()=>openSheet(Number(item.id.split(':')[1]))}>Ver hoja de inscripción</button><small>{item.team} · {item.tournament}</small></div> : <p key={item.id}>Ficha anterior sin hoja de inscripción firmada.</p>)}</div></td></tr>)}
      {!result.results.length && <tr><td colSpan={4} className="players-empty">No hay jugadores con estos filtros.</td></tr>}
    </tbody></table></div><nav className="players-pagination" aria-label="Páginas de jugadores"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page} de {Math.max(1, Math.ceil(result.count / 25))}</span><button type="button" disabled={page * 25 >= result.count} onClick={() => setPage(value => value + 1)}>Siguiente</button></nav></>}
    <p className="players-footnote">Se muestran los registros conservados; este histórico no recupera torneos o inscripciones eliminados definitivamente. Los filtros seleccionan personas y se conserva visible su historial completo.</p>
  </section>;
}
