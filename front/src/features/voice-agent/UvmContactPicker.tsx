import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, Phone, Save, Search, SlidersHorizontal, UserRound, X } from 'lucide-react';
import { apiRequest } from '../../api';
import './uvm-contacts.css';

export type ContactReview = { phones: string[]; names: Record<string, string>; contact_ids: number[]; count: number; duplicates: number; invalid: []; needs_review_count: number; unverified_consent_count: number };
type Contact = { id: number; ordinal: number; phone: string; name: string; footballer: string; age: string; relationship: string; interest: string; confidence: string; priority: string; last_date: string | null; consent_source: string; needs_review: boolean; sensitive: boolean; no_contact: boolean; has_inbound: boolean; selectable: boolean; last_status: string | null; in_active_job: boolean; league_role?: string; league_relevance?: string; teams?: string };
type Detail = Contact & { source_data: Record<string, unknown>; evidence: Record<string, unknown>; audios: Record<string, unknown>[]; notes: string; manually_blocked: boolean; source_no_contact: boolean };
type Directory = { contacts: Contact[]; total: number; dataset_total: number; facets: Record<string, string[]>; has_more: boolean; source_file: string; dataset_label?: string; domain?: string; filter_labels?: Record<string, string> };
const stateLabels: Record<string, string> = { sending: 'En proceso', accepted: 'Aceptado', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'No entregado', uncertain: 'Sin confirmar' };
const facets: Record<string, string> = { relationship: 'Relación con la academia', interest: 'Interés principal', confidence: 'Confianza de clasificación', priority: 'Prioridad de seguimiento', review_state: 'Estado de revisión' };
const initialFilters = { q: '', relationship: '', interest: '', confidence: '', priority: '', review_state: '', no_contact: '', needs_review: '', sensitive: '', age_operator: 'gt', age_value: '', since: '', until: '', outreach: 'all', league_role: '', league_relevance: '', team: '' };
type ContactFilters = typeof initialFilters;
type ContactFilterKey = keyof ContactFilters;

function detailValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (Array.isArray(value)) return value.length ? value.map(detailValue).join('\n') : '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function isLongEvidence(key: string, value: unknown) {
  return ['Resumen', 'Evidencia principal', 'Razón de clasificación', 'Advertencias'].includes(key) || detailValue(value).length > 100;
}

