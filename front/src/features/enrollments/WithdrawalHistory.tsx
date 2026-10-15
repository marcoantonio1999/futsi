import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "../../api";
import { Eye } from "lucide-react";
import { useEnrollmentViewState, useEnrollmentDetail, useEnrollmentScrollReady } from './EnrollmentNavigation';

export type WithdrawalRecord = {
  id: number; name: string; team: string; tournament: string; withdrawn_at: string;
  documents: { id: number; kind: string }[];
};
type Filters = {
  tournaments: { tournament: string; team_record__tournament_id: number | null }[];
  teams: { team: string; team_record_id: number | null; team_record__tournament_id: number | null }[];
};
type Result = { results: WithdrawalRecord[]; count: number; withdrawal_filters: Filters };
const dateLabel = (value: string) => new Date(value).toLocaleString("es-MX");

export function WithdrawalHistory({ token, revision, renderSignature }: {
  token: string; revision: number; renderSignature: (document: { id: number; kind: string }, name: string) => ReactNode;
}) {
  const [search, setSearch] = useEnrollmentViewState('withdrawals.search', "");
  const [query, setQuery] = useEnrollmentViewState('withdrawals.query', "");
  const [tournament, setTournament] = useEnrollmentViewState('withdrawals.tournament', "");
  const [team, setTeam] = useEnrollmentViewState('withdrawals.team', "");
  const [from, setFrom] = useEnrollmentViewState('withdrawals.from', "");
  const [to, setTo] = useEnrollmentViewState('withdrawals.to', "");
  const [page, setPage] = useEnrollmentViewState('withdrawals.page', 1);
  const [result, setResult] = useState<Result>({ results: [], count: 0, withdrawal_filters: { tournaments: [], teams: [] } });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useEnrollmentDetail(result.results);
  useEnrollmentScrollReady(!busy);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (query === search.trim()) return;
    const timer = window.setTimeout(() => { setQuery(search.trim()); setPage(1); }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ withdrawn_only: "true", page: String(page) });
    if (query) params.set("search", query);
    if (tournament) params.set("tournament", tournament);
    if (team) params.set("team", team);
    if (from) params.set("date_from", from);
    if (to) params.set("date_to", to);
    setBusy(true); setError("");
    apiRequest<Result>("/player-enrollments/?" + params, token, { signal: controller.signal })
      .then(body => { if (!controller.signal.aborted) { setResult(body); const lastPage = Math.max(1, Math.ceil(body.count / 25)); if (page > lastPage) setPage(lastPage); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo cargar el histórico."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [token, revision, query, tournament, team, from, to, page]);
  useEffect(() => {
    if (detail) dialog.current?.showModal();
    else { dialog.current?.close(); opener.current?.focus(); }
  }, [detail]);
  const options = result.withdrawal_filters;
  const signature = detail?.documents.find(document => document.kind === "withdrawal_signature");
  return <section className="operator-controls withdrawal-history">
    <header className="withdrawal-history-heading"><h2>Histórico de bajas</h2><p>Consulta los jugadores dados de baja y la firma registrada en cada solicitud.</p></header>
    <div className="control-grid withdrawal-history-filters">
      <label>Jugador<input value={search} onChange={event => setSearch(event.target.value)} maxLength={160} placeholder="Buscar por nombre" /></label>
      <label>Torneo<select value={tournament} onChange={event => { setTournament(event.target.value); setTeam(""); setPage(1); }}><option value="">Todos los torneos</option>{[...new Set(options.tournaments.map(row => row.tournament))].map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Equipo<select value={team} onChange={event => { setTeam(event.target.value); setPage(1); }}><option value="">Todos los equipos</option>{[...new Set(options.teams.filter(row => !tournament || options.tournaments.some(item => item.tournament === tournament && item.team_record__tournament_id === row.team_record__tournament_id)).map(row => row.team))].map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Desde<input type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></label>
      <label>Hasta<input type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></label>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="withdrawal-history-count" role="status">{busy ? "Cargando bajas…" : `${result.count} bajas encontradas`}</p>
    {!busy && !error && <><div className="withdrawal-history-scroll" role="region" aria-label="Histórico de bajas de jugadores" tabIndex={0}><table className="withdrawal-history-table"><thead><tr><th scope="col">Jugador</th><th scope="col">Torneo</th><th scope="col">Equipo</th><th scope="col">Fecha de baja</th><th scope="col">Detalle</th></tr></thead><tbody>{result.results.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td>{row.tournament}</td><td>{row.team}</td><td><time dateTime={row.withdrawn_at}>{new Date(row.withdrawn_at).toLocaleDateString("es-MX")}<small>{new Date(row.withdrawn_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</small></time></td><td><button className="withdrawal-detail-button" type="button" onClick={event => { opener.current = event.currentTarget; setDetail(row); }}><Eye size={16} aria-hidden="true" />Ver detalle y firma</button></td></tr>)}{!result.results.length && <tr><td colSpan={5} className="withdrawal-history-empty">No hay bajas con estos filtros.</td></tr>}</tbody></table></div>
      <div className="withdrawal-pagination"><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Anterior</button><span>Página {page} de {Math.max(1, Math.ceil(result.count / 25))}</span><button disabled={page * 25 >= result.count} onClick={() => setPage(value => value + 1)}>Siguiente</button></div></>}
    <dialog ref={dialog} className="withdrawal-detail-dialog" onCancel={() => setDetail(null)} onClose={() => setDetail(null)}>
      {detail && <><header><h2>Detalle de baja</h2><button type="button" onClick={() => setDetail(null)} aria-label="Cerrar detalle">Cerrar</button></header><dl><dt>Jugador</dt><dd>{detail.name}</dd><dt>Torneo</dt><dd>{detail.tournament}</dd><dt>Equipo</dt><dd>{detail.team}</dd><dt>Fecha de baja</dt><dd>{dateLabel(detail.withdrawn_at)}</dd></dl><h3>Firma registrada de la baja</h3>{signature ? <div className="withdrawal-signature-preview">{renderSignature(signature, detail.name)}</div> : <p>No hay firma registrada para esta baja.</p>}<p>En las bajas múltiples, la firma es común para los integrantes seleccionados. Los registros antiguos no identifican por nombre a quien firmó.</p></>}
    </dialog>
  </section>;
}
