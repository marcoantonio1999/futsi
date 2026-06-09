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


export function chargeStatusLabel(status: ChargeStatus) {
  const labels: Record<ChargeStatus, string> = {
    pending: "Pendiente",
    partial: "Parcial",
    paid: "Pagado",
    canceled: "Cancelado",
  };
  return labels[status];
}

export function chargeLabel(charge: Charge) {
  return charge.description ? `${charge.concept} - ${charge.description}` : charge.concept;
}

export function paymentMethodLabel(method: PaymentMethod) {
  const labels: Record<PaymentMethod, string> = {
    cash: "Efectivo",
    transfer: "Transferencia",
    card: "Tarjeta",
    courtesy: "Cortesia",
  };
  return labels[method];
}

export function paymentStatusLabel(status: PaymentStatus) {
  const labels: Record<PaymentStatus, string> = {
    processing: "En proceso",
    awaiting_confirmation: "Pendiente de aceptacion",
    registered: "Registrado",
    reconciled: "Conciliado",
    canceled: "Cancelado",
    expired: "Expirado",
  };
  return labels[status];
}

export function expenseStatusLabel(status: ExpenseStatus) {
  const labels: Record<ExpenseStatus, string> = {
    pending: "Pendiente",
    approved: "Aprobado",
    rejected: "Rechazado",
    canceled: "Cancelado",
  };
  return labels[status];
}

export function staffPaymentKindLabel(kind: StaffPaymentKind) {
  const labels: Record<StaffPaymentKind, string> = {
    admin_payroll: "Nomina administrativa",
    coach_payroll: "Nomina coaches",
    referee_payroll: "Nomina arbitros",
    other_staff_payment: "Otro pago a personal",
  };
  return labels[kind];
}

export function staffPaymentStatusLabel(status: StaffPaymentStatus) {
  const labels: Record<StaffPaymentStatus, string> = {
    requested: "Pendiente de aceptar",
    accepted: "Aceptado",
    rejected: "Rechazado",
    canceled: "Cancelado",
  };
  return labels[status];
}

export function cashMovementLabel(type: CashMovementType) {
  const labels: Record<CashMovementType, string> = {
    cash_in: "Entrada efectivo",
    cash_out: "Salida efectivo",
    vault_transfer: "Retiro a resguardo",
    adjustment: "Ajuste",
  };
  return labels[type];
}

