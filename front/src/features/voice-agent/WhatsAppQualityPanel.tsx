import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Search } from "lucide-react";
import { apiRequest } from "../../api";
import { inputClass, secondaryButtonClass } from "./model";

const criteria = { courtesy: "Cortesía", seller: "Capacidad vendedora", commercial_initiative: "Proactividad", follow_up: "Seguimiento", useful_response: "Respuesta útil" };
type Criterion = keyof typeof criteria;
type Scores = Partial<Record<Criterion, number | null>>;
type Summary = Record<Criterion, { score: number | null; evaluated: number; requires_review: number }>;
type Result = { requires_review?: boolean; agent_name?: string; explanation?: string; improvements?: string[]; [key: string]: unknown };
type Evidence = { conversation_id: number; result: Result; messages: { id: number; at: string; direction: string; source: string; text: string }[] };
type Report = { analyzed_until: string | null; provisional: boolean; model: string[]; effort: string[]; eligible: number; status_counts: Record<string, number>; total: number; results: { conversation_id: number; site: string; status: string; scores: Scores; result: Result }[]; scores: Summary; score_method: string; evidence: Evidence | null;
  cost: { estimated_usd: number | null }; sites: { channel: string; site: string; eligible: number; completed: number; scores: Summary }[] };
const score = (value: number | null | undefined) => value == null ? "—" : `${value.toLocaleString("es-MX", { maximumFractionDigits: 1 })}/100`;
const label = (value: unknown) => typeof value === "string" ? value.replaceAll("_", " ") : "—";
const statusLabels: Record<string, string> = { failed: "Pendiente por error", running: "En análisis", pending: "Pendiente", skipped: "Revisión requerida" };

