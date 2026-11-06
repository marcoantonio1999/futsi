import { useEffect, useState } from "react";
import { apiRequest } from "../../api";
import { secondaryButtonClass } from "./model";

type Finding = { conversation_id: number; channel: string; channel_label: string; category: string; period_end: string; evidence_message_ids: number[] };
type Report = { counts: Record<string, number>; findings: Finding[]; period_end: string | null; bridge_label: string };

export function WhatsAppBridgePanel({ token, scopeQuery, onOpenConversation }: { token: string; scopeQuery: string; onOpenConversation: (id: number) => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setError("");
    apiRequest<Report>(`/whatsapp-conversations/bridge-audit/?${scopeQuery}`, token, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setReport(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [token, scopeQuery]);
  return <section className="comm-panel" aria-label="Análisis de puentes">
    <header className="comm-section-heading"><div><h3>Invitación a jugar en puentes</h3><p>Puentes laborales oficiales · Liga Franco y Liga Teca</p></div></header>
    <div className="comm-stats-body">
      {error ? <p className="comm-error" role="alert">No se pudo consultar el análisis: {error}</p> : !report ? <p role="status">Consultando análisis…</p> : <>
        {Object.keys(report.counts).length === 0 ? <p>Sin análisis de puentes disponible todavía.</p> : <>
          <p className="comm-muted">{report.bridge_label || "Puente laboral"} · corte {report.period_end ? new Date(report.period_end).toLocaleDateString("es-MX") : "—"}</p>
          <p>{report.counts.invitation || 0} invitaciones · {report.counts.missed_opportunity || 0} oportunidades sin invitación · {report.counts.discouraged || 0} posibles casos de desaliento</p>
          <p className="comm-muted">{report.counts.not_applicable || 0} no aplican · {report.counts.insufficient_evidence || 0} sin evidencia suficiente · {report.counts.failed || 0} con error</p>
          {report.findings.length > 0 && <ul>{report.findings.map(item => <li key={item.conversation_id} className="flex flex-wrap items-center gap-3 py-2"><span>{item.channel_label} · Chat #{item.conversation_id}: {item.category === "discouraged" ? "posible desaliento" : "oportunidad sin invitación"}</span><button type="button" className={secondaryButtonClass} style={{ minHeight: 44 }} onClick={() => onOpenConversation(item.conversation_id)}>Ver chat y evidencia</button></li>)}</ul>}
        </>}
      </>}
    </div>
  </section>;
}
