import type { AppData, Expense, Payment, Site } from "../../types";
import { normalizeText } from "./shared";

export type BusinessUnit = "consolidated" | "academy" | "league" | "uniforms" | "corporate";
export type StatementGroup = "income" | "operating" | "fixed" | "corporate" | "non_recurrent";

export type StatementEntry = {
  id: string;
  label: string;
  group: StatementGroup;
  unit: BusinessUnit;
  amount: number;
  source: "payment" | "expense";
  date: string;
  site: number | null;
  detail: string;
};

export type SiteContribution = {
  siteId: number | null;
  label: string;
  income: number;
  operating: number;
  fixed: number;
  corporate: number;
  nonRecurrent: number;
  net: number;
  margin: number;
};

export const units: Array<{ key: BusinessUnit; label: string }> = [
  { key: "consolidated", label: "Consolidado" },
  { key: "academy", label: "Academia" },
  { key: "league", label: "Liga adultos" },
  { key: "uniforms", label: "Uniformes" },
  { key: "corporate", label: "Corporativo" },
];

export const groupLabels: Record<StatementGroup, string> = {
  income: "Ingresos",
  operating: "Gastos operativos",
  fixed: "Gastos fijos",
  corporate: "Gastos corporativos",
  non_recurrent: "Gastos no recurrentes",
};

export const statementColors = {
  income: "#059669",
  operating: "#dc2626",
  fixed: "#f97316",
  corporate: "#7c3aed",
  non_recurrent: "#71717a",
  utility: "#18181b",
};

export function monthKey(date: string | null | undefined) {
  return date ? date.slice(0, 7) : "";
}

function isConfirmed(payment: Payment) {
  return payment.status === "registered" || payment.status === "reconciled";
}

function paymentDate(payment: Payment) {
  return payment.confirmed_at || payment.paid_at;
}

function detectPaymentUnit(payment: Payment): BusinessUnit {
  const text = normalizeText(`${payment.charge_concept || ""} ${payment.notes || ""} ${payment.team_name || ""}`);
  if (text.includes("uniform")) return "uniforms";
  if (payment.team_name || text.includes("liga") || text.includes("jornada") || text.includes("torneo") || text.includes("arbit") || text.includes("cancha")) return "league";
  return "academy";
}

function detectPaymentCategory(payment: Payment) {
  const text = normalizeText(`${payment.charge_concept || ""} ${payment.notes || ""} ${payment.team_name || ""}`);
  if (text.includes("uniform")) return "Ingresos uniformes";
  if (text.includes("arbit")) return "Ingresos arbitraje";
  if (text.includes("renta") || text.includes("cancha")) return "Renta de cancha";
  if (text.includes("copa")) return "Ingr Copas";
  if (text.includes("intensivo")) return "Curso Intensivo";
  if (text.includes("verano")) return "Curso de Verano";
  if (payment.team_name || text.includes("liga") || text.includes("jornada") || text.includes("torneo")) return "Liga Local";
  return "Ingresos academia";
}

function detectExpenseUnit(expense: Expense): BusinessUnit {
  const text = normalizeText(`${expense.category} ${expense.description}`);
  if (text.includes("uniform") || text.includes("estamp")) return "uniforms";
  if (text.includes("liga") || text.includes("arbit") || text.includes("premiacion")) return "league";
  if (text.includes("corporativo") || text.includes("impuesto") || text.includes("betis") || text.includes("vacante")) return "corporate";
  return "academy";
}

function detectExpenseGroup(expense: Expense): StatementGroup {
  const text = normalizeText(`${expense.category} ${expense.description}`);
  if (text.includes("mejora") || text.includes("pasto") || text.includes("redes") || text.includes("mallas")) return "non_recurrent";
  if (text.includes("corporativo") || text.includes("impuesto") || text.includes("betis") || text.includes("vacante") || text.includes("combustible")) return "corporate";
  if (text.includes("renta") || text.includes("instalacion")) return "fixed";
  return "operating";
}

function detectExpenseCategory(expense: Expense) {
  const text = normalizeText(`${expense.category} ${expense.description}`);
  if (text.includes("bono")) return "Bonos";
  if (text.includes("coach")) return "Nomina coaches";
  if (text.includes("admin") || text.includes("administracion") || text.includes("administrativo")) return "Nomina administrativa";
  if (text.includes("arbit")) return "Arbitraje";
  if (text.includes("renta")) return "Renta";
  if (text.includes("corporativo") || text.includes("prorrata")) return "Corporativo";
  if (text.includes("traslado") || text.includes("viatico")) return "Traslados";
  if (text.includes("balon")) return "Balones";
  if (text.includes("uniform")) return "Compra de uniformes";
  if (text.includes("estamp")) return "Estampados";
  if (text.includes("material") || text.includes("deportivo")) return "Mat Deportivos";
  if (text.includes("mantenimiento") || text.includes("limpieza")) return "Mantto y Limpieza";
  if (text.includes("publicidad")) return "Publicidad";
  if (text.includes("servicio") || text.includes("luz") || text.includes("telefono")) return "Servicios";
  if (text.includes("papel")) return "Papeleria";
  if (text.includes("premi")) return "Premiaciones";
  if (text.includes("reembolso") || text.includes("rembolso")) return "Reembolso";
  if (text.includes("mejora")) return "Mejoras";
  if (text.includes("operativo") || text.includes("operacion")) return "Operacion sede";
  return "Otros";
}

