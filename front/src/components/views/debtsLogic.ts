import { money } from "../../utils/format";
import type { AppData, Charge, Payment } from "../../types";

export type DebtRow = {
  charge: Charge;
  debtorName: string;
  contactName: string;
  phone: string;
  siteName: string;
  concept: string;
  amount: number;
  paid: number;
  balance: number;
  dueDate: string | null;
  dueMonth: string;
  overdueDays: number;
  reason: string;
  risk: "critico" | "alto" | "medio" | "bajo";
  shiftedMonth: string;
};

export type OutreachState = {
  sentAt: string | null;
  seenAt: string | null;
  calledAt: string | null;
};

export type MoneyPoint = {
  label: string;
  esperado: number;
  cobrado: number;
  diferido: number;
  utilidadEsperada?: number;
  utilidadActual?: number;
};

export function amount(value: string | number | null | undefined) {
  return Number(value || 0);
}

export function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function monthKey(value: string | null | undefined) {
  return (value || "").slice(0, 7) || "Sin fecha";
}

function addMonths(month: string, delta: number) {
  if (!/^\d{4}-\d{2}$/.test(month)) return "Sin fecha";
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("es-MX", { month: "short", year: "numeric" });
}

export function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, delta: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + delta);
  return copy;
}

export function currentOperationalMonth(data: AppData) {
  const months = [
    ...data.charges.map((charge) => monthKey(charge.due_date)),
    ...data.payments.map((payment) => monthKey(payment.paid_at)),
  ].filter((month) => /^\d{4}-\d{2}$/.test(month));
  if (!months.length) return new Date().toISOString().slice(0, 7);
  return months.sort().at(-1) || new Date().toISOString().slice(0, 7);
}

function daysBetween(a: Date, b: Date) {
  const ms = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.floor(ms / 86400000);
}

function confirmed(payment: Payment) {
  return payment.status === "registered" || payment.status === "reconciled";
}

function debtorName(charge: Charge, data: AppData) {
  if (charge.student_name) return charge.student_name;
  if (charge.team) return data.teams.find((team) => team.id === charge.team)?.name || `Equipo ${charge.team}`;
  return "Cliente sin identificar";
}

function debtorContact(charge: Charge, data: AppData) {
  if (charge.student) {
    const student = data.students.find((item) => item.id === charge.student);
    return {
      contactName: student?.guardian_name || charge.student_name || "Representante",
      phone: student?.guardian_phone || "",
    };
  }
  if (charge.team) {
    const team = data.teams.find((item) => item.id === charge.team);
    return {
      contactName: team?.representative_name || team?.name || "Representante adulto",
      phone: team?.representative_phone || "",
    };
  }
  return { contactName: "Sin contacto", phone: "" };
}

function reasonForDebt(charge: Charge, data: AppData, today: Date) {
  const relatedPayments = data.payments.filter((payment) => payment.charge === charge.id);
  const pendingPayment = relatedPayments.find((payment) => payment.status === "processing" || payment.status === "awaiting_confirmation");
  const requestedDiscount = data.discounts.find((discount) => discount.charge === charge.id && discount.status === "requested");
  const dueDate = parseDate(charge.due_date);
  const overdueDays = dueDate ? Math.max(0, daysBetween(today, dueDate)) : 0;

  if (pendingPayment?.method === "transfer") return "Transferencia en proceso";
  if (pendingPayment?.method === "cash") return "Efectivo pendiente de confirmacion";
  if (pendingPayment?.method === "card") return "Tarjeta/link en validacion";
  if (requestedDiscount) return "Descuento pendiente de aprobacion";
  if (charge.status === "partial" || amount(charge.paid_amount) > 0) return "Pago parcial";
  if (!charge.due_date) return "Sin fecha de vencimiento";
  if (overdueDays > 10) return "Mora mayor a 10 dias";
  if (overdueDays > 0) return "Vencido reciente";
  return "Aun no vence";
}

