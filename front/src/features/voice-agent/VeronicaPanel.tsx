import { useEffect, useRef, useState } from "react";
import { ArrowLeft, FileText, RefreshCw, X } from "lucide-react";
import { apiRequest } from "../../api";
import { formatDateTime, inputClass, primaryButtonClass, secondaryButtonClass } from "./model";
import "./veronica.css";
import { deliveryProblem } from "./veronicaDelivery";
import { VeronicaAutomaticPdf } from './VeronicaAutomaticPdf';
import { templateStatusMeta } from "./veronicaTemplateStatus";

type Chat = { id: number; phone: string; name: string; opted_out: boolean; last_message_at: string | null; can_reply: boolean; window_end: string | null };
type Message = { id: number; body: string; direction: string; created_at: string; status: string; error_codes: number[] };
type History = { messages: Message[]; can_reply: boolean; window_end: string | null; has_more: boolean };
type TemplateParameter = { key: string; label: string; contact_name?: boolean };
type Template = { name: string; language: string; text: string; status: string; sendable: boolean; reason: string; parameters?: TemplateParameter[] };
type SendResult = { conversation_id: number; status: string; detail: string; message_id: string };
const labels: Record<string, string> = { accepted: "Aceptado por la API · aún no confirma entrega", sent: "Enviado", delivered: "Entregado", read: "Leído", failed: "Fallido", sending: "Procesando · no repetir", uncertain: "Resultado incierto · no repetir" };
const emptyHistory: History = { messages: [], can_reply: false, window_end: null, has_more: false };

function replyWindowOpen(windowEnd: string | null, canReply: boolean, now: number) {
  if (!windowEnd || !canReply) return false;
  const end = Date.parse(windowEnd);
  return Number.isFinite(end) && end > now;
}

