import { ClipboardList } from "lucide-react";
import type { DashboardSummary } from "../../types";
import { money } from "../../utils/format";
import { Metric } from "./Metric";
import "./dashboardMetrics.css";

type DashboardMetricsData = Omit<DashboardSummary["metrics"], "ticket_average"> & {
  ticket_average: Pick<DashboardSummary["metrics"]["ticket_average"], "amount" | "month_label" | "payer_count">;
};

export function DashboardMetrics({ metrics, periodLabel = "Todo el historial" }: { metrics: DashboardMetricsData; periodLabel?: string }) {
  const pending = [
    { label: "Gastos pendientes", value: metrics.pending_expenses, monetary: true },
    { label: "Pagos en proceso", value: metrics.pending_payment_total, monetary: true },
    { label: "Descuentos por aprobar", value: metrics.requested_discounts, monetary: false },
    { label: "Asistieron con pago pendiente", value: metrics.attendance_with_debt, monetary: false },
  ];

  return (
    <section className="dashboard-metrics" aria-label="Resumen de indicadores">
      <div className="dashboard-metrics-primary" aria-label="Indicadores principales">
        <div className="dashboard-metrics-card" data-tone="income">
          <Metric label="Ingresos confirmados" value={`$${money(metrics.total_income)}`} helper={periodLabel} />
        </div>
        <div className="dashboard-metrics-card" data-tone="expenses">
          <Metric label="Gastos aprobados" value={`$${money(metrics.approved_expenses)}`} helper={periodLabel} />
        </div>
        <div className="dashboard-metrics-card" data-tone={metrics.utility < 0 ? "negative" : "utility"}>
          <Metric label="Resultado neto" value={`$${money(metrics.utility)}`} helper="Ingresos menos gastos aprobados" />
        </div>
        <div className="dashboard-metrics-card" data-tone={metrics.open_balance > 0 ? "balance" : "income"}>
          <Metric label="Cobros pendientes" value={`$${money(metrics.open_balance)}`} helper={`Saldo actual · ${metrics.students_with_debt} alumnos`} />
        </div>
      </div>

      <section className="dashboard-metrics-pending" aria-labelledby="dashboard-pending-title">
        <h2 id="dashboard-pending-title"><ClipboardList size={16} aria-hidden="true" /> Pendientes operativos</h2>
        <div className="dashboard-metrics-pending-grid">
          {pending.map((item) => (
            <div className="dashboard-metrics-pending-item" data-empty={item.value === 0} key={item.label}>
              <Metric label={item.label} value={item.monetary ? `$${money(item.value)}` : item.value} helper={item.label.startsWith("Asistieron") ? "Registros históricos" : "Estado actual"} />
            </div>
          ))}
        </div>
      </section>

      <div className="dashboard-metrics-context" aria-label="Contexto de la academia">
        <Metric label="Sedes activas" value={metrics.active_sites} />
        <Metric label="Alumnos" value={metrics.students} />
        <Metric label="Ticket promedio mensual" value={`$${money(metrics.ticket_average.amount)}`} helper={`${metrics.ticket_average.month_label} - ${metrics.ticket_average.payer_count} pagadores`} />
      </div>
    </section>
  );
}
