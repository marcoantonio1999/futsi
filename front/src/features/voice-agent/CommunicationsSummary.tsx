import type { AppData } from "../../types";
import { ArrowUpRight, CalendarDays, CheckCheck, Clock3, Flag, MessageCircle } from "lucide-react";
import { compareConversations, contactName, conversationAttention, lastMessage, messagePreview, nameNeedsReview, type AttentionFilter } from "./communicationUtils";
import { formatDateTime, type VoiceDashboardSection } from "./model";

export function CommunicationsSummary({ data, canReview, onNavigate, onOpenInbox, onOpenConversation, onOpenBooking }: {
  data: AppData; canReview: boolean; onNavigate: (section: VoiceDashboardSection) => void;
  onOpenInbox: (filter: AttentionFilter) => void; onOpenConversation: (id: number) => void; onOpenBooking: (id: number) => void;
}) {
  const contacts = data.whatsappConversations;
  const count = (key: AttentionFilter) => contacts.filter(c => conversationAttention(c).key === key).length;
  const pending = contacts.filter(c => ["needs_reply", "follow_up"].includes(conversationAttention(c).key)).sort(compareConversations);
  const visits = data.trialBookings.filter(b => b.status !== "canceled").flatMap(booking => booking.visits.map(visit => ({ booking, visit })))
    .filter(({ visit }) => visit.status === "scheduled" && new Date(visit.starts_at).getTime() >= Date.now())
    .sort((a, b) => a.visit.starts_at.localeCompare(b.visit.starts_at));
  const pendingCalls = data.voiceCalls.filter(c => c.review_outcome === "pending").length;
  return <div className="comm-summary">
    <div className="comm-metrics comm-attention-metrics" aria-label="Estado actual de las conversaciones">
      <button className={`comm-metric attention-red ${count("needs_reply") ? "has-attention" : ""}`} onClick={() => onOpenInbox("needs_reply")}><span><MessageCircle size={18} /> Nos toca responder</span><strong>{count("needs_reply")}</strong><small>El cliente espera al equipo</small></button>
      <button className="comm-metric attention-amber" onClick={() => onOpenInbox("follow_up")}><span><Flag size={18} /> Por revisar</span><strong>{count("follow_up")}</strong><small>Seguimientos y respuestas por verificar</small></button>
      <button className="comm-metric attention-blue" onClick={() => onOpenInbox("waiting_client")}><span><Clock3 size={18} /> Esperando al cliente</span><strong>{count("waiting_client")}</strong><small>El último mensaje fue nuestro</small></button>
      <button className="comm-metric attention-green" onClick={() => onOpenInbox("up_to_date")}><span><CheckCheck size={18} /> Sin pendientes</span><strong>{count("up_to_date")}</strong><small>Atendidos o flujos cerrados</small></button>
    </div>
    <div className="comm-summary-columns">
      <section className="comm-panel"><header className="comm-section-heading"><div><h3>Atender primero <span className="comm-count">{pending.length}</span></h3></div><button className="comm-link" onClick={() => onOpenInbox("all")}>Ver bandeja <ArrowUpRight size={16} /></button></header>
        {pending.slice(0, 6).map(c => {
          const attention = conversationAttention(c);
          return <button className={`comm-action-row comm-priority-row attention-${attention.tone}`} key={c.id} onClick={() => onOpenConversation(c.id)}>
            <span className="comm-avatar">{contactName(c).slice(0, 1).toUpperCase()}</span><span className="comm-row-main"><strong>{contactName(c)}</strong><span>{messagePreview(lastMessage(c))}</span><small>{c.follow_up_assigned_to_name ? `Asignado a ${c.follow_up_assigned_to_name}` : "Sin asignar"}{c.human_takeover_active ? " · Atención manual" : ""}{attention.turn === "client" ? " · Último mensaje nuestro" : ""}</small></span><span className={`comm-badge ${attention.tone}`}>{attention.label}</span>
          </button>;
        })}
        {!pending.length && <div className="comm-empty comm-all-clear"><CheckCheck size={28} /><strong>El equipo está al día</strong><p>No hay respuestas ni seguimientos pendientes registrados.</p></div>}
        {pending.length > 6 && <button className="comm-footer-link" onClick={() => onOpenInbox("all")}>Ver todos los contactos →</button>}
      </section>
      <section className="comm-panel"><header className="comm-section-heading"><div><h3>Próximas visitas <span className="comm-count">{visits.length}</span></h3></div><button className="comm-link" onClick={() => onNavigate("bookings")}>Ver agenda <ArrowUpRight size={16} /></button></header>
        {visits.slice(0, 5).map(({ booking, visit }) => <button className="comm-action-row" key={visit.id} onClick={() => onOpenBooking(booking.id)}><span className="comm-date-tile"><strong>{new Date(visit.starts_at).getDate()}</strong><small>{new Date(visit.starts_at).toLocaleDateString("es-MX", { month: "short" })}</small></span><span className="comm-row-main"><strong>{booking.child_first_name || "Nombre por confirmar"}</strong><span>{formatDateTime(visit.starts_at)}</span><small>{visit.site_name} · Visita {visit.visit_number}{nameNeedsReview(booking.child_first_name) ? " · Confirmar nombre" : ""}</small></span><ArrowUpRight size={16} /></button>)}
        {!visits.length && <div className="comm-empty"><CalendarDays size={26} /><strong>Sin visitas próximas</strong><button className="comm-link" onClick={() => onNavigate("availability")}>Consultar disponibilidad →</button></div>}
      </section>
    </div>
    {canReview && pendingCalls > 0 && <button className="comm-review-call" onClick={() => onNavigate("calls")}><Flag size={17} /><strong>{pendingCalls} llamadas por revisar</strong><span>Registrar resultado →</span></button>}
  </div>;
}
