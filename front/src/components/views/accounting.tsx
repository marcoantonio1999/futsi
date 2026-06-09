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
import { DashboardPanel } from "./dashboard";
import { DailyOperationPanel } from "./dailyOperation";
import { HistoricalImportsPanel } from "./historicalImports";
import { IncomeStatementPanel } from "./incomeStatement";
import { SalesEstimationPanel } from "./sales";
import { SportsPanel } from "./sportsPanel";

export function AccountingPortal({
  user,
  data,
  onRefresh,
  onLogout,
  onDownloadAccounting,
  onCreateInvoice,
  onDownloadFile,
  onUploadHistoricalImport,
  onCommitHistoricalImport,
  onUpdateMatch,
}: {
  user: User;
  data: AppData;
  onRefresh: () => void;
  onLogout: () => void;
  onDownloadAccounting: () => void;
  onCreateInvoice: (payload: unknown) => void;
  onDownloadFile: (path: string, filename: string) => void;
  onUploadHistoricalImport: (formData: FormData) => Promise<HistoricalImport>;
  onCommitHistoricalImport: (importId: number, payload: unknown) => Promise<HistoricalImport>;
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
}) {
  const confirmedPayments = data.payments.filter((payment) => payment.status === "registered" || payment.status === "reconciled");
  const income = confirmedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const approvedExpenses = data.expenses.filter((expense) => expense.status === "approved");
  const expenseTotal = approvedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const pendingExpenseTotal = data.expenses
    .filter((expense) => expense.status === "pending")
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const openBalance = data.charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
  const pendingPayments = data.payments.filter((payment) => payment.status === "processing" || payment.status === "awaiting_confirmation");
  const attendanceWithDebt = data.attendanceRecords.filter((record) => record.status === "present" && record.had_debt_at_capture);
  const ticketAverage = calculateMonthlyTicketAverage(data.payments);

  const siteRows: AccountingSiteRow[] = data.sites.map((site) => {
    const siteCharges = data.charges.filter((charge) => charge.site === site.id);
    const siteChargeIds = new Set(siteCharges.map((charge) => charge.id));
    const siteIncome = confirmedPayments
      .filter((payment) => payment.charge && siteChargeIds.has(payment.charge))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const siteExpenses = approvedExpenses
      .filter((expense) => expense.site === site.id)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const siteBalance = siteCharges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
    return {
      id: site.id,
      label: site.name,
      ingresos: siteIncome,
      egresos: siteExpenses,
      utilidad: siteIncome - siteExpenses,
      pendiente: siteBalance,
    };
  });
  const siteTotals = sumAccountingRows(siteRows);

  const methodRows = [
    { label: "Efectivo", value: confirmedPayments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Transferencia", value: confirmedPayments.filter((payment) => payment.method === "transfer").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Tarjeta", value: confirmedPayments.filter((payment) => payment.method === "card").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
  ];

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950" data-testid="accounting-portal">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Portal contador</p>
            <h1 className="text-xl font-semibold">Reporte contable operativo</h1>
            <p className="mt-1 text-sm text-zinc-500">{user.first_name || user.username} - ingresos, egresos, utilidad y saldos.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              data-testid="accounting-export"
              className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50"
              onClick={onDownloadAccounting}
            >
              <Download size={16} /> Exportar Excel
            </button>
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50" onClick={onRefresh} title="Actualizar">
              <RefreshCw size={16} />
            </button>
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50" onClick={onLogout} title="Salir">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>
      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <TableHeader title="Estado de resultados por sede" count={siteRows.length} />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Sede</th>
                    <th className="px-4 py-3">Ingresos</th>
                    <th className="px-4 py-3">Egresos</th>
                    <th className="px-4 py-3">Utilidad</th>
                    <th className="px-4 py-3">Por cobrar</th>
                  </tr>
                </thead>
                <tbody>
                  {siteRows.map((row) => (
                    <tr key={row.id} className="border-b border-zinc-100">
                      <td className="px-4 py-3 font-medium">{row.label}</td>
                      <td className="px-4 py-3">${money(row.ingresos)}</td>
                      <td className="px-4 py-3">${money(row.egresos)}</td>
                      <td className={`px-4 py-3 font-semibold ${row.utilidad >= 0 ? "text-emerald-700" : "text-red-700"}`}>${money(row.utilidad)}</td>
                      <td className="px-4 py-3">${money(row.pendiente)}</td>
                    </tr>
                  ))}
                  <tr className="bg-zinc-50 font-semibold">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3">${money(siteTotals.ingresos)}</td>
                    <td className="px-4 py-3">${money(siteTotals.egresos)}</td>
                    <td className={`px-4 py-3 ${siteTotals.utilidad >= 0 ? "text-emerald-700" : "text-red-700"}`}>${money(siteTotals.utilidad)}</td>
                    <td className="px-4 py-3">${money(siteTotals.pendiente)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
      <div className="mx-auto max-w-7xl px-5 py-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric label="Ingresos confirmados" value={`$${money(income)}`} />
          <Metric label="Egresos aprobados" value={`$${money(expenseTotal)}`} />
          <Metric label="Utilidad operativa" value={`$${money(income - expenseTotal)}`} />
          <Metric label="Saldo por cobrar" value={`$${money(openBalance)}`} />
          <Metric
            label="Ticket promedio mensual"
            value={`$${money(ticketAverage.amount)}`}
            helper={`${ticketAverage.monthLabel} - ${ticketAverage.payerCount} pagadores`}
          />
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
          <FinancialAxisChart rows={siteRows} />
          <div className="grid gap-5">
            <PaymentMethodDonut title="Ingresos por metodo" rows={methodRows} />
            <SimpleList
              title="Pendientes criticos"
              count={pendingPayments.length + attendanceWithDebt.length}
              rows={[
                ...pendingPayments.slice(0, 4).map((payment) => ({
                  id: payment.id,
                  title: `${payment.student_name || "Cliente"} - ${paymentMethodLabel(payment.method)}`,
                  subtitle: `${paymentStatusLabel(payment.status)} - $${money(payment.amount)}${payment.expires_at ? ` - vence ${payment.expires_at.slice(0, 10)}` : ""}`,
                })),
                ...attendanceWithDebt.slice(0, 4).map((record) => ({
                  id: 10000 + record.id,
                  title: `${record.student_name} asistio con adeudo`,
                  subtitle: record.override_reason || "Cruce asistencia vs cobranza",
                })),
              ]}
            />
          </div>
        </section>

        <section className="mt-6">
          <SportsPanel data={data} canEditMatches onUpdateMatch={onUpdateMatch} onSaveAssessment={async () => undefined} />
        </section>

        <section className="mt-6">
          <SalesEstimationPanel data={data} />
        </section>

        <section className="mt-6">
          <IncomeStatementPanel data={data} />
        </section>

        <section className="mt-6">
          <DailyOperationPanel data={data} />
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-2">
          

          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <TableHeader title="Gastos pendientes de aprobacion" count={data.expenses.filter((expense) => expense.status === "pending").length} />
            <div className="divide-y divide-zinc-100">
              {data.expenses.filter((expense) => expense.status === "pending").map((expense) => (
                <div key={expense.id} className="px-4 py-3">
                  <p className="font-medium">{expense.site_name} - {expense.category} - ${money(expense.amount)}</p>
                  <p className="mt-1 text-sm text-zinc-500">{expense.expense_date} - {expense.provider_name || "Sin proveedor"} - {expense.description}</p>
                </div>
              ))}
              <div className="px-4 py-3 text-sm font-semibold">Total pendiente: ${money(pendingExpenseTotal)}</div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[0.75fr_1fr]">
          <InvoiceGenerator data={data} onCreateInvoice={onCreateInvoice} />
          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <TableHeader title="Facturas simuladas" count={data.invoices.length} />
            <InvoiceRows invoices={data.invoices} onDownloadFile={onDownloadFile} />
          </div>
        </section>

        <section className="mt-6">
          <HistoricalImportsPanel data={data} onUpload={onUploadHistoricalImport} onCommit={onCommitHistoricalImport} />
        </section>
      </div>
    </main>
  );
}
