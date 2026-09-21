import test from "node:test";
import assert from "node:assert/strict";
import { compareConversations, conversationAttention, matchesAttention, contactName, durationLabel, isClosingAcknowledgement, mediaLabel, messageAuthor, messagePreview, mondayKey, nameNeedsReview, replyWindowOpen, shiftWeek, waitingByConversation } from "../src/features/voice-agent/communicationUtils.ts";
import { templateStatusMeta } from "../src/features/voice-agent/veronicaTemplateStatus.ts";

test("Veronica template states are displayed in Spanish with a safe fallback", () => {
  assert.deepEqual(templateStatusMeta("APPROVED"), { label: "Aprobada", tone: "approved" });
  assert.deepEqual(templateStatusMeta("pending"), { label: "Pendiente", tone: "pending" });
  assert.deepEqual(templateStatusMeta("REJECTED"), { label: "Rechazada", tone: "rejected" });
  assert.deepEqual(templateStatusMeta("custom_review"), { label: "CUSTOM REVIEW", tone: "inactive" });
});

test("closed and expired windows never enable a reply", () => {
  const now = Date.parse("2026-09-05T12:00:00Z");
  assert.equal(replyWindowOpen({ free_form_window_open: true, free_form_window_expires_at: "2026-09-05T12:00:00Z" }, now), false);
  assert.equal(replyWindowOpen({ free_form_window_open: true, free_form_window_expires_at: "2026-09-05T12:00:01Z" }, now), true);
  assert.equal(replyWindowOpen({ free_form_window_open: false, free_form_window_expires_at: "2026-09-06T12:00:00Z" }, now), false);
  assert.equal(replyWindowOpen({ free_form_window_open: true, free_form_window_expires_at: "invalid" }, now), false);
});
test("separate automated, dashboard and business authors", () => {
  assert.equal(messageAuthor({ direction: "outbound", response_source: "bot" }), "Asistente");
  assert.equal(messageAuthor({ direction: "outbound", response_source: "human_dashboard", sent_by_name: "Ana" }), "Ana");
  assert.equal(messageAuthor({ direction: "outbound", response_source: "human_whatsapp" }), "Equipo · WhatsApp");
  assert.equal(messageAuthor({ direction: "outbound", response_source: "unknown" }), "Salida · autor no identificado");
});
test("media markers have explicit labels without losing ordinary text", () => {
  assert.equal(mediaLabel("[image]"), "Imagen");
  assert.equal(mediaLabel(" [AUDIO] "), "Audio");
  assert.equal(mediaLabel("Texto [image] con contexto"), null);
  assert.equal(messagePreview({ body: "*Hola*\nAna", event_type: "message" }), "Hola Ana");
  assert.equal(messagePreview({ body: "private", event_type: "revoked" }), "Mensaje eliminado");
});
test("deduplicate pending contacts and keep the oldest unanswered request", () => {
  const value = { longest_waits: [
    { id: 1, conversation_id: 7, first_inbound_at: "2026-09-05T12:00:00Z", responded_at: null },
    { id: 2, conversation_id: 7, first_inbound_at: "2026-09-04T12:00:00Z", responded_at: null },
    { id: 3, conversation_id: 8, first_inbound_at: "2026-09-03T12:00:00Z", responded_at: "2026-09-03T12:01:00Z" },
  ] };
  const waits = waitingByConversation(value);
  assert.equal(waits.size, 1);
  assert.equal(waits.get(7).id, 2);
  assert.equal(waitingByConversation(null).size, 0);
});
test("missing averages are not shown as zero and durations do not overflow minutes", () => {
  assert.equal(durationLabel(null), "Sin datos");
  assert.equal(durationLabel(0), "0 s");
  assert.equal(durationLabel(7199), "1 h 59 min");
  assert.equal(durationLabel(7200), "2 h 0 min");
});
test("week navigation crosses year boundaries without UTC date shifts", () => {
  assert.equal(mondayKey(new Date(2026, 8, 6, 12)), "2026-08-31");
  assert.equal(shiftWeek("2026-01-05", -1), "2025-12-29");
  assert.equal(shiftWeek("2025-12-29", 1), "2026-01-05");
});
test("suspicious names are flagged without classifying legitimate names as invalid", () => {
  assert.equal(nameNeedsReview(" Costos "), true);
  assert.equal(nameNeedsReview("Información"), true);
  assert.equal(nameNeedsReview("Iñaki Cortés"), false);
  assert.equal(nameNeedsReview("Emiliano Díaz"), false);
  assert.equal(contactName({ contact_name: " ", booking_responsible_name: "Ana", contact_phone: "+52" }), "Ana");
});

