import { useState } from "react";
import { Eye, MessageCircle, Phone } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Metric } from "../cards/Metric";
import { ChartCardHeader } from "../charts/ChartHelp";
import { MiniMoneyTooltip } from "../charts/ChartTooltips";
import { compactMoney, money } from "../../utils/format";
import type { AppData, Charge, Payment } from "../../types";
import { TableHeader } from "./shared";

type DebtRow = {
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

type OutreachState = {
  sentAt: string | null;
  seenAt: string | null;
  calledAt: string | null;
};

type MoneyPoint = {
  label: string;
  esperado: number;
  cobrado: number;
  diferido: number;
  utilidadEsperada?: number;
  utilidadActual?: number;
};

function amount(value: string | number | null | undefined) {
  return Number(value || 0);
}

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function monthKey(value: string | null | undefined) {
  return (value || "").slice(0, 7) || "Sin fecha";
}

function addMonths(month: string, delta: number) {
  if (!/^\d{4}-\d{2}$/.test(month)) return "Sin fecha";
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("es-MX", { month: "short", year: "numeric" });
}

function formatDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, delta: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + delta);
  return copy;
}

function currentOperationalMonth(data: AppData) {
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

function riskLabel(risk: DebtRow["risk"]) {
  const labels = { critico: "Critico", alto: "Alto", medio: "Medio", bajo: "Bajo" };
  return labels[risk];
}

function riskClass(risk: DebtRow["risk"]) {
  if (risk === "critico" || risk === "alto") return "bg-red-50 text-red-700";
  if (risk === "medio") return "bg-amber-50 text-amber-800";
  return "bg-emerald-50 text-emerald-800";
}

function buildDebtRows(data: AppData, today: Date): DebtRow[] {
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

function defaultOutreach(debt: DebtRow, today: Date): OutreachState {
  if ((debt.risk === "critico" || debt.risk === "alto") && debt.overdueDays >= 4) {
    return { sentAt: formatDate(addDays(today, -4)), seenAt: null, calledAt: null };
  }
  if (debt.risk === "medio" && debt.overdueDays >= 1) {
    return { sentAt: formatDate(addDays(today, -1)), seenAt: null, calledAt: null };
  }
  return { sentAt: null, seenAt: null, calledAt: null };
}

function daysSinceSent(outreach: OutreachState, today: Date) {
  const sentAt = parseDate(outreach.sentAt);
  if (!sentAt) return 0;
  return Math.max(0, daysBetween(today, sentAt));
}

function outreachLabel(outreach: OutreachState, today: Date) {
  if (outreach.calledAt) return "Llamada registrada";
  if (outreach.seenAt) return "Visto";
  if (outreach.sentAt && daysSinceSent(outreach, today) >= 3) return "Requiere llamada";
  if (outreach.sentAt) return "Enviado sin visto";
  return "Sin enviar";
}

function outreachClass(outreach: OutreachState, today: Date) {
  const label = outreachLabel(outreach, today);
  if (label === "Requiere llamada") return "bg-red-50 text-red-700";
  if (label === "Enviado sin visto") return "bg-amber-50 text-amber-800";
  if (label === "Visto" || label === "Llamada registrada") return "bg-emerald-50 text-emerald-800";
  return "bg-zinc-100 text-zinc-600";
}

function cleanPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `52${digits}`;
  return digits;
}

function whatsappMessage(debt: DebtRow) {
  return `Hola ${debt.contactName}, te escribimos de Futsi. Tenemos un saldo pendiente de $${money(debt.balance)} por ${debt.concept} de ${debt.debtorName}. Vencia el ${debt.dueDate || "periodo registrado"}. Puedes liquidarlo por transferencia, tarjeta o en ventanilla. Si ya pagaste, por favor ignora este mensaje y comparte tu comprobante.`;
}

function buildBurndown(data: AppData, month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const days = new Date(year, monthNumber, 0).getDate();
  const monthCharges = data.charges.filter((charge) => monthKey(charge.due_date) === month && charge.status !== "canceled");
  const confirmedPayments = data.payments.filter((payment) => confirmed(payment) && monthKey(payment.paid_at) === month);
  const points = [];
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

function buildMonthImpact(data: AppData, debtRows: DebtRow[]) {
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

function buildUtilityImpact(data: AppData, debtRows: DebtRow[], month: string) {
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

function DebtsTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-zinc-900">{label}</p>
      {payload.map((item) => (
        <p key={item.dataKey} style={{ color: item.color }}>
          {item.name}: ${money(Number(item.value || 0))}
        </p>
      ))}
    </div>
  );
}

function BurndownChart({ rows, month }: { rows: MoneyPoint[]; month: string }) {
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Burndown de cobranza"
        title={`Recuperacion del mes: ${monthLabel(month)}`}
        help="La linea gris es el dinero que deberia acumularse segun vencimientos del mes. La verde es lo cobrado. El area roja es dinero diferido: mientras mas grande, mayor impacto de adeudos sobre caja esperada."
      />
      <div className="h-[340px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 10, right: 24, bottom: 8, left: 0 }}>
            <defs>
              <linearGradient id="debtDeferred" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#dc2626" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#dc2626" stopOpacity={0.04} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#71717a" }} />
            <YAxis tickFormatter={(value) => compactMoney(Number(value))} tick={{ fontSize: 12, fill: "#71717a" }} />
            <Tooltip content={<DebtsTooltip />} />
            <Legend />
            <Line type="monotone" dataKey="esperado" name="Esperado" stroke="#71717a" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="cobrado" name="Cobrado" stroke="#059669" strokeWidth={3} dot={false} />
            <Area type="monotone" dataKey="diferido" name="Diferido" stroke="#dc2626" fill="url(#debtDeferred)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function FutureImpactChart({ rows }: { rows: MoneyPoint[] }) {
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Impacto futuro"
        title="Ingreso esperado, cobrado y diferido por mes"
        help="Compara lo esperado contra lo cobrado y lo que se arrastra por adeudos. Las barras rojas muestran dinero que no entro en el mes original y presiona la caja del siguiente mes."
      />
      <div className="h-[340px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 10, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#71717a" }} />
            <YAxis tickFormatter={(value) => compactMoney(Number(value))} tick={{ fontSize: 12, fill: "#71717a" }} />
            <Tooltip content={<DebtsTooltip />} />
            <Legend />
            <Bar dataKey="esperado" name="Esperado ajustado" fill="#2563eb" radius={[6, 6, 0, 0]} />
            <Bar dataKey="cobrado" name="Cobrado" fill="#059669" radius={[6, 6, 0, 0]} />
            <Bar dataKey="diferido" name="Diferido" fill="#dc2626" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function UtilityImpactChart({ rows }: { rows: MoneyPoint[] }) {
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Ganancia del mes"
        title="Utilidad esperada vs utilidad real"
        help="Muestra el efecto de adeudos sobre utilidad operativa: plan del mes usa ingresos programados menos gastos; cobrado real usa pagos confirmados menos gastos; diferido es ingreso que se esperaba pero se movio al futuro."
      />
      <div className="h-[320px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 10, right: 24, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#71717a" }} />
            <YAxis tickFormatter={(value) => compactMoney(Number(value))} tick={{ fontSize: 12, fill: "#71717a" }} />
            <Tooltip content={<DebtsTooltip />} />
            <Legend />
            <Bar dataKey="utilidadEsperada" name="Utilidad esperada" fill="#2563eb" radius={[6, 6, 0, 0]} />
            <Bar dataKey="utilidadActual" name="Utilidad real" fill="#059669" radius={[6, 6, 0, 0]} />
            <Line dataKey="diferido" name="Ingreso diferido" stroke="#dc2626" strokeWidth={3} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ReasonsDonut({ rows }: { rows: { label: string; value: number }[] }) {
  const colors = ["#dc2626", "#f59e0b", "#2563eb", "#7c3aed", "#71717a", "#059669", "#0f766e"];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const visibleRows = rows.filter((row) => row.value > 0);
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Causa probable"
        title="Razones de adeudo"
        help="Agrupa los adeudos por razon probable. No sustituye una nota formal de cobranza; es una lectura automatica basada en pagos en proceso, pagos parciales, descuentos, mora y vencimiento."
      />
      <div className="grid gap-4 p-4 sm:grid-cols-[210px_1fr]">
        <div className="relative h-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={visibleRows.length ? visibleRows : [{ label: "Sin adeudos", value: 1 }]} dataKey="value" nameKey="label" innerRadius={58} outerRadius={90} paddingAngle={3}>
                {(visibleRows.length ? visibleRows : [{ label: "Sin adeudos", value: 1 }]).map((row, index) => (
                  <Cell key={row.label} fill={visibleRows.length ? colors[index % colors.length] : "#d4d4d8"} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-xs uppercase text-zinc-500">Adeudos</p>
              <p className="text-xl font-semibold">{total}</p>
            </div>
          </div>
        </div>
        <div className="grid content-center gap-2">
          {rows.map((row, index) => (
            <div key={row.label} className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="shrink-0 text-zinc-500">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DebtOutreachPanel({
  debts,
  today,
}: {
  debts: DebtRow[];
  today: Date;
}) {
  const [outreachByCharge, setOutreachByCharge] = useState<Record<number, OutreachState>>({});
  const rows = debts.slice(0, 12);
  const outreachFor = (debt: DebtRow) => outreachByCharge[debt.charge.id] || defaultOutreach(debt, today);
  const pendingCalls = rows.filter((debt) => {
    const outreach = outreachFor(debt);
    return Boolean(outreach.sentAt && !outreach.seenAt && !outreach.calledAt && daysSinceSent(outreach, today) >= 3);
  });

  function updateOutreach(debt: DebtRow, next: Partial<OutreachState>) {
    const current = outreachFor(debt);
    setOutreachByCharge((state) => ({
      ...state,
      [debt.charge.id]: { ...current, ...next },
    }));
  }

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-emerald-700">Seguimiento de cobranza</p>
          <h2 className="font-semibold">WhatsApp personalizado y llamadas</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Simula mensajes por adeudo. Si no se marca como visto en 3 dias, el sistema recomienda llamada telefonica.
          </p>
        </div>
        <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
          {pendingCalls.length} por llamar
        </span>
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.map((debt) => {
          const outreach = outreachFor(debt);
          const phone = cleanPhone(debt.phone);
          const canCall = Boolean(outreach.sentAt && !outreach.seenAt && !outreach.calledAt && daysSinceSent(outreach, today) >= 3);
          return (
            <article key={debt.charge.id} className="grid gap-4 px-4 py-4 xl:grid-cols-[1.1fr_1fr_auto]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{debt.debtorName}</h3>
                  <span className={`rounded-md px-2 py-1 text-xs font-medium ${outreachClass(outreach, today)}`}>
                    {outreachLabel(outreach, today)}
                  </span>
                  {canCall && <span className="rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white">Llamar hoy</span>}
                </div>
                <p className="mt-1 text-sm text-zinc-500">
                  Contacto: {debt.contactName} - {debt.phone || "Sin telefono"} - {debt.siteName}
                </p>
                <p className="mt-1 text-sm text-zinc-500">
                  Saldo ${money(debt.balance)} por {debt.concept}. {debt.reason}.
                </p>
                <div className="mt-3 rounded-md bg-zinc-50 p-3 text-sm text-zinc-700">
                  {whatsappMessage(debt)}
                </div>
              </div>
              <div className="grid content-start gap-2 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md bg-zinc-50 px-3 py-2">
                    <p className="text-xs uppercase text-zinc-500">Enviado</p>
                    <p className="font-medium">{outreach.sentAt || "No"}</p>
                  </div>
                  <div className="rounded-md bg-zinc-50 px-3 py-2">
                    <p className="text-xs uppercase text-zinc-500">Visto</p>
                    <p className="font-medium">{outreach.seenAt || "No"}</p>
                  </div>
                </div>
                <div className="rounded-md bg-zinc-50 px-3 py-2">
                  <p className="text-xs uppercase text-zinc-500">Regla</p>
                  <p className="font-medium">
                    {outreach.sentAt && !outreach.seenAt
                      ? `${daysSinceSent(outreach, today)} dias sin visto`
                      : "Esperando primer contacto"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-start gap-2 xl:w-44 xl:flex-col">
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                  disabled={!phone}
                  onClick={() => updateOutreach(debt, { sentAt: formatDate(today), seenAt: null, calledAt: null })}
                  type="button"
                  title={phone ? `Simular envio a ${phone}` : "Sin telefono"}
                >
                  <MessageCircle size={16} />
                  WhatsApp
                </button>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold hover:bg-zinc-50 disabled:opacity-50"
                  disabled={!outreach.sentAt}
                  onClick={() => updateOutreach(debt, { seenAt: formatDate(today) })}
                  type="button"
                >
                  <Eye size={16} />
                  Visto
                </button>
                <button
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                  disabled={!canCall || !phone}
                  onClick={() => updateOutreach(debt, { calledAt: formatDate(today) })}
                  type="button"
                  title={canCall ? `Simular llamada a ${phone}` : "Disponible despues de 3 dias sin visto"}
                >
                  <Phone size={16} />
                  Llamar
                </button>
              </div>
            </article>
          );
        })}
        {rows.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay adeudos para contactar.</p>}
      </div>
    </section>
  );
}

export function DebtsPanel({ data }: { data: AppData }) {
  const operationalMonth = currentOperationalMonth(data);
  const today = parseDate(`${operationalMonth}-15`) || new Date();
  const debts = buildDebtRows(data, today);
  const overdue = debts.filter((debt) => debt.overdueDays > 0);
  const critical = debts.filter((debt) => debt.risk === "critico" || debt.risk === "alto");
  const totalDebt = debts.reduce((sum, debt) => sum + debt.balance, 0);
  const overdueDebt = overdue.reduce((sum, debt) => sum + debt.balance, 0);
  const futureShift = debts.filter((debt) => debt.dueMonth === operationalMonth).reduce((sum, debt) => sum + debt.balance, 0);
  const monthExpected = data.charges
    .filter((charge) => monthKey(charge.due_date) === operationalMonth && charge.status !== "canceled")
    .reduce((sum, charge) => sum + amount(charge.amount), 0);
  const riskPercent = monthExpected ? (futureShift / monthExpected) * 100 : 0;
  const burndown = buildBurndown(data, operationalMonth);
  const monthImpact = buildMonthImpact(data, debts);
  const utilityImpact = buildUtilityImpact(data, debts, operationalMonth);
  const reasonRows = [...new Set(debts.map((debt) => debt.reason))].map((reason) => ({
    label: reason,
    value: debts.filter((debt) => debt.reason === reason).length,
  })).sort((a, b) => b.value - a.value);

  return (
    <div className="grid min-w-0 gap-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Adeudo abierto" value={`$${money(totalDebt)}`} helper={`${debts.length} cargos con saldo`} />
        <Metric label="Adeudo vencido" value={`$${money(overdueDebt)}`} helper={`${overdue.length} cargos vencidos`} />
        <Metric label="Riesgo alto/critico" value={critical.length} helper={`$${money(critical.reduce((sum, debt) => sum + debt.balance, 0))}`} />
        <Metric label="Diferido al siguiente mes" value={`$${money(futureShift)}`} helper={`${riskPercent.toFixed(1)}% del ingreso esperado`} />
        <Metric label="Ingreso esperado del mes" value={`$${money(monthExpected)}`} helper={monthLabel(operationalMonth)} />
      </section>

      <DebtOutreachPanel debts={debts} today={today} />

      <section className="grid min-w-0 gap-5 xl:grid-cols-[1.4fr_1fr]">
        <BurndownChart rows={burndown} month={operationalMonth} />
        <ReasonsDonut rows={reasonRows} />
      </section>

      <section className="grid min-w-0 gap-5 xl:grid-cols-2">
        <FutureImpactChart rows={monthImpact} />
        <UtilityImpactChart rows={utilityImpact} />
      </section>

      <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Adeudos y riesgo operativo" count={debts.length} />
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Sede</th>
                <th className="px-4 py-3">Concepto</th>
                <th className="px-4 py-3">Programado</th>
                <th className="px-4 py-3">Pagado</th>
                <th className="px-4 py-3">Saldo</th>
                <th className="px-4 py-3">Vence</th>
                <th className="px-4 py-3">Dias vencido</th>
                <th className="px-4 py-3">Razon probable</th>
                <th className="px-4 py-3">Riesgo</th>
                <th className="px-4 py-3">Impacto futuro</th>
              </tr>
            </thead>
            <tbody>
              {debts.map((debt) => (
                <tr key={debt.charge.id} className="border-b border-zinc-100">
                  <td className="px-4 py-3 font-medium">{debt.debtorName}</td>
                  <td className="px-4 py-3">{debt.siteName}</td>
                  <td className="px-4 py-3">{debt.concept}</td>
                  <td className="px-4 py-3">${money(debt.amount)}</td>
                  <td className="px-4 py-3">${money(debt.paid)}</td>
                  <td className="px-4 py-3 font-semibold text-red-700">${money(debt.balance)}</td>
                  <td className="px-4 py-3">{debt.dueDate || "Sin fecha"}</td>
                  <td className="px-4 py-3">{debt.overdueDays}</td>
                  <td className="px-4 py-3">{debt.reason}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-1 text-xs font-medium ${riskClass(debt.risk)}`}>{riskLabel(debt.risk)}</span>
                  </td>
                  <td className="px-4 py-3">{debt.dueMonth === operationalMonth ? `Se difiere a ${monthLabel(debt.shiftedMonth)}` : `Presiona ${monthLabel(debt.dueMonth)}`}</td>
                </tr>
              ))}
              {debts.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-zinc-500">
                    No hay adeudos abiertos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
