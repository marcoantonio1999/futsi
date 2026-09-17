// Local-only fixture. All requests stay in this simulated dataset; no real sends.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { emptyData } from "../src/appState";
import { VoiceDashboardPanel } from "../src/features/voice-agent/VoiceDashboardPanel";
import { filterCommunications } from "../src/features/voice-agent/communicationScope";
import type { VoiceDashboardSection } from "../src/features/voice-agent/model";
import type { AppData, Site, User, WhatsAppAutomationSettings, WhatsAppConversation } from "../src/types";
import "../src/styles.css";
if (!import.meta.env.DEV) throw new Error("Development only");
const sites = [1, 2, 3].map(id => ({ id, name: ["Norte", "Sur", "Sin actividad"][id - 1], is_active: true })) as Site[];
const channels = [1, 2].map(site => ({ site, site_name: sites[site - 1].name, business_address: `whatsapp:+52550000010${site}` }));
let settings = channels.map((channel, i) => ({ ...channel, id: i + 1, openai_model: "modelo-prueba", effective_model: "modelo-prueba", human_first_enabled: true, business_days: [0, 1, 2, 3, 4], business_hours_start: "09:00", business_hours_end: "18:00", human_response_delay_seconds: 600, welcome_message: `Hola de ${channel.site_name}`, assistant_instructions: `Información exclusiva de ${channel.site_name}`, contact_classification_enabled: true, classification_confidence_threshold: 80, out_of_hours_acknowledgement: "Escribe HUMANO si necesitas ayuda del equipo.", created_at: null, updated_at: null })) as WhatsAppAutomationSettings[];
const now = new Date().toISOString();
const manualAttempts: Record<number, { stage: number; state: string; created_at: string; detail: string; template_name: string }> = {};
let manualPreview: { charge: number; stage: number; body: string; address: string } | null = null;
const conversations = Array.from({ length: 30 }, (_, index) => (index % 2) + 1).map((site, index) => ({
  id: index + 1, site, site_name: sites[site - 1].name, channel_site: site, channel_site_name: sites[site - 1].name,
  business_address: channels[site - 1].business_address, contact_phone: "+525511110000", contact_name: `Contacto ${sites[site - 1].name} ${index + 1}`,
  status: "active", kind: "faq", current_step: "faq", created_at: now, last_message_at: now, last_inbound_at: now,
  human_takeover_active: true, follow_up_required: false, follow_up_notes: "", free_form_window_open: true, free_form_window_expires_at: new Date(Date.now() + 86400000).toISOString(), manual_send_available: true,
  messages: Array.from({ length: 60 }, (_, messageIndex) => ({ id: index * 100 + messageIndex + 1, direction: messageIndex % 2 ? "outbound" : "inbound", response_source: messageIndex % 2 ? "human" : "unknown", body: `Mensaje ${messageIndex + 1} de ${sites[site - 1].name}`, created_at: new Date(Date.now() - (60-messageIndex)*60000).toISOString(), event_type: "message" })),
})) as WhatsAppConversation[];
const data: AppData = { ...emptyData, sites, whatsappConversations: conversations, whatsappAutomationSettings: settings[0],
  trialBookings: [1, 2].map(site => ({ id: site, site, site_name: sites[site - 1].name, responsible_name: "Prueba", responsible_phone: "+525511110000", child_first_name: `Alumno ${sites[site - 1].name}`, status: "scheduled", source: "manual", visits: [], created_at: now })) as AppData["trialBookings"],
  trialAvailabilityRules: [1, 2].map(site => ({ id: site, site, site_name: sites[site - 1].name, court: null, court_name: "", weekday: 1, starts_at: "17:00", ends_at: "18:00", slot_minutes: 60, capacity: 5, is_active: true })) as AppData["trialAvailabilityRules"],
};
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname.endsWith("/manual-whatsapp/")) {
    const charge = Number(url.pathname.split("/").at(-3));
    const body = JSON.parse(String(init?.body));
    if (body.action === "preview") {
      manualPreview = { charge, stage: body.stage, address: body.business_address, body: `Hola ${body.values["body.1"]}, tienes un saldo pendiente de ${body.values["body.2"]}.` };
      return Response.json({ confirmation: "fixture-only", body: manualPreview.body, contact_phone: "+525500000000", business_address: body.business_address, template_name: body.template_name, language: body.language, balance: "1250.00" });
    }
    if (!manualPreview || manualAttempts[charge]) return Response.json({ detail: "Ya registrado en la prueba; no se reenviará." }, { status: 400 });
    manualAttempts[charge] = { stage: manualPreview.stage, state: "accepted", created_at: now, detail: "Simulación local; no se envió ningún mensaje real", template_name: "recordatorio_pago" };
    return Response.json({ message_id: "fixture-id" });
  }
  if (url.pathname.endsWith("/channels/")) return Response.json(channels);
  if (url.pathname.endsWith("/whatsapp-conversations/templates/")) {
    const address = url.searchParams.get("business_address");
    if (address === channels[1].business_address) return Response.json({ detail: "Catálogo no conectado para Sur (prueba)" }, { status: 503 });
    return Response.json({ business_address: address, waba_id: "1234", fetched_at: now, next_cursor: "", templates: [
      { id: "1", name: "recordatorio_pago", language: "es_MX", category: "UTILITY", status: "APPROVED", rejected_reason: "", components: [{ type: "BODY", format: "", text: "Hola {{1}}, tienes un saldo pendiente de {{2}}.", buttons: [] }] },
      { id: "2", name: "aviso_baja", language: "es_MX", category: "UTILITY", status: "PENDING", rejected_reason: "", components: [] },
      { id: "3", name: "promocion", language: "es_MX", category: "MARKETING", status: "REJECTED", rejected_reason: "Revisar contenido de ejemplo", components: [] },
    ] });
  }
  if (url.pathname.endsWith("/charges/communications/")) {
    const site = url.searchParams.get("site");
    const address = url.searchParams.get("business_address");
    const rows = [7, 14, 21].map((stage, index) => ({
      id: index + 1, site: index === 2 ? 2 : 1, site_name: index === 2 ? "Sur" : "Norte", student_name: `Alumno de prueba ${index + 1}`,
      payer_name: "Responsable de prueba", payer_phone: "+525500000000", concept: "Mensualidad", balance: "1250.00", due_date: "2026-08-17", overdue_days: stage, stage,
      channels: [channels[index === 2 ? 1 : 0].business_address], history: [], attempts: manualAttempts[index + 1] ? [manualAttempts[index + 1]] : [], student_dropped: false,
      blocker: stage === 21 ? "Requiere confirmar la baja; no se enviará un aviso de baja inexistente." : "",
      milestones: [7, 14, 21].map((day, i) => ({ day, label: ["Primer recordatorio", "Segundo recordatorio", "Aviso de baja"][i], date: "2026-09-07", reached: stage >= day })),
    })).filter(row => (!site || String(row.site) === site) && (!address || row.channels.includes(address)));
    return Response.json({ as_of: now.slice(0, 10), automatic_sending_enabled: false, notice: "Prueba local: secuencia automática no activada. Las fechas no significan envío.", rows });
  }
  if (url.pathname.includes("whatsapp-automation-settings")) {
    const address = url.searchParams.get("business_address");
    if (!address) return Response.json(settings);
    let row = settings.find(r => r.business_address === address);
    if (!row) throw new Error("Número no incluido en esta prueba");
    if (init?.method === "PATCH") { row = { ...row, ...JSON.parse(String(init.body)) }; settings = settings.map(r => r.business_address === address ? row! : r); }
    return Response.json(row);
  }
  if (url.pathname.endsWith("/weekly-stats/")) {
    const scoped = filterCommunications(data, { site: url.searchParams.get("site") || "all", address: url.searchParams.get("business_address") || "all" });
    const count = scoped.whatsappConversations.length;
    const summary = { total: count, answered: 0, unanswered: count, average_response_seconds: null, median_response_seconds: null, within_5_minutes_percent: 0, within_10_minutes_percent: 0, within_30_minutes_percent: 0, within_60_minutes_percent: 0 };
    return Response.json({ week_start: url.searchParams.get("week_start"), week_end: now.slice(0, 10), generated_at: now, summary, business_hours: summary, outside_business_hours: { ...summary, total: 0, unanswered: 0 }, classifications: { prospect: count, current_client: 0, ambiguous: 0 }, by_responder: [], longest_waits: [] });
  }
  throw new Error("QA blocks requests outside its fixture");
};
function Preview() {
  const requested = new URLSearchParams(location.search).get("section");
  const [section, setSection] = useState<VoiceDashboardSection>(requested === "collections" ? "collections" : requested === "whatsapp" ? "whatsapp" : "summary");
  const blocked = async (): Promise<never> => { throw new Error("No se envían mensajes ni se editan datos reales en esta prueba"); };
  return <main className="p-5"><p>Prueba local · datos ficticios · no envía mensajes</p><VoiceDashboardPanel user={{ role: "admin" } as User} token="qa-only" section={section} onSelectSection={setSection} data={data} onCreateRecord={blocked} onUpdateRecord={blocked} onCreateAndReturn={blocked} /></main>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
