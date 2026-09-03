import { useMemo, useState } from "react";
import { Bot, CalendarDays, ChartNoAxesCombined, Clock3, MessageCircle, MessageSquareText } from "lucide-react";
import { DashboardPanel } from "../../components/views/dashboard";
import type { TrialBooking, TrialVisit, VoiceCall, WhatsAppConversation } from "../../types";
import { AvailabilityPanel } from "./AvailabilityPanel";
import { TrialBookingsPanel } from "./TrialBookingsPanel";
import { VoiceCallsPanel } from "./VoiceCallsPanel";
import { WhatsAppConversationsPanel } from "./WhatsAppConversationsPanel";
import type { VoiceDashboardProps, VoiceDashboardSection } from "./model";

const adminRoles = new Set(["admin", "owner", "dev"]);
const operationsRoles = new Set(["admin", "owner", "dev", "site_coordinator"]);

export function VoiceDashboardPanel({
  user,
  data,
  onCreateRecord,
  onUpdateRecord,
  onCreateAndReturn,
}: VoiceDashboardProps) {
  const canManageTrials = operationsRoles.has(user.role);
  const canReviewCalls = adminRoles.has(user.role);
  const [section, setSection] = useState<VoiceDashboardSection>("summary");
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
  const tabs = useMemo(
    () => [
      { key: "summary" as const, label: "Resumen", icon: ChartNoAxesCombined },
      ...(canManageTrials
        ? [
            { key: "bookings" as const, label: "Pruebas gratuitas", icon: CalendarDays },
            ...(canReviewCalls
              ? [{ key: "calls" as const, label: "Llamadas y transcripciones", icon: MessageSquareText }]
              : []),
            { key: "whatsapp" as const, label: "WhatsApp", icon: MessageCircle },
            { key: "availability" as const, label: "Disponibilidad", icon: Clock3 },
          ]
        : []),
    ],
    [canManageTrials, canReviewCalls],
  );

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

  if (!canManageTrials) return <DashboardPanel data={data} />;

  return (
    <div className="grid min-w-0 gap-5">
      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-4 border-b border-zinc-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-4 dark:border-zinc-800 dark:from-emerald-950/30 dark:to-zinc-950 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-emerald-700 text-white">
              <Bot size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Agente FUTSI · voz y WhatsApp
              </p>
              <h2 className="truncate text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                Agenda de pruebas gratuitas
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Cada reserva incluye las dos visitas a cancha.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-emerald-900/60 dark:bg-zinc-900 dark:text-zinc-200">
            <MessageCircle size={16} className="text-emerald-700 dark:text-emerald-300" />
            <span>{voiceData.whatsappConversations.length} conversaciones · {voiceData.voiceCalls.length} llamadas</span>
          </div>
        </div>
        <div className="overflow-x-auto p-2">
          <div className="flex min-w-max gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition ${
                    section === tab.key
                      ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  }`}
                  onClick={() => setSection(tab.key)}
                  type="button"
                >
                  <Icon size={16} />
                  {tab.label}
                  {tab.key === "calls" && pendingReviews > 0 ? (
                    <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-amber-950">
                      {pendingReviews}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {section === "summary" ? (
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <VoiceMetric label="Pruebas agendadas" value={voiceData.trialBookings.filter((item) => item.status === "scheduled").length} helper={`${voiceData.trialBookings.length} reservas totales`} />
            <VoiceMetric label="Visitas próximas" value={upcomingVisits.length} helper="Pendientes en cancha" />
            <VoiceMetric label="Llamadas por revisar" value={pendingReviews} helper={canReviewCalls ? "Requieren resultado manual" : "Solo visible a administración"} />
            <VoiceMetric label="Éxito revisado" value={`${successRate}%`} helper={`${reviewedCalls} llamadas clasificadas`} />
            <VoiceMetric label="WhatsApp" value={voiceData.whatsappConversations.length} helper={`${voiceData.whatsappConversations.filter((item) => item.follow_up_required).length} requieren seguimiento`} />
          </div>
          <DashboardPanel data={data} />
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
