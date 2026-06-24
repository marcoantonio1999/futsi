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
import { Metric } from "../../cards/Metric";
import { CollectionFunnel } from "../../charts/CollectionFunnel";
import { FinancialAxisChart } from "../../charts/FinancialAxisChart";
import { FinancialComboChart } from "../../charts/FinancialComboChart";
import { PaymentMethodDonut } from "../../charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../../charts/PendingBySiteChart";
import { StudentStatusDonut } from "../../charts/StudentStatusDonut";
import { API_URL } from "../../../api";
import { roleLabels, statusLabels } from "../../../appState";
import { money } from "../../../utils/format";
import type { AccountingSiteRow, AppData, AttendanceRecord, AttendanceSession, CashMovementType, Charge, ChargeStatus, Discount, Expense, ExpenseStatus, FaceRecognitionResponse, Guardian, HistoricalDiscrepancyReport, HistoricalImport, Invoice, Match, Payment, PaymentMethod, PaymentStatus, Player, PlayerAttendanceRecord, Role, Site, StaffPaymentKind, StaffPaymentRequest, StaffPaymentStatus, StandingRow, Student, StudentAssessment, Team, ThemeMode, User } from "../../../types";


export function paymentMonthKey(payment: Payment) {
  const rawDate = payment.confirmed_at || payment.paid_at;
  const date = rawDate ? new Date(rawDate) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabelFromKey(monthKey: string) {
  if (!monthKey) return "sin mes";
  const [year, month] = monthKey.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

export function paymentPayerKey(payment: Payment) {
  if (payment.student) return `student:${payment.student}`;
  if (payment.student_name) return `student-name:${payment.student_name.trim().toLowerCase()}`;
  if (payment.team_name) return `team:${payment.team_name.trim().toLowerCase()}`;
  if (payment.charge) return `charge:${payment.charge}`;
  return `payment:${payment.id}`;
}

export function calculateMonthlyTicketAverage(payments: Payment[]) {
  const confirmedPayments = payments.filter((payment) => payment.status === "registered" || payment.status === "reconciled");
  const monthKeys = Array.from(new Set(confirmedPayments.map(paymentMonthKey).filter(Boolean))).sort();
  const currentMonthKey = paymentMonthKey({ paid_at: new Date().toISOString(), confirmed_at: null } as Payment);
  const selectedMonth = monthKeys.includes(currentMonthKey) ? currentMonthKey : monthKeys.at(-1) || "";
  const monthPayments = confirmedPayments.filter((payment) => paymentMonthKey(payment) === selectedMonth);
  const payerKeys = new Set(monthPayments.map(paymentPayerKey));
  const total = monthPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return {
    amount: payerKeys.size ? total / payerKeys.size : 0,
    total,
    payerCount: payerKeys.size,
    paymentCount: monthPayments.length,
    monthKey: selectedMonth,
    monthLabel: monthLabelFromKey(selectedMonth),
  };
}

export function sumAccountingRows(rows: AccountingSiteRow[]) {
  return rows.reduce(
    (totals, row) => ({
      ingresos: totals.ingresos + row.ingresos,
      egresos: totals.egresos + row.egresos,
      utilidad: totals.utilidad + row.utilidad,
      pendiente: totals.pendiente + row.pendiente,
    }),
    { ingresos: 0, egresos: 0, utilidad: 0, pendiente: 0 }
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, className = "", ...inputProps } = props;
  return (
    <label className={`block text-sm ${className}`}>
      <span className="font-medium text-zinc-700">
        {label}
        {inputProps.required ? <span className="ml-1 text-red-600">*</span> : null}
      </span>
      <input
        {...inputProps}
        aria-required={inputProps.required || undefined}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none invalid:border-red-500 invalid:bg-red-50 focus:border-emerald-700 invalid:focus:border-red-600"
      />
    </label>
  );
}

export function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const { label, children, className = "", ...selectProps } = props;
  return (
    <label className={`block text-sm ${className}`}>
      <span className="font-medium text-zinc-700">
        {label}
        {selectProps.required ? <span className="ml-1 text-red-600">*</span> : null}
      </span>
      <select
        {...selectProps}
        aria-required={selectProps.required || undefined}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none invalid:border-red-500 invalid:bg-red-50 focus:border-emerald-700 invalid:focus:border-red-600"
      >
        {children}
      </select>
    </label>
  );
}
export function average(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
}

export function dateMonthKey(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function dateDay(value: string | null | undefined) {
  if (!value) return 1;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 1 : date.getDate();
}

export function collectionProgress(day: number) {
  const curve = [0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.68, 0.7, 0.73, 0.76, 0.78, 0.8, 0.83, 0.85, 0.87, 0.89, 0.9, 0.91, 0.93, 0.95, 0.97, 0.99, 1, 1];
  return curve[Math.max(1, Math.min(31, day)) - 1] ?? 1;
}

export function methodLabel(method: PaymentMethod) {
  return method === "cash" ? "Efectivo" : method === "transfer" ? "Transferencias" : method === "card" ? "Tarjetas" : "Cortesia";
}
export function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

