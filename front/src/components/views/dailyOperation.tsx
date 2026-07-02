import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Metric } from "../cards/Metric";
import { ChartCardHeader } from "../charts/ChartHelp";
import { money } from "../../utils/format";
import type { AppData, CashMovement, Expense, Payment, Site } from "../../types";
import { SelectInput, TableHeader, TextInput, normalizeText } from "./shared";

const incomeCategories = [
  "Mensualidad",
  "Liga Local",
  "Uniformes",
  "Cur. Intensivo",
  "Cur. Verano",
  "Fiestas",
  "Tor. Internacionales",
  "Con. Internas",
  "Renta Cancha",
  "Pago de Arbitrajes",
  "Anticipo de Arbitraje",
  "Pago de adeudo",
  "Permisos",
  "Art. Deportivos",
  "Pago de Horario",
  "Registros",
  "Sancionados",
  "$0,00",
];

const expenseCategories = [
  "Nomina Administrativa",
  "Bonos Administrativo",
  "Nomina Coaches",
  "Servicio Arbitraje",
  "Rentar de Canchas",
  "Torneos y Copas Externos",
  "Traslados",
  "Articulos Deportivos",
  "Mantenimiento y Limpieza",
  "Mejoras",
  "Gastos no segmentados",
  "Papeleria",
  "Premiaciones",
  "Publicidad",
  "Rembolso",
  "Servicios Publicos",
  "Renta de Instalacion",
  "$0,00",
];

const methodCategories = ["Efectivo", "Transferencias", "Tarjeta"];
const cashCategories = ["Venta", "Aportaciones", "Retiros", "Egresos", "Saldo Dia", "Caja Mes Anterior", "Caja al Dia"];

type Matrix = Record<string, number[]>;

function monthKey(date: string | null | undefined) {
  return date ? date.slice(0, 7) : "";
}

function dayIndex(date: string | null | undefined) {
  const day = Number((date || "").slice(8, 10));
  return Number.isFinite(day) && day > 0 ? day - 1 : -1;
}

function createMatrix(rows: string[], days: number): Matrix {
  return Object.fromEntries(rows.map((row) => [row, Array.from({ length: days }, () => 0)]));
}

function addToMatrix(matrix: Matrix, row: string, index: number, amount: number) {
  if (!matrix[row] || index < 0 || index >= matrix[row].length) return;
  matrix[row][index] += amount;
}

function classifyIncome(payment: Payment) {
  const text = normalizeText(`${payment.charge_concept || ""} ${payment.notes || ""} ${payment.team_name || ""}`);
  if (text.includes("mensual")) return "Mensualidad";
  if (text.includes("uniform")) return "Uniformes";
  if (text.includes("intensivo")) return "Cur. Intensivo";
  if (text.includes("verano")) return "Cur. Verano";
  if (text.includes("fiesta")) return "Fiestas";
  if (text.includes("internacional")) return "Tor. Internacionales";
  if (text.includes("renta") || text.includes("cancha")) return "Renta Cancha";
  if (text.includes("anticipo") && text.includes("arbit")) return "Anticipo de Arbitraje";
  if (text.includes("arbit")) return "Pago de Arbitrajes";
  if (text.includes("adeudo")) return "Pago de adeudo";
  if (text.includes("permiso")) return "Permisos";
  if (text.includes("art") || text.includes("deportivo")) return "Art. Deportivos";
  if (text.includes("horario")) return "Pago de Horario";
  if (text.includes("registro")) return "Registros";
  if (text.includes("sanc")) return "Sancionados";
  if (text.includes("liga") || text.includes("jornada") || text.includes("torneo") || text.includes("liguilla") || payment.team_name) return "Liga Local";
  if (text.includes("con")) return "Con. Internas";
  return "$0,00";
}

