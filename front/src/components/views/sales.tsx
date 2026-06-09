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

export function calculateSalesEstimation(data: AppData) {
  const confirmedPayments = data.payments.filter((payment) => payment.status === "registered" || payment.status === "reconciled");
  const activityMonths = [
    ...confirmedPayments.map((payment) => paymentMonthKey(payment)),
    ...data.charges.map((charge) => dateMonthKey(charge.due_date)),
    ...data.expenses.map((expense) => dateMonthKey(expense.expense_date)),
  ].filter(Boolean).sort();
  const currentKey = paymentMonthKey({ paid_at: new Date().toISOString(), confirmed_at: null } as Payment);
  const selectedMonth = activityMonths.includes(currentKey) ? currentKey : activityMonths.at(-1) || currentKey;
  const monthPayments = confirmedPayments.filter((payment) => paymentMonthKey(payment) === selectedMonth);
  const monthCharges = data.charges.filter((charge) => dateMonthKey(charge.due_date) === selectedMonth || !charge.due_date);
  const monthExpenses = data.expenses.filter((expense) => dateMonthKey(expense.expense_date) === selectedMonth && expense.status !== "canceled");
  const maxObservedDay = Math.max(1, ...monthPayments.map((payment) => dateDay(payment.confirmed_at || payment.paid_at)), ...monthCharges.map((charge) => dateDay(charge.due_date)));
  const currentDay = maxObservedDay;
  const academyProgress = collectionProgress(currentDay);
  const tournamentProgress = Math.min(1, currentDay / 30);
  const globalPaymentTotal = monthPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const globalMix = {
    cash: globalPaymentTotal ? monthPayments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) / globalPaymentTotal : 0.4,
    transfer: globalPaymentTotal ? monthPayments.filter((payment) => payment.method === "transfer").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) / globalPaymentTotal : 0.3,
    card: globalPaymentTotal ? monthPayments.filter((payment) => payment.method === "card").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) / globalPaymentTotal : 0.3,
  };

  const chargeById = new Map(data.charges.map((charge) => [charge.id, charge]));
  const tournamentById = new Map(data.tournaments.map((tournament) => [tournament.id, tournament]));
  const teamById = new Map(data.teams.map((team) => [team.id, team]));

  const sites = data.sites.filter((site) => site.is_active);
  const rows = sites.map((site) => {
    const siteStudents = data.students.filter((student) => student.site === site.id && student.status !== "dropped");
    const siteCharges = monthCharges.filter((charge) => charge.site === site.id);
    const sitePayments = monthPayments.filter((payment) => {
      if (payment.site === site.id) return true;
      const charge = payment.charge ? chargeById.get(payment.charge) : null;
      return charge?.site === site.id;
    });
    const sitePaymentTotal = sitePayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const monthlyChargeAmounts = siteCharges.filter((charge) => normalizeText(charge.concept).includes("mensual")).map((charge) => Number(charge.amount || 0));
    const monthlyPaymentAmounts = sitePayments
      .filter((payment) => normalizeText(payment.charge_concept || "").includes("mensual"))
      .map((payment) => Number(payment.amount || 0));
    const academyTicket = average(monthlyPaymentAmounts) || average(monthlyChargeAmounts) || average(sitePayments.filter((payment) => payment.student).map((payment) => Number(payment.amount || 0)));

    const siteTournaments = data.tournaments.filter((tournament) => tournament.site === site.id);
    const fullTournamentIds = new Set(siteTournaments.filter((tournament) => tournament.billing_type === "full_tournament").map((tournament) => tournament.id));
    const weeklyTournamentIds = new Set(siteTournaments.filter((tournament) => tournament.billing_type === "weekly_match").map((tournament) => tournament.id));
    const fullTeams = data.teams.filter((team) => fullTournamentIds.has(team.tournament)).length;
    const weeklyTeams = data.teams.filter((team) => weeklyTournamentIds.has(team.tournament)).length;
    const fullTeamIds = new Set(data.teams.filter((team) => fullTournamentIds.has(team.tournament)).map((team) => team.id));
    const weeklyTeamIds = new Set(data.teams.filter((team) => weeklyTournamentIds.has(team.tournament)).map((team) => team.id));
    const fullTicket =
      average(siteCharges.filter((charge) => charge.team && fullTeamIds.has(charge.team)).map((charge) => Number(charge.amount || 0))) ||
      average(sitePayments.filter((payment) => payment.charge_concept && /torneo completo|completo/i.test(payment.charge_concept)).map((payment) => Number(payment.amount || 0)));
    const weeklyTicket =
      average(siteCharges.filter((charge) => charge.team && weeklyTeamIds.has(charge.team)).map((charge) => Number(charge.amount || 0))) ||
      average(sitePayments.filter((payment) => payment.charge_concept && /jornada|liguilla|torneo/i.test(payment.charge_concept)).map((payment) => Number(payment.amount || 0))) ||
      average(siteCharges.filter((charge) => /jornada|liguilla|torneo/i.test(charge.concept)).map((charge) => Number(charge.amount || 0)));

    const mixTotal = sitePaymentTotal;
    const mix = {
      cash: mixTotal ? sitePayments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) / mixTotal : globalMix.cash,
      transfer: mixTotal ? sitePayments.filter((payment) => payment.method === "transfer").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) / mixTotal : globalMix.transfer,
      card: mixTotal ? sitePayments.filter((payment) => payment.method === "card").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) / mixTotal : globalMix.card,
    };

    const expectedAcademy = siteStudents.length * academyTicket * academyProgress;
    const expectedFull = fullTeams * fullTicket * 4.3 * tournamentProgress;
    const expectedWeekly = weeklyTeams * weeklyTicket * 4.3 * tournamentProgress;
    const directPayments = 0;
    const expectedTotal = Math.max(0, expectedAcademy + expectedFull + expectedWeekly - directPayments);
    const expectedByMethod = {
      cash: expectedTotal * mix.cash,
      transfer: expectedTotal * mix.transfer,
      card: expectedTotal * mix.card,
    };
    const reportedByMethod = {
      cash: sitePayments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      transfer: sitePayments.filter((payment) => payment.method === "transfer").reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
      card: sitePayments.filter((payment) => payment.method === "card").reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    };
    const expenses = monthExpenses.filter((expense) => expense.site === site.id);
    const expenseBy = (patterns: RegExp[]) => expenses.filter((expense) => patterns.some((pattern) => pattern.test(`${expense.category} ${expense.description}`))).reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const coachPayroll = expenseBy([/coach/i, /nomina.*coach/i]);
    const adminPayroll = expenseBy([/admin/i, /administr/i, /nomina(?!.*coach)/i]);
    const referees = expenseBy([/arbitr/i]);
    const marketing = expenseBy([/publicidad/i, /marketing/i]);
    const corporate = expenseBy([/corporativo/i]);
    const rent = expenseBy([/renta/i, /cancha/i]);
    const knownExpenseTotal = coachPayroll + adminPayroll + referees + marketing + corporate + rent;
    const otherExpenses = Math.max(0, expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0) - knownExpenseTotal);
    const totalExpenses = knownExpenseTotal + otherExpenses;

    return {
      site,
      students: siteStudents.length,
      academyTicket,
      fullTeams,
      fullTicket,
      weeklyTeams,
      weeklyTicket,
      academyProgress,
      tournamentProgress,
      expectedAcademy,
      expectedFull,
      expectedWeekly,
      directPayments,
      expectedTotal,
      expectedByMethod,
      reportedByMethod,
      reportedTotal: reportedByMethod.cash + reportedByMethod.transfer + reportedByMethod.card,
      ratio: expectedTotal ? (reportedByMethod.cash + reportedByMethod.transfer + reportedByMethod.card) / expectedTotal : 0,
      coachPayroll,
      adminPayroll,
      referees,
      marketing,
      corporate,
      rent,
      otherExpenses,
      totalExpenses,
      expectedUtility: expectedTotal - totalExpenses,
      reportedUtility: (reportedByMethod.cash + reportedByMethod.transfer + reportedByMethod.card) - totalExpenses,
    };
  });

  return {
    monthLabel: monthLabelFromKey(selectedMonth),
    selectedMonth,
    currentDay,
    academyProgress,
    tournamentProgress,
    rows,
  };
}
export function SalesEstimationPanel({ data }: { data: AppData }) {
  const report = calculateSalesEstimation(data);
  const columns = report.rows.map((row) => row.site.name);
  const total = (selector: (row: ReturnType<typeof calculateSalesEstimation>["rows"][number]) => number) => report.rows.reduce((sum, row) => sum + selector(row), 0);
  const tableRows: Array<{ section?: string; label: string; values: number[]; total?: number; format?: "money" | "percent" | "number" }> = [
    { section: "Resumen", label: "Ventas Esperadas", values: report.rows.map((row) => row.expectedTotal), total: total((row) => row.expectedTotal), format: "money" },
    { label: "Ventas Reportadas", values: report.rows.map((row) => row.reportedTotal), total: total((row) => row.reportedTotal), format: "money" },
    { label: "D Ventas Esp vs Rep", values: report.rows.map((row) => row.expectedTotal - row.reportedTotal), total: total((row) => row.expectedTotal - row.reportedTotal), format: "money" },
    { label: "Ventas Reportadas / Esperadas", values: report.rows.map((row) => row.ratio), total: total((row) => row.reportedTotal) / Math.max(1, total((row) => row.expectedTotal)), format: "percent" },
    { section: "Diferencias Ventas x Medio", label: "Efectivo", values: report.rows.map((row) => row.expectedByMethod.cash - row.reportedByMethod.cash), total: total((row) => row.expectedByMethod.cash - row.reportedByMethod.cash), format: "money" },
    { label: "Transferencias", values: report.rows.map((row) => row.expectedByMethod.transfer - row.reportedByMethod.transfer), total: total((row) => row.expectedByMethod.transfer - row.reportedByMethod.transfer), format: "money" },
    { label: "Tarjetas", values: report.rows.map((row) => row.expectedByMethod.card - row.reportedByMethod.card), total: total((row) => row.expectedByMethod.card - row.reportedByMethod.card), format: "money" },
    { section: "Inputs", label: "Numero Ninos", values: report.rows.map((row) => row.students), total: total((row) => row.students), format: "number" },
    { label: "Ticket Promedio Academia", values: report.rows.map((row) => row.academyTicket), total: average(report.rows.map((row) => row.academyTicket)), format: "money" },
    { label: "Equipos T. Completos y Mayores", values: report.rows.map((row) => row.fullTeams), total: total((row) => row.fullTeams), format: "number" },
    { label: "Ticket Promedio Completo", values: report.rows.map((row) => row.fullTicket), total: average(report.rows.map((row) => row.fullTicket)), format: "money" },
    { label: "Equipos P. Semanal y Menores", values: report.rows.map((row) => row.weeklyTeams), total: total((row) => row.weeklyTeams), format: "number" },
    { label: "Ticket Promedio Semanal", values: report.rows.map((row) => row.weeklyTicket), total: average(report.rows.map((row) => row.weeklyTicket)), format: "money" },
    { label: "% Venta Academia", values: report.rows.map(() => report.academyProgress), total: report.academyProgress, format: "percent" },
    { label: "% Venta Torneos", values: report.rows.map(() => report.tournamentProgress), total: report.tournamentProgress, format: "percent" },
    { section: "Operaciones", label: "Academia Esperada", values: report.rows.map((row) => row.expectedAcademy), total: total((row) => row.expectedAcademy), format: "money" },
    { label: "Torneos Pago Completo Esperada", values: report.rows.map((row) => row.expectedFull), total: total((row) => row.expectedFull), format: "money" },
    { label: "Torneos Pago Semanal Esperada", values: report.rows.map((row) => row.expectedWeekly), total: total((row) => row.expectedWeekly), format: "money" },
    { label: "Total Academia y Torneos Esperados", values: report.rows.map((row) => row.expectedTotal), total: total((row) => row.expectedTotal), format: "money" },
    { section: "Ventas Estimadas x Tipo", label: "Efectivo Esperado", values: report.rows.map((row) => row.expectedByMethod.cash), total: total((row) => row.expectedByMethod.cash), format: "money" },
    { label: "Transferencias Esperadas", values: report.rows.map((row) => row.expectedByMethod.transfer), total: total((row) => row.expectedByMethod.transfer), format: "money" },
    { label: "Tarjetas Esperadas", values: report.rows.map((row) => row.expectedByMethod.card), total: total((row) => row.expectedByMethod.card), format: "money" },
    { label: "Total Ventas Semanales", values: report.rows.map((row) => row.expectedTotal), total: total((row) => row.expectedTotal), format: "money" },
    { section: "Ventas Reportadas", label: "Efectivo", values: report.rows.map((row) => row.reportedByMethod.cash), total: total((row) => row.reportedByMethod.cash), format: "money" },
    { label: "Transferencias", values: report.rows.map((row) => row.reportedByMethod.transfer), total: total((row) => row.reportedByMethod.transfer), format: "money" },
    { label: "Tarjetas", values: report.rows.map((row) => row.reportedByMethod.card), total: total((row) => row.reportedByMethod.card), format: "money" },
    { label: "Total Ventas Reportadas", values: report.rows.map((row) => row.reportedTotal), total: total((row) => row.reportedTotal), format: "money" },
    { section: "Utilidad Estimada", label: "Nomina Coaches", values: report.rows.map((row) => row.coachPayroll), total: total((row) => row.coachPayroll), format: "money" },
    { label: "Nomina Admin.", values: report.rows.map((row) => row.adminPayroll), total: total((row) => row.adminPayroll), format: "money" },
    { label: "Arbitros", values: report.rows.map((row) => row.referees), total: total((row) => row.referees), format: "money" },
    { label: "Publicidad", values: report.rows.map((row) => row.marketing), total: total((row) => row.marketing), format: "money" },
    { label: "Corporativo", values: report.rows.map((row) => row.corporate), total: total((row) => row.corporate), format: "money" },
    { label: "Rentas", values: report.rows.map((row) => row.rent), total: total((row) => row.rent), format: "money" },
    { label: "Otros gastos", values: report.rows.map((row) => row.otherExpenses), total: total((row) => row.otherExpenses), format: "money" },
    { label: "Total Gastos Generales", values: report.rows.map((row) => row.totalExpenses), total: total((row) => row.totalExpenses), format: "money" },
    { label: "Utilidad con Venta Esperada", values: report.rows.map((row) => row.expectedUtility), total: total((row) => row.expectedUtility), format: "money" },
    { label: "Utilidad con Venta Reportada", values: report.rows.map((row) => row.reportedUtility), total: total((row) => row.reportedUtility), format: "money" },
  ];
  const expected = total((row) => row.expectedTotal);
  const reported = total((row) => row.reportedTotal);
  const difference = expected - reported;
  const ratio = reported / Math.max(1, expected);

  function formatValue(value: number, format: "money" | "percent" | "number" = "money") {
    if (format === "percent") return `${(value * 100).toFixed(1)}%`;
    if (format === "number") return Number(value || 0).toLocaleString("es-MX", { maximumFractionDigits: 0 });
    return `$${money(value)}`;
  }

  return (
    <section className="grid min-w-0 gap-5">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Cuadrar efectivo y ventas esperadas</p>
            <h2 className="text-lg font-semibold">Estimacion de ventas en tiempo real</h2>
            <p className="mt-1 text-sm text-zinc-500">Replica la hoja Estimacion Ventas con datos actuales de alumnos, equipos, pagos, cargos y gastos.</p>
          </div>
          <div className="rounded-md bg-zinc-100 px-3 py-2 text-sm">
            <p className="font-medium">{report.monthLabel}</p>
            <p className="text-zinc-500">Dia de corte observado: {report.currentDay}</p>
          </div>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Ventas esperadas" value={`$${money(expected)}`} />
        <Metric label="Ventas reportadas" value={`$${money(reported)}`} />
        <Metric label="Diferencia" value={`$${money(difference)}`} helper={difference > 0 ? "Falta reportar vs esperado" : "Reportado supera esperado"} />
        <Metric label="Reportado / esperado" value={`${(ratio * 100).toFixed(1)}%`} />
      </section>

      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Estimacion Ventas" count={tableRows.length} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="sticky left-0 z-10 bg-zinc-50 px-4 py-3">Concepto</th>
                {columns.map((column) => <th key={column} className="px-4 py-3">{column}</th>)}
                <th className="px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rowIndex) => (
                <React.Fragment key={`${row.label}-${rowIndex}`}>
                  {row.section && (
                    <tr>
                      <td colSpan={columns.length + 2} className="bg-zinc-950 px-4 py-2 text-xs font-semibold uppercase text-white">{row.section}</td>
                    </tr>
                  )}
                  <tr className="border-b border-zinc-100">
                    <td className="sticky left-0 bg-white px-4 py-3 font-medium">{row.label}</td>
                    {row.values.map((value, index) => (
                      <td key={index} className={`px-4 py-3 ${value < 0 ? "text-red-700" : ""}`}>{formatValue(value, row.format)}</td>
                    ))}
                    <td className={`px-4 py-3 font-semibold ${Number(row.total || 0) < 0 ? "text-red-700" : ""}`}>{formatValue(row.total ?? 0, row.format)}</td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
