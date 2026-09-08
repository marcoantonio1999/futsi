import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Clock3 } from "lucide-react";
import { apiRequest } from "../../api";
import type { WhatsAppConversation, WhatsAppWeeklyStats } from "../../types";
import { compareConversations, contactName, conversationAttention, durationLabel, mondayKey, shiftWeek } from "./communicationUtils";
import { formatDateTime, inputClass, secondaryButtonClass } from "./model";

export function WhatsAppWeeklyStatsPanel({ value, token, conversations, onOpenConversation }: {
  conversations: WhatsAppConversation[]; value: WhatsAppWeeklyStats | null; token: string; onOpenConversation: (id: number) => void;
}) {
  const currentWeek = value?.week_start ?? mondayKey();
  const [week, setWeek] = useState(currentWeek);
  const [result, setResult] = useState<{ week: string; value: WhatsAppWeeklyStats; previous: WhatsAppWeeklyStats | null } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [reference, setReference] = useState<5 | 10 | 30 | 60>(10);
  const [comparisonError, setComparisonError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setComparisonError(false);
    const fetchWeek = (key: string) => apiRequest<WhatsAppWeeklyStats>(`/whatsapp-conversations/weekly-stats/?week_start=${key}`, token, { signal: controller.signal });
    Promise.all([fetchWeek(week), week < currentWeek ? fetchWeek(shiftWeek(week, -1)).catch(err => { if (!controller.signal.aborted) setComparisonError(true); return null; }) : Promise.resolve(null)])
      .then(([next, previous]) => { if (!controller.signal.aborted) setResult({ week, value: next, previous }); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No se pudieron consultar las estadísticas."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [week, token, currentWeek, retry]);
  const stats = result?.week === week ? result.value : week === currentWeek ? value : null;
  const previous = result?.week === week ? result.previous : null;
  const isCurrent = week === currentWeek;
  const summary = stats?.summary;
  const delta = summary?.average_response_seconds != null && previous?.summary.average_response_seconds != null ? summary.average_response_seconds - previous.summary.average_response_seconds : null;
  const pending = conversations.filter(c => conversationAttention(c).key === "needs_reply").sort(compareConversations);
  return <div className="grid min-w-0 gap-4" aria-busy={loading}>
    <div className="comm-toolbar"><div className="comm-inline comm-week-picker"><button className={secondaryButtonClass} aria-label="Semana anterior" onClick={() => setWeek(shiftWeek(week, -1))}><ArrowLeft size={16} /></button><label>Semana del <input aria-label="Elegir semana" className={inputClass} type="date" value={week} max={currentWeek} onChange={e => { if (e.target.value) setWeek(mondayKey(new Date(e.target.value + "T12:00:00"))); }} /></label><button className={secondaryButtonClass} aria-label="Semana siguiente" disabled={week >= currentWeek} onClick={() => setWeek(shiftWeek(week, 1))}><ArrowRight size={16} /></button>{!isCurrent && <button className="comm-link" onClick={() => setWeek(currentWeek)}>Semana actual</button>}</div><span className="comm-badge">{isCurrent ? "Semana en curso" : "Semana completa"}</span></div>
    {error && <div className="comm-reference" role="alert"><p className="comm-error">{error}</p><button className="comm-link" onClick={() => setRetry(n => n + 1)}>Volver a intentar</button></div>}
    {loading && <p className="comm-muted" role="status">Consultando periodo…</p>}
    {stats && summary ? <>
      <p className="comm-muted">Del {stats.week_start} al {stats.week_end} · Ciudad de México · Corte: {formatDateTime(stats.generated_at)}</p>
      <div className="comm-stats-grid">
        <Stat label="Solicitudes de atención" value={summary.total} helper="Una conversación puede generar varias solicitudes" />
        <Stat label="Sin primera respuesta humana" value={summary.unanswered} helper="Registro del periodo; no es la cola actual del equipo" />
        <Stat label="Primera respuesta promedio" value={durationLabel(summary.average_response_seconds)} helper={`Sobre ${summary.answered} solicitudes respondidas`} />
        <Stat label="Mediana de respuesta" value={durationLabel(summary.median_response_seconds)} helper="La mitad de las respuestas tardó este tiempo o menos" />
      </div>
      <div className="comm-reference">{isCurrent ? "Semana en curso: no se compara con una semana completa. Selecciona una semana anterior para ver la variación." : comparisonError ? "No se pudo cargar la semana anterior para comparar." : delta == null ? "Sin suficientes respuestas en ambas semanas para comparar tiempos." : `Promedio ${durationLabel(Math.abs(delta))} ${delta < 0 ? "más rápido" : delta > 0 ? "más lento" : "de variación"} frente a la semana del ${previous!.week_start} (${previous!.summary.answered} respuestas).`} Los promedios excluyen solicitudes sin responder.</div>
      {isCurrent && <section className="comm-panel"><header className="comm-section-heading"><div><h3>Nos toca responder ahora <span className="comm-count">{pending.length}</span></h3><p>Último intercambio registrado, independientemente de la semana de inicio.</p></div><Clock3 size={19} /></header>
        {pending.slice(0, 6).map(c => <button className="comm-action-row comm-priority-row attention-red" key={c.id} onClick={() => onOpenConversation(c.id)}><span className="comm-row-main"><strong>{contactName(c)}</strong><span>Cliente: {formatDateTime(conversationAttention(c).since)}</span><small>{c.human_takeover_active ? "Atención manual · Asistente pausado" : "Sin respuesta posterior registrada"}</small></span><span className="comm-badge red">Nos toca responder</span><ArrowUpRight size={16} /></button>)}
        {!pending.length && <div className="comm-empty comm-all-clear"><strong>Sin respuestas pendientes del equipo</strong></div>}
        {pending.length > 6 && <p className="comm-muted p-4">Mostrando 6 de {pending.length}. Consulta la bandeja para ver el resto.</p>}
      </section>}
      <div className="comm-summary-columns">
        <section className="comm-panel"><header className="comm-section-heading"><div><h3>Rapidez de atención</h3><p>Porcentaje sobre todas las solicitudes, incluidas las pendientes.</p></div></header><div className="comm-stats-body"><label className="comm-toolbar">Referencia de respuesta <select aria-label="Referencia de respuesta" className={inputClass} style={{ width: "auto" }} value={reference} onChange={e => setReference(Number(e.target.value) as typeof reference)}>{[5, 10, 30, 60].map(n => <option key={n} value={n}>{n} minutos</option>)}</select></label>{[["Total", summary], ["En horario laboral", stats.business_hours], ["Fuera de horario", stats.outside_business_hours]].map(([label, raw]) => { const group = raw as typeof summary; const percentage = group[`within_${reference}_minutes_percent`]; return <div key={String(label)}><div className="comm-toolbar"><span className="text-xs">{String(label)}</span><strong className="text-xs">{group.total ? `${percentage}%` : "Sin datos"}</strong></div><div className="comm-progress"><span style={{ width: `${group.total ? Math.max(0, Math.min(100, percentage)) : 0}%` }} /></div><small className="comm-muted">{group.answered} respondidas de {group.total} · Promedio {durationLabel(group.average_response_seconds)}</small></div>; })}<small className="comm-muted">Referencia de análisis; no representa un compromiso de servicio configurado.</small></div></section>
        <section className="comm-panel"><header className="comm-section-heading"><div><h3>Clasificación de mensajes</h3><p>Mensajes recibidos durante el periodo, no personas únicas.</p></div></header><div className="comm-stats-body">{[["Prospectos", stats.classifications.prospect], ["Clientes actuales", stats.classifications.current_client], ["Por confirmar", stats.classifications.ambiguous]].map(([label, count]) => <div className="comm-toolbar" key={label}><span className="text-sm">{label}</span><strong>{count}</strong></div>)}<p className="comm-muted">La clasificación describe la interpretación del asistente. Revisa el contexto del chat antes de decidir.</p></div></section>
      </div>
      <section className="comm-panel"><header className="comm-section-heading"><div><h3>Atención por responsable</h3><p>Solicitudes respondidas y tiempo de primera respuesta.</p></div></header>{stats.by_responder.length ? <div className="comm-table-wrap"><table className="comm-table"><thead><tr><th>Responsable</th><th>Respondidas</th><th>Promedio</th><th>Mediana</th></tr></thead><tbody>{stats.by_responder.map(item => <tr key={item.key}><td>{item.name}</td><td>{item.answered}</td><td>{durationLabel(item.average_response_seconds)}</td><td>{durationLabel(item.median_response_seconds)}</td></tr>)}</tbody></table></div> : <div className="comm-empty">Todavía no hay respuestas humanas registradas.</div>}</section>
      <details className="comm-panel"><summary className="cursor-pointer p-4 text-sm font-semibold">Histórico de primera respuesta humana · 10 esperas más largas</summary><div className="comm-table-wrap"><table className="comm-table"><thead><tr><th>Contacto</th><th>Solicitud</th><th>Tiempo</th><th>Primera respuesta humana</th></tr></thead><tbody>{stats.longest_waits.map(item => <tr key={item.id}><td><button className="comm-link" onClick={() => onOpenConversation(item.conversation_id)}>{item.contact_name || item.contact_phone} ↗</button></td><td>{formatDateTime(item.first_inbound_at)}</td><td>{durationLabel(item.response_seconds)}</td><td>{item.responded_at ? formatDateTime(item.responded_at) : "Sin registro humano"}</td></tr>)}</tbody></table>{!stats.longest_waits.length && <p className="comm-empty">Sin solicitudes registradas.</p>}</div></details>
    </> : !loading && !error && <div className="comm-empty">No hay estadísticas disponibles.</div>}
  </div>;
}
function Stat({ label, value, helper }: { label: string; value: string | number; helper: string }) { return <article className="comm-panel comm-stat"><p>{label}</p><strong>{value}</strong><small>{helper}</small></article>; }