export function WhatsAppQualityPanel({ token, scopeQuery, week, onOpenConversation }: { token: string; scopeQuery: string; week: string; onOpenConversation: (id: number) => void }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false);
  const [criterion, setCriterion] = useState<Criterion>("seller");
  const [segment, setSegment] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [evidenceError, setEvidenceError] = useState("");
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const query = `${scopeQuery}&week_start=${week}${segment ? `&segment=${segment}` : ""}`;
  useEffect(() => {
    const update = () => setRefresh(value => value + 1);
    window.addEventListener("futsi:refresh-attention", update);
    return () => window.removeEventListener("futsi:refresh-attention", update);
  }, []);
  useEffect(() => { setOffset(0); setReport(null); setOpen(false); setSelected(null); }, [week, scopeQuery]);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    apiRequest<Report>(`/whatsapp-conversations/quality-audit/?${query}&offset=${offset}`, token, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setReport(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [token, query, offset, refresh]);
  useEffect(() => {
    setEvidence(null); setEvidenceError("");
    if (selected == null || !open) return;
    const controller = new AbortController();
    apiRequest<Report>(`/whatsapp-conversations/quality-audit/?${query}&conversation_id=${selected}`, token, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) { setEvidence(value.evidence); if (!value.evidence) setEvidenceError("Sin evidencia para este chat y corte."); } })
      .catch(reason => { if (!controller.signal.aborted) setEvidenceError(reason.message); });
    return () => controller.abort();
  }, [selected, token, query, open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), select, a[href], [tabindex='0']") ?? []);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keydown); trigger.current?.focus(); };
  }, [open]);
  const keys = Object.keys(criteria) as Criterion[];
  return <section className="comm-panel">
    <header className="comm-section-heading"><div><h3>Calidad de atención y venta</h3><p>{report?.analyzed_until ? `Corte ${new Date(report.analyzed_until).toLocaleString("es-MX")}` : "Auditoría semanal"}{report?.provisional ? " · Semana en curso" : ""}</p></div>
      <button ref={trigger} type="button" className={secondaryButtonClass} disabled={!report?.total} onClick={() => setOpen(true)}><Search size={16} /> Ver evidencia</button></header>
    <div className="comm-stats-body"><label>Tipo de contacto <select className={inputClass} value={segment} onChange={event => { setSegment(event.target.value); setOffset(0); setSelected(null); setReport(null); }}><option value="">Todos</option><option value="prospecto">Prospectos</option><option value="cliente_actual">Clientes actuales</option><option value="sin_interes_visible">Sin interés comercial</option><option value="no_evaluable">No evaluables</option></select></label></div>
    {error ? <p className="comm-error comm-stats-body" role="alert">{error}</p> : !report ? <p className="comm-stats-body" role="status">Consultando auditoría…</p> : !report.total ? <p className="comm-empty">Sin auditoría para este periodo o filtro.</p> : <>
      <div className="comm-stats-grid">{keys.map(key => <article key={key} className="comm-stat"><p>{criteria[key]}</p><strong>{score(report.scores[key]?.score)}</strong><small>{report.scores[key]?.evaluated || 0} evaluados · {report.scores[key]?.requires_review || 0} por revisar</small></article>)}</div>
      <div className="comm-stats-body">{report.status_counts.completed || 0} chats analizados{report.status_counts.failed ? ` · ${report.status_counts.failed} pendientes por error` : ""} · {report.model.join(" / ")} · {report.effort.includes("high") ? "esfuerzo alto" : report.effort.join(" / ")}{report.cost.estimated_usd != null && <span> · Costo estimado: US${report.cost.estimated_usd.toFixed(3)}</span>}</div>
      <div className="comm-table-wrap"><table className="comm-table"><thead><tr><th>Sede / número</th><th>Analizados</th>{keys.map(key => <th key={key}>{criteria[key]}</th>)}</tr></thead><tbody>{report.sites.map(site => <tr key={site.channel}><td>{site.site}<div className="comm-muted">{site.channel}</div></td><td>{site.completed} / {site.eligible}</td>{keys.map(key => <td key={key}>{score(site.scores[key]?.score)}</td>)}</tr>)}</tbody></table></div>
    </>}
    {open && createPortal(<div className="fixed inset-0 z-[1200] grid place-items-center bg-black/45 p-4" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="quality-evidence-title" className="flex max-h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-zinc-950">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b p-5"><h3 id="quality-evidence-title" className="text-lg font-semibold">Evidencia de la auditoría</h3><button type="button" className={secondaryButtonClass} aria-label="Cerrar evidencia" onClick={() => setOpen(false)}><X size={18} /></button></header>
        <div className="min-h-0 overflow-auto p-5"><label>Evaluación <select className={inputClass} value={criterion} onChange={event => setCriterion(event.target.value as Criterion)}>{keys.map(key => <option key={key} value={key}>{criteria[key]}</option>)}</select></label>
          <p className="comm-muted mt-4">{report?.score_method}</p>
          {error && <p className="comm-error" role="alert">{error}</p>}
          <div className="comm-table-wrap mt-4"><table className="comm-table"><thead><tr><th>Chat / responsable</th><th>Sede</th><th>{criteria[criterion]}</th><th>Resultado</th><th>Evidencia</th></tr></thead><tbody>{report?.results.map(row => <tr key={row.conversation_id}><td>#{row.conversation_id}<div>{row.result.agent_name || "Sin autor identificado"}</div></td><td>{row.site}</td><td>{score(row.scores[criterion])}</td><td>{row.status === "completed" ? label(row.result[criterion === "seller" ? "concrete_next_step" : criterion]) : statusLabels[row.status] || row.status}{row.result.requires_review && <div className="text-amber-700">Revisión requerida</div>}</td><td><button type="button" className="comm-link" disabled={row.status !== "completed"} aria-expanded={selected === row.conversation_id} onClick={() => setSelected(row.conversation_id)}>Ver motivo y mensajes</button></td></tr>)}</tbody></table></div>
          {selected != null && <section className="mt-5 rounded-xl border p-5" aria-live="polite"><h4 className="font-semibold">Chat #{selected}</h4>{evidenceError ? <p className="comm-error" role="alert">{evidenceError}</p> : !evidence ? <p>Consultando evidencia…</p> : <>
            <p className="mt-3 whitespace-pre-wrap">{evidence.result.explanation || "El proveedor no guardó una explicación textual."}</p>
            {evidence.result.improvements?.length ? <ul className="mt-3 list-disc pl-5">{evidence.result.improvements.map((text, index) => <li key={index}>{text}</li>)}</ul> : null}
            <div className="mt-4 space-y-3">{evidence.messages.map(message => <blockquote key={message.id} className="rounded-lg border-l-4 border-emerald-600 bg-zinc-50 p-3 dark:bg-zinc-900"><small>#{message.id} · {message.direction === "inbound" ? "Contacto" : message.source === "bot" ? "Bot" : "Equipo"} · {new Date(message.at).toLocaleString("es-MX")}</small><p className="mt-2 whitespace-pre-wrap break-words">{message.text}</p></blockquote>)}{!evidence.messages.length && <p className="comm-muted">Sin mensajes citados por el proveedor.</p>}</div>
            <button type="button" className={`${secondaryButtonClass} mt-4`} onClick={() => { setOpen(false); onOpenConversation(selected); }}>Abrir conversación completa</button>
          </>}</section>}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-4 border-t p-5"><button type="button" className={secondaryButtonClass} disabled={offset === 0} onClick={() => { setOffset(value => Math.max(0, value - 50)); setSelected(null); }}>Anterior</button><span>{report?.total ? `${offset + 1}–${Math.min(offset + 50, report.total)} de ${report.total}` : "0 chats"}</span><button type="button" className={secondaryButtonClass} disabled={!report || offset + 50 >= report.total} onClick={() => { setOffset(value => value + 50); setSelected(null); }}>Siguiente</button></footer>
      </div>
    </div>, document.body)}
  </section>;
}