const msg = (id, direction, source, hour, extra = {}) => ({ id, direction, response_source: source, created_at: `2026-09-05T${hour}:00:00Z`, event_type: "message", body: "Mensaje", routing_decision: "unclassified", ...extra });
const chat = (messages, extra = {}) => ({ id: 1, messages, status: "active", human_takeover_active: false, human_last_reply_at: null, follow_up_required: false, follow_up_assigned_to: null, follow_up_updated_at: null, bot_response_pending: false, created_at: "2026-09-05T09:00:00Z", last_message_at: messages.at(-1)?.created_at ?? null, ...extra });

test("manual takeover does not mean that the team owes a reply", () => {
  const c = chat([msg(1, "inbound", "unknown", "10"), msg(2, "outbound", "human_whatsapp", "11", { sent_by_name: "Manuel" })], { human_takeover_active: true });
  assert.equal(conversationAttention(c).key, "waiting_client");
  assert.equal(conversationAttention(c).turn, "client");
  assert.equal(matchesAttention(c, "needs_reply"), false);
  assert.equal(matchesAttention(c, "manual"), true);
});
test("a customer returning after the human reply requires team attention even if the bot flow was completed", () => {
  const c = chat([msg(1, "outbound", "human_dashboard", "10"), msg(2, "inbound", "unknown", "11")], { human_takeover_active: true, status: "completed" });
  assert.equal(conversationAttention(c).key, "needs_reply");
  assert.equal(conversationAttention(c).since, "2026-09-05T11:00:00Z");
});
test("a bot acknowledgement does not count as a requested human response", () => {
  const c = chat([msg(1, "inbound", "unknown", "10", { routing_decision: "human_only" }), msg(2, "outbound", "bot", "11")]);
  assert.equal(conversationAttention(c).key, "needs_reply");
});
test("recorded human response prevents false pending state before the provider echo arrives", () => {
  const c = chat([msg(1, "inbound", "unknown", "10")], { human_takeover_active: true, human_last_reply_at: "2026-09-05T11:00:00Z" });
  assert.equal(conversationAttention(c).key, "waiting_client");
});
test("followup after our message is a reminder, not a missing team response", () => {
  const c = chat([msg(1, "outbound", "human_dashboard", "11")], { follow_up_required: true });
  assert.equal(conversationAttention(c).key, "follow_up");
  assert.equal(conversationAttention(c).turn, "client");
  assert.match(conversationAttention(c).detail, /no una respuesta pendiente/);
  assert.equal(matchesAttention(c, "needs_reply"), false);
  assert.equal(matchesAttention(c, "unassigned"), true);
});
test("completed bot flow is green, but a new customer message reopens attention", () => {
  const c = chat([msg(1, "inbound", "unknown", "10"), msg(2, "outbound", "bot", "11")], { status: "completed" });
  assert.equal(conversationAttention(c).key, "up_to_date");
  c.messages.push(msg(3, "inbound", "unknown", "12"));
  assert.equal(conversationAttention(c).key, "needs_reply");
});
test("missing records stay neutral; outgoing messages without an author do not create false alerts", () => {
  assert.equal(conversationAttention(chat([])).key, "unknown");
  assert.equal(conversationAttention(chat([msg(1, "outbound", "unknown", "11")])).key, "waiting_client");
});
test("an active bot wait is distinct from a paused bot with a waiting customer", () => {
  const c = chat([msg(1, "inbound", "unknown", "11")], { bot_response_pending: true });
  assert.equal(conversationAttention(c).turn, "assistant");
  assert.equal(conversationAttention({ ...c, human_takeover_active: true }).key, "needs_reply");
});
test("message timestamps, not array position, decide whose turn it is", () => {
  const c = chat([msg(2, "outbound", "human_dashboard", "11"), msg(1, "inbound", "unknown", "10")]);
  assert.equal(conversationAttention(c).key, "waiting_client");
});
test("a revoked message is not treated as a customer waiting for a reply", () => {
  const c = chat([msg(1, "outbound", "human_dashboard", "10"), msg(2, "inbound", "unknown", "11", { event_type: "revoked" })]);
  assert.equal(conversationAttention(c).key, "waiting_client");
});
test("same-timestamp messages use record order without hiding a new customer reply", () => {
  const c = chat([msg(1, "outbound", "human_dashboard", "11"), msg(2, "inbound", "unknown", "11")], { human_takeover_active: true });
  assert.equal(conversationAttention(c).key, "needs_reply");
});
test("priority ordering keeps unanswered customers ahead of reminders and client waits", () => {
  const c1 = chat([msg(1, "inbound", "unknown", "11")], { id: 1 });
  const c2 = chat([msg(2, "inbound", "unknown", "10")], { id: 2 });
  const c3 = chat([msg(3, "outbound", "human_whatsapp", "12")], { id: 3, follow_up_required: true });
  const c4 = chat([msg(4, "outbound", "human_dashboard", "13")], { id: 4 });
  assert.deepEqual([c4, c3, c1, c2].sort(compareConversations).map(c => c.id), [2, 1, 3, 4]);
});

