// Manual UI fixture: isolated data, never sends requests to a real backend.
import React from "react";
import { createRoot } from "react-dom/client";
import "../src/styles.css";
import "../src/features/voice-agent/communications.css";
import { WhatsAppSiteSettings } from "../src/features/voice-agent/WhatsAppSiteSettings";
import type { Site, WhatsAppAutomationSettings } from "../src/types";

if (!import.meta.env.DEV) throw new Error("This preview is only available in development.");
const sites = [{ id: 901, name: "Sede de prueba Norte" }, { id: 902, name: "Sede de prueba Sur" }] as Site[];
const make = (index: number): WhatsAppAutomationSettings => ({
  id: index, site: 900 + index, site_name: sites[index - 1].name,
  business_address: "whatsapp:+52550000010" + index, openai_model: "gpt-5.6-luna", effective_model: "gpt-5.6-luna",
  bot_enabled: false,
  human_first_enabled: true, business_days: [0, 1, 2, 3, 4], business_hours_start: "09:00", business_hours_end: "18:00",
  human_response_delay_seconds: 600, welcome_message: "¡Hola! Soy el asistente de " + sites[index - 1].name,
  assistant_instructions: "Datos ficticios de " + sites[index - 1].name + ". Costo: " + (index * 100) + " pesos.",
  contact_classification_enabled: true, classification_confidence_threshold: 80,
  out_of_hours_acknowledgement: "Si necesitas hablar con una persona, escribe HUMANO.",
  created_at: null, updated_at: null,
});
let rows: WhatsAppAutomationSettings[] = JSON.parse(sessionStorage.getItem("qa-site-settings") || "null") || [make(1), make(2)];
(window as any).__siteSettingsPatchCount = 0;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.includes("/whatsapp-automation-settings/")) throw new Error("QA blocks non-fixture requests");
  const address = url.searchParams.get("business_address");
  if (!address) return Response.json(rows);
  let row = rows.find(item => item.business_address === address) || { ...make(1), id: null, site: null, site_name: "", business_address: address, assistant_instructions: "Completa los datos de esta sede.", welcome_message: "Hola, soy el asistente de esta sede." };
  if (init?.method === "PATCH") {
    (window as any).__siteSettingsPatchCount += 1;
    const payload = JSON.parse(String(init.body));
    row = { ...row, ...payload, effective_model: payload.openai_model, site_name: sites.find(site => site.id === payload.site)?.name || "", id: row.id || 3 };
    rows = [...rows.filter(item => item.business_address !== address), row];
    sessionStorage.setItem("qa-site-settings", JSON.stringify(rows));
  }
  return Response.json(row);
};
createRoot(document.getElementById("root")!).render(<main className="communications p-6"><h1 className="mb-4 text-xl font-bold">Prueba local · datos ficticios · no envía mensajes</h1><WhatsAppSiteSettings token="qa-only" sites={sites} initial={rows[0]} /></main>);
