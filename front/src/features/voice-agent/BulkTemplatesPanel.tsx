import { useEffect, useRef, useState } from 'react';
import { apiRequest, apiFormRequest } from '../../api';
import './bulk-templates.css';

type Kind = 'veronica' | 'academy';
type Template = { name: string; language: string; category: string; text: string; sendable: boolean; reason?: string; parameters: { key: string; label: string; contact_name?: boolean }[] };
type Review = { phones: string[]; names?: Record<string, string>; count: number; duplicates: number; invalid: { row: number; value: string; reason: string }[]; needs_column?: boolean; columns?: { index: number; label: string }[] };
type Job = { id: string; title: string; channel: string; status: string; detail: string; created_at: string; heartbeat_at: string | null; percent: number; processed: number; total: number; counts: Record<string, number>; template: { name: string; language: string; text: string }; quote: { total: string; currency: string; unit: string; category: string; note: string; verified_on: string; source: string }; recipients?: { id: number; phone: string; name?: string; status: string; detail: string }[]; has_more?: boolean };
const labels: Record<string, string> = { draft: 'Por confirmar', queued: 'En cola', running: 'Enviando', completed: 'Intentos terminados', cancelled: 'Cancelado', paused: 'Detenido: requiere revisión', pending: 'Pendiente', sending: 'En proceso', accepted: 'Aceptado, sin entrega confirmada', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'No entregado', uncertain: 'Resultado sin confirmar', skipped: 'Excluido: no desea mensajes' };
const money = (n: string) => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

