import { useEffect, useState } from "react";
import { apiRequest } from "../../api";
import type { Charge } from "../../types";
import { money } from "../../utils/format";
import { inputClass, secondaryButtonClass, formatDateTime } from "./model";
import { ManualCollectionSend } from "./ManualCollectionSend";

export type CollectionRow = Charge & {
  overdue_days: number | null; stage: number; blocker: string; student_dropped: boolean;
  channels: string[];
  attempts?: Array<{ stage: number; state: string; created_at: string; detail: string; template_name: string }>;
  milestones: Array<{ day: number; label: string; date: string | null; reached: boolean }>;
  history: Array<{ message_id: number; conversation_id: number; created_at: string; business_address: string; body: string; label: string }>;
};
type CollectionReport = { as_of: string; automatic_sending_enabled: boolean; notice: string; rows: CollectionRow[] };
const stageNames = [[0, "Antes del primer recordatorio"], [7, "Semana 1 · Recordatorio"], [14, "Semana 2 · Segundo recordatorio"], [21, "Semana 3 · Revisión de baja"]] as const;

export function DebtCommunicationsPanel({ token, scopeQuery = "scope=all", onOpenDebts }: {
  token: string; scopeQuery?: string; onOpenDebts?: () => void;
}) {
  const [report, setReport] = useState<CollectionReport | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [stage, setStage] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedCharge, setExpandedCharge] = useState<number | null>(null);
  const [compose, setCompose] = useState<{ row: CollectionRow; stage: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setError(""); setCompose(null); setExpandedCharge(null);
    apiRequest<CollectionReport>(`/charges/communications/?${scopeQuery}`, token, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setReport(value); })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No se pudo cargar la cobranza."); });
    return () => controller.abort();
  }, [token, scopeQuery, retry]);
  const needle = search.trim().toLocaleLowerCase("es-MX");
  const rows = (report?.rows ?? []).filter(row => (stage === "all" || String(row.stage) === stage) &&
    [row.student_name, row.team_name, row.payer_name, row.payer_phone, row.concept, String(row.id)].some(value => value?.toLocaleLowerCase("es-MX").includes(needle)));
  return <div className="grid gap-4">
    <section className="comm-panel">
      <header className="comm-section-heading"><div><h3>Cobranza por WhatsApp</h3><p>Los saldos, vencimientos y pagos provienen de Adeudos. No se crean cargos duplicados.</p></div>
        {onOpenDebts && <button className={secondaryButtonClass} onClick={onOpenDebts}>Abrir Adeudos →</button>}
      </header>
      <div className="p-4 grid gap-3">
        <p className="text-sm">A los 7 días: primer recordatorio. A los 14: segundo recordatorio. A los 21: aviso de baja, sujeto a confirmar la baja. Se cuenta desde la fecha de vencimiento de cada cargo.</p>
        <p className="comm-reference">{report?.notice || "Esta vista no envía mensajes ni da de baja alumnos al abrirla."}</p>
        <p className="comm-muted">Corte: {report?.as_of || "…"} · Ciudad de México. Cobranza se agrupa por sede; si eliges un número, verás los cargos de su sede vinculada.</p>
      </div>
    </section>
    {error ? <div role="alert" className="comm-error">{error} <button className={secondaryButtonClass} onClick={() => setRetry(n => n + 1)}>Reintentar</button></div> : !report ? <p role="status">Consultando adeudos…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{stageNames.map(([day, label]) => <button key={day} aria-pressed={stage === String(day)} className="comm-metric" onClick={() => setStage(stage === String(day) ? "all" : String(day))}><span>{label}</span><strong>{report.rows.filter(row => row.stage === day).length}</strong><small>Cargos con saldo pendiente</small></button>)}</div>
      <div className="comm-toolbar"><input className={inputClass} type="search" aria-label="Buscar adeudo para comunicación" placeholder="Alumno, responsable, teléfono, concepto o cargo" value={search} onChange={e => setSearch(e.target.value)} /><button className={secondaryButtonClass} onClick={() => { setStage("all"); setSearch(""); }}>Ver todos</button><button className={secondaryButtonClass} onClick={() => setRetry(n => n + 1)}>Actualizar saldos</button></div>
      <p className="comm-muted">{rows.length} cargos · Saldo ${money(rows.reduce((sum, row) => sum + Number(row.balance), 0))}</p>
      {rows.map(row => <article className="comm-panel" key={row.id}>
        <header className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <h3 className="min-w-0 flex-1 basis-40 break-words text-sm font-semibold">{row.student_name || row.team_name || row.payer_name || "Cliente sin identificar"}</h3>
          <div className="text-sm"><span className="comm-muted">Debe </span><strong>${money(Number(row.balance))}</strong></div>
          <span className="text-sm">{row.overdue_days === null ? "Sin fecha de vencimiento" : `${row.overdue_days} ${row.overdue_days === 1 ? "día" : "días"} de atraso`}</span>
          <button className={secondaryButtonClass} aria-expanded={expandedCharge === row.id} aria-controls={`collection-detail-${row.id}`} aria-label={`${expandedCharge === row.id ? "Ocultar" : "Ver"} detalle de ${row.student_name || row.team_name || row.payer_name || `cargo ${row.id}`}`} onClick={() => setExpandedCharge(current => current === row.id ? null : row.id)}>{expandedCharge === row.id ? "Ocultar detalle" : "Ver detalle"}</button>
        </header>
        <div id={`collection-detail-${row.id}`} hidden={expandedCharge !== row.id}>
        <div className="p-4 grid gap-3">
          <p className="text-sm font-semibold">{row.site_name} · Cargo #{row.id} · {row.concept}</p>
          <p className="text-sm">{row.payer_name || "Sin responsable"} · {row.payer_phone || "Sin teléfono"} · Vencimiento: {row.due_date || "Sin fecha"} · {row.overdue_days === null ? "Sin antigüedad calculable" : `${row.overdue_days} días vencido`}</p>
          <p className="comm-muted">Números de la sede: {row.channels.length ? row.channels.map(value => value.replace("whatsapp:", "")).join(" · ") : "Sin número vinculado"}</p>
          <ol className="grid gap-2 sm:grid-cols-3">{row.milestones.map(item => {
            const attempt = row.attempts?.find(a => a.stage === item.day && a.state !== "rejected");
            const reason = attempt ? "Ya tiene un envío registrado o por confirmar" : !item.reached ? "Fecha aún no alcanzada" : !row.channels.length ? "Falta vincular un número" : !row.payer_phone ? "Falta teléfono del responsable" : item.day === 21 && !row.student_dropped ? "Primero confirma la baja" : row.blocker.includes("pago o descuento") ? row.blocker : "";
            return <li key={item.day} className="rounded-md border border-zinc-200 p-3 text-sm"><strong>{item.label}</strong><p>{item.date || "Falta vencimiento"}</p><small>{item.reached ? "Fecha alcanzada · no implica envío" : "Próxima etapa"}</small><button className={`${secondaryButtonClass} mt-2`} disabled={Boolean(reason)} onClick={() => setCompose({ row, stage: item.day })}>Preparar envío · {item.label}</button>{reason && <p className="comm-muted mt-1">{reason}</p>}</li>;
          })}</ol>
          {compose?.row.id === row.id && <ManualCollectionSend key={`${row.id}:${compose.stage}`} token={token} row={row} stage={compose.stage} onClose={() => setCompose(null)} onSent={() => { setCompose(null); setRetry(n => n + 1); }} />}
          {row.blocker && <p className="comm-reference">{row.blocker}</p>}
          {row.attempts?.map((attempt, i) => <p key={i} className="comm-reference">Etapa {attempt.stage} días · {attempt.template_name} · {({ accepted: "Aceptado por proveedor", rejected: "Rechazado; puedes corregir y reintentar", sending: "Envío en proceso o pendiente de confirmar; no reenviar", uncertain: "Resultado incierto; revisar con el proveedor antes de reenviar" } as Record<string, string>)[attempt.state] || attempt.state} · {formatDateTime(attempt.created_at)}{attempt.detail && ` · ${attempt.detail}`}</p>)}
          <details><summary className="cursor-pointer text-sm font-semibold">Historial registrado ({row.history.length})</summary>
            {row.history.length ? row.history.map(item => <div key={item.message_id} className="border-t border-zinc-200 py-3 text-sm"><p>{item.body}</p><small>{formatDateTime(item.created_at)} · {item.business_address.replace("whatsapp:", "")} · {item.label}</small></div>) : <p className="comm-muted py-3">No hay mensajes registrados para este cargo. No se asume que ya se enviaron recordatorios.</p>}
          </details>
        </div>
        </div>
      </article>)}
      {!rows.length && <p className="comm-empty">No hay cargos con saldo pendiente para esta selección.</p>}
    </>}
  </div>;
}
