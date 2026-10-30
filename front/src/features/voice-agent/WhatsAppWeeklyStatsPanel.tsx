import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { apiRequest } from "../../api";
import type { WhatsAppWeeklyStats } from "../../types";
import { durationLabel, localDateKey, mondayKey, shiftDays } from "./communicationUtils";
import { formatDateTime, inputClass, secondaryButtonClass } from "./model";
import { responseTimeTone, type ResponseTimeTone } from "./responseTimeTone";

export function WhatsAppWeeklyStatsPanel({ value, token, onOpenConversation, scopeQuery = "scope=all", endpoint = '/whatsapp-conversations/weekly-stats/', showPeriodControls = true, periodDays = 7, periodStart, onPeriodStartChange }: {
  value: WhatsAppWeeklyStats | null; token: string; onOpenConversation: (id: number) => void;
  scopeQuery?: string;
  endpoint?: string;
  showClassifications?: boolean;
  showPeriodControls?: boolean;
  periodDays?: number; periodStart?: string; onPeriodStartChange?: (start: string) => void;
}) {
  const currentWeek = periodDays === 7 ? mondayKey() : shiftDays(localDateKey(new Date()), 1 - periodDays);
  const [localStart, setLocalStart] = useState(currentWeek);
  const week = periodStart ?? localStart;
  const setWeek = onPeriodStartChange ?? setLocalStart;
  const [result, setResult] = useState<{ week: string; days: number; scope: string; value: WhatsAppWeeklyStats; previous: WhatsAppWeeklyStats | null } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [comparisonError, setComparisonError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setComparisonError(false);
    const fetchWeek = async (key: string) => {
      const response = await apiRequest<WhatsAppWeeklyStats>(`${endpoint}?week_start=${key}&period_days=${periodDays}&${scopeQuery}`, token, { signal: controller.signal });
      if ((response.period_days ?? 7) !== periodDays) throw new Error("La API necesita actualizarse para consultar este periodo.");
      return response;
    };
    Promise.all([fetchWeek(week), week < currentWeek ? fetchWeek(shiftDays(week, -periodDays)).catch(err => { if (!controller.signal.aborted) setComparisonError(true); return null; }) : Promise.resolve(null)])
      .then(([next, previous]) => { if (!controller.signal.aborted) setResult({ week, days: periodDays, scope: scopeQuery, value: next, previous }); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No se pudieron consultar las estadísticas."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [week, periodDays, token, currentWeek, retry, scopeQuery, endpoint]);
  const currentResult = result?.week === week && result.days === periodDays && result.scope === scopeQuery ? result : null;
  const stats = currentResult ? currentResult.value : periodDays === 7 && value?.week_start === week ? value : null;
  const previous = currentResult?.previous ?? null;
  const isCurrent = week === currentWeek;
  const summary = stats?.summary;
  const delta = summary?.average_response_seconds != null && previous?.summary.average_response_seconds != null ? summary.average_response_seconds - previous.summary.average_response_seconds : null;
  return <div className="grid min-w-0 gap-4" aria-busy={loading}>
    {showPeriodControls && <div className="comm-toolbar"><div className="comm-inline comm-week-picker"><button className={secondaryButtonClass} aria-label="Periodo anterior" onClick={() => setWeek(shiftDays(week, -periodDays))}><ArrowLeft size={16} /></button><label>{periodDays === 7 ? "Semana del" : "Desde"} <input aria-label="Inicio del periodo" className={inputClass} type="date" value={week} max={currentWeek} onChange={e => { if (e.target.value) setWeek(periodDays === 7 ? mondayKey(new Date(e.target.value + "T12:00:00")) : e.target.value); }} /></label><span>al {shiftDays(week, periodDays - 1)}</span><button className={secondaryButtonClass} aria-label="Periodo siguiente" disabled={week >= currentWeek} onClick={() => setWeek(shiftDays(week, periodDays) > currentWeek ? currentWeek : shiftDays(week, periodDays))}><ArrowRight size={16} /></button>{!isCurrent && <button className="comm-link" onClick={() => setWeek(currentWeek)}>Periodo actual</button>}</div><span className="comm-badge">{isCurrent ? "Periodo en curso" : "Periodo completo"}</span></div>}
    {error && <div className="comm-reference" role="alert"><p className="comm-error">{error}</p><button className="comm-link" onClick={() => setRetry(n => n + 1)}>Volver a intentar</button></div>}
    {loading && <p className="comm-muted" role="status">Consultando periodo…</p>}
    {stats && summary ? <>
      <div className="comm-stats-grid">
        <Stat label="Solicitudes de atención" value={summary.total} helper="Una conversación puede generar varias solicitudes" />
        <Stat label="Sin primera respuesta humana" value={summary.unanswered} tone={summary.unanswered > 0 ? "red" : "green"} helper="Registro del periodo; no es la cola actual del equipo" />
        <Stat label="Primera respuesta promedio" value={durationLabel(summary.average_response_seconds)} tone={responseTimeTone(summary.average_response_seconds)} helper={`Sobre ${summary.answered} solicitudes respondidas`} />
        <Stat label="Mediana de respuesta" value={durationLabel(summary.median_response_seconds)} tone={responseTimeTone(summary.median_response_seconds)} helper="La mitad de las respuestas tardó este tiempo o menos" />
      </div>
      {!isCurrent && <div className="comm-reference">{comparisonError ? "No se pudo cargar el periodo anterior para comparar." : delta == null ? "Sin suficientes respuestas en ambos periodos para comparar tiempos." : `Promedio ${durationLabel(Math.abs(delta))} ${delta < 0 ? "más rápido" : delta > 0 ? "más lento" : "de variación"} frente al periodo del ${previous!.week_start} (${previous!.summary.answered} respuestas).`}</div>}
      <section className="comm-panel"><header className="comm-section-heading"><div><h3>Atención por responsable</h3><p>Solicitudes respondidas y tiempo de primera respuesta.</p></div></header>{stats.by_responder.length ? <div className="comm-table-wrap"><table className="comm-table"><thead><tr><th>Responsable</th><th>Respondidas</th><th>Promedio</th><th>Mediana</th></tr></thead><tbody>{stats.by_responder.map(item => <tr key={item.key}><td>{item.name}</td><td>{item.answered}</td><td><Time seconds={item.average_response_seconds} /></td><td><Time seconds={item.median_response_seconds} /></td></tr>)}</tbody></table></div> : <div className="comm-empty">Todavía no hay respuestas humanas registradas.</div>}</section>
      <section className="comm-panel"><header className="comm-section-heading"><div><h3>Histórico de primera respuesta humana</h3><p>Todas las solicitudes del periodo, ordenadas de la espera más larga a la más corta. Un contacto puede aparecer más de una vez.</p><p>Verde: hasta 20 min · Amarillo: de 20 min a 1 h · Rojo: más de 1 h o sin respuesta humana.</p></div></header><div className="comm-table-wrap comm-response-history"><table className="comm-table"><thead><tr><th>Contacto</th><th scope="col">Teléfono</th><th>Solicitud</th><th>Tiempo</th><th>Primera respuesta humana</th></tr></thead><tbody>{stats.longest_waits.map(item => <tr key={item.id}><td><button className="comm-link" onClick={() => onOpenConversation(item.conversation_id)}>{item.contact_name || item.contact_phone} ↗</button></td><td className="whitespace-nowrap tabular-nums">{item.contact_phone?.trim() || "—"}</td><td>{formatDateTime(item.first_inbound_at)}</td><td><Time seconds={item.response_seconds} unanswered={!item.responded_at} historical /></td><td>{item.responded_at ? formatDateTime(item.responded_at) : <span className="comm-response-time comm-response-red">Sin registro humano</span>}</td></tr>)}</tbody></table>{!stats.longest_waits.length && <p className="comm-empty">Sin solicitudes registradas.</p>}</div></section>
    </> : !loading && !error && <div className="comm-empty">No hay estadísticas disponibles.</div>}
  </div>;
}
function Stat({ label, value, helper, tone = "neutral" }: { label: string; value: string | number; helper: string; tone?: ResponseTimeTone }) { return <article className={`comm-panel comm-stat comm-response-card comm-response-${tone}`}><p>{label}</p><strong>{value}</strong><small>{helper}</small></article>; }
function Time({ seconds, unanswered = false, historical = false }: { seconds: number | null; unanswered?: boolean; historical?: boolean }) {
  return <span className={`comm-response-time comm-response-${responseTimeTone(seconds, unanswered, historical)}`}>{durationLabel(seconds)}</span>;
}