function riskForDebt(balance: number, overdueDays: number, reason: string): DebtRow["risk"] {
  if (overdueDays > 10 && balance >= 1000) return "critico";
  if (overdueDays > 10 || reason.includes("Mora")) return "alto";
  if (reason.includes("Pago parcial") || reason.includes("proceso") || reason.includes("validacion") || overdueDays > 0) return "medio";
  return "bajo";
}

export function riskLabel(risk: DebtRow["risk"]) {
  const labels = { critico: "Critico", alto: "Alto", medio: "Medio", bajo: "Bajo" };
  return labels[risk];
}

export function riskClass(risk: DebtRow["risk"]) {
  if (risk === "critico" || risk === "alto") return "bg-red-50 text-red-700";
  if (risk === "medio") return "bg-amber-50 text-amber-800";
  return "bg-emerald-50 text-emerald-800";
}

export function buildDebtRows(data: AppData, today: Date): DebtRow[] {
  return data.charges
    .filter((charge) => charge.status !== "canceled" && amount(charge.balance) > 0)
    .map((charge) => {
      const dueDate = parseDate(charge.due_date);
      const overdueDays = dueDate ? Math.max(0, daysBetween(today, dueDate)) : 0;
      const reason = reasonForDebt(charge, data, today);
      const balance = amount(charge.balance);
      const dueMonth = monthKey(charge.due_date);
      const contact = debtorContact(charge, data);
      return {
        charge,
        debtorName: debtorName(charge, data),
        contactName: contact.contactName,
        phone: contact.phone,
        siteName: charge.site_name || data.sites.find((site) => site.id === charge.site)?.name || "Sin sede",
        concept: charge.concept,
        amount: amount(charge.amount),
        paid: amount(charge.paid_amount),
        balance,
        dueDate: charge.due_date,
        dueMonth,
        overdueDays,
        reason,
        risk: riskForDebt(balance, overdueDays, reason),
        shiftedMonth: addMonths(dueMonth, 1),
      };
    })
    .sort((a, b) => b.overdueDays - a.overdueDays || b.balance - a.balance);
}

export function defaultOutreach(debt: DebtRow, today: Date): OutreachState {
  if ((debt.risk === "critico" || debt.risk === "alto") && debt.overdueDays >= 4) {
    return { sentAt: formatDate(addDays(today, -4)), seenAt: null, calledAt: null };
  }
  if (debt.risk === "medio" && debt.overdueDays >= 1) {
    return { sentAt: formatDate(addDays(today, -1)), seenAt: null, calledAt: null };
  }
  return { sentAt: null, seenAt: null, calledAt: null };
}

export function daysSinceSent(outreach: OutreachState, today: Date) {
  const sentAt = parseDate(outreach.sentAt);
  if (!sentAt) return 0;
  return Math.max(0, daysBetween(today, sentAt));
}

export function outreachLabel(outreach: OutreachState, today: Date) {
  if (outreach.calledAt) return "Llamada registrada";
  if (outreach.seenAt) return "Visto";
  if (outreach.sentAt && daysSinceSent(outreach, today) >= 3) return "Requiere llamada";
  if (outreach.sentAt) return "Enviado sin visto";
  return "Sin enviar";
}

export function outreachClass(outreach: OutreachState, today: Date) {
  const label = outreachLabel(outreach, today);
  if (label === "Requiere llamada") return "bg-red-50 text-red-700";
  if (label === "Enviado sin visto") return "bg-amber-50 text-amber-800";
  if (label === "Visto" || label === "Llamada registrada") return "bg-emerald-50 text-emerald-800";
  return "bg-zinc-100 text-zinc-600";
}

export function cleanPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  return digits;
}

export function whatsappMessage(debt: DebtRow) {
  return `Hola ${debt.contactName}, te escribimos de Futsi. Tenemos un saldo pendiente de $${money(debt.balance)} por ${debt.concept} de ${debt.debtorName}. Vencia el ${debt.dueDate || "periodo registrado"}. Puedes liquidarlo por transferencia, tarjeta o en ventanilla. Si ya pagaste, por favor ignora este mensaje y comparte tu comprobante.`;
}