export function UvmContactPicker({ token, channel, label = 'este canal', onLoad }: { token: string; channel: string; label?: string; onLoad: (review: ContactReview) => void }) {
  const [filters, setFilters] = useState(initialFilters);
  const [filterDraft, setFilterDraft] = useState(initialFilters);
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
  const filtersDialog = useRef<HTMLDialogElement>(null);
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
  function filter(key: ContactFilterKey, value: string) {
    setFilters(current => ({ ...current, [key]: value }));
    setOffset(0);
    setSelection([]);
  }
  function draftFilter(key: ContactFilterKey, value: string) { setFilterDraft(f => ({ ...f, [key]: value })); }
  function openFilters() {
    setFilterDraft(filters);
    filtersDialog.current?.showModal();
  }
  function closeFilters() { filtersDialog.current?.close(); }
  function applyFilters() {
    setFilters({ ...filterDraft, q: filters.q });
    setOffset(0);
    setSelection([]);
    closeFilters();
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la consulta.'); }
    finally { setBusy(false); }
  }
  function toggle(id: number) {
    setSelection(ids => ids.includes(id) ? ids.filter(i => i !== id) : ids.length < 100 ? [...ids, id] : ids);
  }
  function selectFilter(key: ContactFilterKey, values: ContactFilters, onChange: (key: ContactFilterKey, value: string) => void) {
    return <label key={key}>{result?.filter_labels?.[key] || facets[key] || key}<select value={values[key]} onChange={e => onChange(key, e.target.value)} disabled={busy}><option value="">Todos</option>{key === 'priority' && <option value="__empty__">Sin asignar</option>}{(key === 'priority' ? ['Alta', 'Media', 'Baja'] : result?.facets[key] || []).map(v => <option key={v} value={v}>{v}</option>)}</select></label>;
  }
  const activeFilterCount = (Object.keys(initialFilters) as ContactFilterKey[]).filter(key => key !== 'q' && key !== 'age_operator' && filters[key] !== initialFilters[key]).length;
  const detailEvidence = detail ? Object.entries(detail.evidence).filter(([key]) => !['Ordinal', 'Chat ID', 'Teléfono', 'Contacto', 'Futbolista'].includes(key)) : [];
  return <div className="uvm-directory">
    <div className="uvm-directory-toolbar">
      <div className="uvm-selection-bar"><div aria-live="polite"><strong>{selection.length} / 100 seleccionados</strong><span>{loading ? 'Buscando…' : `${result?.total || 0} resultados de ${result?.dataset_total || 0} contactos de ${result?.dataset_label || label}`}</span></div><div className="bulk-actions">
        <button disabled={loading || busy || !result?.total} onClick={() => void action(async () => {
          const r = await apiRequest<Directory>(base + 'contacts/?' + params({ offset: '0', limit: '100', selectable_only: 'true' }), token);
          setSelection(r.contacts.filter(c => c.selectable).map(c => c.id));
        })}>Seleccionar hasta 100 de este filtro</button>
        <button disabled={busy || !selection.length} onClick={() => setSelection([])}>Quitar selección</button>
      </div></div>
      <label className="uvm-search"><span className="uvm-visually-hidden">Buscar contacto o futbolista</span><Search aria-hidden="true" size={18} /><input value={filters.q} placeholder="Buscar" onChange={e => filter('q', e.target.value)} disabled={busy} /></label>
      <button className="uvm-filter-button" disabled={busy} onClick={openFilters}><SlidersHorizontal aria-hidden="true" size={18} />Filtros{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button>
    </div>
    {error && <div className="bulk-alert error" role="alert">{error}</div>}
    <div className="bulk-table-wrap uvm-contact-table" aria-busy={loading}><table><thead><tr><th>Elegir</th><th>Contacto</th><th>Relación e interés</th><th>Última interacción</th><th>Seguimiento</th><th>Detalle</th></tr></thead><tbody>
      {!loading && !result?.contacts.length && <tr><td colSpan={6}>No hay contactos con estos filtros. Prueba cambiar Seguimiento o los demás filtros.</td></tr>}
      {result?.contacts.map(c => <tr key={c.id}><td><input type="checkbox" aria-label={`Seleccionar ${c.name || c.phone || c.ordinal}`} checked={selection.includes(c.id)} disabled={busy || loading || !c.selectable || (!selection.includes(c.id) && selection.length >= 100)} onChange={() => toggle(c.id)} /></td>
        <td><strong>{c.name || 'Sin nombre'}</strong><span>{c.phone || 'Teléfono no válido'} · #{c.ordinal}</span>{c.footballer && <small>Futbolista: {c.footballer}</small>}</td>
        <td>{c.relationship}<span>{c.interest}</span>{c.league_relevance && <span>{c.league_relevance}</span>}{c.league_role && <small>Rol: {c.league_role}</small>}{c.teams && <small>Equipos: {c.teams}</small>}<small>Confianza: {c.confidence} · Prioridad: {c.priority || 'Sin asignar'}</small></td>
        <td>{c.last_date || 'Sin fecha'}</td><td>{c.no_contact ? <strong className="uvm-blocked">No contactar</strong> : !c.has_inbound ? 'No nos escribió' : c.in_active_job ? 'En lote activo' : c.last_status ? stateLabels[c.last_status] || c.last_status : 'Sin intento previo'}
          {(c.needs_review || c.sensitive) && <span className="uvm-review">Revisar contexto</span>}</td>
        <td><button disabled={busy} onClick={e => { opener.current = e.currentTarget; void action(async () => { const d = await apiRequest<Detail>(base + 'contact-detail/?' + new URLSearchParams({ channel, contact_id: String(c.id) }), token); setDetail(d); setDetailError(''); setEdit({ name: d.name, priority: d.priority, notes: d.notes, manually_blocked: d.manually_blocked }); }); }}>Ver detalle</button></td></tr>)}
    </tbody></table></div>
    <div className="uvm-directory-footer"><div className="bulk-pages"><button disabled={busy || loading || !offset} onClick={() => setOffset(n => n-50)}>Anterior</button><span>Página {Math.floor(offset/50)+1} de {Math.max(1, Math.ceil((result?.total || 0)/50))}</span><button disabled={busy || loading || !result?.has_more} onClick={() => setOffset(n => n+50)}>Siguiente</button></div>
      <div className="bulk-actions"><button className="primary" disabled={busy || loading || !selection.length} onClick={() => void action(async () => { onLoad(await post<ContactReview>('contact-select', { channel, contact_ids: selection })); })}>{busy ? 'Cargando…' : `Cargar y revisar ${selection.length} contactos`}</button></div></div>
    <dialog ref={filtersDialog} className="uvm-filter-modal" aria-labelledby="uvm-filter-title" onCancel={e => { e.preventDefault(); closeFilters(); }}>
      <header className="uvm-modal-heading"><div><span>Directorio de contactos</span><h3 id="uvm-filter-title">Filtros</h3></div><button aria-label="Cerrar filtros" onClick={closeFilters}><X aria-hidden="true" size={20} /></button></header>
      <div className="uvm-filter-modal-body">
        <section><div className="uvm-filter-section-heading"><h4>Relación y seguimiento</h4><p>Define qué tipo de contacto quieres incluir y su situación actual.</p></div><div className="uvm-filter-grid">
          {selectFilter('relationship', filterDraft, draftFilter)}{selectFilter('interest', filterDraft, draftFilter)}
          {result?.domain === 'league' && <>{selectFilter('league_relevance', filterDraft, draftFilter)}{selectFilter('league_role', filterDraft, draftFilter)}<label>Equipo<input value={filterDraft.team} onChange={e => draftFilter('team', e.target.value)} disabled={busy} placeholder="Nombre del equipo" /></label></>}
          <label>Seguimiento<select value={filterDraft.outreach} onChange={e => draftFilter('outreach', e.target.value)} disabled={busy}>
            <option value="all">Todos</option><option value="new">Sin intento previo ni lote activo</option><option value="active">En lote activo</option><option value="attempted">Con intento previo</option>
            {Object.entries(stateLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select></label>
        </div></section>
        <section><div className="uvm-filter-section-heading"><h4>Clasificación</h4><p>Usa la información registrada para priorizar la selección.</p></div><div className="uvm-filter-grid">
          {(['confidence', 'priority', 'review_state'] as ContactFilterKey[]).map(key => selectFilter(key, filterDraft, draftFilter))}
          {Object.entries({ no_contact: 'Pidió no contactar', needs_review: 'Requiere revisión', sensitive: 'Caso sensible' }).map(([key, label]) => <label key={key}>{label}<select disabled={busy} value={filterDraft[key as ContactFilterKey]} onChange={e => draftFilter(key as ContactFilterKey, e.target.value)}><option value="">Todos</option><option value="true">Sí</option><option value="false">No</option></select></label>)}
        </div></section>
        <section><div className="uvm-filter-section-heading"><h4>Actividad</h4><p>Los contactos aparecen del más reciente al más antiguo.{result?.domain === 'academy' && ' La edad requiere un valor claro; no se infiere de categorías ni años de nacimiento.'}</p></div><div className="uvm-filter-grid">
          {result?.domain === 'academy' && <><label>Edad mencionada<select value={filterDraft.age_operator} onChange={e => draftFilter('age_operator', e.target.value)} disabled={busy}><option value="gt">Mayor a</option><option value="lt">Menor a</option><option value="eq">Igual a</option></select></label><label>Años<input type="number" min="1" max="120" step="1" inputMode="numeric" value={filterDraft.age_value} onChange={e => draftFilter('age_value', e.target.value)} disabled={busy} placeholder="Ej. 12" /></label></>}
          <label>Última interacción desde<input type="date" value={filterDraft.since} onChange={e => draftFilter('since', e.target.value)} disabled={busy} /></label>
          <label>Última interacción hasta<input type="date" value={filterDraft.until} onChange={e => draftFilter('until', e.target.value)} disabled={busy} /></label>
        </div></section>
      </div>
      <footer className="uvm-filter-modal-footer"><button onClick={() => setFilterDraft({ ...initialFilters, q: filters.q })}>Restablecer</button><div><button onClick={closeFilters}>Cancelar</button><button className="primary" onClick={applyFilters}>Aplicar filtros</button></div></footer>
    </dialog>
    <dialog ref={dialog} className="uvm-detail-modal" aria-labelledby="uvm-detail-title" onClick={e => { if (e.target === e.currentTarget && !busy) setDetail(null); }} onCancel={e => { e.preventDefault(); if (!busy) setDetail(null); }}>
      {detail && <article className="uvm-detail-shell">
        <header className="uvm-detail-header">
          <div className="uvm-detail-identity">
            <span className="uvm-detail-eyebrow">Detalle del contacto</span>
            <h3 id="uvm-detail-title">{detail.name || detail.phone || 'Contacto sin nombre'}</h3>
            <div className="uvm-detail-meta">
              <span><Phone aria-hidden="true" size={15} />{detail.phone || 'Teléfono no válido'}</span>
              <span><UserRound aria-hidden="true" size={15} />Contacto #{detail.ordinal}</span>
              <span>{result?.dataset_label || label}</span>
            </div>
          </div>
          <button className="uvm-detail-close" type="button" aria-label="Cerrar detalle" disabled={busy} onClick={() => setDetail(null)}><X aria-hidden="true" size={21} /></button>
        </header>

        <div className="uvm-detail-body">
          <main className="uvm-detail-content">
            {(detail.sensitive || detail.needs_review) && <div className="uvm-detail-alert" role="note"><AlertTriangle aria-hidden="true" size={20} /><div><strong>Este contacto requiere revisión</strong><span>Lee el contexto antes de incluirlo en una campaña.</span></div></div>}

            <section className="uvm-detail-section" aria-labelledby="uvm-evidence-title">
              <div className="uvm-detail-section-heading"><div><span>Información analizada</span><h4 id="uvm-evidence-title">Contexto y evidencia</h4></div><small>{detailEvidence.length} campos</small></div>
              {detailEvidence.length ? <dl className="uvm-evidence">{detailEvidence.map(([key, value]) => <div className={isLongEvidence(key, value) ? 'uvm-evidence-item wide' : 'uvm-evidence-item'} key={key}><dt>{key}</dt><dd>{detailValue(value)}</dd></div>)}</dl> : <p className="uvm-detail-empty">No hay evidencia textual disponible para este contacto.</p>}
            </section>

            <details className="uvm-detail-disclosure"><summary><span><FileText aria-hidden="true" size={18} />Datos originales del archivo</span><small>{Object.keys(detail.source_data).length} campos</small></summary><dl className="uvm-evidence uvm-source-data">{Object.entries(detail.source_data).map(([key, value]) => <div className={isLongEvidence(key, value) ? 'uvm-evidence-item wide' : 'uvm-evidence-item'} key={key}><dt>{key}</dt><dd>{detailValue(value)}</dd></div>)}</dl></details>
            {!!detail.audios.length && <details className="uvm-detail-disclosure"><summary><span>Audios y transcripciones</span><small>{detail.audios.length}</small></summary>{detail.audios.map((audio, i) => <dl className="uvm-evidence uvm-audio-data" key={i}>{Object.entries(audio).map(([key, value]) => <div className={isLongEvidence(key, value) ? 'uvm-evidence-item wide' : 'uvm-evidence-item'} key={key}><dt>{key}</dt><dd>{detailValue(value)}</dd></div>)}</dl>)}</details>}
          </main>

          <aside className="uvm-detail-followup" aria-labelledby="uvm-followup-title">
            <div className="uvm-detail-section-heading"><div><span>Uso interno</span><h4 id="uvm-followup-title">Datos de seguimiento</h4></div></div>
            <label>Nombre para el saludo<input maxLength={120} value={edit.name} disabled={busy} onChange={e => setEdit(v => ({ ...v, name: e.target.value }))} /></label>
            <label>Prioridad<select value={edit.priority} disabled={busy} onChange={e => setEdit(v => ({ ...v, priority: e.target.value }))}><option value="">Sin asignar</option>{['Alta', 'Media', 'Baja'].map(v => <option key={v}>{v}</option>)}</select></label>
            <label>Notas del equipo<textarea maxLength={4000} rows={5} value={edit.notes} disabled={busy} onChange={e => setEdit(v => ({ ...v, notes: e.target.value }))} /></label>
            <label className="uvm-block-checkbox"><input type="checkbox" disabled={busy || detail.source_no_contact} checked={edit.manually_blocked || detail.source_no_contact} onChange={e => setEdit(v => ({ ...v, manually_blocked: e.target.checked }))} /><span><strong>No contactar</strong><small>Impide incluir este número en un envío.</small></span></label>
            {detail.source_no_contact && <p className="uvm-detail-source-note">El contacto pidió no recibir mensajes; esta exclusión no puede quitarse aquí.</p>}
          </aside>
        </div>

        <footer className="uvm-detail-footer">
          {detailError ? <div role="alert" className="uvm-detail-error">{detailError}</div> : <span>Los cambios sólo afectan el seguimiento de este contacto.</span>}
          <div><button type="button" disabled={busy} onClick={() => setDetail(null)}>Cancelar</button><button type="button" className="primary" disabled={busy} onClick={() => { setBusy(true); setDetailError(''); void post<Detail>('contact-update', { channel, contact_id: detail.id, ...edit }).then(() => { setSelection([]); setDetail(null); setRevision(n => n+1); }).catch(e => setDetailError(e.message)).finally(() => setBusy(false)); }}><Save aria-hidden="true" size={17} />{busy ? 'Guardando…' : 'Guardar seguimiento'}</button></div>
        </footer>
      </article>}
    </dialog>
  </div>;
}
