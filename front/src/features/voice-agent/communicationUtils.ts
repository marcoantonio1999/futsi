import { isSoccerWa } from "../../appBrand.ts";
import type { WhatsAppMessage, WhatsAppConversation, WhatsAppWeeklyStats } from "../../types";

export function contactName(conversation: WhatsAppConversation) {
  return conversation.contact_name?.trim() || conversation.booking_responsible_name?.trim() || conversation.contact_phone || "Contacto sin identificar";
}
export function messageAuthor(message: WhatsAppMessage) {
  if (message.direction === "inbound") return "Contacto";
  if (message.response_source === "bot") return "Asistente";
  if (message.response_source === "human_dashboard") return message.sent_by_name || `Equipo · ${isSoccerWa ? "Soccer WA" : "Futsi"}`;
  if (message.response_source === "human_whatsapp") return message.sent_by_name || "Equipo · WhatsApp";
  return "Salida · autor no identificado";
}
const mediaNames: Record<string, string> = { image: "Imagen", audio: "Audio", video: "Video", document: "Documento", sticker: "Sticker", location: "Ubicación" };
export function mediaLabel(body: string) {
  const match = body.trim().match(/^\[(image|audio|video|document|sticker|location)\]$/i);
  return match ? mediaNames[match[1].toLowerCase()] : null;
}
export function messagePreview(message?: WhatsAppMessage) {
  if (!message) return "Sin mensajes";
  if (message.event_type === "revoked") return "Mensaje eliminado";
  return mediaLabel(message.body) || message.body.replace(/[*_~]/g, "").replace(/\s+/g, " ").trim() || "Mensaje sin texto";
}
export function replyWindowOpen(conversation: WhatsAppConversation, now = Date.now()) {
  return conversation.free_form_window_open && (!conversation.free_form_window_expires_at || new Date(conversation.free_form_window_expires_at).getTime() > now);
}
export function waitingByConversation(value: WhatsAppWeeklyStats | null) {
  const waits = new Map<number, WhatsAppWeeklyStats["longest_waits"][number]>();
  for (const item of value?.longest_waits ?? []) {
    if (item.responded_at) continue;
    const previous = waits.get(item.conversation_id);
    if (!previous || item.first_inbound_at < previous.first_inbound_at) waits.set(item.conversation_id, item);
  }
  return waits;
}
export function durationLabel(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "Sin datos";
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return Math.floor(Math.max(0, seconds)) + " s";
  if (minutes < 60) return minutes + " min";
  if (seconds > 86400) {
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    return `${days} ${days === 1 ? "día" : "días"}${hours ? ` ${hours} h` : ""}`;
  }
  return Math.floor(minutes / 60) + " h " + minutes % 60 + " min";
}
export function nameNeedsReview(name: string) {
  const normalized = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  return !normalized || ["costos", "costo", "precio", "precios", "horarios", "horario", "informacion", "hola", "prueba", "si", "no"].includes(normalized);
}
export function localDateKey(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}
export function mondayKey(value = new Date()) {
  const date = new Date(value);
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  return localDateKey(date);
}
export function shiftWeek(key: string, weeks: number) {
  return shiftDays(key, weeks * 7);
}
export function shiftDays(key: string, days: number) {
  const date = new Date(key + "T12:00:00");
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}


export type AttentionKey = "needs_reply" | "follow_up" | "waiting_client" | "up_to_date" | "unknown";
export type AttentionFilter = "all" | AttentionKey | "manual" | "unassigned";
export type ConversationAttention = {
  key: AttentionKey;
  tone: "red" | "amber" | "blue" | "green" | "neutral";
  label: string;
  detail: string;
  since: string | null;
  turn: "team" | "client" | "assistant" | "none";
};

export function orderedMessages(conversation: WhatsAppConversation) {
  return [...conversation.messages].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
}
export function lastMessage(conversation: WhatsAppConversation) {
  return orderedMessages(conversation).filter(m => m.event_type !== "revoked" && m.body.trim().toLowerCase() !== "[reaction]").at(-1);
}

