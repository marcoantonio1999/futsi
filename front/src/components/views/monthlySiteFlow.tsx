import { useMemo, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Metric } from "../cards/Metric";
import { ChartCardHeader } from "../charts/ChartHelp";
import { money } from "../../utils/format";
import type { AppData, Expense, Payment, Site } from "../../types";
import { SelectInput, TableHeader, normalizeText } from "./shared";

type MonthRow = {
  month: string;
  label: string;
  ingresos: number;
  egresos: number;
  utilidad: number;
  previousUtility: number | null;
};

type SiteMonthRow = {
  id: number;
  name: string;
  ingresos: number;
  egresos: number;
  utilidad: number;
  delta: number | null;
};

function monthKey(value: string | null | undefined) {
  return value ? value.slice(0, 7) : "";
}

function paymentDate(payment: Payment) {
  return payment.confirmed_at || payment.paid_at;
}

function isConfirmed(payment: Payment) {
  return payment.status === "registered" || payment.status === "reconciled";
}

function paymentSite(payment: Payment, chargeSiteById: Map<number, number>) {
  if (payment.site) return payment.site;
  return payment.charge ? chargeSiteById.get(payment.charge) || null : null;
}

function monthLabel(month: string) {
  const date = new Date(`${month}-01T00:00:00`);
  return date.toLocaleDateString("es-MX", { month: "short" }).replace(".", "");
}

function expenseCategory(expense: Expense) {
  const text = normalizeText(`${expense.category} ${expense.description}`);
  if (text.includes("coach")) return "Nomina coaches";
  if (text.includes("admin")) return "Nomina administrativa";
  if (text.includes("arbit")) return "Arbitraje";
  if (text.includes("renta")) return "Renta";
  if (text.includes("material") || text.includes("deportivo") || text.includes("uniform")) return "Material deportivo";
  if (text.includes("mantenimiento") || text.includes("limpieza")) return "Mantenimiento";
  if (text.includes("publicidad")) return "Publicidad";
  if (text.includes("servicio") || text.includes("luz") || text.includes("telefono")) return "Servicios";
  if (text.includes("traslado") || text.includes("viatico")) return "Traslados";
  return "Otros";
}

function incomeCategory(payment: Payment) {
  const text = normalizeText(`${payment.charge_concept || ""} ${payment.notes || ""} ${payment.team_name || ""}`);
  if (text.includes("uniform")) return "Uniformes";
  if (text.includes("arbit")) return "Arbitraje";
  if (text.includes("renta") || text.includes("cancha")) return "Renta cancha";
  if (text.includes("liga") || text.includes("jornada") || text.includes("torneo") || payment.team_name) return "Liga";
  if (text.includes("curso") || text.includes("verano") || text.includes("intensivo")) return "Cursos";
  return "Mensualidades";
}

