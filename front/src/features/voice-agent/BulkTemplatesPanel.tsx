import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { apiRequest, apiFormRequest } from '../../api';
import './bulk-templates.css';
import { UvmContactPicker } from './UvmContactPicker';
import { FileContactFilters, initialFileFilters, type FileContact, type FileFilters } from './FileContactFilters';
import { normalizeBulkReview, type BulkReview as Review, type RecipientParameters } from './bulkReview';
import { formatWhatsAppTemplateCategory } from './model';
import { WhatsAppTemplatePreview } from './WhatsAppTemplatePreview';

type Kind = 'veronica' | 'academy';
type Template = { name: string; language: string; category: string; text: string; sendable: boolean; reason?: string; parameters?: { key: string; label: string; contact_name?: boolean }[] };
type Job = { id: string; title: string; channel: string; status: string; detail: string; created_at: string; heartbeat_at: string | null; percent: number; processed: number; total: number; counts: Record<string, number>; template: { name: string; language: string; text: string }; quote: { total: string; currency: string; unit: string; category: string; note: string; verified_on: string; source: string }; recipients?: { id: number; phone: string; name?: string; status: string; detail: string }[]; has_more?: boolean; directory?: { dataset?: string; needs_review_count?: number; unverified_consent_count?: number } };
const labels: Record<string, string> = { draft: 'Por confirmar', queued: 'En cola', running: 'Enviando', completed: 'Intentos terminados', cancelled: 'Cancelado', paused: 'Detenido: requiere revisión', pending: 'Pendiente', sending: 'En proceso', accepted: 'Aceptado, sin entrega confirmada', sent: 'Enviado', delivered: 'Entregado', read: 'Leído', failed: 'No entregado', uncertain: 'Resultado sin confirmar', skipped: 'Excluido: no desea mensajes' };
const money = (n: string) => Number(n).toLocaleString('es-MX', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

function recipientFields(review: Review, template?: Template): RecipientParameters {
  return Object.fromEntries(review.phones.map(phone => [phone, Object.fromEntries((template?.parameters || []).map(parameter => {
    const imported = review.parameter_values?.[phone]?.[parameter.key]?.trim();
    const contactName = parameter.contact_name ? review.names?.[phone]?.trim() : '';
    return [parameter.key, imported || contactName || ''];
  }))]));
}

export function BulkTemplatesPanel({ token, kind, view = 'create' }: { token: string; kind: Kind; view?: 'create' | 'history' }) {
  const base = kind === 'veronica' ? '/veronica/bulk/' : '/whatsapp-bulk/';
  const [channels, setChannels] = useState<{ channel: string; label: string; contact_directory?: string; directory_label?: string }[]>([]);
  const [channel, setChannel] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateKey, setTemplateKey] = useState('');
  const [recipientParameters, setRecipientParameters] = useState<RecipientParameters>({});
  const [cursor, setCursor] = useState('');
  const [mode, setMode] = useState<'text' | 'file' | 'directory'>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [column, setColumn] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [fileReview, setFileReview] = useState<Review | null>(null);
  const [fileFilters, setFileFilters] = useState<FileFilters>(initialFileFilters);
  const [reviewPage, setReviewPage] = useState(0);
  const [job, setJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsPage, setJobsPage] = useState(0);
  const [jobsMore, setJobsMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [consent, setConsent] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const directoryChannel = channels.find(c => c.channel === channel);
  const hasDirectory = kind === 'academy' && !!directoryChannel?.contact_directory;
  const directoryLabel = directoryChannel?.directory_label || directoryChannel?.label || 'este número';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollError, setPollError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const catalogGeneration = useRef(0);
  const requestId = useRef(crypto.randomUUID());
  const selected = templates.find(t => `${t.name}:${t.language}` === templateKey);
  const selectedParameters = selected?.parameters || [];
  const prepareReason = busy ? 'Espera a que termine la operación actual.'
    : !channel ? 'Selecciona el número desde el que enviarás en el paso 1.'
    : !templates.length ? 'No hay plantillas disponibles. Actualiza las plantillas o elige otro número.'
    : !selected ? 'Falta seleccionar una plantilla aprobada en el paso 1.'
    : !selected.sendable ? selected.reason || 'La plantilla seleccionada no está disponible para envíos masivos.'
    : review?.needs_column ? 'Selecciona la columna de teléfonos y vuelve a cargar el archivo.'
    : !review?.count ? 'Carga y revisa al menos un número válido en el paso 2.' : '';
  const missingFields = review && selected ? review.phones.reduce((total, phone) => total + selectedParameters.filter(parameter => !recipientParameters[phone]?.[parameter.key]?.trim()).length, 0) : 0;
  const blockedReason = prepareReason || (missingFields ? `Completa ${missingFields} ${missingFields === 1 ? 'campo requerido' : 'campos requeridos'} de los destinatarios en la tabla.` : '');
  const templateReady = !!selected?.sendable;
  const draft = job?.status === 'draft' ? job : null;
  const processing = !!job && !draft;
  const historyView = view === 'history' || historyOpen;
  const activeId = processing ? job?.id : undefined;
  const post = <T,>(op: string, body: unknown) => apiRequest<T>(base+op+'/', token, { method: 'POST', body: JSON.stringify(body) });
  function invalidate() { setReview(null); setFileReview(null); setRecipientParameters({}); setFileFilters(initialFileFilters); setReviewPage(0); requestId.current = crypto.randomUUID(); }
  function loadReview(next: Review) {
    const normalized = normalizeBulkReview(next);
    setReview(normalized);
    setRecipientParameters(recipientFields(normalized, selected));
    setReviewPage(0);
    requestId.current = crypto.randomUUID();
  }
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
    const controller = new AbortController();
    catalogGeneration.current += 1;
    setTemplates([]); setTemplateKey(''); setRecipientParameters({}); setCursor('');
    setReview(null); setFileReview(null); setFileFilters(initialFileFilters); setReviewPage(0); setStep(1); setJob(null); setConsent(false); setError('');
    requestId.current = crypto.randomUUID();
    setCatalogLoading(!!channel);
    if (channel) {
      apiRequest<{ templates: Template[]; next_cursor: string }>(base+'catalog/?'+new URLSearchParams({ channel }), token, { signal: controller.signal })
        .then(r => { if (!controller.signal.aborted) { setTemplates(r.templates); setCursor(r.next_cursor); } })
        .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'No se pudieron cargar las plantillas.'); })
        .finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    }
    return () => controller.abort();
  }, [base, token, channel]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (draft && dialog && !dialog.open) dialog.showModal();
    else if (!draft && dialog?.open) { dialog.close(); (confirmButtonRef.current || stepHeadingRef.current)?.focus(); }
  }, [draft?.id]);
  useEffect(() => { setReviewConfirmed(false); }, [draft?.id]);
  useEffect(() => { setMode(hasDirectory ? 'directory' : 'text'); }, [channel, hasDirectory]);
  useEffect(() => { stepHeadingRef.current?.focus(); }, [step, processing]);
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
    const generation = catalogGeneration.current;
    await action(async () => {
      const result = await apiRequest<{ templates: Template[]; next_cursor: string }>(base+'catalog/?'+new URLSearchParams({ channel, after }), token);
      if (generation !== catalogGeneration.current) return;
      setTemplates(old => after ? [...old, ...result.templates] : result.templates);
      setCursor(result.next_cursor === after ? '' : result.next_cursor);
    });
  }
  function chooseFile(next: File | null) {
    setFile(next); setColumn(''); invalidate(); setError('');
    if (next && (!/\.(xlsx|csv|txt)$/i.test(next.name) || next.size > 10*1024*1024)) setError('Usa un archivo .xlsx, .csv o .txt de hasta 10 MB.');
  }
  async function loadNumbers() {
    await action(async () => {
      const form = new FormData();
      form.set('channel', channel);
      if (mode === 'file' && file) form.set('file', file);
      else form.set('text', text);
      if (column !== '') form.set('column', column);
      form.set('template_parameters', JSON.stringify(selected?.parameters || []));
      const result = normalizeBulkReview(await apiFormRequest<Partial<Review>>(base+'import/', token, form));
      loadReview(result);
      if (result.file_contacts?.length) { setFileReview(result); setFileFilters(initialFileFilters); }
      else if (!result.needs_column && result.count) setStep(3);
      else if (!result.needs_column) setError('No encontramos números válidos. Revisa el archivo o escribe números de 10 dígitos.');
    });
  }
  function applyFileContacts(contacts: FileContact[]) {
    if (!fileReview) return;
    const phones = contacts.map(contact => contact.phone);
    const names = Object.fromEntries(contacts.filter(contact => contact.name.trim()).map(contact => [contact.phone, contact.name]));
    loadReview({ ...fileReview, phones, names, count: phones.length });
    setStep(3); setError('');
  }
  function newJob() { setJob(null); setConsent(false); setOffset(0); invalidate(); setStep(1); setHistoryOpen(false); setError(''); }
  function closeConfirmation() { if (!busy) { setJob(null); setConsent(false); setError(''); } }
  const previewPhone = review?.phones[0];
  const previewText = selected ? selectedParameters.reduce((message, parameter, index) => {
    const recipientValue = previewPhone ? recipientParameters[previewPhone]?.[parameter.key]?.trim() : '';
    const value = recipientValue || (parameter.contact_name ? 'María' : parameter.label || `{{${index + 1}}}`);
    return message.replaceAll(`{{${index + 1}}}`, value);
  }, selected.text) : '';
  const previewChannel = channels.find(c => c.channel === channel)?.label || 'Tu academia';
  const recipientModeControls = <>
    {hasDirectory && <button aria-pressed={mode === 'directory'} disabled={busy} onClick={() => { setMode('directory'); invalidate(); }}>Contactos de {directoryLabel}</button>}
    <button aria-pressed={mode === 'text'} disabled={busy} onClick={() => { setMode('text'); invalidate(); }}>Escribir o pegar números</button>
    <button aria-pressed={mode === 'file'} disabled={busy} onClick={() => { setMode('file'); invalidate(); }}>Agregar Excel, CSV o TXT</button>
  </>;
  const recipientStepTitle = mode === 'directory' ? 'Selecciona los contactos' : mode === 'file' ? 'Carga el archivo' : 'Escribe los números';
  return <section className="bulk-templates">
    <header className="bulk-heading"><div><p>Comunicaciones / {kind === 'veronica' ? 'Verónica' : 'Canchas'} / Envíos masivos</p><h2>{view === 'history' ? 'Historial de envíos' : 'Envío masivo de plantillas'}</h2></div><div className="bulk-actions">{view === 'history' && job && <button onClick={() => { setJob(null); setOffset(0); setError(''); }} disabled={busy}>Volver al historial</button>}{view === 'create' && processing && <button onClick={newJob} disabled={busy}>Nuevo envío</button>}{kind === 'veronica' && view === 'create' && <button aria-expanded={historyOpen} onClick={() => setHistoryOpen(v => !v)}>Lotes anteriores</button>}</div></header>
    {error && !draft && <div role="alert" className="bulk-alert error">{error}</div>}
    {pollError && <div role="alert" className="bulk-alert error">No se pudo actualizar el avance. Lo mostrado puede estar desactualizado. {pollError}</div>}
    {!historyView && !processing ? <div className={`bulk-workspace ${step === 2 ? 'bulk-workspace-single' : ''}`}><div className="bulk-wizard">
      {step === 1 && <section className="bulk-card"><header className="bulk-step-heading"><h3 ref={stepHeadingRef} tabIndex={-1}>Configura el envío</h3><span>Paso 1 de 3 · Plantilla y destinatarios</span></header>
        <div className="bulk-fields"><label>Enviar desde<select value={channel} disabled={busy || !channels.length} onChange={e => { setChannel(e.target.value); setJobsPage(0); }}><option value="" disabled>Selecciona un canal</option>{channels.map(c => <option key={c.channel} value={c.channel}>{c.label}</option>)}</select></label>
          <button disabled={busy || catalogLoading || !channel} onClick={() => void loadTemplates()}>Actualizar plantillas</button></div>
        {catalogLoading && <p role="status">Cargando plantillas disponibles…</p>}
        {!catalogLoading && !!channel && !templates.length && <p>No hay plantillas disponibles para este número.</p>}
        {!channels.length && <p>No hay canales conectados disponibles. No se pueden realizar envíos.</p>}
        {!!templates.length && <label>Plantilla aprobada<select value={templateKey} disabled={busy} onChange={e => { setTemplateKey(e.target.value); invalidate(); }}><option value="">Selecciona una plantilla</option>{templates.map(t => <option key={`${t.name}:${t.language}`} disabled={!t.sendable} value={`${t.name}:${t.language}`}>{t.name} · {t.language}{!t.sendable ? ' · No disponible para masivos' : ''}</option>)}</select></label>}
        {cursor && <button disabled={busy} onClick={() => void loadTemplates(cursor)}>Cargar más plantillas</button>}
        {selected && !templateReady && <p role="status">Esta plantilla no está disponible para envíos masivos.</p>}
        <div className="bulk-recipient-choice"><strong>¿Cómo agregarás los destinatarios?</strong><div className="bulk-tabs bulk-recipient-options">{recipientModeControls}</div></div>
        <div className="bulk-actions"><button className="primary" disabled={busy || catalogLoading || !templateReady} onClick={() => { setStep(2); setError(''); }}>Continuar con destinatarios</button></div>
      </section>}
      {step === 2 && <section className="bulk-card bulk-recipient-card"><header className="bulk-step-heading"><div><button className="bulk-back-button" type="button" aria-label="Regresar a configurar el envío" title="Regresar" disabled={busy} onClick={() => { setStep(1); setError(''); }}><ArrowLeft aria-hidden="true" size={18} /></button><h3 ref={stepHeadingRef} tabIndex={-1}>{recipientStepTitle}</h3></div><span>Paso 2 de 3 · Carga destinatarios</span></header>
        {mode === 'directory' && hasDirectory ? <UvmContactPicker key={channel} token={token} channel={channel} label={directoryLabel} onLoad={r => { loadReview(r); setStep(3); }} /> : <>
        {mode === 'text' ? <label>Números separados por comas<textarea disabled={busy} rows={4} value={text} maxLength={25000} placeholder="5512345678, 5587654321" onChange={e => { setText(e.target.value); invalidate(); }} /></label> : <>
          <label className={`bulk-drop ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) chooseFile(e.dataTransfer.files[0] || null); }}>
            <strong>{file ? file.name : 'Arrastra tu archivo aquí'}</strong><span>o pulsa para elegir Excel (.xlsx), CSV o TXT · hasta 10 MB</span><input type="file" accept=".xlsx,.csv,.txt" disabled={busy} onChange={e => chooseFile(e.target.files?.[0] || null)} />
          </label>
          {review?.needs_column && <label>¿Qué columna contiene los números?<select value={column} onChange={e => setColumn(e.target.value)}><option value="">Selecciona una columna</option>{review.columns?.map(c => <option key={c.index} value={c.index}>{c.label}</option>)}</select></label>}
        </>}
        {mode === 'file' && fileReview?.file_contacts?.length && fileReview.file_facets && <FileContactFilters contacts={fileReview.file_contacts} facets={fileReview.file_facets} profile={fileReview.file_profile || 'generic'} filters={fileFilters} disabled={busy} onChange={setFileFilters} onApply={applyFileContacts} />}
        {!(mode === 'file' && fileReview?.file_contacts?.length) && <button className="primary" disabled={busy || (mode === 'file' ? !file : !text.trim())} onClick={() => void loadNumbers()}>{busy ? 'Procesando…' : mode === 'file' ? 'Leer archivo y mostrar filtros' : 'Cargar y revisar números'}</button>}
        </>}
      </section>}
      {step === 3 && review && !review.needs_column && <section className="bulk-card"><header className="bulk-step-heading"><div><button className="bulk-back-button" type="button" aria-label="Regresar a cargar destinatarios" title="Regresar" disabled={busy} onClick={() => { if (fileReview) setReview(fileReview); setStep(2); setError(''); }}><ArrowLeft aria-hidden="true" size={18} /></button><h3 ref={stepHeadingRef} tabIndex={-1}>Revisa los destinatarios</h3></div><span>Paso 3 de 3 · Completa los campos</span></header><div className="bulk-review" aria-live="polite"><h4>{review.count} números válidos · {review.duplicates} duplicados excluidos · {review.invalid.length} inválidos excluidos</h4>
          {kind === 'veronica' && !!((review.added_filter_options?.platform.length || 0) + (review.added_filter_options?.vacancy_type.length || 0)) && <p className="bulk-alert">Se agregaron categorías nuevas: {[...(review.added_filter_options?.platform || []), ...(review.added_filter_options?.vacancy_type || [])].join(', ')}.</p>}
          <p>Solo los números que aparecen aquí se agregarán al lote. Ningún mensaje se ha enviado.</p>
          {!!selectedParameters.length && <p>Completamos lo disponible desde cada contacto y desde las columnas del archivo. Revisa o escribe todos los campos requeridos por la plantilla.</p>}
          <div className="bulk-table-wrap"><table><thead><tr><th>Número</th>{selectedParameters.map(parameter => <th key={parameter.key}>{parameter.label}</th>)}{kind === 'veronica' && <><th>Plataforma</th><th>Tipo de vacante</th></>}</tr></thead><tbody>{review.phones.slice(reviewPage*50, reviewPage*50+50).map(phone => <tr key={phone}><td>{phone}</td>{selectedParameters.map(parameter => <td key={parameter.key}><input aria-label={`${parameter.label} de ${phone}`} placeholder={`Escribe ${parameter.label.toLocaleLowerCase('es-MX')}`} disabled={busy} maxLength={parameter.contact_name ? 120 : 500} value={recipientParameters[phone]?.[parameter.key] || ''} onChange={e => { const value = e.target.value; setRecipientParameters(old => ({ ...old, [phone]: { ...old[phone], [parameter.key]: value } })); if (parameter.contact_name) setReview(old => old ? { ...old, names: { ...old.names, [phone]: value } } : old); requestId.current = crypto.randomUUID(); }} /></td>)}{kind === 'veronica' && <><td><input aria-label={`Plataforma de ${phone}`} placeholder="Ej. OCC" disabled={busy} maxLength={80} value={review.filters?.[phone]?.platform || ''} onChange={e => { const value = e.target.value; setReview(old => old ? { ...old, filters: { ...old.filters, [phone]: { ...old.filters?.[phone], platform: value } } } : old); requestId.current = crypto.randomUUID(); }} /></td><td><input aria-label={`Tipo de vacante de ${phone}`} placeholder="Ej. Coach" disabled={busy} maxLength={80} value={review.filters?.[phone]?.vacancy_type || ''} onChange={e => { const value = e.target.value; setReview(old => old ? { ...old, filters: { ...old.filters, [phone]: { ...old.filters?.[phone], vacancy_type: value } } } : old); requestId.current = crypto.randomUUID(); }} /></td></>}</tr>)}</tbody></table></div>
          {review.count > 50 && <div className="bulk-pages"><button disabled={!reviewPage} onClick={() => setReviewPage(p => p-1)}>Anterior</button><span>Página {reviewPage+1} de {Math.ceil(review.count/50)}</span><button disabled={(reviewPage+1)*50 >= review.count} onClick={() => setReviewPage(p => p+1)}>Siguiente</button></div>}
          {!!review.invalid.length && <details><summary>Ver números excluidos y corregir ({review.invalid.length})</summary><div className="bulk-exclusions">{review.invalid.map((r, i) => <p key={i}>Fila {r.row}: {r.value} — {r.reason}</p>)}</div><p>Corrige el texto o el archivo y vuelve a cargarlo.</p></details>}
        </div>
      {blockedReason && <div id="bulk-prepare-reason" className="bulk-alert" role="status"><strong>Para continuar: </strong>{blockedReason}</div>}
      <div className="bulk-actions"><button ref={confirmButtonRef} className="primary bulk-prepare" aria-describedby={blockedReason ? 'bulk-prepare-reason' : undefined} disabled={!!blockedReason} onClick={() => void action(async () => {
        if (blockedReason) return;
        const saved = await post<Job>('create', { request_id: requestId.current, channel, name: selected?.name, language: selected?.language, ...(selectedParameters.length ? { recipient_parameters: recipientParameters } : { parameters: {} }), phones: review?.phones, names: review?.names || {}, ...(kind === 'veronica' ? { filters: review?.filters || {} } : {}), ...(review?.contact_ids ? { contact_ids: review.contact_ids } : {}) });
        setJob(saved); setOffset(0); setConsent(false);
      })}>{busy ? 'Calculando costo…' : 'Confirmar destinatarios'}</button></div>
      </section>}
    </div>{step !== 2 && <WhatsAppTemplatePreview channelLabel={previewChannel} text={previewText} templateName={selected?.name} meta={selected ? `${formatWhatsAppTemplateCategory(selected.category)} · ${selected.language}` : ''} />}</div> : job && <section className="bulk-card">
      <header className="bulk-heading"><div><h3>{job.title}</h3><p>{channels.find(c => c.channel === job.channel)?.label || job.channel} · {new Date(job.created_at).toLocaleString('es-MX')}</p></div><strong className={`bulk-state ${job.status}`}>{labels[job.status] || job.status}</strong></header>
      {job.detail && <div role="alert" className="bulk-alert error">{job.detail}</div>}
      <h3 ref={stepHeadingRef} tabIndex={-1}>Progreso del envío</h3>
      <details><summary>Consultar costo estimado · ${money(job.quote.total)} {job.quote.currency}</summary><p>{job.quote.note}</p></details>
      <details><summary>Ver contenido de la plantilla</summary><p className="bulk-template">{job.template.text}</p></details>
      <div className="bulk-progress"><label htmlFor="bulk-progress">{job.processed} de {job.total} procesados · {job.percent}%</label><progress id="bulk-progress" value={job.processed} max={job.total || 1} /><p>El avance cuenta intentos terminados; “aceptado” no significa “entregado”. Puedes salir de esta página y volver al lote.</p><div className="bulk-counts">{Object.entries(job.counts).map(([s, n]) => <span key={s} className={`bulk-state ${s}`}>{labels[s] || s}: {n}</span>)}</div></div>
      {['draft', 'queued', 'running', 'paused'].includes(job.status) && <button disabled={busy} onClick={() => void action(async () => { setJob(await post<Job>('cancel', { id: job.id })); })}>Cancelar pendientes</button>}
      <h4>Destinatarios del lote</h4><div className="bulk-table-wrap"><table><thead><tr><th>Nombre</th><th>Número</th><th>Estado</th><th>Qué ocurrió</th></tr></thead><tbody>{job.recipients?.map(r => <tr key={r.id}><td>{r.name || 'Sin nombre'}</td><td>{r.phone}</td><td><span className={`bulk-state ${r.status}`}>{labels[r.status] || r.status}</span></td><td>{r.detail || '—'}</td></tr>)}</tbody></table></div>
      <div className="bulk-pages"><button disabled={!offset} onClick={() => setOffset(n => n-50)}>Anterior</button><span>Página {Math.floor(offset/50)+1} de {Math.max(1, Math.ceil(job.total/50))}</span><button disabled={!job.has_more} onClick={() => setOffset(n => n+50)}>Siguiente</button></div>
      {hasDirectory && job.directory?.dataset === directoryChannel?.contact_directory && <button className="primary" disabled={busy} onClick={() => { setJob(null); setConsent(false); invalidate(); setStep(2); setMode('directory'); }}>Elegir el siguiente lote de {directoryLabel}</button>}
    </section>}
    <dialog ref={dialogRef} className="bulk-modal" aria-labelledby="bulk-confirm-title" onCancel={e => { e.preventDefault(); closeConfirmation(); }}>
      {draft && <div className="bulk-card"><header className="bulk-heading"><h3 id="bulk-confirm-title">Confirmar envío</h3><button aria-label="Cerrar confirmación" disabled={busy} onClick={closeConfirmation}>Cerrar</button></header>
        <p><strong>{draft.total} destinatarios</strong> · {channels.find(c => c.channel === draft.channel)?.label || draft.channel}</p>
        <p>Plantilla: {draft.template.name}</p>
        <div className="bulk-cost"><div><span>Costo total estimado</span><strong>${money(draft.quote.total)} {draft.quote.currency}</strong></div><p>${money(draft.quote.unit)} {draft.quote.currency} por mensaje · {formatWhatsAppTemplateCategory(draft.quote.category)} · México</p><p>{draft.quote.note}</p><a href={draft.quote.source} target="_blank" rel="noreferrer">Tarifas · verificadas {draft.quote.verified_on}</a></div>
        <div className="bulk-confirm"><label><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />Confirmo que estos destinatarios autorizaron recibir mensajes de este canal y acepto el costo estimado.</label></div>
        {!!draft.directory?.unverified_consent_count && <p>El Excel no acredita el consentimiento de {draft.directory.unverified_consent_count} contactos. Confirma la casilla anterior únicamente si cuentas con su autorización. Esta confirmación queda registrada con el lote y no modifica el análisis original.</p>}
        {!!draft.directory?.needs_review_count && <div className="bulk-confirm"><label><input type="checkbox" checked={reviewConfirmed} disabled={busy} onChange={e => setReviewConfirmed(e.target.checked)} />Revisé el contexto de los {draft.directory.needs_review_count} contactos marcados para revisión y confirmo que el mensaje es pertinente.</label></div>}
        {error && <div role="alert" className="bulk-alert error">{error}</div>}
        <div className="bulk-actions"><button disabled={busy} onClick={closeConfirmation}>Volver sin enviar</button><button className="primary" disabled={busy || !consent || (!!draft.directory?.needs_review_count && !reviewConfirmed)} onClick={() => void action(async () => { const next = await post<Job>('start', { id: draft.id, consent: true, review_confirmed: reviewConfirmed }); setJob(next); setHistoryOpen(false); })}>{busy ? 'Confirmando…' : `Confirmar y enviar a ${draft.total} contactos`}</button></div>
        <p className="bulk-modal-note">Los mensajes se enviarán al confirmar. La entrega se mostrará en la siguiente pantalla.</p>
      </div>}
    </dialog>
    {historyView && !job && <section className="bulk-card"><h3>{kind === 'veronica' ? 'Lotes anteriores de Verónica' : 'Lotes enviados'}</h3><p>Consulta el avance, los destinatarios y los errores de cada envío.</p>{!jobs.length && <p>No hay lotes registrados.</p>}<div className="bulk-jobs">{jobs.map(j => <button key={j.id} disabled={busy} onClick={() => { setJob(j); setOffset(0); setConsent(false); setError(''); setHistoryOpen(false); }}><span><strong>{j.title}</strong><small>{new Date(j.created_at).toLocaleString('es-MX')} · {j.total} destinatarios</small></span><span className={`bulk-state ${j.status}`}>{labels[j.status] || j.status} · {j.percent}%</span></button>)}</div>
      <div className="bulk-pages"><button disabled={!jobsPage} onClick={() => setJobsPage(p => p-1)}>Anterior</button><span>Página {jobsPage+1}</span><button disabled={!jobsMore} onClick={() => setJobsPage(p => p+1)}>Siguiente</button></div>
    </section>}
  </section>;
}