test("a reaction does not create an unanswered customer message", () => {
  const c = chat([msg(1, "outbound", "human_whatsapp", "10"), msg(2, "inbound", "unknown", "11", { body: "[reaction]" })], { human_takeover_active: true });
  assert.equal(conversationAttention(c).key, "up_to_date");
});

test("thanks, emoji and sticker replies close an exchange after our message", () => {
  for (const body of ["Gracias", "Muchas gracias 🙏", "Perfecto, gracias", "🙏⚽", "[sticker]"]) {
    const c = chat([msg(1, "outbound", "human_whatsapp", "10"), msg(2, "inbound", "unknown", "11", { body })], { human_takeover_active: true });
    const attention = conversationAttention(c);
    assert.equal(attention.key, "up_to_date", body);
    assert.equal(attention.label, "Conversación cerrada", body);
  }
});

test("a thank-you containing a real request still requires a response", () => {
  const body = "Gracias, ¿me puedes confirmar el horario?";
  assert.equal(isClosingAcknowledgement(body), false);
  const c = chat([msg(1, "outbound", "human_whatsapp", "10"), msg(2, "inbound", "unknown", "11", { body })], { human_takeover_active: true });
  assert.equal(conversationAttention(c).key, "needs_reply");
});

test("an isolated emoji without an earlier academy message is not auto-closed", () => {
  const c = chat([msg(1, "inbound", "unknown", "11", { body: "👋" })], { human_takeover_active: true });
  assert.equal(conversationAttention(c).key, "needs_reply");
});

test("an explicit follow-up remains marked after a closing acknowledgement", () => {
  const c = chat([msg(1, "outbound", "human_dashboard", "10"), msg(2, "inbound", "unknown", "11", { body: "Muchas gracias" })], { follow_up_required: true });
  assert.equal(conversationAttention(c).key, "follow_up");
});

test("explicit review closes only the reviewed exchange; a new customer message reopens it", () => {
  const c = chat([msg(1, "inbound", "unknown", "10")], { human_takeover_active: true, attention_resolution: { message_id: 1, resolved_at: "2026-09-05T11:00:00Z" } });
  assert.equal(conversationAttention(c).key, "up_to_date");
  c.messages.push(msg(2, "inbound", "unknown", "12"));
  assert.equal(conversationAttention(c).key, "needs_reply");
});
test("no-response review does not silently clear a separately marked followup", () => {
  const c = chat([msg(1, "inbound", "unknown", "10")], { follow_up_required: true, attention_resolution: { message_id: 1, resolved_at: "2026-09-05T11:00:00Z" } });
  assert.equal(conversationAttention(c).key, "follow_up");
  assert.equal(conversationAttention(c).turn, "none");
});