function replyWindowRemaining(windowEnd: string | null, now: number) {
  if (!windowEnd) return "";
  const minutes = Math.max(1, Math.ceil((Date.parse(windowEnd) - now) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${minutes} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function DeliveryAlert({ message, phone }: { message: Message; phone?: string }) {
  const problem = deliveryProblem(message.status, message.error_codes);
  if (!problem) return null;
  return <div className="vero-delivery-alert" role="alert">
    <strong>⚠ {problem.title}</strong>
    {phone && <p>Destinatario: {phone} · {formatDateTime(message.created_at)}</p>}
    <p>{problem.explanation}</p><p><b>Qué hacer:</b> {problem.action}</p>
    {message.error_codes.length > 0 && <details><summary>Detalle técnico para soporte</summary><p>Código de WhatsApp: {message.error_codes.join(", ")}</p></details>}
  </div>;
}

export function VeronicaPanel({ token }: { token: string }) {
  const [chats, setChats] = useState<Chat[]>([]), [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0), [more, setMore] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null), [phone, setPhone] = useState("");
  const [history, setHistory] = useState<History>(emptyHistory);
  const [templates, setTemplates] = useState<Template[]>([]), [templateKey, setTemplateKey] = useState("");
  const [templateParameters, setTemplateParameters] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [mobileConversation, setMobileConversation] = useState(false);
  const consoleRef = useRef<HTMLDivElement>(null);
  const pdfDialog = useRef<HTMLDialogElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [refresh, setRefresh] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const lock = useRef(false);
  const selected = templates.find(t => t.name + ":" + t.language === templateKey);
  const selectedStatus = selected ? templateStatusMeta(selected.status) : null;
  const knownContactName = chat && chat.name !== chat.phone && !/^\+?\d+$/.test(chat.name) ? chat.name : "";
  const parameterDefaults = (template?: Template) => Object.fromEntries((template?.parameters || []).map(parameter =>
    [parameter.key, parameter.contact_name ? knownContactName : ""]));
  const renderedTemplate = selected?.text.replace(/{{\s*(\d+)\s*}}/g, (match, number: string) =>
    templateParameters[`body:${number}`]?.trim() || match) || "";

  useEffect(() => {
    const element = consoleRef.current;
    if (!element) return;
    const fit = () => {
      const viewport = window.visualViewport;
      const bottom = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
      element.style.height = `${Math.max(0, bottom - element.getBoundingClientRect().top - 16)}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener('resize', fit);
    window.visualViewport?.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); window.visualViewport?.removeEventListener('resize', fit); };
  }, []);
  useEffect(() => {
    if (pdfOpen) pdfDialog.current?.showModal();
    else pdfDialog.current?.close();
  }, [pdfOpen]);
  useEffect(() => {
    if (followLatest.current && historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [history.messages]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      apiRequest<{ conversations: Chat[]; has_more: boolean }>(`/veronica/inbox/?q=${encodeURIComponent(query)}&offset=${offset}`, token, { signal: controller.signal })
        .then(r => { setChats(r.conversations); setMore(r.has_more); })
        .catch(e => { if (!controller.signal.aborted) setError(e.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [token, query, offset, refresh]);
  useEffect(() => {
    if (!chat) { setHistory(emptyHistory); setHistoryLoaded(false); return; }
    const controller = new AbortController();
    setHistoryLoaded(false);
    const load = () => apiRequest<History>(`/veronica/history/?conversation_id=${chat.id}`, token, { signal: controller.signal })
      .then(result => { setHistory(result); setHistoryLoaded(true); }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    void load();
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [token, chat, refresh]);

  async function loadTemplates() {
    setBusy(true); setError("");
    try {
      const r = await apiRequest<{ templates: Template[] }>("/veronica/templates/", token);
      setTemplates(r.templates);
      const current = r.templates.find(t => t.name + ":" + t.language === templateKey);
      const initial = current || r.templates.find(t => t.name === "seguimiento_postulacion_occ") || r.templates.find(t => t.name === "reclutamiento_primer_mensaje" && t.language === "es") || r.templates.find(t => t.sendable) || r.templates[0];
      setTemplateKey(initial ? initial.name + ":" + initial.language : "");
      setTemplateParameters(parameterDefaults(initial));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function older() {
    if (!chat || !history.messages.length) return;
    setBusy(true);
    try { const before = Math.min(...history.messages.filter(m => m.id > 0).map(m => m.id)); const r = await apiRequest<History>(`/veronica/history/?conversation_id=${chat.id}&before=${before}`, token); setHistory(h => ({ ...r, messages: [...r.messages, ...h.messages] })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function choose(c: Chat | null) {
    setMobileConversation(true); followLatest.current = true;
    const savedPhone = c?.phone.replace(/^\+/, '') ?? '';
    const localPhone = /^52\d{10}$/.test(savedPhone) ? savedPhone.slice(2) : /^521\d{10}$/.test(savedPhone) ? savedPhone.slice(3) : savedPhone;
    setChat(c); setPhone(localPhone); setHistory(emptyHistory); setHistoryLoaded(false); setBody(""); setTemplateParameters({}); setNotice(""); setError(""); request.current = null;
  }
  async function send() {
    if (lock.current) return;
    if (!chat && !/^[1-9]\d{9}$/.test(phone)) { setError('Escribe los 10 dígitos del número de México, sin +52.'); return; }
    const destination = chat?.phone ?? `+52${phone}`;
    const kind = replyAvailable ? "text" : "template";
    setConfirming(false);
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const fingerprint = JSON.stringify([phone, kind, body, templateKey, templateParameters]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const r = await apiRequest<SendResult>("/veronica/send/", token, { method: "POST", body: JSON.stringify({
        phone: destination, kind, body, template_name: selected?.name, language: selected?.language,
        parameters: templateParameters, request_id: request.current.id,
      }) });
      setNotice(labels[r.status] || r.status);
      if (r.status === "accepted") { setBody(""); request.current = null; }
      if (r.status === "failed") setError(r.detail || "La API rechazó el envío. Revisa la conexión antes de intentar otro envío.");
      if (!chat) setChat({ id: r.conversation_id, phone: destination, name: phone, last_message_at: null, opted_out: false, can_reply: false, window_end: null });
      setRefresh(n => n + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); lock.current = false; }
  }
  const replyAvailable = Boolean(chat) && replyWindowOpen(historyLoaded ? history.window_end : chat?.window_end ?? null, historyLoaded ? history.can_reply : Boolean(chat?.can_reply), clock);
  const templateRequired = !replyAvailable;
  const templateReady = !!selected?.sendable && (selected.parameters || []).every(parameter => templateParameters[parameter.key]?.trim());
  const canSend = !busy && (chat ? /^\+?[1-9]\d{7,14}$/.test(chat.phone) : /^[1-9]\d{9}$/.test(phone)) && !chat?.opted_out && (templateRequired ? templateReady : !!body.trim());
  useEffect(() => {
    if (templateRequired && !templates.length) void loadTemplates();
  }, [templateRequired, templates.length]);
  const lastProblem = [...history.messages].reverse().find(m => m.direction === "outbound" && deliveryProblem(m.status, m.error_codes));
  return <div ref={consoleRef} className={`veronica-console${mobileConversation ? ' has-conversation' : ''}`}>
    <header className="comm-page-heading"><div><p className="comm-eyebrow">Comunicaciones / Verónica</p><h2>Mensajes</h2></div><div className="vero-heading-actions"><button className="vero-toolbar-button" onClick={() => setPdfOpen(true)}><FileText size={18} aria-hidden="true" />PDF automático</button><button className="vero-toolbar-button" disabled={busy} onClick={() => { setRefresh(n => n + 1); void loadTemplates(); }}><RefreshCw size={18} aria-hidden="true" />Actualizar</button></div></header>
    <div className="vero-feedback">
    {error && <p className="comm-error" role="alert">{error}</p>}
    {chat && lastProblem ? <DeliveryAlert message={lastProblem} phone={chat.phone} /> : notice && <p className="vero-note" role="status">{notice}</p>}
    </div>
    <div className="vero-layout"><aside className="comm-panel vero-sidebar">
      <h3>Conversaciones</h3><input aria-label="Buscar contacto de Verónica" className={inputClass} placeholder="Buscar teléfono o nombre" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} />
      <button className={primaryButtonClass} disabled={busy} onClick={() => choose(null)}>Nuevo destinatario</button>
      {loading && <p role="status">Cargando…</p>}{!loading && !chats.length && <p>No hay conversaciones en esta búsqueda.</p>}
      <div className="vero-contacts">{chats.map(c => {
        const open = replyWindowOpen(c.window_end, c.can_reply, clock);
        return <button disabled={busy} aria-pressed={chat?.id === c.id} key={c.id} onClick={() => choose(c)}><strong>{c.name}</strong><small>{c.phone} · {formatDateTime(c.last_message_at)}</small><span className={`vero-window-chip ${open ? "open" : "closed"}`}>{open ? `Ventana abierta · ${replyWindowRemaining(c.window_end, clock)}` : "Ventana cerrada"}</span></button>;
      })}</div>
      <nav aria-label="Páginas de conversaciones"><button disabled={!offset || busy} onClick={() => setOffset(n => Math.max(0, n - 30))}>Anterior</button><span>{offset / 30 + 1}</span><button disabled={!more || busy} onClick={() => setOffset(n => n + 30)}>Siguiente</button></nav>
    </aside><section className="comm-panel vero-conversation">
      <button className="vero-mobile-back vero-toolbar-button" onClick={() => setMobileConversation(false)}><ArrowLeft size={18} />Conversaciones</button>
      {chat ? <dl className="vero-contact-info"><div><dt>Nombre</dt><dd>{chat.name}</dd></div><div><dt>Destinatario</dt><dd>{chat.phone}</dd></div></dl> : <label>Destinatario (10 dígitos)<input className={inputClass} type="tel" inputMode="numeric" value={phone} disabled={busy} placeholder="5574879293" onChange={e => setPhone(e.target.value.replace(/[\s()-]/g, ""))} /></label>}
      {!chat && phone && !/^[1-9]\d{9}$/.test(phone) && <small role="status">Escribe 10 dígitos, sin +52.</small>}
      <div ref={historyRef} className="vero-history" aria-label="Historial de Verónica" tabIndex={0} onScroll={e => { const el = e.currentTarget; followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; }}>
      {chat ? <>{history.has_more && <button disabled={busy} onClick={() => { followLatest.current = false; void older(); }}>Ver mensajes anteriores</button>}{history.messages.map(m => <article key={m.id} className={m.direction === "outbound" ? "outbound" : "inbound"}><small>{m.direction === "outbound" ? "Verónica / equipo" : "Contacto"} · {formatDateTime(m.created_at)}</small><p>{m.body}</p>{m.status && <small>{labels[m.status] || m.status}{m.error_codes.length > 0 && ` · Error ${m.error_codes.join(", ")}`}</small>}</article>)}{!history.messages.length && <p>{historyLoaded ? 'Sin mensajes registrados.' : 'Cargando mensajes…'}</p>}</> : <p className="vero-empty-chat">Selecciona una conversación o escribe el número de un nuevo destinatario.</p>}
      </div><div className={`vero-composer${templateRequired ? ' template-only' : ''}`}>
      {templateRequired && <div className="vero-window-closed-notice" role="status"><strong>Ventana de atención cerrada</strong><span>El mensaje libre está desactivado. Para iniciar una nueva conversación, envía una plantilla aprobada.</span></div>}
      {templateRequired ? <><label><span className="vero-template-heading"><span>Plantilla</span>{selectedStatus && <span className={`vero-template-status ${selectedStatus.tone}`} aria-label={`Estado de la plantilla: ${selectedStatus.label}`}>{selectedStatus.label}</span>}</span><select className={inputClass} disabled={busy} value={templateKey} onChange={e => { const next = templates.find(t => t.name + ":" + t.language === e.target.value); setTemplateKey(e.target.value); setTemplateParameters(parameterDefaults(next)); request.current = null; }}><option value="">Selecciona una plantilla</option>{templates.map(t => { const status = templateStatusMeta(t.status); return <option key={t.name + t.language} value={t.name + ":" + t.language}>{t.name} · {status.label}</option>; })}</select></label>
        {selected && !selected.sendable && <small className="vero-template-help" role="status">{selected.reason || "Esta plantilla todavía no puede enviarse. Espera a que Meta la apruebe y pulsa Actualizar."}</small>}
        {(selected?.parameters || []).map(parameter => <label key={parameter.key}>{parameter.label}<input className={inputClass} maxLength={500} disabled={busy} value={templateParameters[parameter.key] || ""} placeholder={parameter.contact_name ? "Nombre" : "Dato de la plantilla"} onChange={e => { setTemplateParameters(values => ({ ...values, [parameter.key]: e.target.value })); request.current = null; }} /></label>)}</>
        : <label>Mensaje<textarea className={inputClass} rows={2} maxLength={4000} disabled={busy} value={body} onChange={e => setBody(e.target.value)} /></label>}
      {chat?.opted_out && <p role="alert">Este contacto pidió no recibir mensajes. Envío bloqueado.</p>}
      <button className={primaryButtonClass} disabled={!canSend} onClick={() => setConfirming(true)}>{busy ? "Procesando…" : templateRequired ? "Enviar plantilla" : "Enviar mensaje"}</button>
    </div></section></div>
    <dialog ref={pdfDialog} className="vero-pdf-modal" aria-labelledby="vero-pdf-title" onCancel={() => setPdfOpen(false)} onClose={() => setPdfOpen(false)}>
      <header className="vero-modal-heading"><h2 id="vero-pdf-title">PDF automático</h2><button className="vero-toolbar-button" aria-label="Cerrar configuración del PDF" onClick={() => setPdfOpen(false)}><X size={20} /></button></header>
      {pdfOpen && <VeronicaAutomaticPdf token={token} onSaved={() => setRefresh(n => n+1)} />}
    </dialog>
    {confirming && <div className="vero-confirm-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="vero-confirm-title" className="vero-confirm">
      <h3 id="vero-confirm-title">Confirmar envío desde Verónica</h3>
      <p>Destinatario: <strong>{phone}</strong></p>
      <p>{templateRequired ? `Plantilla: ${selected?.name}` : "Mensaje"}</p>
      <p className="vero-preview">{templateRequired ? renderedTemplate : body}</p>
      <div className="vero-tabs"><button autoFocus className={secondaryButtonClass} onClick={() => setConfirming(false)}>Cancelar</button><button className={primaryButtonClass} disabled={!canSend} onClick={() => void send()}>Confirmar envío</button></div>
    </div></div>}
  </div>;
}
