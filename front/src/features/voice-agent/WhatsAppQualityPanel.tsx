import { useEffect, useState } from "react";
import { apiRequest } from "../../api";

type AuditRow = { conversation_id: number; site: string; status: string; model: string; result: { agent_name?: string; useful_response?: string; commercial_initiative?: string; concrete_next_step?: string; follow_up?: string; explanation?: string; improvements?: string[] } };
type Report = { analyzed_until: string | null; provisional: boolean; model: string[]; effort: string[]; eligible: number; status_counts: Record<string, number>; total: number; results: AuditRow[]; sites: { channel: string; site: string; eligible: number; completed: number; failed: number; skipped: number; proactive: number; insufficient: number }[] };
const label = (value?: string) => value ? value.replaceAll("_", " ") : "—";

export function WhatsAppQualityPanel({ token, scopeQuery, week, onOpenConversation }: { token: string; scopeQuery: string; week: string; onOpenConversation: (id: number) => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  useEffect(() => { setOffset(0); }, [week, scopeQuery]);
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setReport(null);
    apiRequest<Report>(`/whatsapp-conversations/quality-audit/?${scopeQuery}&week_start=${week}&offset=${offset}`, token, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setReport(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [token, scopeQuery, week, offset]);
  return <section className="comm-panel">
    <header className="comm-section-heading"><div><h3>Calidad comercial de los chats</h3><p>{report?.model.length ? report.model.join(" / ") : "Luna 6"} · esfuerzo {report?.effort.includes("high") ? "alto" : report?.effort.join(" / ") || "alto"}{report?.analyzed_until ? ` · Corte ${new Date(report.analyzed_until).toLocaleString("es-MX")}${report.provisional ? " · Semana en curso" : ""}` : ""}</p></div></header>
    {error ? <p className="comm-error comm-stats-body" role="alert">{error}</p> : !report ? <p className="comm-stats-body" role="status">Consultando auditoría…</p> : !report.total ? <p className="comm-empty">Sin auditoría guardada para esta semana.</p> : <>
      <div className="comm-stats-body"><strong>{report.status_counts.completed || 0} de {report.eligible} chats analizados</strong>{!!report.status_counts.failed && <span> · {report.status_counts.failed} pendientes por error</span>}{!!report.status_counts.skipped && <span> · {report.status_counts.skipped} requieren revisión</span>}</div>
      <div className="comm-table-wrap"><table className="comm-table"><thead><tr><th>Sede / número</th><th>Analizados</th><th>Proactivos</th><th>Respuesta insuficiente</th></tr></thead><tbody>{report.sites.map(site => <tr key={site.channel}><td>{site.site}<div className="comm-muted">{site.channel}</div></td><td>{site.completed} / {site.eligible}</td><td>{site.proactive}</td><td>{site.insufficient}</td></tr>)}</tbody></table></div>
      <div className="comm-table-wrap" style={{ maxHeight: 420, overflow: "auto" }}><table className="comm-table"><thead><tr><th>Chat / responsable</th><th>Sede</th><th>Respuesta</th><th>Iniciativa</th><th>Siguiente paso</th><th>Seguimiento</th><th>Evidencia y mejora</th></tr></thead><tbody>{report.results.map(row => <tr key={row.conversation_id}><td><button className="comm-link" onClick={() => onOpenConversation(row.conversation_id)}>#{row.conversation_id} ↗</button><div>{row.result.agent_name || "Sin autor identificado"}</div></td><td>{row.site}</td><td>{row.status === "completed" ? label(row.result.useful_response) : label(row.status)}</td><td>{label(row.result.commercial_initiative)}</td><td>{label(row.result.concrete_next_step)}</td><td>{label(row.result.follow_up)}</td><td style={{ minWidth: 280 }}>{row.result.explanation}<div>{row.result.improvements?.join(" · ")}</div></td></tr>)}</tbody></table></div>
      <div className="comm-toolbar" style={{ padding: 16, gap: 16 }}><button className="comm-link" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Anterior</button><span>{offset + 1}–{Math.min(offset + 50, report.total)} de {report.total}</span><button className="comm-link" disabled={offset + 50 >= report.total} onClick={() => setOffset(value => value + 50)}>Siguiente</button></div>
    </>}
  </section>;
}
