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
import { Metric } from "../../components/cards/Metric";
import { CollectionFunnel } from "../../components/charts/CollectionFunnel";
import { FinancialAxisChart } from "../../components/charts/FinancialAxisChart";
import { FinancialComboChart } from "../../components/charts/FinancialComboChart";
import { PaymentMethodDonut } from "../../components/charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../../components/charts/PendingBySiteChart";
import { StudentStatusDonut } from "../../components/charts/StudentStatusDonut";
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
} from "../../components/views/shared";


export function getCoachStudentLoad(data: AppData) {
  return data.users
    .filter((user) => user.role === "coach")
    .map((coach) => {
      const assignedStudents = data.students.filter((student) => {
        if (coach.primary_site && student.site !== coach.primary_site) return false;
        if (coach.coach_group_name) return student.group_name === coach.coach_group_name;
        return true;
      });
      const activeStudents = assignedStudents.filter((student) => student.status === "active");
      const debtStudents = assignedStudents.filter((student) => student.open_charge_count > 0);
      const medicalStudents = assignedStudents.filter((student) => student.medical_notes);
      return {
        coach,
        coachName: `${coach.first_name || ""} ${coach.last_name || ""}`.trim() || coach.username,
        siteName: coach.primary_site_name || data.sites.find((site) => site.id === coach.primary_site)?.name || "Sin sede",
        groupName: coach.coach_group_name || "Todos los grupos de la sede",
        totalStudents: assignedStudents.length,
        activeStudents: activeStudents.length,
        debtStudents: debtStudents.length,
        medicalStudents: medicalStudents.length,
      };
    })
    .sort((a, b) => b.totalStudents - a.totalStudents || a.coachName.localeCompare(b.coachName));
}

export function CoachStudentLoadPanel({ data }: { data: AppData }) {
  const rows = getCoachStudentLoad(data);
  const totalAssigned = rows.reduce((sum, row) => sum + row.totalStudents, 0);
  const average = rows.length ? totalAssigned / rows.length : 0;

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-emerald-700">Carga por coach</p>
          <h2 className="font-semibold">Alumnos asignados por coach</h2>
          <p className="mt-1 text-sm text-zinc-500">Conteo por sede y grupo asignado; no depende de los torneos que administre el coach.</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">
          Promedio {average.toFixed(1)} alumnos
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3">Coach</th>
              <th className="px-4 py-3">Sede</th>
              <th className="px-4 py-3">Grupo asignado</th>
              <th className="px-4 py-3">Alumnos</th>
              <th className="px-4 py-3">Activos</th>
              <th className="px-4 py-3">Con adeudo</th>
              <th className="px-4 py-3">Alertas medicas</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.coach.id} className="border-b border-zinc-100">
                <td className="px-4 py-3 font-medium">{row.coachName}</td>
                <td className="px-4 py-3">{row.siteName}</td>
                <td className="px-4 py-3">{row.groupName}</td>
                <td className="px-4 py-3">{row.totalStudents}</td>
                <td className="px-4 py-3">{row.activeStudents}</td>
                <td className="px-4 py-3">{row.debtStudents}</td>
                <td className="px-4 py-3">{row.medicalStudents}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-500">
                  No hay coaches cargados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