// Same whole-phrase policy as core.whatsapp.attention in both servers.
const closingPhrase = new RegExp("^(?:" + [
  "(?:muchas? |muchisimas? |mil |muchisisimas? )?gracia+s+(?: (?:por (?:todo|la (?:informacion|info|ayuda|atencion|respuesta)|el (?:apoyo|dato)|confirmar|avisar)|a ti|a usted|a ustedes))?",
  "grax|grx|thanks|thank you|thx|te agradezco|le agradezco|se agradece|muy amable",
  "a ustedes|a usted|a ti|igualmente|de nada|por nada|con gusto",
  "ok(?:ay)?|perfecto|listo|entendido|entiendo|excelente|ecelente|super|sale|vale|va|bueno|de acuerdo|esta bien|esta perfecto|muy bien|claro",
  "adio+s+|chao|chau|bye(?: bye)?|hasta luego|hasta pronto|hasta manana|nos vemos|cuidate|cuidese",
  "saludos(?: cordiales)?|(?:que (?:tengas|tenga|tengan|pases|pase|pasen) (?:un )?)?(?:buen dia|buena tarde|buena noche|bonito dia|lindo dia|excelente dia|buen fin de semana)",
].join("|") + ")");

function normalizedAcknowledgement(body: string) {
  return body.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f]/gu, " ")
    .replace(/[^\p{L}\p{N}_]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isClosingAcknowledgement(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return false;
  if (/^\[(?:sticker|reaction|revoke)\]$/i.test(trimmed)) return true;
  if (/[?¿]/.test(trimmed)) return false;
  if (!/[\p{L}\p{N}]/u.test(trimmed)) return true;
  let normalized = normalizedAcknowledgement(trimmed);
  if (["buen dia", "buena tarde", "buena noche", "bonito dia", "lindo dia", "excelente dia"].includes(normalized)) return false;
  const prefix = /^(?:(?:hola+|buenas (?:tardes|noches)|buenos dias|si+)\s+)+/.exec(normalized);
  if (prefix) {
    normalized = normalized.slice(prefix[0].length);
    if (["buen dia", "buena tarde", "buena noche", "bonito dia", "lindo dia", "excelente dia"].includes(normalized)) return false;
  }
  while (normalized) {
    const match = closingPhrase.exec(normalized);
    if (!match || (match[0].length < normalized.length && normalized[match[0].length] !== " ")) return false;
    normalized = normalized.slice(match[0].length).trim();
    if (normalized.startsWith("y ")) normalized = normalized.slice(2);
  }
  return true;
}

// No model call: identify ONLY acknowledgement messages, not the real request
// before them. All trend views use the same contextual policy as the inbox.
export function acknowledgementIds(c: WhatsAppConversation): Set<number> {
  const ids = new Set(c.attention_not_required_ids ?? []);
  let seenOutbound = false;
  for (const m of orderedMessages(c)) {
    if (m.event_type === "revoked") continue;
    if (m.direction === "outbound") seenOutbound = true;
    else if (seenOutbound && isClosingAcknowledgement(m.body ?? "")) ids.add(m.id);
  }
  return ids;
}

// Operational state comes from the current exchange, never from historical
// first-human-response events or the automation-paused flag alone.
export function conversationAttention(c: WhatsAppConversation): ConversationAttention {
  const nonRevokedMessages = orderedMessages(c).filter(m => m.event_type !== "revoked");
  const latestEvent = nonRevokedMessages.at(-1);
  const messages = nonRevokedMessages.filter(m => m.body.trim().toLowerCase() !== "[reaction]");
  const last = messages.at(-1);
  const inbound = messages.filter(m => m.direction === "inbound").at(-1);
  const human = messages.filter(m => m.direction === "outbound" && ["human_dashboard", "human_whatsapp"].includes(m.response_source)).at(-1);
  const humanAt = Math.max(Date.parse(c.human_last_reply_at ?? "") || 0, Date.parse(human?.created_at ?? "") || 0);
  const inboundAt = Date.parse(inbound?.created_at ?? "") || 0;
  const lastAt = Date.parse(last?.created_at ?? "") || 0;
  // Coexistence replies can arrive before their message echo is synchronized.
  const humanRepliedLast = humanAt > lastAt || (humanAt > 0 && humanAt === lastAt && last?.direction === "outbound" && ["human_dashboard", "human_whatsapp"].includes(last.response_source));
  const humanRequested = !!inbound && ["human_only", "automation_paused"].includes(inbound.routing_decision);
  const needsHuman = !!inbound && !humanRepliedLast && humanAt <= inboundAt && (c.human_takeover_active || humanRequested);
  const turn = humanRepliedLast ? "client" : last?.direction === "inbound" ? "team" : last ? "client" : "none";
  const closingAcknowledgement = latestEvent?.direction === "inbound"
    && isClosingAcknowledgement(latestEvent.body)
    && nonRevokedMessages.some(message => message.direction === "outbound" && message.id !== latestEvent.id);
  const nonTextAcknowledgement = latestEvent?.direction === "inbound"
    && (/^\[(?:sticker|reaction)\]$/i.test(latestEvent.body.trim()) || (latestEvent.body.trim() !== "" && normalizedAcknowledgement(latestEvent.body) === ""));
  const previousMeaningful = nonRevokedMessages.filter(message => message.id !== latestEvent?.id
    && !isClosingAcknowledgement(message.body)).at(-1);

  const reviewed = c.attention_resolution?.message_id === last?.id && !!last
    && Date.parse(c.attention_resolution?.resolved_at ?? "") >= Math.max(lastAt, humanAt);
  if (reviewed) return c.follow_up_required
    ? { key: "follow_up", tone: "amber", label: "Seguimiento marcado", since: c.follow_up_updated_at, turn: "none", detail: "El equipo indicó que no hace falta responder. El seguimiento sigue marcado." }
    : { key: "up_to_date", tone: "green", label: "Atendido", since: null, turn: "none", detail: "El equipo revisó este intercambio e indicó que no requiere respuesta." };
  // Saved weekly evidence only. A new or edited message invalidates it on the
  // server; rendering never invokes AI and never manufactures a human reply.
  const analysis = c.attention_analysis;
  if (analysis?.last_message_id === last?.id && analysis?.current_state === 'closed') return c.follow_up_required
    ? { key: "follow_up", tone: "amber", label: "Seguimiento marcado", since: c.follow_up_updated_at, turn: "none", detail: "El análisis semanal identifica un cierre. El seguimiento del equipo se conserva." }
    : { key: "up_to_date", tone: "green", label: "Conversación cerrada", since: null, turn: "none", detail: "El análisis semanal del intercambio identifica un cierre sin solicitud pendiente. No implica una respuesta humana no registrada." };
  if (analysis?.last_message_id === last?.id && analysis?.current_state === 'pending') return {
    key: "needs_reply", tone: "red", label: "Nos toca responder", since: inbound?.created_at ?? null, turn: "team",
    detail: "El análisis semanal identifica una solicitud pendiente; una cortesía no la da por resuelta.",
  };
  if (analysis?.last_message_id === last?.id && analysis?.current_state === 'uncertain') return {
    key: "follow_up", tone: "amber", label: "Por revisar", since: inbound?.created_at ?? null, turn,
    detail: "El análisis semanal no pudo confirmar el cierre. La solicitud no se descarta ni se cuenta como respuesta humana.",
  };
  if (nonTextAcknowledgement && previousMeaningful?.direction === "outbound" && !c.follow_up_required) return {
    key: "waiting_client", tone: "blue", label: "Esperando al cliente", since: previousMeaningful.created_at, turn: "client",
    detail: "El equipo respondió. El emoji, sticker o reacción del cliente no genera una nueva solicitud de respuesta.",
  };
  if (closingAcknowledgement && previousMeaningful?.direction === "outbound") return c.follow_up_required
    ? { key: "follow_up", tone: "amber", label: "Seguimiento marcado", since: c.follow_up_updated_at, turn: "none", detail: "El contacto cerró el intercambio con un agradecimiento o una reacción. El seguimiento marcado por el equipo se conserva." }
    : { key: "up_to_date", tone: "green", label: "Conversación cerrada", since: null, turn: "none", detail: "El contacto respondió sólo con un agradecimiento, emoji, sticker o reacción después de nuestro mensaje; no requiere otra respuesta." };
  if (closingAcknowledgement && previousMeaningful?.direction === "inbound") return {
    key: "needs_reply", tone: "red", label: "Nos toca responder", since: previousMeaningful.created_at, turn: "team",
    detail: "El agradecimiento o reacción final no borra la solicitud anterior que sigue sin una respuesta de fondo.",
  };
  if (needsHuman || (turn === "team" && !c.bot_response_pending)) return {
    key: "needs_reply", tone: "red", label: "Nos toca responder", since: inbound?.created_at ?? null, turn: "team",
    detail: c.human_takeover_active ? "El cliente escribió después de la última respuesta humana. El asistente está pausado." : humanRequested ? "El cliente está en atención humana; una respuesta automática no cierra esa solicitud." : "El último mensaje es del cliente y no tiene una respuesta posterior registrada.",
  };
  if (c.status === "failed") return { key: "follow_up", tone: "amber", label: "Revisar error", since: null, turn, detail: c.failure_reason || "El flujo registró un error. Revisa el chat." };
  if (turn === "team" && c.bot_response_pending) return { key: "follow_up", tone: "amber", label: "Asistente por responder", since: inbound?.created_at ?? null, turn: "assistant", detail: "Hay una respuesta automática pendiente; el cliente fue el último en escribir." };
  if (c.follow_up_required) return {
    key: "follow_up", tone: "amber", label: "Seguimiento marcado", since: c.follow_up_updated_at, turn,
    detail: turn === "client" ? "El último mensaje fue nuestro. Hay un seguimiento marcado, no una respuesta pendiente del equipo." : "Hay un seguimiento marcado por el equipo.",
  };
  if (humanRepliedLast) return { key: "waiting_client", tone: "blue", label: "Esperando al cliente", since: new Date(humanAt).toISOString(), turn: "client", detail: "El equipo respondió y no hay un mensaje posterior del cliente registrado." };
  if (!last) return { key: "unknown", tone: "neutral", label: "Sin intercambio registrado", since: null, turn: "none", detail: "No hay mensajes suficientes para saber a quién le toca responder." };
  if (["completed", "canceled"].includes(c.status) && last.direction === "outbound" && !c.human_takeover_active) return {
    key: "up_to_date", tone: "green", label: c.status === "completed" ? "Flujo completado" : "Flujo cancelado", since: null, turn: "none",
    detail: "El flujo terminó, sin nuevos mensajes del cliente ni seguimiento marcado.",
  };
  return { key: "waiting_client", tone: "blue", label: "Esperando al cliente", since: last.created_at, turn: "client", detail: "El último mensaje fue nuestro. El silencio del cliente no confirma desinterés." };
}

export function matchesAttention(c: WhatsAppConversation, filter: AttentionFilter) {
  if (filter === "all") return true;
  if (filter === "manual") return c.human_takeover_active;
  if (filter === "unassigned") return ["needs_reply", "follow_up"].includes(conversationAttention(c).key) && !c.follow_up_assigned_to;
  return conversationAttention(c).key === filter;
}
export function compareConversations(a: WhatsAppConversation, b: WhatsAppConversation) {
  const rank: Record<AttentionKey, number> = { needs_reply: 0, follow_up: 1, waiting_client: 2, up_to_date: 3, unknown: 4 };
  const left = conversationAttention(a), right = conversationAttention(b);
  const difference = rank[left.key] - rank[right.key];
  if (difference) return difference;
  if (left.key === "needs_reply") return Date.parse(left.since ?? a.created_at) - Date.parse(right.since ?? b.created_at);
  return compareConversationsByRecency(a, b);
}

export function compareConversationsByRecency(a: WhatsAppConversation, b: WhatsAppConversation) {
  const difference = Date.parse(b.last_message_at ?? b.created_at) - Date.parse(a.last_message_at ?? a.created_at);
  return difference || b.id - a.id;
}
