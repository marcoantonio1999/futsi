import { useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api";
import { channelOwnerLabel, channelsForScope, filterCommunications, scopeQuery, conversationSite, type CommunicationChannel } from "./communicationScope";
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
import { WhatsAppTemplateBuilder } from "./WhatsAppTemplateBuilder";
import { VeronicaPanel } from "./VeronicaPanel";
import { BulkTemplatesPanel } from "./BulkTemplatesPanel";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { VeronicaFiltersPanel } from "./VeronicaFiltersPanel";
import { CommunicationScopePicker } from "./CommunicationScopePicker";
import { ChatExportPanel } from "./ChatExportPanel";
import { type VoiceDashboardProps, type VoiceDashboardSection } from "./model";
import { CourtCommunicationsOnlyContext, isCourtCommunicationsSection } from "./CommunicationsAccess";

const adminRoles = new Set(["admin", "owner", "dev"]);
const operationsRoles = new Set(["admin", "owner", "dev", "site_coordinator"]);
const sectionDetails: Record<VoiceDashboardSection, { title: string }> = {
  connections: { title: "Conexiones" },
  "bulk-veronica": { title: "Verónica · envíos masivos" },
  "veronica-filters": { title: "Verónica · filtros de RH" },
  "bulk-academy": { title: "Canchas · envíos masivos" },
  "bulk-academy-history": { title: "Canchas · historial de envíos" },
  veronica: { title: "Verónica · atención manual" },
  templates: { title: "Plantillas de WhatsApp" },
  "template-builder": { title: "Crear plantilla de WhatsApp" },
  collections: { title: "Cobranza por WhatsApp" },
  summary: { title: "Resumen de comunicaciones" },
  bookings: { title: "Pruebas gratuitas" },
  calls: { title: "Llamadas y transcripciones" },
  whatsapp: { title: "Bandeja de WhatsApp" },
  "weekly-stats": { title: "Resultados semanales" },
  "chat-export": { title: "Exportar chats" },
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
  const courtCommunicationsOnly = useContext(CourtCommunicationsOnlyContext);
  const canManageTrials = operationsRoles.has(user.role);
  const canReviewCalls = adminRoles.has(user.role);
  const [inboxConversations, setInboxConversations] = useState(data.whatsappConversations);
  useEffect(() => { setInboxConversations(data.whatsappConversations); }, [data.whatsappConversations]);
  useEffect(() => {
    if (section !== "whatsapp") return;
    let active = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void apiRequest<WhatsAppConversation[]>("/whatsapp-conversations/?scope=all", token)
        .then(rows => { if (active) setInboxConversations(rows); })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [section, token]);
  const communicationsData = useMemo(
    () => ({ ...data, whatsappConversations: inboxConversations }),
    [data, inboxConversations],
  );
  const permittedData = useMemo(() => {
    if (user.role !== "site_coordinator") return communicationsData;
    const primarySite = user.primary_site;
    return {
      ...communicationsData,
      sites: primarySite ? communicationsData.sites.filter((site) => site.id === primarySite) : [],
      courts: primarySite ? communicationsData.courts.filter((court) => court.site === primarySite) : [],
      trialBookings: primarySite ? communicationsData.trialBookings.filter((booking) => booking.site === primarySite) : [],
      whatsappConversations: primarySite
        ? communicationsData.whatsappConversations.filter((conversation) => conversationSite(conversation) === primarySite)
        : [],
      trialAvailabilityRules: primarySite
        ? communicationsData.trialAvailabilityRules.filter((rule) => rule.site === primarySite)
        : [],
    };
  }, [communicationsData, user.primary_site, user.role]);
  const [selectedSite, setSelectedSite] = useState(user.role === "site_coordinator" ? String(user.primary_site ?? "unassigned") : "all");
  const [selectedAddress, setSelectedAddress] = useState("all");
  const [channels, setChannels] = useState<CommunicationChannel[]>([]);
  const [channelError, setChannelError] = useState("");
  const [channelsReady, setChannelsReady] = useState(false);
  const [channelRetry, setChannelRetry] = useState(0);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [inboxFilter, setInboxFilter] = useState<AttentionFilter>("all");
  const [bookingId, setBookingId] = useState<number | null>(null);
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
  const templateChannels = useMemo(() => channelsForScope(channels, scope).map(channel => ({
    business_address: channel.business_address,
    label: channelOwnerLabel(channel),
    template_management_available: channel.template_management_available,
  })), [channels, selectedAddress, selectedSite]);
  const voiceData = useMemo(() => filterCommunications(permittedData, { site: selectedSite, address: selectedAddress }, channels), [permittedData, selectedSite, selectedAddress, channels]);
  const hasUnassigned = channels.some(channel => channel.site === null)
    || permittedData.whatsappConversations.some(conversation => conversationSite(conversation) == null);
  useEffect(() => {
    if (channelsReady && selectedSite === "unassigned" && !hasUnassigned) {
      setSelectedSite("all");
      setSelectedAddress("all");
      setConversationId(null);
      setBookingId(null);
    }
  }, [channelsReady, hasUnassigned, selectedSite]);
  function canChangeScope() {
    if (settingsBusy) return false;
    return !settingsDirty || window.confirm("Hay ajustes sin guardar. ¿Descartarlos y cambiar de sede o número?");
  }
  function changeAddress(address: string) {
    if (address === selectedAddress || !canChangeScope()) return;
    const channel = channels.find(c => c.business_address === address);
    setSettingsDirty(false); setSelectedAddress(address);
    if (address !== "all" && user.role !== "site_coordinator" && channel) setSelectedSite(channel.site ? String(channel.site) : "unassigned");
    setConversationId(null); setBookingId(null);
  }
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
    const saved = await onCreateAndReturn<WhatsAppConversation>(
      `/whatsapp-conversations/${conversation.id}/send-message/?scope=all`,
      { body },
    );
    setInboxConversations(rows => rows.some(row => row.id === saved.id)
      ? rows.map(row => row.id === saved.id ? saved : row)
      : [saved, ...rows]);
  }

  if (!canManageTrials || (courtCommunicationsOnly && !isCourtCommunicationsSection(section))) return null;
  if (section === 'connections') return canReviewCalls ? <div className="communications"><CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} /><ConnectionsPanel token={token} /></div> : null;
  if (section === 'veronica-filters') return canReviewCalls ? <div className="communications"><CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} /><VeronicaFiltersPanel token={token} /></div> : null;
  if (section === 'bulk-veronica' || section === 'bulk-academy' || section === 'bulk-academy-history') return (canReviewCalls || (courtCommunicationsOnly && section !== 'bulk-veronica')) ? <div className="communications">
    <CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} />
    <BulkTemplatesPanel key={section} token={token} kind={section === 'bulk-veronica' ? 'veronica' : 'academy'} view={section === 'bulk-academy-history' ? 'history' : 'create'} />
  </div> : null;
  if (section === "veronica") return canReviewCalls ? <div className="communications">
    <CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} />
    <VeronicaPanel token={token} />
  </div> : null;

  const sectionDetail = sectionDetails[section];
  const sectionGroup = communicationGroups.find(group => group.items.some(item => item.key === section))?.label;
  const pageClass = section === "summary" ? "comm-summary-page" : section === "whatsapp" ? "comm-inbox-page" : "";
  const scopePanel = <CommunicationScopePicker
    sites={permittedData.sites}
    channels={channels}
    selectedSite={selectedSite}
    selectedAddress={selectedAddress}
    hasUnassigned={hasUnassigned}
    allowAllSites={user.role !== "site_coordinator"}
    disabled={settingsBusy || !channelsReady}
    inbox={section === "whatsapp"}
    onChange={(site, address) => {
      if (!canChangeScope()) return;
      setSettingsDirty(false);
      setSelectedSite(site);
      setSelectedAddress(address);
      setConversationId(null);
      setBookingId(null);
    }}
  />;

  return (
    <div className={`communications ${pageClass}`}>
      <header className="comm-page-heading">
        <div><p className="comm-eyebrow">Comunicaciones <span aria-hidden="true"> / </span> {sectionGroup}</p><h2>{sectionDetail.title}</h2></div>
        {section !== "whatsapp" && scopePanel}
      </header>
      <CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} />
      {channelError && <p role="alert" className="comm-error">No se pudieron cargar los canales: {channelError} <button onClick={() => setChannelRetry(n => n + 1)}>Reintentar</button></p>}
      {!channelsReady && !channelError && <p role="status">Cargando sedes y números…</p>}
      {channelsReady && <div key={query} className={section === "summary" ? "comm-summary-content" : section === "whatsapp" ? "comm-inbox-content" : undefined}>
      {section === "templates" && <WhatsAppTemplatesPanel token={token} channels={templateChannels} />}
      {section === "template-builder" && <WhatsAppTemplateBuilder token={token} channels={templateChannels} />}
      {section === "collections" && <DebtCommunicationsPanel token={token} scopeQuery={query} onOpenDebts={onOpenDebts} />}
      {section === "summary" && <CommunicationsSummary data={voiceData} canReview={canReviewCalls} onNavigate={onSelectSection} onOpenInbox={openInbox} />}

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
          scopeControls={scopePanel}
          assignees={voiceData.whatsappFollowUpAssignees}
          conversations={voiceData.whatsappConversations}
          onSendMessage={sendWhatsAppMessage}
          onResolveConversation={async conversation => {
            const saved = await onCreateAndReturn<WhatsAppConversation>(`/whatsapp-conversations/${conversation.id}/resolve-attention/?scope=all`, { last_message_id: lastMessage(conversation)?.id });
            setInboxConversations(rows => rows.map(row => row.id === saved.id ? saved : row));
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
        <WhatsAppWeeklyStatsPanel scopeQuery={query} value={voiceData.whatsappWeeklyStats} token={token} onOpenConversation={openConversation} />
      ) : null}

      {section === "chat-export" && canReviewCalls ? (
        <ChatExportPanel token={token} scopeQuery={query} conversations={voiceData.whatsappConversations} />
      ) : null}

      {section === "settings" && canReviewCalls ? (
        <WhatsAppSiteSettings token={token} sites={permittedData.sites} initial={voiceData.whatsappAutomationSettings} selectedAddress={selectedAddress} selectedSite={selectedSite} onAddressChange={changeAddress} onDirtyChange={setSettingsDirty} onBusyChange={setSettingsBusy} onChannelSaved={channel => { setChannels(rows => [...rows.filter(c => c.business_address !== channel.business_address), channel]); setSelectedSite(channel.site ? String(channel.site) : "unassigned"); }} />
      ) : null}
      </div>}
    </div>
  );
}