export function buildBurndown(data: AppData, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const monthCharges = data.charges.filter((charge) => monthKey(charge.due_date) === month && charge.status !== "canceled");
  const confirmedPayments = data.payments.filter((payment) => confirmed(payment) && monthKey(payment.paid_at) === month);
  const points: MoneyPoint[] = [];
  for (let day = 1; day <= days; day += 1) {
    const expected = monthCharges
      .filter((charge) => Number((charge.due_date || "").slice(8, 10)) <= day)
      .reduce((sum, charge) => sum + amount(charge.amount), 0);
    const collected = confirmedPayments
      .filter((payment) => Number((payment.paid_at || "").slice(8, 10)) <= day)
      .reduce((sum, payment) => sum + amount(payment.amount), 0);
    points.push({
      label: String(day),
      esperado: expected,
      cobrado: collected,
      diferido: Math.max(0, expected - collected),
    });
  }
  return points;
}

export function buildMonthImpact(data: AppData, debtRows: DebtRow[]) {
  const chargeMonths = new Map<string, MoneyPoint>();
  data.charges
    .filter((charge) => charge.status !== "canceled")
    .forEach((charge) => {
      const key = monthKey(charge.due_date);
      const row = chargeMonths.get(key) || { label: monthLabel(key), esperado: 0, cobrado: 0, diferido: 0 };
      row.esperado += amount(charge.amount);
      row.diferido += amount(charge.balance);
      chargeMonths.set(key, row);
    });
  data.payments
    .filter(confirmed)
    .forEach((payment) => {
      const key = monthKey(payment.paid_at);
      const row = chargeMonths.get(key) || { label: monthLabel(key), esperado: 0, cobrado: 0, diferido: 0 };
      row.cobrado += amount(payment.amount);
      chargeMonths.set(key, row);
    });
  debtRows.forEach((debt) => {
    const shifted = chargeMonths.get(debt.shiftedMonth) || { label: monthLabel(debt.shiftedMonth), esperado: 0, cobrado: 0, diferido: 0 };
    shifted.esperado += debt.balance;
    chargeMonths.set(debt.shiftedMonth, shifted);
  });
  return [...chargeMonths.entries()]
    .filter(([key]) => /^\d{4}-\d{2}$/.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, row]) => row);
}

export function buildUtilityImpact(data: AppData, debtRows: DebtRow[], month: string) {
  const monthCharges = data.charges.filter((charge) => monthKey(charge.due_date) === month && charge.status !== "canceled");
  const monthPayments = data.payments.filter((payment) => confirmed(payment) && monthKey(payment.paid_at) === month);
  const monthExpenses = data.expenses.filter((expense) => expense.status === "approved" && monthKey(expense.expense_date) === month);
  const expectedIncome = monthCharges.reduce((sum, charge) => sum + amount(charge.amount), 0);
  const collectedIncome = monthPayments.reduce((sum, payment) => sum + amount(payment.amount), 0);
  const deferredIncome = debtRows.filter((debt) => debt.dueMonth === month).reduce((sum, debt) => sum + debt.balance, 0);
  const expenses = monthExpenses.reduce((sum, expense) => sum + amount(expense.amount), 0);
  return [
    { label: "Plan del mes", utilidadEsperada: expectedIncome - expenses, utilidadActual: 0, esperado: expectedIncome, cobrado: 0, diferido: 0 },
    { label: "Cobrado real", utilidadEsperada: 0, utilidadActual: collectedIncome - expenses, esperado: 0, cobrado: collectedIncome, diferido: 0 },
    { label: "Ingreso diferido", utilidadEsperada: 0, utilidadActual: 0, esperado: 0, cobrado: 0, diferido: deferredIncome },
  ];
}
