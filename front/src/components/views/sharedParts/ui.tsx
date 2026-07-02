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


export function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const canRenderImage = Boolean(imageUrl && /^(https?:|data:|blob:)/i.test(imageUrl));
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return canRenderImage ? (
    <img className="size-16 rounded-md object-cover" src={imageUrl} alt={name} />
  ) : (
    <div className="grid size-16 place-items-center rounded-md bg-emerald-700 text-lg font-semibold text-white">{initials || "U"}</div>
  );
}
export function AttendanceButton({
  active,
  disabled,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-h-10 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium transition hover:-translate-y-0.5 hover:shadow-sm disabled:opacity-50 ${
        active ? "border-red-700 bg-red-700 text-white" : "border-zinc-300 bg-white text-zinc-700"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
export function TableHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="motion-header flex items-center justify-between border-b border-zinc-200 px-4 py-3">
      <h2 className="font-semibold">{title}</h2>
      <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{count}</span>
    </div>
  );
}

export function StatusPill({ label, tone = "ok" }: { label: string; tone?: "ok" | "warn" | "danger" | "neutral" }) {
  const styles = {
    ok: "bg-emerald-50 text-emerald-800",
    warn: "bg-amber-50 text-amber-800",
    danger: "bg-red-50 text-red-700",
    neutral: "bg-zinc-100 text-zinc-600",
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-medium transition-colors duration-200 ${styles[tone]}`}>{label}</span>;
}

export function InfoChip({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "danger" | "neutral" }) {
  const styles = {
    ok: "bg-emerald-50 text-emerald-800",
    warn: "bg-amber-50 text-amber-800",
    danger: "bg-red-50 text-red-700",
    neutral: "bg-zinc-100 text-zinc-600",
  };
  return (
    <div className={`motion-card rounded-md px-3 py-2 text-xs ${styles[tone]}`}>
      <p className="font-medium">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}
export function SimpleList({ title, count, rows }: { title: string; count: number; rows: Array<{ id: number | string; title: string; subtitle: string }> }) {
  return (
    <div className="motion-card rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title={title} count={count} />
      <div className="motion-list divide-y divide-zinc-100">
        {rows.map((row) => (
          <div key={row.id} className="px-4 py-3 transition-colors hover:bg-zinc-50">
            <p className="font-medium">{row.title}</p>
            <p className="mt-1 text-sm text-zinc-500">{row.subtitle}</p>
          </div>
        ))}
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin registros.</p>}
      </div>
    </div>
  );
}