function classifyExpense(expense: Expense) {
  const text = normalizeText(`${expense.category} ${expense.description}`);
  if (text.includes("bono")) return "Bonos Administrativo";
  if (text.includes("admin")) return "Nomina Administrativa";
  if (text.includes("coach")) return "Nomina Coaches";
  if (text.includes("arbit")) return "Servicio Arbitraje";
  if (text.includes("instal")) return "Renta de Instalacion";
  if (text.includes("renta") || text.includes("cancha")) return "Rentar de Canchas";
  if (text.includes("torneo") || text.includes("copa")) return "Torneos y Copas Externos";
  if (text.includes("traslado") || text.includes("viatico")) return "Traslados";
  if (text.includes("art") || text.includes("material") || text.includes("deportivo")) return "Articulos Deportivos";
  if (text.includes("mantenimiento") || text.includes("limpieza")) return "Mantenimiento y Limpieza";
  if (text.includes("mejora")) return "Mejoras";
  if (text.includes("papel")) return "Papeleria";
  if (text.includes("premi")) return "Premiaciones";
  if (text.includes("publicidad") || text.includes("marketing")) return "Publicidad";
  if (text.includes("reembolso") || text.includes("rembolso")) return "Rembolso";
  if (text.includes("servicio") || text.includes("luz") || text.includes("agua")) return "Servicios Publicos";
  return "Gastos no segmentados";
}

function paymentSite(payment: Payment, chargeSiteById: Map<number, number>) {
  if (payment.site) return payment.site;
  return payment.charge ? chargeSiteById.get(payment.charge) || null : null;
}

function isSiteMatch(siteId: string, recordSite: number | null | undefined) {
  return siteId === "all" || String(recordSite || "") === siteId;
}

function isConfirmed(payment: Payment) {
  return payment.status === "registered" || payment.status === "reconciled";
}

function paymentDate(payment: Payment) {
  return payment.confirmed_at || payment.paid_at;
}

function calculatePreviousCash(data: AppData, siteId: string, selectedMonth: string, chargeSiteById: Map<number, number>) {
  const firstDay = `${selectedMonth}-01`;
  const payments = data.payments
    .filter((payment) => isConfirmed(payment) && payment.method === "cash" && paymentDate(payment) < firstDay)
    .filter((payment) => isSiteMatch(siteId, paymentSite(payment, chargeSiteById)))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const movements = data.cashMovements
    .filter((movement) => movement.movement_date < firstDay && isSiteMatch(siteId, movement.site))
    .reduce((sum, movement) => {
      const amount = Number(movement.amount || 0);
      if (movement.movement_type === "cash_in" || movement.movement_type === "adjustment") return sum + amount;
      return sum - amount;
    }, 0);
  return payments + movements;
}

function buildOperation(data: AppData, selectedMonth: string, siteId: string) {
  const [year, month] = selectedMonth.split("-").map(Number);
  const days = new Date(year, month, 0).getDate();
  const chargeSiteById = new Map(data.charges.map((charge) => [charge.id, charge.site]));
  const income = createMatrix(incomeCategories, days);
  const expenses = createMatrix(expenseCategories, days);
  const methods = createMatrix(methodCategories, days);
  const cash = createMatrix(cashCategories, days);

  data.payments
    .filter((payment) => isConfirmed(payment) && monthKey(paymentDate(payment)) === selectedMonth)
    .filter((payment) => isSiteMatch(siteId, paymentSite(payment, chargeSiteById)))
    .forEach((payment) => {
      const index = dayIndex(paymentDate(payment));
      const amount = Number(payment.amount || 0);
      addToMatrix(income, classifyIncome(payment), index, amount);
      if (payment.method === "cash") {
        addToMatrix(methods, "Efectivo", index, amount);
        addToMatrix(cash, "Venta", index, amount);
      }
      if (payment.method === "transfer") addToMatrix(methods, "Transferencias", index, amount);
      if (payment.method === "card") addToMatrix(methods, "Tarjeta", index, amount);
    });

  data.expenses
    .filter((expense) => expense.status === "approved" && monthKey(expense.expense_date) === selectedMonth && isSiteMatch(siteId, expense.site))
    .forEach((expense) => addToMatrix(expenses, classifyExpense(expense), dayIndex(expense.expense_date), Number(expense.amount || 0)));

  data.cashMovements
    .filter((movement) => monthKey(movement.movement_date) === selectedMonth && isSiteMatch(siteId, movement.site))
    .forEach((movement) => {
      const amount = Number(movement.amount || 0);
      const index = dayIndex(movement.movement_date);
      if (movement.movement_type === "cash_in") addToMatrix(cash, "Aportaciones", index, amount);
      if (movement.movement_type === "vault_transfer") addToMatrix(cash, "Retiros", index, amount);
      if (movement.movement_type === "cash_out") addToMatrix(cash, "Egresos", index, amount);
      if (movement.movement_type === "adjustment") addToMatrix(cash, "Aportaciones", index, amount);
    });

  const previousCash = calculatePreviousCash(data, siteId, selectedMonth, chargeSiteById);
  let runningCash = previousCash;
  for (let index = 0; index < days; index += 1) {
    cash["Saldo Dia"][index] = cash.Venta[index] + cash.Aportaciones[index] - cash.Retiros[index] - cash.Egresos[index];
    cash["Caja Mes Anterior"][index] = index === 0 ? previousCash : 0;
    runningCash += cash["Saldo Dia"][index];
    cash["Caja al Dia"][index] = runningCash;
  }

  const incomeDaily = Array.from({ length: days }, (_, index) => incomeCategories.reduce((sum, row) => sum + income[row][index], 0));
  const expenseDaily = Array.from({ length: days }, (_, index) => expenseCategories.reduce((sum, row) => sum + expenses[row][index], 0));
  const utilityDaily = incomeDaily.map((value, index) => value - expenseDaily[index]);

  return { days, income, expenses, methods, cash, incomeDaily, expenseDaily, utilityDaily, previousCash };
}

