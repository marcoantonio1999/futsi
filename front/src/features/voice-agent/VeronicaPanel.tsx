import { useEffect, useRef, useState } from "react";
import { apiFormRequest, apiRequest } from "../../api";
import { formatDateTime, inputClass, primaryButtonClass, secondaryButtonClass } from "./model";
import "./veronica.css";
import { deliveryProblem } from "./veronicaDelivery";
import { VeronicaAutomaticPdf } from './VeronicaAutomaticPdf';

type Chat = { id: number; phone: string; name: string; opted_out: boolean; last_message_at: string | null };
type Message = { id: number; body: string; direction: string; created_at: string; status: string; error_codes: number[] };
type History = { messages: Message[]; can_reply: boolean; window_end: string | null; has_more: boolean };
type Template = { name: string; language: string; text: string; status: string; sendable: boolean; reason: string };
type SendResult = { conversation_id: number; status: string; detail: string; message_id: string };
const labels: Record<string, string> = { accepted: "Aceptado por la API · aún no confirma entrega", sent: "Enviado", delivered: "Entregado", read: "Leído", failed: "Fallido", sending: "Procesando · no repetir", uncertain: "Resultado incierto · no repetir" };
const emptyHistory: History = { messages: [], can_reply: false, window_end: null, has_more: false };

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
  const [tab, setTab] = useState<"text" | "template" | "document">("template");
  const [chats, setChats] = useState<Chat[]>([]), [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0), [more, setMore] = useState(false);
  const [chat, setChat] = useState<Chat | null>(null), [phone, setPhone] = useState("");
  const [contactName, setContactName] = useState("");
  const [history, setHistory] = useState<History>(emptyHistory);
  const [templates, setTemplates] = useState<Template[]>([]), [templateKey, setTemplateKey] = useState("");
  const [cursor, setCursor] = useState("");
  const [body, setBody] = useState(""), [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const lock = useRef(false);
  const selected = templates.find(t => t.name + ":" + t.language === templateKey);

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
    if (!chat) { setHistory(emptyHistory); return; }
    const controller = new AbortController();
    const load = () => apiRequest<History>(`/veronica/history/?conversation_id=${chat.id}`, token, { signal: controller.signal })
      .then(setHistory).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    void load();
    const interval = window.setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [token, chat, refresh]);

  async function loadTemplates(after = "") {
    setBusy(true); setError("");
    try {
      const r = await apiRequest<{ templates: Template[]; next_cursor: string }>(`/veronica/templates/?after=${encodeURIComponent(after)}`, token);
      setTemplates(old => after ? [...old, ...r.templates] : r.templates); setCursor(r.next_cursor);
      if (!after) {
        const initial = r.templates.find(t => t.name === "reclutamiento_primer_mensaje" && t.language === "es") || r.templates.find(t => t.sendable);
        setTemplateKey(initial ? initial.name + ":" + initial.language : "");
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function older() {
    if (!chat || !history.messages.length) return;
    setBusy(true);
    try { const before = Math.min(...history.messages.filter(m => m.id > 0).map(m => m.id)); const r = await apiRequest<History>(`/veronica/history/?conversation_id=${chat.id}&before=${before}`, token); setHistory(h => ({ ...r, messages: [...r.messages, ...h.messages] })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function choose(c: Chat | null) {
    setContactName(c && c.name !== c.phone ? c.name : "");
    const savedPhone = c?.phone.replace(/^\+/, '') ?? '';
    const localPhone = /^52\d{10}$/.test(savedPhone) ? savedPhone.slice(2) : /^521\d{10}$/.test(savedPhone) ? savedPhone.slice(3) : savedPhone;
    setChat(c); setPhone(localPhone); setHistory(emptyHistory); setBody(""); setFile(null); setNotice(""); setError(""); request.current = null;
  }
  async function send() {
    if (lock.current) return;
    if (!chat && !/^[1-9]\d{9}$/.test(phone)) { setError('Escribe los 10 dígitos del número de México, sin +52.'); return; }
    const destination = chat?.phone ?? `+52${phone}`;
    setConfirming(false);
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const fingerprint = JSON.stringify([phone, tab, body, templateKey, file?.name, file?.size, file?.lastModified]);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    try {
      let mediaToken = "";
      if (tab === "document") {
        if (!file || file.size > 5 * 1024 * 1024 || !file.name.toLowerCase().endsWith(".pdf")) throw new Error("Selecciona un PDF de máximo 5 MB.");
        const form = new FormData(); form.append("file", file);
        const uploaded = await apiFormRequest<{ media_token: string }>("/veronica/upload/", token, form);
        mediaToken = uploaded.media_token;
      }
      const r = await apiRequest<SendResult>("/veronica/send/", token, { method: "POST", body: JSON.stringify({
        phone: destination, kind: tab, body, template_name: selected?.name, language: selected?.language,
        media_token: mediaToken, request_id: request.current.id,
      }) });
      setNotice(labels[r.status] || r.status);
      if (r.status === "accepted") { setBody(""); setFile(null); request.current = null; }
      if (r.status === "failed") setError(r.detail || "La API rechazó el envío. Revisa la conexión antes de intentar otro envío.");
      if (!chat) setChat({ id: r.conversation_id, phone: destination, name: phone, last_message_at: null, opted_out: false });
      setRefresh(n => n + 1);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); lock.current = false; }
  }
  const canSend = !busy && (chat ? /^\+?[1-9]\d{7,14}$/.test(chat.phone) : /^[1-9]\d{9}$/.test(phone)) && !chat?.opted_out && (tab === "template" ? !!selected?.sendable : history.can_reply && (tab === "text" ? !!body.trim() : !!file));
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
      <div className="vero-contacts">{chats.map(c => <button disabled={busy} aria-pressed={chat?.id === c.id} key={c.id} onClick={() => choose(c)}><strong>{c.name}</strong><small>{c.phone} · {formatDateTime(c.last_message_at)}</small></button>)}</div>
      <nav aria-label="Páginas de conversaciones"><button disabled={!offset || busy} onClick={() => setOffset(n => Math.max(0, n - 30))}>Anterior</button><span>{offset / 30 + 1}</span><button disabled={!more || busy} onClick={() => setOffset(n => n + 30)}>Siguiente</button></nav>
    </aside><section className="comm-panel">
      <label>Destinatario (10 dígitos)<input className={inputClass} type="tel" inputMode="numeric" value={phone} readOnly={!!chat} disabled={busy} placeholder="5574879293" onChange={e => setPhone(e.target.value.replace(/[\s()-]/g, ""))} /></label>
      {!chat && phone && !/^[1-9]\d{9}$/.test(phone) && <small role="status">Escribe 10 dígitos, sin +52.</small>}
      {chat && <div><label>Nombre del contacto<input className={inputClass} value={contactName} maxLength={120} disabled={busy} placeholder="Escribe su nombre si aún no aparece" onChange={e => setContactName(e.target.value)} /></label><button className={secondaryButtonClass} disabled={busy || !contactName.trim() || contactName.trim() === chat.name} onClick={async () => {
        setBusy(true); setError('');
        try {
          const saved = await apiRequest<{ name: string }>('/veronica/contact/', token, { method: 'POST', body: JSON.stringify({ conversation_id: chat.id, name: contactName }) });
          setChat({ ...chat, name: saved.name }); setContactName(saved.name); setRefresh(n => n+1);
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>Guardar nombre</button><small>El nombre guardado aquí tiene prioridad sobre el perfil de WhatsApp y los archivos importados.</small></div>}
      {chat && <><h3>Historial</h3>{history.has_more && <button disabled={busy} onClick={older}>Ver mensajes anteriores</button>}<div className="vero-history" aria-label="Historial de Verónica">{history.messages.map(m => <article key={m.id} className={m.direction === "outbound" ? "outbound" : "inbound"}><small>{m.direction === "outbound" ? "Verónica / equipo" : "Contacto"} · {formatDateTime(m.created_at)}</small><p>{m.body}</p>{m.status && <small>{labels[m.status] || m.status}{m.error_codes.length > 0 && ` · Error ${m.error_codes.join(", ")}`}</small>}</article>)}{!history.messages.length && <p>Sin mensajes registrados. El historial empieza con los eventos guardados por el servicio; no importa automáticamente chats anteriores.</p>}</div></>}
      <div className="vero-tabs" role="tablist" aria-label="Tipo de envío">{([['template', 'Plantillas'], ['text', 'Mensaje'], ['document', 'PDF']] as const).map(([key, label]) => <button role="tab" aria-selected={tab === key} disabled={busy} key={key} onClick={() => { setTab(key); setBody(""); }}>{label}</button>)}</div>
      {tab === "template" ? <div><button disabled={busy} className={secondaryButtonClass} onClick={() => void loadTemplates()}>Consultar plantillas de Verónica</button>
        <label>Plantilla e idioma<select className={inputClass} disabled={busy} value={templateKey} onChange={e => setTemplateKey(e.target.value)}><option value="">Selecciona una plantilla</option>{templates.map(t => <option key={t.name + t.language} value={t.name + ":" + t.language}>{t.name} · {t.language} · {t.status}</option>)}</select></label>
        {cursor && <button disabled={busy} onClick={() => void loadTemplates(cursor)}>Cargar más plantillas</button>}
        {selected && <div className="vero-preview"><strong>{selected.status}</strong><p>{selected.text}</p>{selected.reason && <p>{selected.reason}</p>}</div>}
        <p>La plantilla inicial es reclutamiento_primer_mensaje · es · sin variables. Se verifica su aprobación al enviarla.</p>
      </div> : <><p>{history.can_reply ? `Puedes responder hasta ${formatDateTime(history.window_end)}.` : "Para enviar texto o PDF, el contacto debe haberte escrito durante las últimas 24 horas. Primero envía una plantilla y espera su respuesta."}</p>
        {tab === "document" && <label>PDF (máximo 5 MB)<input type="file" accept=".pdf,application/pdf" disabled={busy || !history.can_reply} onChange={e => setFile(e.target.files?.[0] ?? null)} />{file && <small>Seleccionado: {file.name}</small>}<small>Se sube a la conexión de Verónica al confirmar el envío; no se publica un enlace abierto.</small></label>}
        <label>{tab === "document" ? "Descripción del PDF (opcional)" : "Mensaje"}<textarea className={inputClass} rows={4} maxLength={tab === "document" ? 1024 : 4000} disabled={busy || !history.can_reply} value={body} onChange={e => setBody(e.target.value)} /></label></>}
      {chat?.opted_out && <p role="alert">Este contacto pidió no recibir mensajes. Envío bloqueado.</p>}
      <button className={primaryButtonClass} disabled={!canSend} onClick={() => setConfirming(true)}>{busy ? "Procesando…" : "Enviar desde Verónica"}</button>
      <p className="vero-footnote">Envío individual con confirmación. La respuesta a la plantilla de reclutamiento activa el PDF configurado una sola vez; no activa el bot de la academia.</p>
    </section></div>
    {confirming && <div className="vero-confirm-backdrop"><div role="dialog" aria-modal="true" aria-labelledby="vero-confirm-title" className="vero-confirm">
      <h3 id="vero-confirm-title">Confirmar envío desde Verónica</h3>
      <p>Destinatario: <strong>{phone}</strong></p>
      <p>{tab === "template" ? `Plantilla: ${selected?.name} · ${selected?.language}` : tab === "document" ? `PDF: ${file?.name}` : "Mensaje de texto"}</p>
      <p className="vero-preview">{tab === "template" ? selected?.text : body || "Sin descripción"}</p>
      {tab === "template" && <p>El envío real de plantillas puede tener costo en Meta.</p>}
      <div className="vero-tabs"><button autoFocus className={secondaryButtonClass} onClick={() => setConfirming(false)}>Cancelar</button><button className={primaryButtonClass} disabled={!canSend} onClick={() => void send()}>Confirmar envío</button></div>
    </div></div>}
  </div>;
}
