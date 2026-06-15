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
import type { AppData } from "../../types";
import { TableHeader } from "./shared";
import { DebtOutreachPanel } from "./DebtOutreachPanel";
import {
  amount,
  buildBurndown,
  buildDebtRows,
  buildMonthImpact,
  buildUtilityImpact,
  currentOperationalMonth,
  monthKey,
  monthLabel,
  parseDate,
  riskClass,
  riskLabel,
  type DebtRow,
  type MoneyPoint,
} from "./debtsLogic";

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
