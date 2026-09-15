import { useEffect, useState } from 'react';
import { apiRequest } from '../../api';
import './connections.css';

type Kind = 'academy' | 'veronica';
type Connection = { channel: string; label: string; phone_number: string; phone_number_id: string; waba_id: string; verified_name: string; status: string; quality: string; name_status: string; verified: boolean; detail: string; checked_at: string; kind: Kind };
type Template = { id?: string; name: string; language: string; status: string; category: string; text: string; rejected_reason?: string };
const base = (kind: Kind) => kind === 'veronica' ? '/veronica/bulk/' : '/whatsapp-bulk/';
const keyOf = (c: Connection) => `${c.kind}/${c.channel}`;
const templateStates: Record<string, string> = { APPROVED: 'Aprobada', PENDING: 'En revisión', REJECTED: 'Rechazada', PAUSED: 'Pausada', DISABLED: 'Deshabilitada', IN_APPEAL: 'En apelación', DELETED: 'Eliminada', PENDING_DELETION: 'Pendiente de eliminación', LIMIT_EXCEEDED: 'Límite excedido' };
const phoneStates: Record<string, string> = { CONNECTED: 'Conectado', DISCONNECTED: 'Desconectado', PENDING: 'Pendiente de conexión', FLAGGED: 'Requiere revisión', RESTRICTED: 'Restringido', BANNED: 'Bloqueado' };
const qualityLabels: Record<string, string> = { GREEN: 'Alta', YELLOW: 'Media', RED: 'Baja', UNKNOWN: 'Sin datos' };
const categories: Record<string, string> = { MARKETING: 'Marketing', UTILITY: 'Servicio', AUTHENTICATION: 'Autenticación' };
const date = (value: string) => new Date(value).toLocaleString('es-MX');

