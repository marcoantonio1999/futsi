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
import { SportsPanel } from "./sports";


export function FormationBoard({ students, groupName }: { students: Student[]; groupName: string }) {
  const starters = students.slice(0, 11);
  const bench = students.slice(11);
  const slots = [
    { label: "POR", x: 8, y: 50 },
    { label: "LI", x: 26, y: 18 },
    { label: "DFC", x: 24, y: 39 },
    { label: "DFC", x: 24, y: 61 },
    { label: "LD", x: 26, y: 82 },
    { label: "MC", x: 49, y: 28 },
    { label: "MC", x: 45, y: 50 },
    { label: "MC", x: 49, y: 72 },
    { label: "EI", x: 73, y: 22 },
    { label: "DC", x: 80, y: 50 },
    { label: "ED", x: 73, y: 78 },
  ];

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="font-semibold">Formacion 4-3-3</h2>
        <p className="mt-1 text-sm text-zinc-500">{groupName} - 11 titulares y banca</p>
      </div>
      <div className="p-4">
        <div className="relative min-h-[460px] overflow-hidden rounded-md border border-red-900 bg-red-700">
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/60" />
          <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" />
          <div className="absolute left-0 top-1/2 h-44 w-20 -translate-y-1/2 border-y border-r border-white/60" />
          <div className="absolute right-0 top-1/2 h-44 w-20 -translate-y-1/2 border-y border-l border-white/60" />
          {slots.map((slot, index) => {
            const student = starters[index];
            return (
              <div
                key={slot.label + index}
                className="absolute w-24 -translate-x-1/2 -translate-y-1/2 text-center"
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              >
                <div className="mx-auto grid size-11 place-items-center rounded-full border-2 border-white bg-zinc-950 text-xs font-semibold text-white shadow-sm">
                  {slot.label}
                </div>
                <p className="mt-1 rounded-md bg-white/95 px-2 py-1 text-xs font-medium leading-tight text-zinc-950 shadow-sm">
                  {student?.full_name ?? "Pendiente"}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-4">
          <p className="text-sm font-semibold">Banca / repuesto</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {bench.map((student) => (
              <span key={student.id} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                {student.full_name}
              </span>
            ))}
            {bench.length === 0 && <span className="text-sm text-zinc-500">Sin banca cargada.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
