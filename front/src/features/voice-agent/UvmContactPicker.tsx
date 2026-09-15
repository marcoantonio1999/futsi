import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api';
import './uvm-contacts.css';

export type ContactReview = { phones: string[]; names: Record<string, string>; contact_ids: number[]; count: number; duplicates: number; invalid: []; needs_review_count: number; unverified_consent_count: number };
type Contact = { id: number; ordinal: number; phone: string; name: string; footballer: string; age: string; relationship: string; interest: string; confidence: string; priority: string; last_date: string | null; consent_source: string; needs_review: boolean; sensitive: boolean; no_contact: boolean; selectable: boolean; last_status: string | null; in_active_job: boolean };
type Detail = Contact & { source_data: Record<string, unknown>; evidence: Record<string, unknown>; audios: Record<string, unknown>[]; notes: string; manually_blocked: boolean; source_no_contact: boolean };
type Directory = { contacts: Contact[]; total: number; dataset_total: number; facets: Record<string, string[]>; has_more: boolean; source_file: string };
const stateLabels: Record<string, string> = { sending: 'En proceso', accepted: 'Aceptado', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'No entregado', uncertain: 'Sin confirmar' };
const facets: Record<string, string> = { relationship: 'Relación academia', interest: 'Interés principal', confidence: 'Confianza de clasificación', priority: 'Prioridad de seguimiento', consent_source: 'Consentimiento del Excel', campaign_source: 'Estatus campaña del Excel', review_state: 'Estado revisión' };
const initialFilters = { q: '', relationship: '', interest: '', confidence: '', priority: '', consent_source: '', campaign_source: '', review_state: '', no_contact: '', needs_review: '', sensitive: '', age: '', since: '', until: '', min_messages: '', ordinal_from: '', ordinal_to: '', outreach: 'new', sort: 'ordinal' };

