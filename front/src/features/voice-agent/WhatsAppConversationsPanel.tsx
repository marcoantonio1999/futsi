import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, MessageCircle, Search, Send, UserRound } from "lucide-react";
import type { WhatsAppConversation, WhatsAppFollowUpAssignee } from "../../types";
import { compareConversations, contactName, conversationAttention, lastMessage, matchesAttention, orderedMessages, messageAuthor, messagePreview, replyWindowOpen, type AttentionFilter } from "./communicationUtils";
import { MessageBody } from "./MessageBody";
import { FollowUpEditor } from "./FollowUpEditor";
import { formatDateTime, inputClass, primaryButtonClass, secondaryButtonClass } from "./model";

const statusLabels: Record<string, string> = { active: "Activa", completed: "Completada", canceled: "Cancelada", failed: "Con error" };
type FollowUpPayload = { follow_up_required: boolean; follow_up_assigned_to: number | null; follow_up_notes: string };
export function WhatsAppConversationsPanel({ conversations, assignees, initialFilter = "all", initialConversationId, onUpdateConversation, onResolveConversation, onSendMessage }: {
  conversations: WhatsAppConversation[]; assignees: WhatsAppFollowUpAssignee[]; initialFilter?: AttentionFilter;
  initialConversationId?: number | null;
  onResolveConversation: (conversation: WhatsAppConversation) => Promise<void>;
  onUpdateConversation: (conversation: WhatsAppConversation, payload: FollowUpPayload) => Promise<void>;
  onSendMessage: (conversation: WhatsAppConversation, body: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AttentionFilter>(initialFilter);
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<number | null>(initialConversationId ?? null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  useEffect(() => { setFilter(initialFilter); }, [initialFilter]);
  useEffect(() => { if (initialConversationId != null) { setSelectedId(initialConversationId); setQuery(""); setFilter("all"); setStatus("all"); } }, [initialConversationId]);
  const pendingCount = conversations.filter(c => conversationAttention(c).key === "needs_reply").length;
  const filtered = useMemo(() => conversations.filter(c => {
    const needle = query.trim().toLocaleLowerCase("es-MX");
    return matchesAttention(c, filter) &&
      (status === "all" || c.status === status) && (!needle || [contactName(c), c.contact_phone, c.site_name, c.follow_up_assigned_to_name, ...c.messages.map(m => m.body)].some(v => v?.toLocaleLowerCase("es-MX").includes(needle)));
  }).sort(compareConversations), [conversations, filter, query, status]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[aria-current="true"]');
    if (list && selected) {
      const offset = selected.getBoundingClientRect().top - list.getBoundingClientRect().top;
      if (offset < 0 || offset + selected.offsetHeight > list.clientHeight) list.scrollTop += offset;
    }
  }, [selectedId]);
  const selected = conversations.find(c => c.id === selectedId);
  return <section className={`comm-inbox ${selected ? "has-selection" : ""}`} aria-label="Bandeja de WhatsApp">
    <div className="comm-inbox-list">
      <div className="comm-inbox-tools"><div className="comm-section-heading"><h3>Bandeja <span className="comm-count">{conversations.length}</span></h3><span className={`comm-badge ${pendingCount ? "red" : "green"}`}>{pendingCount ? `${pendingCount} por responder` : "Sin respuestas pendientes"}</span></div>
        <label className="comm-search"><Search size={17} /><input aria-label="Buscar conversaciones" placeholder="Nombre, teléfono o mensaje" type="search" value={query} onChange={e => setQuery(e.target.value)} /></label>
        <select aria-label="Prioridad de atención" className={inputClass} value={filter} onChange={e => setFilter(e.target.value as AttentionFilter)}>
          {([["all", "Todas las conversaciones"], ["needs_reply", "Nos toca responder"], ["follow_up", "Por revisar / seguimiento"], ["waiting_client", "Esperando al cliente"], ["up_to_date", "Sin pendientes"], ["manual", "En atención manual"], ["unassigned", "Pendientes sin asignar"], ["unknown", "Sin intercambio registrado"]] as Array<[AttentionFilter, string]>).map(([id, label]) => <option key={id} value={id}>{label} · {conversations.filter(c => matchesAttention(c, id)).length}</option>)}
        </select>
        <details className="comm-inbox-filters"><summary>Filtrar por estado del flujo</summary><select aria-label="Estado de conversación" className={inputClass} value={status} onChange={e => setStatus(e.target.value)}><option value="all">Todos los estados</option>{Object.entries(statusLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></details>
        <small className="comm-muted">{filtered.length} de {conversations.length} conversaciones</small>
      </div>
      <div className="comm-contact-list" ref={listRef} aria-label="Contactos">{filtered.map(c => {
        const attention = conversationAttention(c);
        return <button className={`comm-contact attention-${attention.tone} ${selectedId === c.id ? "selected" : ""}`} aria-current={selectedId === c.id ? "true" : undefined} key={c.id} onClick={() => setSelectedId(c.id)}>
          <span className="comm-avatar">{contactName(c).slice(0, 1).toUpperCase()}</span><span className="comm-row-main"><span className="comm-contact-title"><strong>{contactName(c)}</strong><time>{new Date(c.last_message_at ?? c.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</time></span><span>{messagePreview(lastMessage(c))}</span><small>{c.follow_up_assigned_to_name ? `Asignado a ${c.follow_up_assigned_to_name}` : c.site_name || "Sin asignar"}{c.human_takeover_active ? " · Manual" : ""}</small><span className={`comm-badge ${attention.tone}`}>{attention.label}</span></span>
        </button>;
      })}{!filtered.length && <div className="comm-empty"><Search size={24} /><strong>Sin conversaciones con estos filtros</strong><button className="comm-link" onClick={() => { setQuery(""); setFilter("all"); setStatus("all"); }}>Ver todas</button></div>}</div>
    </div>
    {selected ? <ConversationDetail key={selected.id} conversation={selected} assignees={assignees} body={drafts[selected.id] ?? ""} onBody={body => setDrafts(d => ({ ...d, [selected.id]: body }))} onBack={() => setSelectedId(null)} onResolve={() => onResolveConversation(selected)} onSave={payload => onUpdateConversation(selected, payload)} onSend={body => onSendMessage(selected, body)} /> : <div className="comm-chat-placeholder"><MessageCircle size={36} /><h3>{selectedId != null ? "Conversación no disponible" : "Selecciona una conversación"}</h3><p>Lee el historial, asigna seguimiento y responde desde aquí.</p></div>}
  </section>;
}

function ConversationDetail({ conversation: c, assignees, body, onBody, onBack, onSave, onResolve, onSend }: {
  conversation: WhatsAppConversation; assignees: WhatsAppFollowUpAssignee[]; body: string; onBody: (body: string) => void; onBack: () => void;
  onResolve: () => Promise<void>;
  onSave: (payload: FollowUpPayload) => Promise<void>; onSend: (body: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [now, setNow] = useState(Date.now());
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [c.id, c.messages.length]);
  const canReply = replyWindowOpen(c, now);
  const messages = orderedMessages(c);
  const latest = messages.filter(m => m.direction === "inbound" && m.event_type !== "revoked").at(-1);
  const attention = conversationAttention(c);
  async function resolveAttention() {
    if (resolving || sending) return;
    setResolving(true); setResolveError("");
    try { await onResolve(); } catch (err) { setResolveError(err instanceof Error ? err.message : "No se pudo registrar la revisión."); } finally { setResolving(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || sending) return;
    if (!replyWindowOpen(c)) { setNow(Date.now()); setError("La ventana de respuesta acaba de cerrar. Tu borrador se conserva."); return; }
    setSending(true); setError(""); setSent(false);
    try { await onSend(body.trim()); onBody(""); setSent(true); } catch (err) { setError(err instanceof Error ? err.message : "No se pudo enviar. Tu borrador se conserva."); } finally { setSending(false); }
  }
  return <div className="comm-chat">
    <header className="comm-chat-heading"><button className="comm-back" aria-label="Volver a la bandeja" onClick={onBack}><ArrowLeft size={20} /></button><span className="comm-avatar"><UserRound size={19} /></span><div className="comm-row-main"><h3>{contactName(c)}</h3><small>{c.contact_phone} · {c.site_name || "Sede por definir"}</small></div><button className={secondaryButtonClass} aria-expanded={editing} onClick={() => setEditing(!editing)}>Seguimiento</button></header>
    <div className="comm-chat-context">
      <div className={`comm-attention-strip attention-${attention.tone}`}><div className="comm-inline"><span className={`comm-badge ${attention.tone}`}>{attention.label}</span>{c.human_takeover_active && <strong className="comm-handling">Atención manual · Asistente pausado</strong>}</div><p>{attention.detail}</p>{c.follow_up_assigned_to_name && <small>Asignado a {c.follow_up_assigned_to_name}</small>}{attention.key === "needs_reply" && <button className="comm-resolve-button" disabled={resolving || sending} onClick={() => void resolveAttention()}>{resolving ? "Guardando…" : "No requiere respuesta"}</button>}{resolveError && <p role="alert" className="comm-error">{resolveError}</p>}</div>
      {editing && <FollowUpEditor assignees={assignees} conversation={c} onCancel={() => setEditing(false)} onSave={async payload => { await onSave(payload); setEditing(false); }} />}
      <details><summary>Datos del contacto y automatización</summary><dl className="comm-details"><div><dt>Estado del flujo</dt><dd>{statusLabels[c.status]}</dd></div><div><dt>Asistente</dt><dd>{c.human_takeover_active ? "Pausado por atención humana" : c.bot_response_pending ? "Respuesta pendiente" : "Sin pausa registrada"}</dd></div><div><dt>Clasificación del último mensaje</dt><dd>{({ prospect: "Prospecto", current_client: "Cliente actual", ambiguous: "Por confirmar", unclassified: "Sin clasificar" })[latest?.contact_type ?? "unclassified"]} {latest?.classification_confidence != null ? `· Confianza ${latest.classification_confidence}%` : ""}</dd></div><div><dt>Notas de seguimiento</dt><dd>{c.follow_up_notes || "Sin notas"}</dd></div>{c.failure_reason && <div><dt>Error registrado</dt><dd>{c.failure_reason}</dd></div>}{latest?.classification_evidence?.length ? <div><dt>Evidencia de clasificación</dt><dd>{latest.classification_evidence.join(" · ")}</dd></div> : null}</dl></details>
    </div>
    <div className="comm-messages" ref={history} aria-label="Historial de mensajes" tabIndex={0}>
      {messages.map((message, index) => <div key={message.id}>
        {(index === 0 || new Date(message.created_at).toDateString() !== new Date(messages[index - 1].created_at).toDateString()) && <div className="comm-day-divider">{new Date(message.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}</div>}
        <article className={`comm-message ${message.direction === "outbound" ? "outbound" : "inbound"}`}><header><strong>{message.direction === "inbound" ? contactName(c) : messageAuthor(message)}</strong><time title={formatDateTime(message.created_at)}>{new Date(message.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</time></header>{message.event_type === "revoked" ? <i>Mensaje eliminado</i> : <MessageBody body={message.body} />}</article>
      </div>)}
      {!c.messages.length && <div className="comm-empty"><MessageCircle size={28} /><p>Esta conversación aún no tiene mensajes registrados.</p></div>}
    </div>
    <form className="comm-composer" onSubmit={submit}>
      {canReply ? <><label htmlFor={`reply-${c.id}`}>Responder a {contactName(c)}</label><textarea id={`reply-${c.id}`} className={inputClass} rows={2} maxLength={4096} value={body} disabled={sending} onChange={e => { onBody(e.target.value); setSent(false); }} placeholder="Escribe una respuesta…" /><div className="comm-composer-footer"><small>Al enviar, el asistente cede la atención al equipo.</small><button className={primaryButtonClass} disabled={sending || !body.trim()} type="submit"><Send size={16} />{sending ? "Enviando…" : "Enviar"}</button></div></> : <div className="comm-window-closed"><strong>Ventana de respuesta cerrada</strong><p>Para retomar el contacto, utiliza una plantilla aprobada desde WhatsApp Business o espera un nuevo mensaje del contacto.</p>{body && <p>Tu borrador se conserva en esta bandeja.</p>}</div>}
      {error && <p className="comm-error" role="alert">{error}</p>}{sent && <p className="comm-success" role="status">Mensaje enviado.</p>}
    </form>
  </div>;
}
