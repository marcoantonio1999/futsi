import { useMemo } from "react";
import { Bot, MessageCircle } from "lucide-react";
import type { TrialBooking, TrialVisit, VoiceCall, WhatsAppConversation } from "../../types";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { TrialBookingsPanel } from "./TrialBookingsPanel";
import { VoiceCallsPanel } from "./VoiceCallsPanel";
import { WhatsAppConversationsPanel } from "./WhatsAppConversationsPanel";
import { WhatsAppAutomationSettingsPanel } from "./WhatsAppAutomationSettingsPanel";
import { WhatsAppWeeklyStatsPanel } from "./WhatsAppWeeklyStatsPanel";
import type { VoiceDashboardProps, VoiceDashboardSection } from "./model";

const adminRoles = new Set(["admin", "owner", "dev"]);
const operationsRoles = new Set(["admin", "owner", "dev", "site_coordinator"]);
const sectionDetails: Record<VoiceDashboardSection, { title: string; description: string }> = {
  summary: {
    title: "Resumen de comunicaciones",
    description: "Actividad de voz, WhatsApp y pruebas gratuitas en un solo lugar.",
  },
  bookings: {
    title: "Pruebas gratuitas",
    description: "Reservas y visitas programadas para niños y niñas.",
  },
  calls: {
    title: "Llamadas y transcripciones",
    description: "Consulta las llamadas atendidas y registra su resultado.",
  },
  whatsapp: {
    title: "Conversaciones de WhatsApp",
    description: "Revisa mensajes, contexto y seguimientos pendientes.",
  },
  "weekly-stats": {
    title: "Estadísticas semanales",
    description: "Mide clasificación, atención humana y tiempos de primera respuesta.",
  },
  availability: {
    title: "Disponibilidad",
    description: "Configura los horarios que puede ofrecer el asistente.",
  },
  settings: {
    title: "Configuración del bot",
    description: "Define cuándo espera al equipo y cuándo responde inmediatamente.",
  },
};

export function VoiceDashboardPanel({
  user,
  data,
  section,
  onCreateRecord,
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
  const today = new Date();
  const upcomingVisits = voiceData.trialBookings.flatMap((booking) => booking.visits).filter((visit) => {
    return visit.status === "scheduled" && new Date(visit.starts_at) >= today;
  });
  const pendingReviews = voiceData.voiceCalls.filter((call) => call.review_outcome === "pending").length;
  const successfulCalls = voiceData.voiceCalls.filter((call) => call.review_outcome === "successful").length;
  const reviewedCalls = voiceData.voiceCalls.filter((call) => call.review_outcome !== "pending").length;
  const successRate = reviewedCalls ? Math.round((successfulCalls / reviewedCalls) * 100) : 0;

  async function updateBooking(booking: TrialBooking, payload: unknown) {
    await onUpdateRecord(`/trial-bookings/${booking.id}/`, payload, "Reserva actualizada.");
  }

  async function updateVisit(visit: TrialVisit, payload: unknown) {
    await onUpdateRecord(`/trial-visits/${visit.id}/`, payload, `Visita ${visit.visit_number} actualizada.`);
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
    await onUpdateRecord(
      `/whatsapp-conversations/${conversation.id}/`,
      payload,
      "Seguimiento de WhatsApp actualizado.",
    );
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

  return (
    <div className="grid min-w-0 gap-5">
      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-4 bg-emerald-700 px-4 py-4 text-white dark:bg-emerald-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-emerald-900 text-white dark:bg-emerald-950">
              <Bot size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-100">
                Comunicaciones · voz y WhatsApp
              </p>
              <h2 className="text-lg font-semibold leading-tight text-white">
                {sectionDetail.title}
              </h2>
              <p className="text-sm text-emerald-50">
                {sectionDetail.description}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-emerald-500 bg-emerald-800 px-3 py-2 text-sm text-white dark:border-emerald-600 dark:bg-emerald-900">
            <MessageCircle size={16} />
            <span>{voiceData.whatsappConversations.length} conversaciones · {voiceData.voiceCalls.length} llamadas</span>
          </div>
        </div>
      </section>

      {section === "summary" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <VoiceMetric label="Pruebas agendadas" value={voiceData.trialBookings.filter((item) => item.status === "scheduled").length} helper={`${voiceData.trialBookings.length} reservas totales`} />
          <VoiceMetric label="Visitas próximas" value={upcomingVisits.length} helper="Pendientes en cancha" />
          <VoiceMetric label="Llamadas por revisar" value={pendingReviews} helper={canReviewCalls ? "Requieren resultado manual" : "Solo visible a administración"} />
          <VoiceMetric label="Éxito revisado" value={`${successRate}%`} helper={`${reviewedCalls} llamadas clasificadas`} />
          <VoiceMetric label="WhatsApp" value={voiceData.whatsappConversations.length} helper={`${voiceData.whatsappConversations.filter((item) => item.follow_up_required).length} requieren seguimiento`} />
        </div>
      ) : null}

      {section === "bookings" ? (
        <TrialBookingsPanel
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
          assignees={voiceData.whatsappFollowUpAssignees}
          conversations={voiceData.whatsappConversations}
          onSendMessage={sendWhatsAppMessage}
          onUpdateConversation={updateWhatsAppConversation}
        />
      ) : null}

      {section === "availability" ? (
        <AvailabilityPanel
          data={voiceData}
          onCreateRule={(payload) =>
            onCreateRecord("/trial-availability-rules/", payload, "Horario de pruebas creado.")
          }
          onUpdateRule={(rule, payload) =>
            onUpdateRecord(`/trial-availability-rules/${rule.id}/`, payload, "Disponibilidad actualizada.")
          }
        />
      ) : null}

      {section === "weekly-stats" && canReviewCalls ? (
        <WhatsAppWeeklyStatsPanel value={voiceData.whatsappWeeklyStats} />
      ) : null}

      {section === "settings" && canReviewCalls ? (
        <WhatsAppAutomationSettingsPanel
          value={voiceData.whatsappAutomationSettings}
          onSave={(payload) =>
            onUpdateRecord(
              "/whatsapp-automation-settings/current/",
              payload,
              "Configuración del bot actualizada.",
            )
          }
        />
      ) : null}
    </div>
  );
}

function VoiceMetric({ label, value, helper }: { label: string; value: string | number; helper: string }) {
  return (
    <article className="motion-card rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{helper}</p>
    </article>
  );
}