function total(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0);
}

function MatrixTable({ title, rows, matrix, days }: { title: string; rows: string[]; matrix: Matrix; days: number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title={title} count={rows.length} />
      <div className="overflow-x-auto">
        <table className="min-w-[1180px] text-left text-xs">
          <thead className="border-b border-zinc-200 bg-zinc-50 uppercase text-zinc-500">
            <tr>
              <th className="sticky left-0 z-10 min-w-44 bg-zinc-50 px-3 py-3">Concepto</th>
              {Array.from({ length: days }, (_, index) => <th key={index} className="px-2 py-3 text-right">{index + 1}</th>)}
              <th className="px-3 py-3 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row} className="border-b border-zinc-100">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium">{row}</td>
                {matrix[row].map((value, index) => (
                  <td key={`${row}-${index}`} className="px-2 py-2 text-right tabular-nums">{value ? `$${money(value)}` : "-"}</td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums">${money(total(matrix[row]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UtilityTrendChart({ income, expense, utility }: { income: number[]; expense: number[]; utility: number[] }) {
  const rows = income.map((value, index) => ({
    day: index + 1,
    ingreso: value,
    egreso: expense[index],
    utilidad: utility[index],
  }));
  const positiveDays = rows.filter((row) => row.utilidad >= 0).length;
  const bestDay = rows.reduce((best, row) => (row.utilidad > best.utilidad ? row : best), rows[0]);
  const riskDay = rows.reduce((worst, row) => (row.utilidad < worst.utilidad ? row : worst), rows[0]);

  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        title="Resultado operativo diario"
        subtitle="Ingresos, egresos y margen por dia para detectar picos y dias de perdida."
        help="Lee por dia del mes. Las barras verdes son ingresos diarios, las rojas son egresos y el area oscura es utilidad. Los chips resumen cuantos dias fueron positivos, el mejor dia y el dia de mayor riesgo."
        right={(
          <div className="hidden flex-wrap gap-2 text-xs lg:flex">
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">{positiveDays} dias positivos</span>
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-zinc-700">Mejor dia {bestDay?.day || "-"}</span>
            <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">Mayor riesgo dia {riskDay?.day || "-"}</span>
          </div>
        )}
      />
      <div className="h-[340px] min-w-0 px-2 py-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: 20, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} tickFormatter={(value) => `$${Number(value) / 1000}k`} />
            <Tooltip
              formatter={(value: unknown, name: unknown) => [`$${money(Number(value || 0))}`, String(name ?? "")]}
              labelFormatter={(label) => `Dia ${label}`}
              contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7" }}
            />
            <Bar dataKey="ingreso" name="Ingresos" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={20} />
            <Bar dataKey="egreso" name="Egresos" fill="#dc2626" radius={[4, 4, 0, 0]} maxBarSize={20} />
            <Area type="monotone" dataKey="utilidad" name="Utilidad" stroke="#18181b" fill="#18181b22" strokeWidth={2.4} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function CalendarGrid({ selectedDay, days, income, expense, utility, onSelect }: { selectedDay: number; days: number; income: number[]; expense: number[]; utility: number[]; onSelect: (day: number) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      {Array.from({ length: days }, (_, index) => {
        const day = index + 1;
        const active = selectedDay === day;
        return (
          <button
            key={day}
            className={`rounded-md border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${active ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white"}`}
            onClick={() => onSelect(day)}
            type="button"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{day}</span>
              <CalendarDays size={14} />
            </div>
            <p className={`mt-3 text-xs ${active ? "text-zinc-200" : "text-zinc-500"}`}>Ing. ${money(income[index])}</p>
            <p className={`text-xs ${active ? "text-zinc-200" : "text-zinc-500"}`}>Egr. ${money(expense[index])}</p>
            <p className={`mt-1 text-sm font-semibold ${utility[index] >= 0 ? active ? "text-emerald-200" : "text-emerald-700" : "text-red-600"}`}>
              ${money(utility[index])}
            </p>
          </button>
        );
      })}
    </div>
  );
}

export function DailyOperationPanel({ data }: { data: AppData }) {
  const latestDate = [...data.payments.map((payment) => paymentDate(payment)), ...data.expenses.map((expense) => expense.expense_date)].filter(Boolean).sort().at(-1);
  const [selectedMonth, setSelectedMonth] = useState((latestDate || new Date().toISOString()).slice(0, 7));
  const [siteId, setSiteId] = useState("all");
  const [selectedDay, setSelectedDay] = useState(1);
  const operation = useMemo(() => buildOperation(data, selectedMonth, siteId), [data, selectedMonth, siteId]);
  const selectedIndex = Math.min(selectedDay, operation.days) - 1;
  const siteLabel = siteId === "all" ? "Todas las sedes" : data.sites.find((site: Site) => String(site.id) === siteId)?.name || "Sede";

  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_220px_220px]">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Operacion diaria</p>
            <h2 className="text-xl font-semibold">Control por dia, categoria y caja</h2>
            <p className="mt-1 text-sm text-zinc-500">Replica la estructura del Excel operativo con datos vivos de pagos, gastos y movimientos de efectivo.</p>
          </div>
          <SelectInput label="Sede" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="all">Todas las sedes</option>
            {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </SelectInput>
          <TextInput label="Mes" type="month" value={selectedMonth} onChange={(event) => { setSelectedMonth(event.target.value); setSelectedDay(1); }} />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Sede" value={siteLabel} />
        <Metric label="Ingresos del mes" value={`$${money(total(operation.incomeDaily))}`} />
        <Metric label="Egresos del mes" value={`$${money(total(operation.expenseDaily))}`} />
        <Metric label="Utilidad del mes" value={`$${money(total(operation.utilityDaily))}`} />
        <Metric label={`Caja al dia ${selectedDay}`} value={`$${money(operation.cash["Caja al Dia"][selectedIndex] || 0)}`} />
      </section>

      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-semibold">Calendario operativo</h3>
            <p className="text-sm text-zinc-500">Selecciona un dia para revisar ingresos, egresos, utilidad y caja.</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-800">Ingresos</span>
            <span className="rounded-md bg-red-50 px-2 py-1 text-red-700">Egresos</span>
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-zinc-700">Utilidad</span>
          </div>
        </div>
        <CalendarGrid
          selectedDay={selectedDay}
          days={operation.days}
          income={operation.incomeDaily}
          expense={operation.expenseDaily}
          utility={operation.utilityDaily}
          onSelect={setSelectedDay}
        />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={`Ingreso dia ${selectedDay}`} value={`$${money(operation.incomeDaily[selectedIndex] || 0)}`} />
        <Metric label={`Egreso dia ${selectedDay}`} value={`$${money(operation.expenseDaily[selectedIndex] || 0)}`} />
        <Metric label={`Utilidad dia ${selectedDay}`} value={`$${money(operation.utilityDaily[selectedIndex] || 0)}`} />
        <Metric label="Saldo dia caja" value={`$${money(operation.cash["Saldo Dia"][selectedIndex] || 0)}`} />
      </section>

      <MatrixTable title="Ingresos" rows={incomeCategories} matrix={operation.income} days={operation.days} />
      <MatrixTable title="Egresos" rows={expenseCategories} matrix={operation.expenses} days={operation.days} />
      <UtilityTrendChart income={operation.incomeDaily} expense={operation.expenseDaily} utility={operation.utilityDaily} />
      <MatrixTable title="Distribucion de Ingresos" rows={methodCategories} matrix={operation.methods} days={operation.days} />
      <MatrixTable title="Manejo de Efectivo" rows={cashCategories} matrix={operation.cash} days={operation.days} />
    </div>
  );
}