function buildMonths(year: string) {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function buildMonthRow(data: AppData, month: string, siteId: string, chargeSiteById: Map<number, number>, previousUtility: number | null): MonthRow {
  const siteMatch = (site: number | null | undefined) => siteId === "all" || String(site || "") === siteId;
  const ingresos = data.payments
    .filter((payment) => isConfirmed(payment) && monthKey(paymentDate(payment)) === month && siteMatch(paymentSite(payment, chargeSiteById)))
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const egresos = data.expenses
    .filter((expense) => expense.status === "approved" && monthKey(expense.expense_date) === month && siteMatch(expense.site))
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  return { month, label: monthLabel(month), ingresos, egresos, utilidad: ingresos - egresos, previousUtility };
}

function buildSiteRows(data: AppData, selectedMonth: string, chargeSiteById: Map<number, number>): SiteMonthRow[] {
  const previousMonthDate = new Date(`${selectedMonth}-01T00:00:00`);
  previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
  const previousMonth = `${previousMonthDate.getFullYear()}-${String(previousMonthDate.getMonth() + 1).padStart(2, "0")}`;
  return data.sites.map((site) => {
    const sitePayments = (month: string) => data.payments
      .filter((payment) => isConfirmed(payment) && monthKey(paymentDate(payment)) === month && paymentSite(payment, chargeSiteById) === site.id)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const siteExpenses = (month: string) => data.expenses
      .filter((expense) => expense.status === "approved" && monthKey(expense.expense_date) === month && expense.site === site.id)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const ingresos = sitePayments(selectedMonth);
    const egresos = siteExpenses(selectedMonth);
    const previousUtility = sitePayments(previousMonth) - siteExpenses(previousMonth);
    const utilidad = ingresos - egresos;
    return { id: site.id, name: site.name, ingresos, egresos, utilidad, delta: previousUtility ? ((utilidad - previousUtility) / Math.abs(previousUtility)) * 100 : null };
  }).sort((a, b) => b.egresos - a.egresos);
}

function categoryRows(data: AppData, selectedMonth: string, siteId: string, chargeSiteById: Map<number, number>) {
  const rows = new Map<string, { label: string; type: "Ingreso" | "Egreso"; amount: number; count: number }>();
  const add = (label: string, type: "Ingreso" | "Egreso", amount: number) => {
    const key = `${type}-${label}`;
    const current = rows.get(key) || { label, type, amount: 0, count: 0 };
    current.amount += amount;
    current.count += 1;
    rows.set(key, current);
  };
  data.payments
    .filter((payment) => isConfirmed(payment) && monthKey(paymentDate(payment)) === selectedMonth)
    .filter((payment) => siteId === "all" || String(paymentSite(payment, chargeSiteById) || "") === siteId)
    .forEach((payment) => add(incomeCategory(payment), "Ingreso", Number(payment.amount || 0)));
  data.expenses
    .filter((expense) => expense.status === "approved" && monthKey(expense.expense_date) === selectedMonth)
    .filter((expense) => siteId === "all" || String(expense.site) === siteId)
    .forEach((expense) => add(expenseCategory(expense), "Egreso", Number(expense.amount || 0)));
  return Array.from(rows.values()).sort((a, b) => b.amount - a.amount);
}

function TimelineButton({ row, active, onClick }: { row: MonthRow; active: boolean; onClick: () => void }) {
  const delta = row.previousUtility ? ((row.utilidad - row.previousUtility) / Math.abs(row.previousUtility)) * 100 : null;
  const risky = delta !== null && delta < -15;
  return (
    <button
      className={`min-w-[118px] rounded-md border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${
        active ? "border-zinc-950 bg-zinc-950 text-white" : risky ? "border-red-200 bg-red-50" : "border-zinc-200 bg-white"
      }`}
      onClick={onClick}
      type="button"
    >
      <p className="text-xs font-semibold uppercase">{row.label}</p>
      <p className={`mt-2 text-sm font-bold ${row.utilidad >= 0 ? active ? "text-emerald-200" : "text-emerald-700" : "text-red-600"}`}>${money(row.utilidad)}</p>
      <p className={`mt-1 text-xs ${active ? "text-zinc-300" : "text-zinc-500"}`}>Ing. ${money(row.ingresos)}</p>
      <p className={`text-xs ${active ? "text-zinc-300" : "text-zinc-500"}`}>Egr. ${money(row.egresos)}</p>
      <p className={`mt-2 text-xs ${delta === null ? "text-zinc-400" : delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
        {delta === null ? "Sin comparativo" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% vs mes ant.`}
      </p>
    </button>
  );
}

export function MonthlySiteFlowPanel({ data }: { data: AppData }) {
  const latestDate = [...data.payments.map(paymentDate), ...data.expenses.map((expense) => expense.expense_date)].filter(Boolean).sort().at(-1) || new Date().toISOString();
  const [year, setYear] = useState(latestDate.slice(0, 4));
  const [siteId, setSiteId] = useState("all");
  const [selectedMonth, setSelectedMonth] = useState(latestDate.slice(0, 7));
  const chargeSiteById = useMemo(() => new Map(data.charges.map((charge) => [charge.id, charge.site])), [data.charges]);
  const monthRows = useMemo(() => {
    let previousUtility: number | null = null;
    return buildMonths(year).map((month) => {
      const row = buildMonthRow(data, month, siteId, chargeSiteById, previousUtility);
      previousUtility = row.utilidad;
      return row;
    });
  }, [data, year, siteId, chargeSiteById]);
  const activeRow = monthRows.find((row) => row.month === selectedMonth) || monthRows[0];
  const siteRows = useMemo(() => buildSiteRows(data, selectedMonth, chargeSiteById), [data, selectedMonth, chargeSiteById]);
  const filteredSiteRows = siteId === "all" ? siteRows : siteRows.filter((site) => String(site.id) === siteId);
  const categories = useMemo(() => categoryRows(data, selectedMonth, siteId, chargeSiteById), [data, selectedMonth, siteId, chargeSiteById]);

  return (
    <section className="grid min-w-0 gap-5">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_220px]">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Ingresos y egresos por sede</p>
            <h2 className="text-xl font-semibold">Timeline mensual financiero</h2>
            <p className="mt-1 text-sm text-zinc-500">Compara cada mes, detecta picos por sede y abre el detalle sin duplicar informacion.</p>
          </div>
          <SelectInput label="Año" value={year} onChange={(event) => { setYear(event.target.value); setSelectedMonth(`${event.target.value}-01`); }}>
            {Array.from(new Set([...data.payments.map((payment) => monthKey(paymentDate(payment)).slice(0, 4)), ...data.expenses.map((expense) => monthKey(expense.expense_date).slice(0, 4))].filter(Boolean))).sort().map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </SelectInput>
          <SelectInput label="Sede" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="all">Todas las sedes</option>
            {data.sites.map((site: Site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </SelectInput>
        </div>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
          {monthRows.map((row) => <TimelineButton key={row.month} row={row} active={row.month === activeRow.month} onClick={() => setSelectedMonth(row.month)} />)}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label={`Ingresos ${activeRow.label}`} value={`$${money(activeRow.ingresos)}`} />
        <Metric label={`Egresos ${activeRow.label}`} value={`$${money(activeRow.egresos)}`} />
        <Metric label={`Utilidad ${activeRow.label}`} value={`$${money(activeRow.utilidad)}`} />
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <ChartCardHeader
            title="Tendencia del año"
            count={monthRows.length}
            help="Lee cada mes de izquierda a derecha. Las barras verdes son ingresos, las rojas son egresos y el area oscura es utilidad. Sirve para encontrar meses donde suben ventas, gastos o margen."
          />
          <div className="h-[330px] px-2 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthRows} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} tickFormatter={(value) => `$${Number(value) / 1000}k`} />
                <Tooltip formatter={(value: unknown, name: unknown) => [`$${money(Number(value || 0))}`, String(name ?? "")]} contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7" }} />
                <Bar dataKey="ingresos" name="Ingresos" fill="#059669" radius={[5, 5, 0, 0]} maxBarSize={24} isAnimationActive animationDuration={800} />
                <Bar dataKey="egresos" name="Egresos" fill="#dc2626" radius={[5, 5, 0, 0]} maxBarSize={24} isAnimationActive animationDuration={800} />
                <Area type="monotone" dataKey="utilidad" name="Utilidad" stroke="#18181b" fill="#18181b22" strokeWidth={2.4} dot={false} isAnimationActive animationDuration={950} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <ChartCardHeader
            title="Ranking por sede del mes"
            count={filteredSiteRows.length}
            help="Ordena sedes del mes seleccionado por egresos. Cada fila muestra ingresos, egresos y utilidad; la barra roja indica que parte del gasto total del mes corresponde a esa sede."
          />
          <div className="max-h-[330px] divide-y divide-zinc-100 overflow-auto">
            {filteredSiteRows.map((site) => (
              <div key={site.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{site.name}</p>
                  <p className={`font-semibold ${site.utilidad >= 0 ? "text-emerald-700" : "text-red-700"}`}>${money(site.utilidad)}</p>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-zinc-500">
                  <span>Ingresos ${money(site.ingresos)}</span>
                  <span>Egresos ${money(site.egresos)}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full bg-red-600" style={{ width: `${Math.min(100, activeRow.egresos ? (site.egresos / activeRow.egresos) * 100 : 0)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Detalle por categoria del mes seleccionado" count={categories.length} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3 text-right">Registros</th>
                <th className="px-4 py-3 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((row) => (
                <tr key={`${row.type}-${row.label}`} className="border-b border-zinc-100">
                  <td className={`px-4 py-3 font-medium ${row.type === "Ingreso" ? "text-emerald-700" : "text-red-700"}`}>{row.type}</td>
                  <td className="px-4 py-3">{row.label}</td>
                  <td className="px-4 py-3 text-right">{row.count}</td>
                  <td className="px-4 py-3 text-right font-semibold">${money(row.amount)}</td>
                </tr>
              ))}
              {categories.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={4}>Sin informacion para este mes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
