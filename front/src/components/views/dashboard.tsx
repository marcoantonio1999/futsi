import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Camera,
  Check,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  Lock,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Upload,
  Shield,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { Metric } from "../cards/Metric";
import { CollectionFunnel } from "../charts/CollectionFunnel";
import { FinancialAxisChart } from "../charts/FinancialAxisChart";
import { FinancialComboChart } from "../charts/FinancialComboChart";
import { PaymentMethodDonut } from "../charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../charts/PendingBySiteChart";
import { StudentStatusDonut } from "../charts/StudentStatusDonut";
import { API_URL } from "../../api";
import { roleLabels, statusLabels } from "../../appState";
import { money } from "../../utils/format";
import type { AccountingSiteRow, AppData, AttendanceRecord, AttendanceSession, CashMovementType, Charge, ChargeStatus, Discount, Expense, ExpenseStatus, FaceRecognitionResponse, Guardian, HistoricalDiscrepancyReport, HistoricalImport, Invoice, Match, Payment, PaymentMethod, PaymentStatus, Player, PlayerAttendanceRecord, Role, Site, StaffPaymentKind, StaffPaymentRequest, StaffPaymentStatus, StandingRow, Student, StudentAssessment, Team, ThemeMode, User } from "../../types";

import {
  Avatar,
  AttendanceButton,
  FaceAttendanceCard,
  InfoChip,
  InvoiceGenerator,
  InvoiceRows,
  SelectInput,
  SimpleList,
  StaffPaymentInbox,
  StatusPill,
  TableHeader,
  TextInput,
  average,
  calculateCashBySite,
  calculateMonthlyTicketAverage,
  chargeLabel,
  chargeStatusLabel,
  collectionProgress,
  dateDay,
  dateMonthKey,
  expenseStatusLabel,
  exportAccountingWorkbook,
  cashMovementLabel,
  methodLabel,
  monthLabelFromKey,
  normalizeText,
  paymentMethodLabel,
  paymentMonthKey,
  paymentPayerKey,
  paymentStatusLabel,
  staffPaymentKindLabel,
  staffPaymentStatusLabel,
  sumAccountingRows,
} from "./shared";
import { SitesMap } from "./dashboardMap";
import { MonthlySiteFlowPanel } from "./monthlySiteFlow";

export { SitesMap };

