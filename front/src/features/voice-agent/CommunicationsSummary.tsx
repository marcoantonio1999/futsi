import type { AppData } from "../../types";
import { CheckCheck, Clock3, Flag, MessageCircle } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { conversationAttention, type AttentionFilter } from "./communicationUtils";
import { buildMonthlyMessageTrend } from "./communicationsSummaryModel";
import type { VoiceDashboardSection } from "./model";

export function CommunicationsSummary({ data, canReview, onNavigate, onOpenInbox }: {
  data: AppData; canReview: boolean; onNavigate: (section: VoiceDashboardSection) => void;
  onOpenInbox: (filter: AttentionFilter) => void;
}) {
  const contacts = data.whatsappConversations;
  const count = (key: AttentionFilter) => contacts.filter(c => conversationAttention(c).key === key).length;
  const monthlyTrend = buildMonthlyMessageTrend(contacts);
  const pendingCalls = data.voiceCalls.filter(c => c.review_outcome === "pending").length;
  return <div className="comm-summary">
    <div className="comm-metrics comm-attention-metrics" aria-label="Estado actual de las conversaciones">
      <button className={`comm-metric attention-red ${count("needs_reply") ? "has-attention" : ""}`} onClick={() => onOpenInbox("needs_reply")}><span><MessageCircle size={18} /> Nos toca responder</span><strong>{count("needs_reply")}</strong></button>
      <button className="comm-metric attention-amber" onClick={() => onOpenInbox("follow_up")}><span><Flag size={18} /> Por revisar</span><strong>{count("follow_up")}</strong></button>
      <button className="comm-metric attention-blue" onClick={() => onOpenInbox("waiting_client")}><span><Clock3 size={18} /> Esperando al cliente</span><strong>{count("waiting_client")}</strong></button>
      <button className="comm-metric attention-green" onClick={() => onOpenInbox("up_to_date")}><span><CheckCheck size={18} /> Sin pendientes</span><strong>{count("up_to_date")}</strong></button>
    </div>
    <section className="comm-panel comm-monthly-chart">
      <header className="comm-section-heading"><div><h3>Mensajes por mes</h3><p>Actividad de los últimos seis meses para la sede y el número seleccionados.</p></div></header>
      <div className="comm-chart-area" role="img" aria-label="Gráfica mensual de mensajes recibidos, respuestas enviadas, mensajes esperando respuesta y mensajes atendidos">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={monthlyTrend} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--comm-line)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--comm-muted)" }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} width={36} tick={{ fontSize: 11, fill: "var(--comm-muted)" }} axisLine={false} tickLine={false} />
            <Tooltip content={<MonthlyMessageTooltip />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
            <Line type="monotone" dataKey="received" name="Recibidos" stroke="#3979d5" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="replied" name="Respuestas enviadas" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="waiting" name="Esperando respuesta" stroke="#d83b2b" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="attended" name="Atendidos" stroke="#2b9656" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
    {canReview && pendingCalls > 0 && <button className="comm-review-call" onClick={() => onNavigate("calls")}><Flag size={17} /><strong>{pendingCalls} llamadas por revisar</strong><span>Registrar resultado →</span></button>}
  </div>;
}

function MonthlyMessageTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="comm-chart-tooltip"><strong>{label}</strong>{payload.map(item => <span key={item.name}><i style={{ background: item.color }} />{item.name}<b>{item.value ?? 0}</b></span>)}</div>;
}