export function ConnectionsPanel({ token, veronicaOnly = false }: { token: string; veronicaOnly?: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [retry, setRetry] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [cursor, setCursor] = useState('');
  const [nextCursor, setNextCursor] = useState('');
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [fetchedAt, setFetchedAt] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const selected = connections.find(c => keyOf(c) === selectedKey);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setErrors([]);
    const kinds: Kind[] = veronicaOnly ? ['veronica'] : ['academy', 'veronica'];
    Promise.all(kinds.map(async kind => {
      try {
        const result = await apiRequest<{ connections: Omit<Connection, 'kind'>[] }>(base(kind)+'connections/', token, { signal: controller.signal });
        return { rows: result.connections.map(c => ({ ...c, kind })), error: '' };
      } catch (e) { return { rows: [] as Connection[], error: `${kind === 'veronica' ? 'Verónica' : 'Canchas'}: ${e instanceof Error ? e.message : 'No se pudo consultar la conexión.'}` }; }
    })).then(results => {
      if (controller.signal.aborted) return;
      const rows = results.flatMap(r => r.rows);
      setConnections(rows); setErrors(results.map(r => r.error).filter(Boolean));
      const nextKey = rows.some(c => keyOf(c) === selectedKey) ? selectedKey : rows[0] ? keyOf(rows[0]) : '';
      if (nextKey !== selectedKey) { setTemplates([]); setCursor(''); setNextCursor(''); setFetchedAt(''); setCatalogError(''); }
      setSelectedKey(nextKey);
      setLoading(false);
    });
    return () => controller.abort();
  }, [token, veronicaOnly, retry]);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    setCatalogLoading(true); setCatalogError('');
    apiRequest<{ templates: Template[]; next_cursor: string; fetched_at?: string }>(base(selected.kind)+'catalog/?'+new URLSearchParams({ channel: selected.channel, after: cursor }), token, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setTemplates(old => cursor ? [...new Map([...old, ...result.templates].map(t => [`${t.name}:${t.language}`, t])).values()] : result.templates);
        setNextCursor(result.next_cursor === cursor ? '' : result.next_cursor);
        setFetchedAt(result.fetched_at || new Date().toISOString());
      })
      .catch(e => { if (!controller.signal.aborted) setCatalogError(e instanceof Error ? e.message : 'No se pudieron consultar las plantillas.'); })
      .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [token, selected?.kind, selected?.channel, cursor, catalogRetry]);

  function choose(connection: Connection) {
    if (keyOf(connection) === selectedKey) return;
    setSelectedKey(keyOf(connection)); setTemplates([]); setCursor(''); setNextCursor(''); setSearch(''); setFilter('all'); setFetchedAt(''); setCatalogError('');
  }
  function refreshCatalog() { setCursor(''); setTemplates([]); setNextCursor(''); setFetchedAt(''); setCatalogRetry(n => n+1); }
  const needle = search.trim().toLocaleLowerCase('es-MX');
  const visible = templates.filter(t => (filter === 'all' || t.status.toUpperCase() === filter) && `${t.name} ${t.text}`.toLocaleLowerCase('es-MX').includes(needle));
  return <section className="connections-panel">
    <header className="comm-page-heading"><div><p className="comm-eyebrow">Comunicaciones</p><h2>Conexiones</h2><p>Números vinculados a Futsi y sus plantillas en Dualhook.</p></div><button disabled={loading} onClick={() => setRetry(n => n+1)}>Actualizar conexiones</button></header>
    {loading && <p role="status">Consultando números en Dualhook…</p>}
    {errors.map(error => <p key={error} className="comm-error" role="alert">{error}</p>)}
    {!loading && !connections.length && !errors.length && <p>No hay números configurados para tu acceso.</p>}
    <div className="connections-grid">{connections.map(c => <button className="connection-card" key={keyOf(c)} disabled={loading} aria-pressed={selectedKey === keyOf(c)} onClick={() => choose(c)}>
      <strong>{c.label}</strong><span className="connection-phone">{c.phone_number || 'Número no disponible'}</span>
      {c.verified_name && <span>{c.verified_name}</span>}
      <span className={`connection-badge ${c.verified && c.status === 'CONNECTED' ? 'good' : 'neutral'}`}>{!c.verified ? 'Sin verificar' : phoneStates[c.status] || c.status || 'Estado no informado'}</span>
      {c.detail && <small>{c.detail}</small>}
    </button>)}</div>
    {selected && <section className="connection-catalog" key={selectedKey}>
      <header className="bulk-heading"><div><h3>Plantillas de {selected.label}</h3><p>{selected.phone_number || 'Número no disponible'} · Calidad: {qualityLabels[selected.quality] || selected.quality || 'Sin datos'}</p></div><button disabled={catalogLoading} onClick={refreshCatalog}>Actualizar plantillas</button></header>
      <details className="connection-technical"><summary>Detalles de la conexión</summary><p>WABA: {selected.waba_id}</p><p>Identificador del número: {selected.phone_number_id}</p><p>Revisión del nombre: {templateStates[selected.name_status] || selected.name_status || 'Sin datos'}</p><p>Consulta del número: {date(selected.checked_at)}. Las consultas se conservan durante un minuto.</p></details>
      <div className="connection-filters"><label>Buscar plantilla<input type="search" placeholder="Nombre o texto de la plantilla" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Estado<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todos los estados</option>{Object.entries(templateStates).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
      {catalogError && <p className="comm-error" role="alert">{catalogError}</p>}
      {catalogLoading && <p role="status">Consultando plantillas…</p>}
      {fetchedAt && <p className="comm-muted">{templates.length} plantillas cargadas · Consultado: {date(fetchedAt)}{nextCursor ? ' · Hay más por cargar' : ''}</p>}
      <div className="connection-template-list">{visible.map(t => <article key={`${t.name}:${t.language}`} className="connection-template"><header><div><h4>{t.name}</h4><small>{t.language} · {categories[t.category] || t.category}</small></div><strong className={`connection-badge ${t.status === 'APPROVED' ? 'good' : t.status === 'REJECTED' || t.status === 'DISABLED' ? 'bad' : 'neutral'}`}>{templateStates[t.status.toUpperCase()] || t.status || 'Estado desconocido'}</strong></header><details><summary>Ver mensaje</summary><p className="connection-template-text">{t.text}</p></details>{t.rejected_reason && <p className="comm-error">Motivo de rechazo: {t.rejected_reason}</p>}</article>)}</div>
      {!catalogLoading && !catalogError && !visible.length && <p>{templates.length ? 'Ninguna plantilla coincide con el filtro.' : 'Esta cuenta todavía no tiene plantillas.'}</p>}
      {nextCursor && <button disabled={catalogLoading} onClick={() => setCursor(nextCursor)}>Cargar más plantillas</button>}
    </section>}
  </section>;
}
