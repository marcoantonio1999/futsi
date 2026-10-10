import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { apiRequest } from "../../api";
import type { WhatsAppWeeklyStats } from "../../types";
import { durationLabel, mondayKey, shiftWeek } from "./communicationUtils";
import { formatDateTime, inputClass, secondaryButtonClass } from "./model";
import { ContactClassificationPanel } from "./ContactClassificationPanel";
import { WhatsAppQualityPanel } from "./WhatsAppQualityPanel";

export function WhatsAppWeeklyStatsPanel({ value, token, onOpenConversation, scopeQuery = "scope=all", endpoint = '/whatsapp-conversations/weekly-stats/', showClassifications = true }: {
  value: WhatsAppWeeklyStats | null; token: string; onOpenConversation: (id: number) => void;
  scopeQuery?: string;
  endpoint?: string;
  showClassifications?: boolean;
}) {
  const currentWeek = value?.week_start ?? mondayKey();
  const [week, setWeek] = useState(currentWeek);
  const [result, setResult] = useState<{ week: string; scope: string; value: WhatsAppWeeklyStats; previous: WhatsAppWeeklyStats | null } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [comparisonError, setComparisonError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setComparisonError(false);
    const fetchWeek = (key: string) => apiRequest<WhatsAppWeeklyStats>(`${endpoint}?week_start=${key}&${scopeQuery}`, token, { signal: controller.signal });
    Promise.all([fetchWeek(week), week < currentWeek ? fetchWeek(shiftWeek(week, -1)).catch(err => { if (!controller.signal.aborted) setComparisonError(true); return null; }) : Promise.resolve(null)])
      .then(([next, previous]) => { if (!controller.signal.aborted) setResult({ week, scope: scopeQuery, value: next, previous }); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No se pudieron consultar las estadísticas."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [week, token, currentWeek, retry, scopeQuery, endpoint]);
  const currentResult = result?.week === week && result.scope === scopeQuery ? result : null;
  const stats = currentResult ? currentResult.value : week === currentWeek ? value : null;
  const previous = currentResult?.previous ?? null;
  const isCurrent = week === currentWeek;
  const summary = stats?.summary;
  const delta = summary?.average_response_seconds != null && previous?.summary.average_response_seconds != null ? summary.average_response_seconds - previous.summary.average_response_seconds : null;
  return <div className="grid min-w-0 gap-4" aria-busy={loading}>
    {showClassifications && <WhatsAppQualityPanel token={token} scopeQuery={scopeQuery} week={week} onOpenConversation={onOpenConversation} />}
    <div className="comm-toolbar"><div className="comm-inline comm-week-picker"><button className={secondaryButtonClass} aria-label="Semana anterior" onClick={() => setWeek(shiftWeek(week, -1))}><ArrowLeft size={16} /></button><label>Semana del <input aria-label="Elegir semana" className={inputClass} type="date" value={week} max={currentWeek} onChange={e => { if (e.target.value) setWeek(mondayKey(new Date(e.target.value + "T12:00:00"))); }} /></label><button className={secondaryButtonClass} aria-label="Semana siguiente" disabled={week >= currentWeek} onClick={() => setWeek(shiftWeek(week, 1))}><ArrowRight size={16} /></button>{!isCurrent && <button className="comm-link" onClick={() => setWeek(currentWeek)}>Semana actual</button>}</div><span className="comm-badge">{isCurrent ? "Semana en curso" : "Semana completa"}</span></div>
    {error && <div className="comm-reference" role="alert"><p className="comm-error">{error}</p><button className="comm-link" onClick={() => setRetry(n => n + 1)}>Volver a intentar</button></div>}
    {loading && <p className="comm-muted" role="status">Consultando periodo…</p>}
    {showClassifications && <ContactClassificationPanel token={token} scopeQuery={scopeQuery} />}
    {stats && summary ? <>
      <div className="comm-stats-grid">
        <Stat label="Solicitudes de atención" value={summary.total} helper="Una conversación puede generar varias solicitudes" />
        <Stat label="Sin primera respuesta humana" value={summary.unanswered} helper="Registro del periodo; no es la cola actual del equipo" />
        <Stat label="Primera respuesta promedio" value={durationLabel(summary.average_response_seconds)} helper={`Sobre ${summary.answered} solicitudes respondidas`} />
        <Stat label="Mediana de respuesta" value={durationLabel(summary.median_response_seconds)} helper="La mitad de las respuestas tardó este tiempo o menos" />
      </div>
      {!isCurrent && <div className="comm-reference">{comparisonError ? "No se pudo cargar la semana anterior para comparar." : delta == null ? "Sin suficientes respuestas en ambas semanas para comparar tiempos." : `Promedio ${durationLabel(Math.abs(delta))} ${delta < 0 ? "más rápido" : delta > 0 ? "más lento" : "de variación"} frente a la semana del ${previous!.week_start} (${previous!.summary.answered} respuestas).`}</div>}
      <section className="comm-panel"><header className="comm-section-heading"><div><h3>Atención por responsable</h3><p>Solicitudes respondidas y tiempo de primera respuesta.</p></div></header>{stats.by_responder.length ? <div className="comm-table-wrap"><table className="comm-table"><thead><tr><th>Responsable</th><th>Respondidas</th><th>Promedio</th><th>Mediana</th></tr></thead><tbody>{stats.by_responder.map(item => <tr key={item.key}><td>{item.name}</td><td>{item.answered}</td><td>{durationLabel(item.average_response_seconds)}</td><td>{durationLabel(item.median_response_seconds)}</td></tr>)}</tbody></table></div> : <div className="comm-empty">Todavía no hay respuestas humanas registradas.</div>}</section>
      <section className="comm-panel"><header className="comm-section-heading"><div><h3>Histórico de primera respuesta humana</h3><p>Todas las solicitudes del periodo, ordenadas de la espera más larga a la más corta. Un contacto puede aparecer más de una vez.</p></div></header><div className="comm-table-wrap comm-response-history"><table className="comm-table"><thead><tr><th>Contacto</th><th>Solicitud</th><th>Tiempo</th><th>Primera respuesta humana</th></tr></thead><tbody>{stats.longest_waits.map(item => <tr key={item.id}><td><button className="comm-link" onClick={() => onOpenConversation(item.conversation_id)}>{item.contact_name || item.contact_phone} ↗</button></td><td>{formatDateTime(item.first_inbound_at)}</td><td>{durationLabel(item.response_seconds)}</td><td>{item.responded_at ? formatDateTime(item.responded_at) : "Sin registro humano"}</td></tr>)}</tbody></table>{!stats.longest_waits.length && <p className="comm-empty">Sin solicitudes registradas.</p>}</div></section>
    </> : !loading && !error && <div className="comm-empty">No hay estadísticas disponibles.</div>}
  </div>;
}
function Stat({ label, value, helper }: { label: string; value: string | number; helper: string }) { return <article className="comm-panel comm-stat"><p>{label}</p><strong>{value}</strong><small>{helper}</small></article>; }
