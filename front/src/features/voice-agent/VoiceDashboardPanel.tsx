import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api";
import { filterCommunications, scopeQuery, conversationSite, type CommunicationChannel } from "./communicationScope";
import { CommunicationsNav, communicationGroups } from "./CommunicationsNav";
import { CommunicationsSummary } from "./CommunicationsSummary";
import "./communications.css";
import { lastMessage, type AttentionFilter } from "./communicationUtils";
import type { TrialBooking, TrialVisit, VoiceCall, WhatsAppConversation } from "../../types";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { TrialBookingsPanel } from "./TrialBookingsPanel";
import { VoiceCallsPanel } from "./VoiceCallsPanel";
import { WhatsAppConversationsPanel } from "./WhatsAppConversationsPanel";
import { WhatsAppSiteSettings } from "./WhatsAppSiteSettings";
import { WhatsAppWeeklyStatsPanel } from "./WhatsAppWeeklyStatsPanel";
import { DebtCommunicationsPanel } from "./DebtCommunicationsPanel";
import { WhatsAppTemplatesPanel } from "./WhatsAppTemplatesPanel";
import { VeronicaPanel } from "./VeronicaPanel";
import { BulkTemplatesPanel } from "./BulkTemplatesPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { inputClass, type VoiceDashboardProps, type VoiceDashboardSection } from "./model";

const adminRoles = new Set(["admin", "owner", "dev"]);
const operationsRoles = new Set(["admin", "owner", "dev", "site_coordinator"]);
const sectionDetails: Record<VoiceDashboardSection, { title: string }> = {
  connections: { title: "Conexiones" },
  "bulk-veronica": { title: "Verónica · envíos masivos" },
  "bulk-academy": { title: "Canchas · envíos masivos" },
  veronica: { title: "Verónica · atención manual" },
  templates: { title: "Plantillas de WhatsApp" },
  collections: { title: "Cobranza por WhatsApp" },
  summary: { title: "Resumen de comunicaciones" },
  bookings: { title: "Pruebas gratuitas" },
  calls: { title: "Llamadas y transcripciones" },
  whatsapp: { title: "Bandeja de WhatsApp" },
  "weekly-stats": { title: "Resultados semanales" },
  availability: { title: "Disponibilidad para pruebas" },
  settings: { title: "Ajustes del asistente" },
};