function paymentSite(payment: Payment, chargeSiteById: Map<number, number>) {
  if (payment.site) return payment.site;
  return payment.charge ? chargeSiteById.get(payment.charge) || null : null;
}

export function matchesFilters(entry: StatementEntry, unit: BusinessUnit, siteId: string, month: string) {
  const unitMatch = unit === "consolidated" || entry.unit === unit || (unit === "corporate" && entry.group === "corporate");
  const siteMatch = siteId === "all" || String(entry.site || "") === siteId;
  return unitMatch && siteMatch && monthKey(entry.date) === month;
}

export function buildEntries(data: AppData) {
  const chargeSiteById = new Map(data.charges.map((charge) => [charge.id, charge.site]));
  const payments: StatementEntry[] = data.payments.filter(isConfirmed).map((payment) => ({
    id: `payment-${payment.id}`,
    label: detectPaymentCategory(payment),
    group: "income",
    unit: detectPaymentUnit(payment),
    amount: Number(payment.amount || 0),
    source: "payment",
    date: paymentDate(payment),
    site: paymentSite(payment, chargeSiteById),
    detail: `${payment.student_name || payment.team_name || "Cliente"} - ${payment.method}`,
  }));
  const expenses: StatementEntry[] = data.expenses.filter((expense) => expense.status === "approved").map((expense) => ({
    id: `expense-${expense.id}`,
    label: detectExpenseCategory(expense),
    group: detectExpenseGroup(expense),
    unit: detectExpenseUnit(expense),
    amount: Number(expense.amount || 0),
    source: "expense",
    date: expense.expense_date,
    site: expense.site,
    detail: `${expense.site_name || "Sede"} - ${expense.provider_name || "Sin proveedor"} - ${expense.description}`,
  }));
  return [...payments, ...expenses];
}

export function sum(entries: StatementEntry[], group: StatementGroup) {
  return entries.filter((entry) => entry.group === group).reduce((total, entry) => total + entry.amount, 0);
}

export function groupByCategory(entries: StatementEntry[]) {
  const byCategory = new Map<string, { label: string; group: StatementGroup; amount: number; count: number }>();
  entries.forEach((entry) => {
    const key = `${entry.group}-${entry.label}`;
    const current = byCategory.get(key) || { label: entry.label, group: entry.group, amount: 0, count: 0 };
    current.amount += entry.amount;
    current.count += 1;
    byCategory.set(key, current);
  });
  return Array.from(byCategory.values()).sort((a, b) => {
    if (a.group !== b.group) return a.group.localeCompare(b.group);
    return b.amount - a.amount;
  });
}

export function buildMonthlyTrend(entries: StatementEntry[], unit: BusinessUnit, siteId: string, selectedMonth: string) {
  const year = Number(selectedMonth.slice(0, 4));
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    const rows = entries.filter((entry) => matchesFilters(entry, unit, siteId, month));
    const income = sum(rows, "income");
    const expenses = sum(rows, "operating") + sum(rows, "fixed") + sum(rows, "corporate") + sum(rows, "non_recurrent");
    return { month: month.slice(5), ingresos: income, gastos: expenses, utilidad: income - expenses };
  });
}

function unitMatches(entry: StatementEntry, unit: BusinessUnit) {
  return unit === "consolidated" || entry.unit === unit || (unit === "corporate" && entry.group === "corporate");
}

export function buildSiteContribution(entries: StatementEntry[], sites: Site[], unit: BusinessUnit, selectedMonth: string) {
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));
  const grouped = new Map<number | null, SiteContribution>();
  entries
    .filter((entry) => unitMatches(entry, unit) && monthKey(entry.date) === selectedMonth)
    .forEach((entry) => {
      const key = entry.site ?? null;
      const current = grouped.get(key) || {
        siteId: key,
        label: key ? siteNames.get(key) || "Sede" : "Sin sede / corporativo",
        income: 0,
        operating: 0,
        fixed: 0,
        corporate: 0,
        nonRecurrent: 0,
        net: 0,
        margin: 0,
      };
      if (entry.group === "income") current.income += entry.amount;
      if (entry.group === "operating") current.operating += entry.amount;
      if (entry.group === "fixed") current.fixed += entry.amount;
      if (entry.group === "corporate") current.corporate += entry.amount;
      if (entry.group === "non_recurrent") current.nonRecurrent += entry.amount;
      current.net = current.income - current.operating - current.fixed - current.corporate - current.nonRecurrent;
      current.margin = current.income ? (current.net / current.income) * 100 : 0;
      grouped.set(key, current);
    });
  return Array.from(grouped.values()).sort((a, b) => b.net - a.net);
}