export function UvmContactPicker({ token, channel, onLoad }: { token: string; channel: string; onLoad: (review: ContactReview) => void }) {
  const [filters, setFilters] = useState(initialFilters);
  const [result, setResult] = useState<Directory | null>(null);
  const [offset, setOffset] = useState(0);
  const [selection, setSelection] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState('');
  const [edit, setEdit] = useState({ name: '', priority: '', notes: '', manually_blocked: false });
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const base = '/whatsapp-bulk/';
  const params = (extra: Record<string, string> = {}) => new URLSearchParams({ ...filters, channel, offset: String(offset), ...extra });
  const post = <T,>(op: string, body: unknown) => apiRequest<T>(base + op + '/', token, { method: 'POST', body: JSON.stringify(body) });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      apiRequest<Directory>(base + 'contacts/?' + params(), token, { signal: controller.signal })
        .then(r => { if (!controller.signal.aborted) setResult(r); })
        .catch(e => { if (!controller.signal.aborted) { setError(e.message); setResult(null); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [token, channel, filters, offset, revision]);
  useEffect(() => {
    if (detail && !dialog.current?.open) dialog.current?.showModal();
    if (!detail && dialog.current?.open) { dialog.current.close(); opener.current?.focus(); }
  }, [detail]);
  function filter(key: string, value: string) { setFilters(f => ({ ...f, [key]: value })); setOffset(0); setSelection([]); }
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la consulta.'); }
    finally { setBusy(false); }
  }
  function toggle(id: number) {
    setSelection(ids => ids.includes(id) ? ids.filter(i => i !== id) : ids.length < 100 ? [...ids, id] : ids);
  }
  function selectFilter(key: string) {
    return <label key={key}>{facets[key]}<select value={filters[key as keyof typeof filters]} onChange={e => filter(key, e.target.value)} disabled={busy}><option value="">Todos</option>{key === 'priority' && <option value="__empty__">Sin asignar</option>}{(key === 'priority' ? ['Alta', 'Media', 'Baja'] : result?.facets[key] || []).map(v => <option key={v} value={v}>{v}</option>)}</select></label>;
  }
  return <div className="uvm-directory">
    <div className="uvm-filter-grid">
      <label>Buscar contacto o futbolista<input value={filters.q} placeholder="Nombre o 10 dígitos" onChange={e => filter('q', e.target.value)} disabled={busy} /></label>
      {selectFilter('relationship')}{selectFilter('interest')}
      <label>Seguimiento<select value={filters.outreach} onChange={e => filter('outreach', e.target.value)} disabled={busy}>
        <option value="new">Sin intento previo ni lote activo</option><option value="all">Todos</option><option value="active">En lote activo</option><option value="attempted">Con intento previo</option>
        {Object.entries(stateLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select></label>
    </div>
    <details className="uvm-more-filters"><summary>Más filtros del Excel</summary><div className="uvm-filter-grid">
      {['confidence', 'priority', 'consent_source', 'campaign_source', 'review_state'].map(selectFilter)}
      {Object.entries({ no_contact: 'No contactar', needs_review: 'Requiere revisión', sensitive: 'Caso sensible' }).map(([key, label]) => <label key={key}>{label}<select disabled={busy} value={filters[key as keyof typeof filters]} onChange={e => filter(key, e.target.value)}><option value="">Todos</option><option value="true">Sí</option><option value="false">No</option></select></label>)}
      <label>Edad mencionada<input value={filters.age} onChange={e => filter('age', e.target.value)} disabled={busy} placeholder="Texto del Excel; no edad actual" /></label>
      <label>Última interacción desde<input type="date" value={filters.since} onChange={e => filter('since', e.target.value)} disabled={busy} /></label>
      <label>Última interacción hasta<input type="date" value={filters.until} onChange={e => filter('until', e.target.value)} disabled={busy} /></label>
      <label>Mínimo de mensajes<input type="number" min="0" value={filters.min_messages} onChange={e => filter('min_messages', e.target.value)} disabled={busy} /></label>
      <label>Ordinal desde<input type="number" min="1" value={filters.ordinal_from} onChange={e => filter('ordinal_from', e.target.value)} disabled={busy} /></label>
      <label>Ordinal hasta<input type="number" min="1" value={filters.ordinal_to} onChange={e => filter('ordinal_to', e.target.value)} disabled={busy} /></label>
      <label>Ordenar<select value={filters.sort} onChange={e => filter('sort', e.target.value)} disabled={busy}><option value="ordinal">Orden del Excel</option><option value="recent">Interacción más reciente</option><option value="name">Nombre</option></select></label>
    </div><p>La confianza es la del análisis. La prioridad se asigna manualmente al revisar un contacto.</p></details>
    <div className="uvm-selection-bar"><div aria-live="polite"><strong>{selection.length} / 100 seleccionados</strong><span>{loading ? 'Buscando…' : `${result?.total || 0} resultados de ${result?.dataset_total || 0} contactos UVM`}</span></div><div className="bulk-actions">
      <button disabled={loading || busy || !result?.total} onClick={() => void action(async () => {
        const r = await apiRequest<Directory>(base + 'contacts/?' + params({ offset: '0', limit: '100', selectable_only: 'true' }), token);
        setSelection(r.contacts.filter(c => c.selectable).map(c => c.id));
      })}>Seleccionar hasta 100 de este filtro</button>
      <button disabled={busy || !selection.length} onClick={() => setSelection([])}>Quitar selección</button>
    </div></div>
    {error && <div className="bulk-alert error" role="alert">{error}</div>}
    <div className="bulk-table-wrap uvm-contact-table" aria-busy={loading}><table><thead><tr><th>Elegir</th><th>Contacto</th><th>Relación e interés</th><th>Última interacción</th><th>Seguimiento</th><th>Detalle</th></tr></thead><tbody>
      {!loading && !result?.contacts.length && <tr><td colSpan={6}>No hay contactos con estos filtros. Prueba cambiar Seguimiento o los demás filtros.</td></tr>}
      {result?.contacts.map(c => <tr key={c.id}><td><input type="checkbox" aria-label={`Seleccionar ${c.name || c.phone || c.ordinal}`} checked={selection.includes(c.id)} disabled={busy || loading || !c.selectable || (!selection.includes(c.id) && selection.length >= 100)} onChange={() => toggle(c.id)} /></td>
        <td><strong>{c.name || 'Sin nombre'}</strong><span>{c.phone || 'Teléfono no válido'} · #{c.ordinal}</span>{c.footballer && <small>Futbolista: {c.footballer}</small>}</td>
        <td>{c.relationship}<span>{c.interest}</span><small>Confianza: {c.confidence} · Prioridad: {c.priority || 'Sin asignar'}</small></td>
        <td>{c.last_date || 'Sin fecha'}</td><td>{c.no_contact ? <strong className="uvm-blocked">No contactar</strong> : c.in_active_job ? 'En lote activo' : c.last_status ? stateLabels[c.last_status] || c.last_status : 'Sin intento previo'}
          {(c.needs_review || c.sensitive) && <span className="uvm-review">Revisar contexto</span>}<small>Consentimiento: {c.consent_source}</small></td>
        <td><button disabled={busy} onClick={e => { opener.current = e.currentTarget; void action(async () => { const d = await apiRequest<Detail>(base + 'contact-detail/?' + new URLSearchParams({ channel, contact_id: String(c.id) }), token); setDetail(d); setDetailError(''); setEdit({ name: d.name, priority: d.priority, notes: d.notes, manually_blocked: d.manually_blocked }); }); }}>Ver detalle</button></td></tr>)}
    </tbody></table></div>
    <div className="bulk-pages"><button disabled={busy || loading || !offset} onClick={() => setOffset(n => n-50)}>Anterior</button><span>Página {Math.floor(offset/50)+1} de {Math.max(1, Math.ceil((result?.total || 0)/50))}</span><button disabled={busy || loading || !result?.has_more} onClick={() => setOffset(n => n+50)}>Siguiente</button></div>
    <div className="bulk-actions"><button className="primary" disabled={busy || loading || !selection.length} onClick={() => void action(async () => { onLoad(await post<ContactReview>('contact-select', { channel, contact_ids: selection })); })}>{busy ? 'Cargando…' : `Cargar y revisar ${selection.length} contactos`}</button></div>
    <small className="uvm-source">Fuente: {result?.source_file || 'Excel de UVM'}. Los filtros y la selección solo afectan a UVM. No se envía nada hasta confirmar el costo.</small>
    <dialog ref={dialog} className="uvm-detail-modal" aria-labelledby="uvm-detail-title" onCancel={e => { e.preventDefault(); if (!busy) setDetail(null); }}>
      {detail && <div className="bulk-card"><header className="bulk-heading"><h3 id="uvm-detail-title">{detail.name || detail.phone || 'Contacto sin nombre'}</h3><button disabled={busy} onClick={() => setDetail(null)}>Cerrar</button></header>
        <p>{detail.phone || 'Teléfono no válido'} · Contacto #{detail.ordinal} · UVM</p>
        {(detail.sensitive || detail.needs_review) && <p className="bulk-alert">El análisis pide revisión humana de este contacto. Lee el contexto antes de incluirlo en una campaña.</p>}
        <h4>Contexto y evidencia</h4><dl className="uvm-evidence">{Object.entries(detail.evidence).filter(([key]) => !['Ordinal', 'Chat ID', 'Teléfono', 'Contacto', 'Futbolista'].includes(key)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value ?? '—')}</dd></div>)}</dl>
        <details><summary>Ver todos los datos originales del Excel</summary><dl className="uvm-evidence">{Object.entries(detail.source_data).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value ?? '—')}</dd></div>)}</dl></details>
        {!!detail.audios.length && <details><summary>Audios y transcripciones ({detail.audios.length})</summary>{detail.audios.map((audio, i) => <dl className="uvm-evidence" key={i}>{Object.entries(audio).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value ?? '—')}</dd></div>)}</dl>)}</details>}
        <h4>Datos de seguimiento</h4><div className="uvm-filter-grid"><label>Nombre para el saludo<input maxLength={120} value={edit.name} disabled={busy} onChange={e => setEdit(v => ({ ...v, name: e.target.value }))} /></label><label>Prioridad<select value={edit.priority} disabled={busy} onChange={e => setEdit(v => ({ ...v, priority: e.target.value }))}><option value="">Sin asignar</option>{['Alta', 'Media', 'Baja'].map(v => <option key={v}>{v}</option>)}</select></label></div>
        <label>Notas del equipo<textarea maxLength={4000} rows={3} value={edit.notes} disabled={busy} onChange={e => setEdit(v => ({ ...v, notes: e.target.value }))} /></label>
        <label className="uvm-block-checkbox"><input type="checkbox" disabled={busy || detail.source_no_contact} checked={edit.manually_blocked || detail.source_no_contact} onChange={e => setEdit(v => ({ ...v, manually_blocked: e.target.checked }))} />No contactar</label>
        {detail.source_no_contact && <p>La exclusión viene del Excel y no puede quitarse aquí.</p>}
        {detailError && <div role="alert" className="bulk-alert error">{detailError}</div>}
        <button className="primary" disabled={busy} onClick={() => { setBusy(true); setDetailError(''); void post<Detail>('contact-update', { channel, contact_id: detail.id, ...edit }).then(() => { setSelection([]); setDetail(null); setRevision(n => n+1); }).catch(e => setDetailError(e.message)).finally(() => setBusy(false)); }}>{busy ? 'Guardando…' : 'Guardar seguimiento'}</button>
      </div>}
    </dialog>
  </div>;
}