export function VoiceDashboardPanel({
  onOpenDebts,
  user,
  token,
  onSelectSection,
  data,
  section,
  onUpdateRecord,
  onCreateAndReturn,
}: VoiceDashboardProps) {
  const canManageTrials = operationsRoles.has(user.role);
  const canReviewCalls = adminRoles.has(user.role);
  const permittedData = useMemo(() => {
    if (user.role !== "site_coordinator") return data;
    const primarySite = user.primary_site;
    return {
      ...data,
      sites: primarySite ? data.sites.filter((site) => site.id === primarySite) : [],
      courts: primarySite ? data.courts.filter((court) => court.site === primarySite) : [],
      trialBookings: primarySite ? data.trialBookings.filter((booking) => booking.site === primarySite) : [],
      whatsappConversations: primarySite
        ? data.whatsappConversations.filter((conversation) => conversationSite(conversation) === primarySite)
        : [],
      trialAvailabilityRules: primarySite
        ? data.trialAvailabilityRules.filter((rule) => rule.site === primarySite)
        : [],
    };
  }, [data, user.primary_site, user.role]);
  const [selectedSite, setSelectedSite] = useState(user.role === "site_coordinator" ? String(user.primary_site ?? "unassigned") : "all");
  const [selectedAddress, setSelectedAddress] = useState("all");
  const [channels, setChannels] = useState<CommunicationChannel[]>([]);
  const [channelError, setChannelError] = useState("");
  const [channelsReady, setChannelsReady] = useState(false);
  const [channelRetry, setChannelRetry] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setChannelError("");
    apiRequest<CommunicationChannel[]>("/whatsapp-conversations/channels/", token, { signal: controller.signal })
      .then(rows => { if (!controller.signal.aborted) { setChannels(rows); setChannelsReady(true); } })
      .catch(err => { if (!controller.signal.aborted) { setChannelError(err.message); setChannelsReady(false); } });
    return () => controller.abort();
  }, [token, data.whatsappConversations, channelRetry]);
  const scope = { site: selectedSite, address: selectedAddress };
  const query = scopeQuery(scope);
  const voiceData = useMemo(() => filterCommunications(permittedData, { site: selectedSite, address: selectedAddress }, channels), [permittedData, selectedSite, selectedAddress, channels]);
  const channelOptions = channels.filter(c => selectedSite === "all" || (selectedSite === "unassigned" ? c.site === null : String(c.site) === selectedSite));
  function canChangeScope() {
    if (settingsBusy) return false;
    return !settingsDirty || window.confirm("Hay ajustes sin guardar. ¿Descartarlos y cambiar de sede o número?");
  }
  function changeAddress(address: string) {
    if (address === selectedAddress || !canChangeScope()) return;
    const channel = channels.find(c => c.business_address === address);
    setSettingsDirty(false); setSelectedAddress(address);
    if (address !== "all" && user.role !== "site_coordinator") setSelectedSite(channel?.site ? String(channel.site) : "unassigned");
    setConversationId(null); setBookingId(null);
  }
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [inboxFilter, setInboxFilter] = useState<AttentionFilter>("all");
  const [bookingId, setBookingId] = useState<number | null>(null);
  useEffect(() => { if (section !== "bookings") setBookingId(null); if (section !== "whatsapp") { setConversationId(null); setInboxFilter("all"); } }, [section]);
  function openInbox(filter: AttentionFilter) { setConversationId(null); setInboxFilter(filter); onSelectSection("whatsapp"); }
  function openConversation(id: number) { setInboxFilter("all"); setConversationId(id); onSelectSection("whatsapp"); }
  function openBooking(id: number) { setBookingId(id); onSelectSection("bookings"); }

  async function updateBooking(booking: TrialBooking, payload: unknown) {
    if (!await onUpdateRecord(`/trial-bookings/${booking.id}/`, payload, "Reserva actualizada.")) throw new Error("No se pudo guardar la reserva. Intenta de nuevo.");
  }

  async function updateVisit(visit: TrialVisit, payload: unknown) {
    if (!await onUpdateRecord(`/trial-visits/${visit.id}/`, payload, `Visita ${visit.visit_number} actualizada.`)) throw new Error("No se pudo guardar la visita. Intenta de nuevo.");
  }

  async function reviewCall(
    call: VoiceCall,
    payload: { review_outcome: "successful" | "unsuccessful"; failure_reason?: string },
  ) {
    return onCreateAndReturn<VoiceCall>(`/voice-calls/${call.id}/review/`, payload);
  }

  async function updateWhatsAppConversation(
    conversation: WhatsAppConversation,
    payload: {
      follow_up_required: boolean;
      follow_up_assigned_to: number | null;
      follow_up_notes: string;
    },
  ) {
    const saved = await onUpdateRecord(
      `/whatsapp-conversations/${conversation.id}/?scope=all`,
      payload,
      "Seguimiento de WhatsApp actualizado.",
    );
    if (!saved) throw new Error("No se pudo guardar el seguimiento. Intenta de nuevo.");
  }

  async function sendWhatsAppMessage(
    conversation: WhatsAppConversation,
    body: string,
  ) {
    await onCreateAndReturn<WhatsAppConversation>(
      `/whatsapp-conversations/${conversation.id}/send-message/?scope=all`,
      { body },
    );
  }

  if (!canManageTrials) return null;
  if (section === 'connections') return canReviewCalls ? <div className="communications"><CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} /><ConnectionsPanel token={token} /></div> : null;
  if (section === 'bulk-veronica' || section === 'bulk-academy') return canReviewCalls ? <div className="communications">
    <CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} />
    <BulkTemplatesPanel key={section} token={token} kind={section === 'bulk-veronica' ? 'veronica' : 'academy'} />
  </div> : null;
  if (section === "veronica") return canReviewCalls ? <div className="communications">
    <CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} />
    <VeronicaPanel token={token} />
  </div> : null;

  const sectionDetail = sectionDetails[section];
  const sectionGroup = communicationGroups.find(group => group.items.some(item => item.key === section))?.label;

  return (
    <div className="communications">
      <header className="comm-page-heading"><div><p className="comm-eyebrow">Comunicaciones <span aria-hidden="true"> / </span> {sectionGroup}</p><h2>{sectionDetail.title}</h2></div></header>
      <section className="comm-panel comm-scope" aria-label="Ámbito de comunicaciones">
        <label>Sede<select aria-label="Sede de comunicaciones" className={inputClass} value={selectedSite} disabled={settingsBusy || user.role === "site_coordinator"} onChange={e => { if (canChangeScope()) { setSettingsDirty(false); setSelectedSite(e.target.value); setSelectedAddress("all"); setConversationId(null); setBookingId(null); } }}>
          {user.role !== "site_coordinator" && <><option value="all">Todas las sedes · Consolidado</option><option value="unassigned">Sin sede vinculada</option></>}
          {permittedData.sites.map(site => <option value={site.id} key={site.id}>{site.name}</option>)}
        </select></label>
        <label>Número de atención<select aria-label="Número de comunicaciones" className={inputClass} value={selectedAddress} disabled={settingsBusy || !channelsReady} onChange={e => changeAddress(e.target.value)}>
          <option value="all">Todos los números de la selección</option>
          {selectedAddress !== "all" && !channelOptions.some(c => c.business_address === selectedAddress) && <option value={selectedAddress}>{selectedAddress.replace("whatsapp:", "")} · Sin vínculo</option>}
          {channelOptions.map(channel => <option key={channel.business_address} value={channel.business_address}>{channel.business_address.replace("whatsapp:", "")} · {channel.site_name || "Sin sede vinculada"}</option>)}
        </select></label>
        <p>El filtro se conserva entre subsecciones. WhatsApp, llamadas y resultados se filtran por número; la agenda y disponibilidad son de la sede, e incluyen reservas manuales.</p>
        {channelsReady && selectedSite !== "all" && !channelOptions.length && <p role="status">Esta sede no tiene números registrados en el sistema. Puedes preparar su configuración en Ajustes; conectar el número requiere su integración de WhatsApp.</p>}
      </section>
      <CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} />
      {channelError && <p role="alert" className="comm-error">No se pudieron cargar los canales: {channelError} <button onClick={() => setChannelRetry(n => n + 1)}>Reintentar</button></p>}
      {!channelsReady && !channelError && <p role="status">Cargando sedes y números…</p>}
      {channelsReady && <div key={query}>
      {section === "templates" && <WhatsAppTemplatesPanel key={selectedAddress} token={token} address={selectedAddress} onOpenCollections={() => onSelectSection("collections")} />}
      {section === "collections" && <DebtCommunicationsPanel token={token} scopeQuery={query} onOpenDebts={onOpenDebts} />}
      {section === "summary" && <CommunicationsSummary data={voiceData} canReview={canReviewCalls} onNavigate={onSelectSection} onOpenInbox={openInbox} onOpenConversation={openConversation} onOpenBooking={openBooking} />}

      {section === "bookings" ? (
        <TrialBookingsPanel
          initialBookingId={bookingId}
          data={voiceData}
          onUpdateBooking={updateBooking}
          onUpdateVisit={updateVisit}
        />
      ) : null}

      {section === "calls" && canReviewCalls ? (
        <VoiceCallsPanel calls={voiceData.voiceCalls} bookings={voiceData.trialBookings} onReviewCall={reviewCall} />
      ) : null}

      {section === "whatsapp" ? (
        <WhatsAppConversationsPanel
          initialConversationId={conversationId}
          initialFilter={inboxFilter}
          assignees={voiceData.whatsappFollowUpAssignees}
          conversations={voiceData.whatsappConversations}
          onSendMessage={sendWhatsAppMessage}
          onResolveConversation={async conversation => {
            await onCreateAndReturn(`/whatsapp-conversations/${conversation.id}/resolve-attention/?scope=all`, { last_message_id: lastMessage(conversation)?.id });
          }}
          onUpdateConversation={updateWhatsAppConversation}
        />
      ) : null}

      {section === "availability" ? (
        <AvailabilityPanel
          data={voiceData}
          onCreateRule={async (payload) => {
            await onCreateAndReturn("/trial-availability-rules/", payload);
          }}
          onUpdateRule={async (rule, payload) => {
            if (!await onUpdateRecord(`/trial-availability-rules/${rule.id}/`, payload, "Disponibilidad actualizada.")) throw new Error("No se pudo guardar la disponibilidad.");
          }}
        />
      ) : null}

      {section === "weekly-stats" && canReviewCalls ? (
        <WhatsAppWeeklyStatsPanel scopeQuery={query} conversations={voiceData.whatsappConversations} value={voiceData.whatsappWeeklyStats} token={token} onOpenConversation={openConversation} />
      ) : null}

      {section === "settings" && canReviewCalls ? (
        <WhatsAppSiteSettings token={token} sites={permittedData.sites} initial={voiceData.whatsappAutomationSettings} selectedAddress={selectedAddress} onAddressChange={changeAddress} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} onChannelSaved={channel => { setChannels(rows => [...rows.filter(c => c.business_address !== channel.business_address), channel]); setSelectedSite(channel.site ? String(channel.site) : "unassigned"); }} />
      ) : null}
      </div>}
    </div>
  );
}
