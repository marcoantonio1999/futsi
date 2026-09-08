import { useEffect, useMemo, useState } from "react";
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
import type { VoiceDashboardProps, VoiceDashboardSection } from "./model";

const adminRoles = new Set(["admin", "owner", "dev"]);
const operationsRoles = new Set(["admin", "owner", "dev", "site_coordinator"]);
const sectionDetails: Record<VoiceDashboardSection, { title: string }> = {
  summary: { title: "Resumen de comunicaciones" },
  bookings: { title: "Pruebas gratuitas" },
  calls: { title: "Llamadas y transcripciones" },
  whatsapp: { title: "Bandeja de WhatsApp" },
  "weekly-stats": { title: "Resultados semanales" },
  availability: { title: "Disponibilidad para pruebas" },
  settings: { title: "Ajustes del asistente" },
};

export function VoiceDashboardPanel({
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
  const voiceData = useMemo(() => {
    if (user.role !== "site_coordinator") return data;
    const primarySite = user.primary_site;
    return {
      ...data,
      sites: primarySite ? data.sites.filter((site) => site.id === primarySite) : [],
      courts: primarySite ? data.courts.filter((court) => court.site === primarySite) : [],
      trialBookings: primarySite ? data.trialBookings.filter((booking) => booking.site === primarySite) : [],
      whatsappConversations: primarySite
        ? data.whatsappConversations.filter((conversation) => conversation.site === primarySite)
        : [],
      trialAvailabilityRules: primarySite
        ? data.trialAvailabilityRules.filter((rule) => rule.site === primarySite)
        : [],
    };
  }, [data, user.primary_site, user.role]);
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
      `/whatsapp-conversations/${conversation.id}/`,
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
      `/whatsapp-conversations/${conversation.id}/send-message/`,
      { body },
    );
  }

  if (!canManageTrials) return null;

  const sectionDetail = sectionDetails[section];
  const sectionGroup = communicationGroups.find(group => group.items.some(item => item.key === section))?.label;

  return (
    <div className="communications">
      <header className="comm-page-heading"><div><p className="comm-eyebrow">Comunicaciones <span aria-hidden="true"> / </span> {sectionGroup}</p><h2>{sectionDetail.title}</h2></div></header>
      <CommunicationsNav compact section={section} canReview={canReviewCalls} onSelect={onSelectSection} />
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
            await onCreateAndReturn(`/whatsapp-conversations/${conversation.id}/resolve-attention/`, { last_message_id: lastMessage(conversation)?.id });
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
        <WhatsAppWeeklyStatsPanel conversations={voiceData.whatsappConversations} value={voiceData.whatsappWeeklyStats} token={token} onOpenConversation={openConversation} />
      ) : null}

      {section === "settings" && canReviewCalls ? (
        <WhatsAppSiteSettings token={token} sites={voiceData.sites} initial={voiceData.whatsappAutomationSettings} />
      ) : null}
    </div>
  );
}
