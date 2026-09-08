import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { apiRequest } from "../../api";
import type { AppData, DashboardSummary, TabKey } from "../../types";
import { money } from "../../utils/format";
import { DashboardMetrics } from "../cards/DashboardMetrics";
import { CollectionFunnel } from "../charts/CollectionFunnel";
import { FinancialComboChart } from "../charts/FinancialComboChart";
import { PaymentMethodDonut } from "../charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../charts/PendingBySiteChart";
import { StudentStatusDonut } from "../charts/StudentStatusDonut";
import { SitesMap } from "./dashboardMap";
import "./dashboard.css";

export { SitesMap };

function monthLabel(month: string) {
  return new Date(month + "-01T12:00:00").toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

export function DashboardPanel({ data, token, onNavigate, availableSections = [] }: {
  data: AppData; token: string; onNavigate?: (tab: TabKey) => void; availableSections?: TabKey[];
}) {
  const [month, setMonth] = useState("all");
  const [site, setSite] = useState("all");
  const [view, setView] = useState("finances");
  const [result, setResult] = useState<{ key: string; baseline: typeof data.dashboardSummary; summary: DashboardSummary } | null>(null);
  const [failure, setFailure] = useState("");
  const [retry, setRetry] = useState(0);
  const key = site + "/" + month;
  const baseline = data.dashboardSummary;
  const summary = site === "all" && month === "all" && baseline
    ? baseline
    : result?.key === key && result.baseline === baseline ? result.summary : null;
  useEffect(() => {
    setFailure("");
    if (site === "all" && month === "all" && baseline) return;
    const controller = new AbortController();
    apiRequest<DashboardSummary>("/dashboard/summary/?" + new URLSearchParams({ site, month }), token, { signal: controller.signal })
      .then((value) => setResult({ key, baseline, summary: value }))
      .catch((error: Error) => { if (!controller.signal.aborted) setFailure(error.message); });
    return () => controller.abort();
  }, [baseline, key, month, site, token, retry]);
  const period = month === "all" ? "Todo el historial" : monthLabel(month);
  const months = baseline?.context?.available_months ?? [...new Set(baseline?.monthly_rows.map(row => row.month) ?? [])].sort();
  const canNavigate = (tab: TabKey) => Boolean(onNavigate && availableSections.includes(tab));
  const action = (tab: TabKey, label: string) => canNavigate(tab)
    ? <button type="button" className="dashboard-action" onClick={() => onNavigate?.(tab)}>{label}<ArrowUpRight size={15} aria-hidden="true" /></button> : null;

  return (
    <div className="dashboard-workspace grid min-w-0 gap-5 pt-5">
      <section className="dashboard-context" aria-label="Filtros del dashboard">
        <div>
          <p className="dashboard-eyebrow">CONTROL OPERATIVO</p>
          <h2 className="text-xl font-semibold">Tu operación, en perspectiva</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {summary?.context ? "Actualizado: " + new Date(summary.context.generated_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "Resumen financiero y operativo"}
          </p>
        </div>
        <div className="dashboard-filters">
          <label>Sede<select value={site} onChange={event => setSite(event.target.value)}>
            <option value="all">Todas las sedes</option>
            {(baseline?.site_rows ?? data.sites).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label>
          <label>Periodo financiero<select value={month} onChange={event => setMonth(event.target.value)}>
            <option value="all">Todo el historial</option>
            {[...months].reverse().map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}
          </select></label>
        </div>
        <p className="dashboard-context-note">Ingresos y gastos: <strong>{period}</strong>. Cobros, pagos en proceso, gastos pendientes y alumnos: estado actual. Asistencias: registros históricos.</p>
      </section>

      {!summary ? <div role={failure ? "alert" : "status"} className="rounded-md border border-zinc-200 bg-white p-6">
        {failure ? <><p>No se pudo cargar este resumen: {failure}</p><button className="dashboard-action mt-3" onClick={() => setRetry(value => value + 1)}>Reintentar <RefreshCw size={14} /></button></> : "Actualizando el resumen…"}
      </div> : <>
        <DashboardMetrics metrics={summary.metrics} periodLabel={period} />
        <section className="dashboard-tasks" aria-labelledby="dashboard-tasks-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><h2 id="dashboard-tasks-title" className="font-semibold">Atención operativa</h2><p className="mt-1 text-xs text-zinc-500">Accesos a los pendientes actuales y al historial de incidencias.</p></div>
            <div className="flex flex-wrap gap-2">
              {summary.metrics.open_balance > 0 && action("debts", "Ver adeudos")}
              {(summary.metrics.pending_payment_total > 0 || summary.metrics.requested_discounts > 0) && action("billing", "Revisar cobros")}
              {summary.metrics.pending_expenses > 0 && action("expenses", "Revisar gastos")}
              {summary.metrics.attendance_with_debt > 0 && action("attendance", "Ver asistencias")}
            </div>
          </div>
          {summary.alerts.length ? <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">Ver incidencias · {summary.alerts.length} destacadas</summary>
            <p className="mt-2 text-xs text-zinc-500">Hasta 5 registros por tipo: mayores adeudos, descuentos pendientes y asistencias más recientes.</p>
            <ul className="dashboard-alert-list">
              {summary.alerts.map(alert => {
                const tab: TabKey = String(alert.id).startsWith("discount-") ? "billing" : String(alert.id).startsWith("attendance-") ? "attendance" : "debts";
                return <li key={alert.id}><div><p className="text-sm font-medium">{alert.title}</p><p className="mt-1 text-xs text-zinc-500">{alert.subtitle}</p></div>{action(tab, tab === "debts" ? "Ver adeudos" : tab === "billing" ? "Ver cobros" : "Ver asistencias")}</li>;
              })}
            </ul>
          </details> : <p className="mt-3 text-sm text-zinc-500">Sin incidencias destacadas para esta sede.</p>}
        </section>

        <div className="dashboard-view-switch" role="group" aria-label="Vista del dashboard">
          {[["finances", "Finanzas"], ["collection", "Cobranza"], ["sites", "Sedes"]].map(([id, label]) =>
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>
          )}
        </div>
        <section aria-label={view === "finances" ? "Vista de finanzas" : view === "collection" ? "Vista de cobranza" : "Vista de sedes"} className="grid min-w-0 gap-5">
          {view === "finances" && <>
            <FinancialComboChart title="Evolución mensual" mode="time" rows={summary.monthly_rows.filter(row => row.site_id === "all").sort((a, b) => a.month.localeCompare(b.month))} />
            <FinancialComboChart title="Comparación entre sedes" rows={summary.site_rows.map(row => ({ label: row.name, ingresos: row.payments, egresos: row.expenses, utilidad: row.utility }))} />
          </>}
          {view === "collection" && <>
            <section className="grid min-w-0 gap-5 xl:grid-cols-2">
              <PaymentMethodDonut title="Ingresos por método de pago" rows={summary.method_rows} />
              <CollectionFunnel title="Estado de cobranza" rows={summary.payment_status_rows} />
            </section>
            <PendingBySiteChart title="Saldo actual por sede" rows={summary.site_rows.map(row => ({ label: row.name, value: row.balance }))} />
          </>}
          {view === "sites" && <>
            <SitesMap sites={data.sites.filter(row => summary.site_rows.some(item => item.id === row.id))} siteRows={summary.site_rows} />
            <StudentStatusDonut title="Estado actual de alumnos" rows={summary.student_status_rows} />
            <details className="rounded-md border border-zinc-200 bg-white p-4">
              <summary className="cursor-pointer font-semibold">Detalle operativo · {summary.site_rows.length} sedes</summary>
              <p className="mt-2 text-xs text-zinc-500">Finanzas: {period}. Alumnos y saldos actuales. Asistencias históricas.</p>
              <div className="dashboard-site-details">{summary.site_rows.map(row =>
                <article key={row.id}><h3 className="font-semibold">{row.name}</h3><dl>
                  {[["Alumnos", row.students], ["Asistencias históricas", row.attendance], ["Ingresos", "$" + money(row.payments)], ["Gastos", "$" + money(row.expenses)], ["Resultado", "$" + money(row.utility)], ["Saldo actual", "$" + money(row.balance)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl></article>
              )}</div>
            </details>
          </>}
        </section>
      </>}
    </div>
  );
}