export function BulkTemplatesPanel({ token, kind }: { token: string; kind: Kind }) {
  const base = kind === 'veronica' ? '/veronica/bulk/' : '/whatsapp-bulk/';
  const [channels, setChannels] = useState<{ channel: string; label: string }[]>([]);
  const [channel, setChannel] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [parameters, setParameters] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState('');
  const [mode, setMode] = useState<'text' | 'file'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [column, setColumn] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [reviewPage, setReviewPage] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsPage, setJobsPage] = useState(0);
  const [jobsMore, setJobsMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [dragging, setDragging] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const selected = templates.find(t => `${t.name}:${t.language}` === templateKey);
  const prepareReason = busy ? 'Espera a que termine la operación actual.'
    : !channel ? 'Selecciona el número desde el que enviarás en el paso 1.'
    : !templates.length ? 'Primero pulsa «Consultar plantillas» en el paso 1 y selecciona una plantilla aprobada.'
    : !selected ? 'Falta seleccionar una plantilla aprobada en el paso 1.'
    : !selected.sendable ? selected.reason || 'La plantilla seleccionada no está disponible para envíos masivos.'
    : selected.parameters.some(p => !parameters[p.key]?.trim()) ? `Completa los campos de la plantilla: ${selected.parameters.filter(p => !parameters[p.key]?.trim()).map(p => p.label).join(', ')}.`
    : review?.needs_column ? 'Selecciona la columna de teléfonos y vuelve a cargar el archivo.'
    : !review?.count ? 'Carga y revisa al menos un número válido en el paso 2.' : '';
  const missingNames = Object.values(parameters).includes('{{contact_name}}') ? review?.phones.filter(p => !review.names?.[p]?.trim()).length || 0 : 0;
  const blockedReason = prepareReason || (missingNames ? `Completa el nombre de ${missingNames} destinatarios en el paso 2.` : '');
  const activeId = job?.id;
  const post = <T,>(op: string, body: unknown) => apiRequest<T>(base+op+'/', token, { method: 'POST', body: JSON.stringify(body) });
  function invalidate() { setReview(null); setReviewPage(0); requestId.current = crypto.randomUUID(); }
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<{ channels: typeof channels }>(base+'channels/', token, { signal: controller.signal })
      .then(r => { setChannels(r.channels); setChannel(r.channels[0]?.channel || ''); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [base, token]);
  useEffect(() => {
    setTemplates([]); setTemplateKey(''); setParameters({}); setCursor('');
    setReview(null); setReviewPage(0);
    requestId.current = crypto.randomUUID();
  }, [channel]);
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const result = await apiRequest<{ jobs: Job[]; has_more: boolean }>(base+'list/?'+new URLSearchParams({ channel, offset: String(jobsPage*20) }), token);
        if (!disposed) { setJobs(result.jobs); setJobsMore(result.has_more); }
        if (activeId) {
          const next = await apiRequest<Job>(base+'detail/?'+new URLSearchParams({ id: activeId, offset: String(offset) }), token);
          if (!disposed) setJob(next);
        }
        if (!disposed) setPollError('');
      } catch (e) { if (!disposed) setPollError(e instanceof Error ? e.message : 'No se pudo actualizar el avance.'); }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [base, token, channel, activeId, offset, jobsPage]);
  async function loadTemplates(after = '') {
    await action(async () => {
      const result = await apiRequest<{ templates: Template[]; next_cursor: string }>(base+'catalog/?'+new URLSearchParams({ channel, after }), token);
      setTemplates(old => after ? [...old, ...result.templates] : result.templates);
      setCursor(result.next_cursor === after ? '' : result.next_cursor);
    });
  }
  function chooseFile(next: File | null) {
    setFile(next); setColumn(''); invalidate(); setError('');
    if (next && (!/\.(xlsx|csv|txt)$/i.test(next.name) || next.size > 2*1024*1024)) setError('Usa un archivo .xlsx, .csv o .txt de hasta 2 MB.');
  }
  async function loadNumbers() {
    await action(async () => {
      const form = new FormData();
      form.set('channel', channel);
      if (mode === 'file' && file) form.set('file', file);
      else form.set('text', text);
      if (column !== '') form.set('column', column);
      const result = await apiFormRequest<Review>(base+'import/', token, form);
      setReview(result); setReviewPage(0); requestId.current = crypto.randomUUID();
    });
  }
  function newJob() { setJob(null); setConsent(false); setOffset(0); invalidate(); setError(''); }
  return <section className="bulk-templates">
    <header className="bulk-heading"><div><p>Comunicaciones / {kind === 'veronica' ? 'Verónica' : 'Canchas'}</p><h2>Envío masivo de plantillas</h2><p>Carga o escribe los números, revisa el lote y confirma antes de enviar.</p></div>{job && <button onClick={newJob} disabled={busy}>Nuevo lote</button>}</header>
    {error && <div role="alert" className="bulk-alert error">{error}</div>}
    {pollError && <div role="alert" className="bulk-alert error">No se pudo actualizar el avance. Lo mostrado puede estar desactualizado. {pollError}</div>}
    {!job ? <>
      <section className="bulk-card"><h3>1. Número y plantilla</h3>
        <div className="bulk-fields"><label>Enviar desde<select value={channel} disabled={busy || !channels.length} onChange={e => { setChannel(e.target.value); setJobsPage(0); }}><option value="" disabled>Selecciona un canal</option>{channels.map(c => <option key={c.channel} value={c.channel}>{c.label}</option>)}</select></label>
          <button disabled={busy || !channel} onClick={() => void loadTemplates()}>Consultar plantillas</button></div>
        {!channels.length && <p>No hay canales conectados disponibles. No se pueden realizar envíos.</p>}
        {!!templates.length && <><label>Plantilla aprobada<select value={templateKey} disabled={busy} onChange={e => { setTemplateKey(e.target.value); const next = templates.find(t => `${t.name}:${t.language}` === e.target.value); setParameters(Object.fromEntries((next?.parameters || []).filter(p => p.contact_name).map(p => [p.key, '{{contact_name}}']))); requestId.current = crypto.randomUUID(); }}><option value="">Selecciona una plantilla</option>{templates.map(t => <option key={`${t.name}:${t.language}`} disabled={!t.sendable} value={`${t.name}:${t.language}`}>{t.name} · {t.language}{!t.sendable ? ' · No disponible para masivos' : ''}</option>)}</select></label>
          {selected && <div className="bulk-template"><strong>{selected.name} · {selected.category}</strong><p>{selected.text}</p></div>}
          {!!selected?.parameters.length && <p>La plantilla ya contiene el mensaje completo. Solo completa sus datos variables.</p>}
          {selected?.parameters.map(p => <div key={p.key}><label>{p.label}<select disabled={busy} value={parameters[p.key] === '{{contact_name}}' ? 'name' : 'fixed'} onChange={e => { setParameters(v => ({ ...v, [p.key]: e.target.value === 'name' ? '{{contact_name}}' : '' })); requestId.current = crypto.randomUUID(); }}><option value="name">Nombre de cada destinatario</option><option value="fixed">Escribir un dato igual para todos</option></select></label>{parameters[p.key] === '{{contact_name}}' ? <p>Se utilizará el nombre de cada fila del paso 2. Puedes revisarlo y corregirlo antes de enviar.</p> : <label>Dato para sustituir en la plantilla<input disabled={busy} maxLength={500} value={parameters[p.key] || ''} onChange={e => { setParameters(v => ({ ...v, [p.key]: e.target.value })); requestId.current = crypto.randomUUID(); }} /></label>}</div>)}</>}
        {cursor && <button disabled={busy} onClick={() => void loadTemplates(cursor)}>Cargar más plantillas</button>}
      </section>
      <section className="bulk-card"><h3>2. ¿A quiénes se enviará?</h3><p>Solo números de México de 10 dígitos. No escribas código de país. Hasta 1,000 números por lote.</p>
        <div className="bulk-tabs"><button aria-pressed={mode === 'text'} disabled={busy} onClick={() => { setMode('text'); invalidate(); }}>Escribir o pegar números</button><button aria-pressed={mode === 'file'} disabled={busy} onClick={() => { setMode('file'); invalidate(); }}>Agregar Excel, CSV o TXT</button></div>
        {mode === 'text' ? <label>Números separados por comas<textarea disabled={busy} rows={4} value={text} maxLength={25000} placeholder="5512345678, 5587654321" onChange={e => { setText(e.target.value); invalidate(); }} /></label> : <>
          <label className={`bulk-drop ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) chooseFile(e.dataTransfer.files[0] || null); }}>
            <strong>{file ? file.name : 'Arrastra tu archivo aquí'}</strong><span>o pulsa para elegir Excel (.xlsx), CSV o TXT · hasta 2 MB</span><input type="file" accept=".xlsx,.csv,.txt" disabled={busy} onChange={e => chooseFile(e.target.files?.[0] || null)} />
          </label><p>Excel/CSV: una columna “Teléfono” y, opcionalmente, otra “Nombre”. Los nombres se conservarán en el lote y en la conversación. TXT: números separados por comas o renglones.</p>
          {review?.needs_column && <label>¿Qué columna contiene los números?<select value={column} onChange={e => setColumn(e.target.value)}><option value="">Selecciona una columna</option>{review.columns?.map(c => <option key={c.index} value={c.index}>{c.label}</option>)}</select></label>}
        </>}
        <button className="primary" disabled={busy || (mode === 'file' ? !file : !text.trim())} onClick={() => void loadNumbers()}>{busy ? 'Procesando…' : 'Cargar y revisar números'}</button>
        {review && !review.needs_column && <div className="bulk-review" aria-live="polite"><h4>{review.count} números válidos · {review.duplicates} duplicados excluidos · {review.invalid.length} inválidos excluidos</h4>
          <p>Solo los números que aparecen aquí se agregarán al lote. Ningún mensaje se ha enviado.</p>
          <p>Usamos los nombres del archivo y completamos los faltantes con los contactos de este canal. Puedes escribir o corregir cualquier nombre.</p>
          <div className="bulk-table-wrap"><table><thead><tr><th>Número</th><th>Nombre del destinatario</th></tr></thead><tbody>{review.phones.slice(reviewPage*50, reviewPage*50+50).map(p => <tr key={p}><td>{p}</td><td><input aria-label={`Nombre de ${p}`} placeholder="Escribe el nombre" disabled={busy} maxLength={120} value={review.names?.[p] || ''} onChange={e => { const name = e.target.value; setReview(old => old ? { ...old, names: { ...old.names, [p]: name } } : old); requestId.current = crypto.randomUUID(); }} /></td></tr>)}</tbody></table></div>
          {review.count > 50 && <div className="bulk-pages"><button disabled={!reviewPage} onClick={() => setReviewPage(p => p-1)}>Anterior</button><span>Página {reviewPage+1} de {Math.ceil(review.count/50)}</span><button disabled={(reviewPage+1)*50 >= review.count} onClick={() => setReviewPage(p => p+1)}>Siguiente</button></div>}
          {!!review.invalid.length && <details><summary>Ver números excluidos y corregir ({review.invalid.length})</summary><div className="bulk-exclusions">{review.invalid.map((r, i) => <p key={i}>Fila {r.row}: {r.value} — {r.reason}</p>)}</div><p>Corrige el texto o el archivo y vuelve a cargarlo.</p></details>}
        </div>}
      </section>
      {blockedReason && <div id="bulk-prepare-reason" className="bulk-alert" role="status"><strong>Para continuar: </strong>{blockedReason}</div>}
      {error && <div role="alert" className="bulk-alert error">{error}</div>}
      <button className="primary bulk-prepare" aria-describedby={blockedReason ? 'bulk-prepare-reason' : undefined} disabled={!!blockedReason} onClick={() => void action(async () => {
        if (blockedReason) return;
        const saved = await post<Job>('create', { request_id: requestId.current, channel, name: selected?.name, language: selected?.language, parameters, phones: review?.phones, names: review?.names || {} });
        setJob(saved); setOffset(0); setConsent(false);
      })}>3. Revisar costo y confirmar lote</button>
    </> : <section className="bulk-card">
      <header className="bulk-heading"><div><h3>{job.title}</h3><p>{channels.find(c => c.channel === job.channel)?.label || job.channel} · {new Date(job.created_at).toLocaleString('es-MX')}</p></div><strong className={`bulk-state ${job.status}`}>{labels[job.status] || job.status}</strong></header>
      {job.detail && <div role="alert" className="bulk-alert error">{job.detail}</div>}
      <div className="bulk-cost"><div><span>Costo estimado para {job.total} mensajes</span><strong>${money(job.quote.total)} {job.quote.currency}</strong></div><p>${money(job.quote.unit)} USD por mensaje · {job.quote.category} · México</p><p>{job.quote.note}</p><a href={job.quote.source} target="_blank" rel="noreferrer">Tarifas de Meta · verificadas {job.quote.verified_on}</a></div>
      <details><summary>Ver contenido de la plantilla</summary><p className="bulk-template">{job.template.text}</p></details>
      {job.status === 'draft' ? <div className="bulk-confirm"><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />Confirmo que estos destinatarios autorizaron recibir mensajes de este canal y acepto el costo estimado.</label><p>Enviar a números sin autorización puede ocasionar restricciones de WhatsApp. Este lote no activa el bot de la academia.</p><button className="primary" disabled={busy || !consent} onClick={() => void action(async () => { setJob(await post<Job>('start', { id: job.id, consent: true })); })}>Confirmar y enviar a {job.total} contactos · ${money(job.quote.total)} USD</button></div> : <div className="bulk-progress"><label htmlFor="bulk-progress">{job.processed} de {job.total} procesados · {job.percent}%</label><progress id="bulk-progress" value={job.processed} max={job.total || 1} /><p>El avance cuenta intentos terminados; “aceptado” no significa “entregado”. Puedes salir de esta página y volver al lote.</p><div className="bulk-counts">{Object.entries(job.counts).map(([s, n]) => <span key={s} className={`bulk-state ${s}`}>{labels[s] || s}: {n}</span>)}</div></div>}
      {['draft', 'queued', 'running', 'paused'].includes(job.status) && <button disabled={busy} onClick={() => void action(async () => { setJob(await post<Job>('cancel', { id: job.id })); })}>Cancelar pendientes</button>}
      <h4>Destinatarios del lote</h4><div className="bulk-table-wrap"><table><thead><tr><th>Nombre</th><th>Número</th><th>Estado</th><th>Qué ocurrió</th></tr></thead><tbody>{job.recipients?.map(r => <tr key={r.id}><td>{r.name || 'Sin nombre'}</td><td>{r.phone}</td><td><span className={`bulk-state ${r.status}`}>{labels[r.status] || r.status}</span></td><td>{r.detail || '—'}</td></tr>)}</tbody></table></div>
      <div className="bulk-pages"><button disabled={!offset} onClick={() => setOffset(n => n-50)}>Anterior</button><span>Página {Math.floor(offset/50)+1} de {Math.max(1, Math.ceil(job.total/50))}</span><button disabled={!job.has_more} onClick={() => setOffset(n => n+50)}>Siguiente</button></div>
    </section>}
    <section className="bulk-card"><h3>Lotes anteriores de {kind === 'veronica' ? 'Verónica' : 'este número'}</h3><p>Consulta aquí el avance y los errores, aunque hayas cerrado la página.</p>{!jobs.length && <p>No hay lotes registrados.</p>}<div className="bulk-jobs">{jobs.map(j => <button key={j.id} disabled={busy} onClick={() => { setJob(j); setOffset(0); setConsent(false); setError(''); }}><span><strong>{j.title}</strong><small>{new Date(j.created_at).toLocaleString('es-MX')} · {j.total} destinatarios</small></span><span className={`bulk-state ${j.status}`}>{labels[j.status] || j.status} · {j.percent}%</span></button>)}</div>
      <div className="bulk-pages"><button disabled={!jobsPage} onClick={() => setJobsPage(p => p-1)}>Anterior</button><span>Página {jobsPage+1}</span><button disabled={!jobsMore} onClick={() => setJobsPage(p => p+1)}>Siguiente</button></div>
    </section>
  </section>;
}
