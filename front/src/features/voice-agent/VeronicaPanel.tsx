import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api";
import { formatDateTime, inputClass, primaryButtonClass, secondaryButtonClass } from "./model";
import "./veronica.css";
import { deliveryProblem } from "./veronicaDelivery";
import { VeronicaAutomaticPdf } from './VeronicaAutomaticPdf';

type Chat = { id: number; phone: string; name: string; opted_out: boolean; last_message_at: string | null; can_reply: boolean; window_end: string | null };
type Message = { id: number; body: string; direction: string; created_at: string; status: string; error_codes: number[] };
type History = { messages: Message[]; can_reply: boolean; window_end: string | null; has_more: boolean };
type Template = { name: string; language: string; text: string; status: string; sendable: boolean; reason: string };
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
  const [body, setBody] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const lock = useRef(false);
  const selected = templates.find(t => t.name + ":" + t.language === templateKey);

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
      const initial = r.templates.find(t => t.name === "reclutamiento_primer_mensaje" && t.language === "es") || r.templates.find(t => t.sendable);
      setTemplateKey(initial ? initial.name + ":" + initial.language : "");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function older() {
    if (!chat || !history.messages.length) return;
    setBusy(true);
    try { const before = Math.min(...history.messages.filter(m => m.id > 0).map(m => m.id)); const r = await apiRequest<History>(`/veronica/history/?conversation_id=${chat.id}&before=${before}`, token); setHistory(h => ({ ...r, messages: [...r.messages, ...h.messages] })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function choose(c: Chat | null) {
    const savedPhone = c?.phone.replace(/^\+/, '') ?? '';
    const localPhone = /^52\d{10}$/.test(savedPhone) ? savedPhone.slice(2) : /^521\d{10}$/.test(savedPhone) ? savedPhone.slice(3) : savedPhone;
    setChat(c); setPhone(localPhone); setHistory(emptyHistory); setHistoryLoaded(false); setBody(""); setNotice(""); setError(""); request.current = null;
  }
  async function send() {
    if (lock.current) return;
    if (!chat && !/^[1-9]\d{9}$/.test(phone)) { setError('Escribe los 10 dígitos del número de México, sin +52.'); return; }
    const destination = chat?.phone ?? `+52${phone}`;
    const kind = replyAvailable ? "text" : "template";
    setConfirming(false);
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const fingerprint = JSON.stringify([phone, kind, body, templateKey]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const r = await apiRequest<SendResult>("/veronica/send/", token, { method: "POST", body: JSON.stringify({
        phone: destination, kind, body, template_name: selected?.name, language: selected?.language, request_id: request.current.id,
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
  const canSend = !busy && (chat ? /^\+?[1-9]\d{7,14}$/.test(chat.phone) : /^[1-9]\d{9}$/.test(phone)) && !chat?.opted_out && (templateRequired ? !!selected?.sendable : !!body.trim());
  useEffect(() => {
    if (templateRequired && !templates.length) void loadTemplates();
  }, [templateRequired, templates.length]);
  const lastProblem = [...history.messages].reverse().find(m => m.direction === "outbound" && deliveryProblem(m.status, m.error_codes));
  return <div className="veronica-console">
    <header className="comm-page-heading"><div><p className="comm-eyebrow">Comunicaciones / Verónica</p><h2>Mensajes, plantillas y PDF</h2><p>Canal independiente · Atención manual · Sin bot de la academia</p></div><button className={secondaryButtonClass} disabled={busy} onClick={() => setRefresh(n => n + 1)}>Actualizar</button></header>
    {error && <p className="comm-error" role="alert">{error}</p>}
    {chat && lastProblem ? <DeliveryAlert message={lastProblem} phone={chat.phone} /> : notice && <p className="vero-note" role="status">{notice}</p>}
    <VeronicaAutomaticPdf token={token} onSaved={() => setRefresh(n => n+1)} />
    <div className="vero-layout"><aside className="comm-panel">
      <h3>Conversaciones</h3><input aria-label="Buscar contacto de Verónica" className={inputClass} placeholder="Buscar teléfono o nombre" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} />
      <button className={primaryButtonClass} disabled={busy} onClick={() => choose(null)}>Nuevo destinatario</button>
      {loading && <p role="status">Cargando…</p>}{!loading && !chats.length && <p>No hay conversaciones en esta búsqueda.</p>}
      <div className="vero-contacts">{chats.map(c => {
        const open = replyWindowOpen(c.window_end, c.can_reply, clock);
        return <button disabled={busy} aria-pressed={chat?.id === c.id} key={c.id} onClick={() => choose(c)}><strong>{c.name}</strong><small>{c.phone} · {formatDateTime(c.last_message_at)}</small><span className={`vero-window-chip ${open ? "open" : "closed"}`}>{open ? `Ventana abierta · ${replyWindowRemaining(c.window_end, clock)}` : "Ventana cerrada"}</span></button>;
      })}</div>
      <nav aria-label="Páginas de conversaciones"><button disabled={!offset || busy} onClick={() => setOffset(n => Math.max(0, n - 30))}>Anterior</button><span>{offset / 30 + 1}</span><button disabled={!more || busy} onClick={() => setOffset(n => n + 30)}>Siguiente</button></nav>
    </aside><section className="comm-panel">
      {chat ? <dl className="vero-contact-info"><div><dt>Nombre</dt><dd>{chat.name}</dd></div><div><dt>Destinatario</dt><dd>{chat.phone}</dd></div></dl> : <label>Destinatario (10 dígitos)<input className={inputClass} type="tel" inputMode="numeric" value={phone} disabled={busy} placeholder="5574879293" onChange={e => setPhone(e.target.value.replace(/[\s()-]/g, ""))} /></label>}
      {!chat && phone && !/^[1-9]\d{9}$/.test(phone) && <small role="status">Escribe 10 dígitos, sin +52.</small>}
      {chat && <><h3>Historial</h3>{history.has_more && <button disabled={busy} onClick={older}>Ver mensajes anteriores</button>}<div className="vero-history" aria-label="Historial de Verónica">{history.messages.map(m => <article key={m.id} className={m.direction === "outbound" ? "outbound" : "inbound"}><small>{m.direction === "outbound" ? "Verónica / equipo" : "Contacto"} · {formatDateTime(m.created_at)}</small><p>{m.body}</p>{m.status && <small>{labels[m.status] || m.status}{m.error_codes.length > 0 && ` · Error ${m.error_codes.join(", ")}`}</small>}</article>)}{!history.messages.length && <p>Sin mensajes registrados. El historial empieza con los eventos guardados por el servicio; no importa automáticamente chats anteriores.</p>}</div></>}
      {templateRequired ? <label>Plantilla<select className={inputClass} disabled={busy} value={templateKey} onChange={e => setTemplateKey(e.target.value)}><option value="">Selecciona una plantilla</option>{templates.filter(t => t.sendable).map(t => <option key={t.name + t.language} value={t.name + ":" + t.language}>{t.name}</option>)}</select></label>
        : <label>Mensaje<textarea autoFocus className={inputClass} rows={4} maxLength={4000} disabled={busy} value={body} onChange={e => setBody(e.target.value)} /></label>}
      {chat?.opted_out && <p role="alert">Este contacto pidió no recibir mensajes. Envío bloqueado.</p>}
      <button className={primaryButtonClass} disabled={!canSend} onClick={() => setConfirming(true)}>{busy ? "Procesando…" : templateRequired ? "Enviar plantilla" : "Enviar mensaje"}</button>
    </section></div>
    {confirming && <div className="vero-confirm-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="vero-confirm-title" className="vero-confirm">
      <h3 id="vero-confirm-title">Confirmar envío desde Verónica</h3>
      <p>Destinatario: <strong>{phone}</strong></p>
      <p>{templateRequired ? `Plantilla: ${selected?.name}` : "Mensaje"}</p>
      <p className="vero-preview">{templateRequired ? selected?.text : body}</p>
      <div className="vero-tabs"><button autoFocus className={secondaryButtonClass} onClick={() => setConfirming(false)}>Cancelar</button><button className={primaryButtonClass} disabled={!canSend} onClick={() => void send()}>Confirmar envío</button></div>
    </div></div>}
  </div>;
}
