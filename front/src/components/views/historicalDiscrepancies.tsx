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


export function discrepancyLabel(type: string) {
  const labels: Record<string, string> = {
    no_payment_no_folio: "Sin pago ni folio",
    no_payment_reported: "Sin pago reportado",
    missing_folio: "Sin folio",
    partial_payment: "Pago incompleto",
    current_attendance_with_open_balance: "Asistio con saldo abierto",
    current_attendance_without_folio: "Asistio sin folio",
  };
  return labels[type] ?? type;
}

export function HistoricalDiscrepanciesPanel({ report, sites }: { report: HistoricalDiscrepancyReport | null; sites: Site[] }) {
  const [siteFilter, setSiteFilter] = useState("all");
  const [monthFilter, setMonthFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | "historical" | "platform">("all");

  const allItems = useMemo(() => {
    if (!report) return [];
    return [...report.items, ...report.current_platform_items];
  }, [report]);

  const months = useMemo(() => Array.from(new Set(allItems.map((item) => item.month))).sort(), [allItems]);
  const siteNames = useMemo(() => Array.from(new Set(allItems.map((item) => item.site_name))).sort(), [allItems]);
  const filteredItems = allItems.filter((item) => {
    const siteOk = siteFilter === "all" || item.site_name === siteFilter || String(item.site_id ?? "") === siteFilter;
    const monthOk = monthFilter === "all" || item.month === monthFilter;
    const severityOk = severityFilter === "all" || item.severity === severityFilter;
    const sourceOk = sourceFilter === "all" || item.source === sourceFilter;
    return siteOk && monthOk && severityOk && sourceOk;
  });

  const filteredSummary = filteredItems.reduce<Record<string, HistoricalDiscrepancySummary>>((acc, item) => {
    const key = `${item.site_name}-${item.month}`;
    const current = acc[key] ?? {
      site_name: item.site_name,
      month: item.month,
      total_cases: 0,
      high_risk: 0,
      missing_amount: "0",
      classes_attended: 0,
      missing_folio: 0,
      no_payment: 0,
      partial_payment: 0,
    };
    current.total_cases += 1;
    current.high_risk += item.severity === "high" ? 1 : 0;
    current.classes_attended += Number(item.classes_attended || 0);
    current.missing_amount = String(Number(current.missing_amount || 0) + Number(item.missing_amount || 0));
    current.missing_folio += item.discrepancy_type.includes("folio") ? 1 : 0;
    current.no_payment += ["no_payment_no_folio", "no_payment_reported"].includes(item.discrepancy_type) ? 1 : 0;
    current.partial_payment += item.discrepancy_type === "partial_payment" ? 1 : 0;
    acc[key] = current;
    return acc;
  }, {});
  const summaryRows = Object.values(filteredSummary).sort((a, b) => `${a.site_name}${a.month}`.localeCompare(`${b.site_name}${b.month}`));
  const totalMissing = filteredItems.reduce((sum, item) => sum + Number(item.missing_amount || 0), 0);
  const highRisk = filteredItems.filter((item) => item.severity === "high").length;

  if (!report) {
    return (
      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle size={16} /> Discrepancias historicas
        </h2>
        <p className="mt-2 text-sm text-zinc-500">Carga un historico de Excel para analizar pagos faltantes, folios faltantes y pagos incompletos.</p>
      </section>
    );
  }

  return (
    <div className="grid min-w-0 gap-5">
      <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle size={16} /> Discrepancias por sede
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Cruza el historico cerrado contra clases/asistencia, folios y montos. En la nueva plataforma estos casos deben tender a cero.
          </p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Casos filtrados" value={filteredItems.length} />
          <Metric label="Alto riesgo" value={highRisk} />
          <Metric label="Monto probable faltante" value={`$${money(totalMissing)}`} />
          <Metric label="Casos plataforma actual" value={report.totals.current_platform_cases} />
        </div>
        <div className="grid gap-3 border-t border-zinc-200 p-4 md:grid-cols-4">
          <SelectInput label="Sede" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}>
            <option value="all">Todas</option>
            {siteNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
            {sites.map((site) => (
              <option key={site.id} value={String(site.id)}>{site.name}</option>
            ))}
          </SelectInput>
          <SelectInput label="Mes" value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>
            <option value="all">Todos</option>
            {months.map((month) => (
              <option key={month} value={month}>{month}</option>
            ))}
          </SelectInput>
          <SelectInput label="Severidad" value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
            <option value="all">Todas</option>
            <option value="high">Alta</option>
            <option value="medium">Media</option>
            <option value="low">Baja</option>
          </SelectInput>
          <SelectInput label="Origen" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as "all" | "historical" | "platform")}>
            <option value="all">Todos</option>
            <option value="historical">Historico Excel</option>
            <option value="platform">Plataforma actual</option>
          </SelectInput>
        </div>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Resumen por sede y mes" count={summaryRows.length} />
        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Sede</th>
                <th className="px-4 py-3">Mes</th>
                <th className="px-4 py-3">Casos</th>
                <th className="px-4 py-3">Alto riesgo</th>
                <th className="px-4 py-3">Clases / juegos</th>
                <th className="px-4 py-3">Sin folio</th>
                <th className="px-4 py-3">Sin pago</th>
                <th className="px-4 py-3">Pago incompleto</th>
                <th className="px-4 py-3">Monto faltante</th>
              </tr>
            </thead>
            <tbody>
              {summaryRows.map((row) => (
                <tr key={`${row.site_name}-${row.month}`} className="border-b border-zinc-100">
                  <td className="px-4 py-3 font-medium">{row.site_name}</td>
                  <td className="px-4 py-3">{row.month}</td>
                  <td className="px-4 py-3">{row.total_cases}</td>
                  <td className="px-4 py-3 text-red-700">{row.high_risk}</td>
                  <td className="px-4 py-3">{row.classes_attended}</td>
                  <td className="px-4 py-3">{row.missing_folio}</td>
                  <td className="px-4 py-3">{row.no_payment}</td>
                  <td className="px-4 py-3">{row.partial_payment}</td>
                  <td className="px-4 py-3 font-semibold">${money(row.missing_amount)}</td>
                </tr>
              ))}
              {summaryRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-zinc-500">No hay discrepancias con estos filtros.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Detalle de discrepancias" count={filteredItems.length} />
        <div className="max-w-full overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Riesgo</th>
                <th className="px-4 py-3">Sede / mes</th>
                <th className="px-4 py-3">Alumno</th>
                <th className="px-4 py-3">Tutor</th>
                <th className="px-4 py-3">Clases</th>
                <th className="px-4 py-3">Folio</th>
                <th className="px-4 py-3">Esperado</th>
                <th className="px-4 py-3">Pagado</th>
                <th className="px-4 py-3">Faltante</th>
                <th className="px-4 py-3">Origen</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className="border-b border-zinc-100 align-top">
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-1 text-xs font-medium ${item.severity === "high" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                      {discrepancyLabel(item.discrepancy_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{item.site_name}</p>
                    <p className="text-xs text-zinc-500">{item.month}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{item.student_name}</p>
                    <p className="text-xs text-zinc-500">{item.category || "Sin categoria"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p>{item.guardian_name || "Sin tutor"}</p>
                    <p className="text-xs text-zinc-500">{item.phone}</p>
                  </td>
                  <td className="px-4 py-3">{item.classes_attended}</td>
                  <td className="px-4 py-3">{item.folio || <span className="text-red-700">Sin folio</span>}</td>
                  <td className="px-4 py-3">${money(item.expected_amount)}</td>
                  <td className="px-4 py-3">${money(item.paid_amount)}</td>
                  <td className="px-4 py-3 font-semibold text-red-700">${money(item.missing_amount)}</td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    <p>{item.source === "historical" ? "Historico Excel" : "Plataforma actual"}</p>
                    <p>{item.source_file} fila {item.source_row}</p>
                    {item.observations && <p className="mt-1 text-zinc-600">{item.observations}</p>}
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-zinc-500">No hay discrepancias con estos filtros.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