export function DashboardPanel({ data }: { data: AppData }) {
  if (data.dashboardSummary) {
    return <DashboardSummaryPanel data={data} />;
  }

  const confirmedPayments = data.payments.filter((payment) => payment.status === "registered" || payment.status === "reconciled");
  const pendingPayments = data.payments.filter((payment) => payment.status === "processing" || payment.status === "awaiting_confirmation");
  const totalIncome = confirmedPayments
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const approvedExpenses = data.expenses
    .filter((expense) => expense.status === "approved")
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const pendingExpenses = data.expenses
    .filter((expense) => expense.status === "pending")
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const openBalance = data.charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
  const studentsWithDebt = data.students.filter((student) => student.open_charge_count > 0);
  const attendanceWithDebt = data.attendanceRecords.filter(
    (record) => record.status === "present" && record.had_debt_at_capture,
  );
  const requestedDiscounts = data.discounts.filter((discount) => discount.status === "requested");
  const ticketAverage = calculateMonthlyTicketAverage(data.payments);

  const siteRows = data.sites.map((site) => {
    const payments = confirmedPayments
      .filter((payment) => data.charges.find((charge) => charge.id === payment.charge)?.site === site.id)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const expenses = data.expenses
      .filter((expense) => expense.site === site.id && expense.status === "approved")
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const balance = data.charges
      .filter((charge) => charge.site === site.id)
      .reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
    const students = data.students.filter((student) => student.site === site.id).length;
    const attendance = data.attendanceRecords.filter((record) => {
      const student = data.students.find((item) => item.id === record.student);
      return student?.site === site.id && record.status === "present";
    }).length;
    return {
      id: site.id,
      name: site.name,
      students,
      payments,
      expenses,
      balance,
      attendance,
      utility: payments - expenses,
    };
  });

  const methodRows: Array<{ label: string; value: number }> = [
    { label: "Efectivo", value: confirmedPayments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Transferencia", value: confirmedPayments.filter((payment) => payment.method === "transfer").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Tarjeta", value: confirmedPayments.filter((payment) => payment.method === "card").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Cortesia", value: confirmedPayments.filter((payment) => payment.method === "courtesy").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
  ];
  const financialRows = siteRows.map((site) => ({
    label: site.name,
    ingresos: site.payments,
    egresos: site.expenses,
    utilidad: site.utility,
  }));
  const pendingPaymentTotal = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const studentStatusRows = Object.entries(statusLabels).map(([status, label]) => ({
    label,
    value: data.students.filter((student) => student.status === status).length,
  }));
  const paymentStatusRows = [
    { label: "Confirmados", value: totalIncome },
    { label: "En proceso", value: pendingPaymentTotal },
    { label: "Cobros pendientes", value: openBalance },
  ];

  return (
    <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Sedes activas" value={data.sites.filter((site) => site.is_active).length} />
        <Metric label="Alumnos" value={data.students.length} />
        <Metric label="Gastos pendientes" value={`$${money(pendingExpenses)}`} />
        <Metric label="Cobros pendientes" value={`$${money(openBalance)}`} />
        <Metric
          label="Ticket promedio mensual"
          value={`$${money(ticketAverage.amount)}`}
          helper={`${ticketAverage.monthLabel} - ${ticketAverage.payerCount} pagadores`}
        />
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Ingresos registrados" value={`$${money(totalIncome)}`} />
        <Metric label="Gastos aprobados" value={`$${money(approvedExpenses)}`} />
        <Metric label="Utilidad estimada" value={`$${money(totalIncome - approvedExpenses)}`} />
        <Metric label="Pagos en proceso" value={`$${money(pendingPaymentTotal)}`} />
        <Metric label="Descuentos por aprobar" value={requestedDiscounts.length} />
      </div>

      <div className="grid min-w-0 gap-5">
        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Cobros pendientes" value={`$${money(openBalance)}`} />
          <Metric label="Alumnos con cobro pendiente" value={studentsWithDebt.length} />
          <Metric label="Asistieron con pago pendiente" value={attendanceWithDebt.length} />
        </section>

        <section className="grid min-w-0 gap-5">
          <FinancialComboChart title="Ingresos, egresos y utilidad por sede" rows={financialRows} />
        </section>

        <MonthlySiteFlowPanel data={data} />

        <section className="grid min-w-0 gap-5 lg:grid-cols-2">
          <PaymentMethodDonut title="Ingresos confirmados por metodo" rows={methodRows} />
          <CollectionFunnel title="Embudo de cobranza" rows={paymentStatusRows} />
        </section>

        <section className="grid min-w-0 gap-5 lg:grid-cols-2">
          <PendingBySiteChart title="Cobros pendientes por sede" rows={siteRows.map((site) => ({ label: site.name, value: site.balance }))} />
          <StudentStatusDonut title="Estado de alumnos" rows={studentStatusRows} />
        </section>

        <SitesMap sites={data.sites} siteRows={siteRows} />

        <div className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Operacion por sede" count={siteRows.length} />
          <div className="max-w-full overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Sede</th>
                  <th className="px-4 py-3">Alumnos</th>
                  <th className="px-4 py-3">Asistencias</th>
                  <th className="px-4 py-3">Ingresos</th>
                  <th className="px-4 py-3">Gastos</th>
                  <th className="px-4 py-3">Utilidad</th>
                  <th className="px-4 py-3">Saldo pendiente</th>
                </tr>
              </thead>
              <tbody>
                {siteRows.map((site) => (
                  <tr key={site.id} className="border-b border-zinc-100">
                    <td className="px-4 py-3 font-medium">{site.name}</td>
                    <td className="px-4 py-3">{site.students}</td>
                    <td className="px-4 py-3">{site.attendance}</td>
                    <td className="px-4 py-3">${money(site.payments)}</td>
                    <td className="px-4 py-3">${money(site.expenses)}</td>
                    <td className="px-4 py-3 font-semibold">${money(site.utility)}</td>
                    <td className="px-4 py-3">${money(site.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <section className="grid min-w-0 gap-5 lg:grid-cols-2">
          <SimpleList
            title="Ingresos por metodo"
            count={methodRows.length}
            rows={methodRows.map((row, index) => ({
              id: index,
              title: row.label,
              subtitle: `$${money(row.value)}`,
            }))}
          />
          <SimpleList
            title="Alertas operativas"
            count={studentsWithDebt.length + requestedDiscounts.length + attendanceWithDebt.length}
            rows={[
              ...studentsWithDebt.slice(0, 5).map((student) => ({
                id: student.id,
                title: `${student.full_name} tiene cobro pendiente`,
                subtitle: `${student.site_name} - saldo $${money(student.balance_due)}`,
              })),
              ...requestedDiscounts.slice(0, 5).map((discount) => ({
                id: 10000 + discount.id,
                title: `Descuento pendiente: ${discount.student_name}`,
                subtitle: `${discount.reason} - $${money(discount.amount)}`,
              })),
              ...attendanceWithDebt.slice(0, 5).map((record) => ({
                id: 20000 + record.id,
                title: `${record.student_name} asistio con pago pendiente`,
                subtitle: record.override_reason || "Autorizacion registrada en cancha",
              })),
            ]}
          />
        </section>
      </div>
    </>
  );
}

function DashboardSummaryPanel({ data }: { data: AppData }) {
  const summary = data.dashboardSummary!;
  const metrics = summary.metrics;
  const financialRows = summary.site_rows.map((site) => ({
    label: site.name,
    ingresos: site.payments,
    egresos: site.expenses,
    utilidad: site.utility,
  }));
  const monthlyRows = summary.monthly_rows
    .filter((row) => row.site_id === "all")
    .map((row) => ({ label: row.label, ingresos: row.ingresos, egresos: row.egresos, utilidad: row.utilidad }));

  return (
    <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Sedes activas" value={metrics.active_sites} />
        <Metric label="Alumnos" value={metrics.students} />
        <Metric label="Gastos pendientes" value={`$${money(metrics.pending_expenses)}`} />
        <Metric label="Cobros pendientes" value={`$${money(metrics.open_balance)}`} />
        <Metric
          label="Ticket promedio mensual"
          value={`$${money(metrics.ticket_average.amount)}`}
          helper={`${metrics.ticket_average.month_label} - ${metrics.ticket_average.payer_count} pagadores`}
        />
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Ingresos registrados" value={`$${money(metrics.total_income)}`} />
        <Metric label="Gastos aprobados" value={`$${money(metrics.approved_expenses)}`} />
        <Metric label="Utilidad estimada" value={`$${money(metrics.utility)}`} />
        <Metric label="Pagos en proceso" value={`$${money(metrics.pending_payment_total)}`} />
        <Metric label="Descuentos por aprobar" value={metrics.requested_discounts} />
      </div>

      <div className="grid min-w-0 gap-5">
        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Cobros pendientes" value={`$${money(metrics.open_balance)}`} />
          <Metric label="Alumnos con cobro pendiente" value={metrics.students_with_debt} />
          <Metric label="Asistieron con pago pendiente" value={metrics.attendance_with_debt} />
        </section>

        <section className="grid min-w-0 gap-5">
          <FinancialComboChart title="Ingresos, egresos y utilidad por sede" rows={financialRows} />
        </section>

        {monthlyRows.length ? (
          <section className="grid min-w-0 gap-5">
            <FinancialComboChart title="Timeline mensual financiero" rows={monthlyRows} />
          </section>
        ) : null}

        <section className="grid min-w-0 gap-5 lg:grid-cols-2">
          <PaymentMethodDonut title="Ingresos confirmados por metodo" rows={summary.method_rows} />
          <CollectionFunnel title="Embudo de cobranza" rows={summary.payment_status_rows} />
        </section>

        <section className="grid min-w-0 gap-5 lg:grid-cols-2">
          <PendingBySiteChart title="Cobros pendientes por sede" rows={summary.site_rows.map((site) => ({ label: site.name, value: site.balance }))} />
          <StudentStatusDonut title="Estado de alumnos" rows={summary.student_status_rows} />
        </section>

        <SitesMap sites={data.sites} siteRows={summary.site_rows} />

        <div className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Operacion por sede" count={summary.site_rows.length} />
          <div className="max-w-full overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Sede</th>
                  <th className="px-4 py-3">Alumnos</th>
                  <th className="px-4 py-3">Asistencias</th>
                  <th className="px-4 py-3">Ingresos</th>
                  <th className="px-4 py-3">Gastos</th>
                  <th className="px-4 py-3">Utilidad</th>
                  <th className="px-4 py-3">Saldo pendiente</th>
                </tr>
              </thead>
              <tbody>
                {summary.site_rows.map((site) => (
                  <tr key={site.id} className="border-b border-zinc-100">
                    <td className="px-4 py-3 font-medium">{site.name}</td>
                    <td className="px-4 py-3">{site.students}</td>
                    <td className="px-4 py-3">{site.attendance}</td>
                    <td className="px-4 py-3">${money(site.payments)}</td>
                    <td className="px-4 py-3">${money(site.expenses)}</td>
                    <td className="px-4 py-3 font-semibold">${money(site.utility)}</td>
                    <td className="px-4 py-3">${money(site.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <section className="grid min-w-0 gap-5 lg:grid-cols-2">
          <SimpleList
            title="Ingresos por metodo"
            count={summary.method_rows.length}
            rows={summary.method_rows.map((row, index) => ({
              id: index,
              title: row.label,
              subtitle: `$${money(row.value)}`,
            }))}
          />
          <SimpleList
            title="Alertas operativas"
            count={summary.alerts.length}
            rows={summary.alerts.map((alert) => ({
              id: alert.id,
              title: alert.title,
              subtitle: alert.subtitle,
            }))}
          />
        </section>
      </div>
    </>
  );
}

