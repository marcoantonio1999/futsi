import React from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  FileText,
  Shield,
  Trophy,
  Upload,
  UserRound,
  UsersRound,
} from "lucide-react";
import type { Role, TabKey } from "../../types";

export const fullWidthTabs = new Set<TabKey>([
  "dashboard",
  "adult-dashboard",
  "sports",
  "values",
  "tournaments",
  "coaches",
  "referees",
  "uniforms",
  "debts",
  "billing",
  "sales-estimate",
  "income-statement",
  "daily-operation",
  "expenses",
  "students",
  "invoices",
  "historical",
  "discrepancies",
]);

export function tabItems(): Array<{ key: TabKey; label: string; icon: React.ReactNode; adminOnly?: boolean }> {
  return [
    { key: "dashboard", label: "Dashboard", icon: <BarChart3 size={16} /> },
    { key: "adult-dashboard", label: "Liga adultos", icon: <UsersRound size={16} /> },
    { key: "sports", label: "Deportivo", icon: <BarChart3 size={16} /> },
    { key: "values", label: "Valores", icon: <Shield size={16} /> },
    { key: "tournaments", label: "Torneos", icon: <Trophy size={16} /> },
    { key: "coaches", label: "Coaches", icon: <UserRound size={16} /> },
    { key: "referees", label: "Arbitros", icon: <Shield size={16} /> },
    { key: "uniforms", label: "Uniformes", icon: <FileText size={16} /> },
    { key: "sales-estimate", label: "Estimacion ventas", icon: <BarChart3 size={16} /> },
    { key: "income-statement", label: "Estado resultados", icon: <FileText size={16} /> },
    { key: "daily-operation", label: "Operacion diaria", icon: <CalendarDays size={16} /> },
    { key: "attendance", label: "Asistencia", icon: <ClipboardCheck size={16} /> },
    { key: "billing", label: "Cobranza", icon: <CreditCard size={16} /> },
    { key: "debts", label: "Adeudos", icon: <AlertTriangle size={16} /> },
    { key: "expenses", label: "Gastos", icon: <FileText size={16} /> },
    { key: "students", label: "Alumnos", icon: <UsersRound size={16} /> },
    { key: "guardians", label: "Representantes", icon: <UserRound size={16} /> },
    { key: "sites", label: "Sedes", icon: <Building2 size={16} /> },
    { key: "users", label: "Usuarios", icon: <Shield size={16} />, adminOnly: true },
    { key: "invoices", label: "Facturas", icon: <FileText size={16} /> },
    { key: "historical", label: "Historico", icon: <Upload size={16} /> },
    { key: "discrepancies", label: "Discrepancias", icon: <AlertTriangle size={16} />, adminOnly: true },
  ];
}

export function defaultSectionsByRole(tabs: Array<{ key: TabKey }>): Record<Role, TabKey[]> {
  return {
    admin: tabs.map((tab) => tab.key),
    dev: tabs.map((tab) => tab.key),
    owner: tabs.map((tab) => tab.key),
    accounting: ["dashboard", "billing", "debts", "expenses", "sales-estimate", "income-statement", "daily-operation", "invoices", "historical", "discrepancies"],
    site_coordinator: ["dashboard", "sports", "values", "tournaments", "attendance", "billing", "debts", "expenses", "students", "guardians", "uniforms"],
    cashier: ["billing", "adult-dashboard"],
    coach: ["dashboard", "adult-dashboard", "attendance", "sports", "values", "tournaments"],
    guardian: ["sports"],
    adult_representative: ["adult-dashboard"],
    adult_player: ["adult-dashboard"],
  };
}
