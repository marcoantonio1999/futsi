import type { WhatsAppMessage, WhatsAppConversation, WhatsAppWeeklyStats } from "../../types";

export function contactName(conversation: WhatsAppConversation) {
  return conversation.contact_name?.trim() || conversation.booking_responsible_name?.trim() || conversation.contact_phone || "Contacto sin identificar";
}
export function messageAuthor(message: WhatsAppMessage) {
  if (message.direction === "inbound") return "Contacto";
  if (message.response_source === "bot") return "Asistente";
  if (message.response_source === "human_dashboard") return message.sent_by_name || "Equipo · Futsi";
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
  const date = new Date(key + "T12:00:00");
  date.setDate(date.getDate() + weeks * 7);
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

const acknowledgementOnly = new Set([
  "ok", "okay", "perfecto", "listo", "entendido", "excelente", "super", "sale", "va",
  "de acuerdo", "esta bien", "muy bien", "claro",
]);
const acknowledgementRequest = /\b(?:pero|aunque|duda|pregunta|quisiera|quiero|necesito|puede|puedes|podria|podrias|mandar|enviar|decir|confirmar|informar|agendar|inscribir|registrar|cambiar|cancelar|cuando|donde|como|cual|cuanto|horario|precio|costo)\b/;

function normalizedAcknowledgement(body: string) {
  return body.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u200d\ufe0f]/gu, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isClosingAcknowledgement(body: string) {
  const trimmed = body.trim();
  if (!trimmed) return false;
  if (/^\[(?:sticker|reaction)\]$/i.test(trimmed)) return true;
  const normalized = normalizedAcknowledgement(trimmed);
  if (!normalized) return true;
  if (acknowledgementOnly.has(normalized)) return true;
  if (!normalized.includes("gracias") || trimmed.includes("?") || acknowledgementRequest.test(normalized)) return false;
  return normalized.split(" ").length <= 12;
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

  const reviewed = c.attention_resolution?.message_id === last?.id && !!last
    && Date.parse(c.attention_resolution?.resolved_at ?? "") >= Math.max(lastAt, humanAt);
  if (reviewed) return c.follow_up_required
    ? { key: "follow_up", tone: "amber", label: "Seguimiento marcado", since: c.follow_up_updated_at, turn: "none", detail: "El equipo indicó que no hace falta responder. El seguimiento sigue marcado." }
    : { key: "up_to_date", tone: "green", label: "Atendido", since: null, turn: "none", detail: "El equipo revisó este intercambio e indicó que no requiere respuesta." };
  if (closingAcknowledgement) return c.follow_up_required
    ? { key: "follow_up", tone: "amber", label: "Seguimiento marcado", since: c.follow_up_updated_at, turn: "none", detail: "El contacto cerró el intercambio con un agradecimiento o una reacción. El seguimiento marcado por el equipo se conserva." }
    : { key: "up_to_date", tone: "green", label: "Conversación cerrada", since: null, turn: "none", detail: "El contacto respondió sólo con un agradecimiento, emoji, sticker o reacción después de nuestro mensaje; no requiere otra respuesta." };
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
  return Date.parse(b.last_message_at ?? b.created_at) - Date.parse(a.last_message_at ?? a.created_at);
}
