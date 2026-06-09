import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Metric } from "../cards/Metric";
import { ChartCardHeader } from "../charts/ChartHelp";
import { money } from "../../utils/format";
import type { AppData, Expense, Payment, Site } from "../../types";
import { SelectInput, TableHeader, TextInput, normalizeText } from "./shared";

type BusinessUnit = "consolidated" | "academy" | "league" | "uniforms" | "corporate";
type StatementGroup = "income" | "operating" | "fixed" | "corporate" | "non_recurrent";

type StatementEntry = {
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

type SiteContribution = {
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

const units: Array<{ key: BusinessUnit; label: string }> = [
  { key: "consolidated", label: "Consolidado" },
  { key: "academy", label: "Academia" },
  { key: "league", label: "Liga adultos" },
  { key: "uniforms", label: "Uniformes" },
  { key: "corporate", label: "Corporativo" },
];

const groupLabels: Record<StatementGroup, string> = {
  income: "Ingresos",
  operating: "Gastos operativos",
  fixed: "Gastos fijos",
  corporate: "Gastos corporativos",
  non_recurrent: "Gastos no recurrentes",
};

const colors = {
  income: "#059669",
  operating: "#dc2626",
  fixed: "#f97316",
  corporate: "#7c3aed",
  non_recurrent: "#71717a",
  utility: "#18181b",
};

function monthKey(date: string | null | undefined) {
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

function matchesFilters(entry: StatementEntry, unit: BusinessUnit, siteId: string, month: string) {
  const unitMatch = unit === "consolidated" || entry.unit === unit || (unit === "corporate" && entry.group === "corporate");
  const siteMatch = siteId === "all" || String(entry.site || "") === siteId;
  return unitMatch && siteMatch && monthKey(entry.date) === month;
}

function buildEntries(data: AppData) {
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

function sum(entries: StatementEntry[], group: StatementGroup) {
  return entries.filter((entry) => entry.group === group).reduce((total, entry) => total + entry.amount, 0);
}

function groupByCategory(entries: StatementEntry[]) {
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

function buildMonthlyTrend(entries: StatementEntry[], unit: BusinessUnit, siteId: string, selectedMonth: string) {
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

function buildSiteContribution(entries: StatementEntry[], sites: Site[], unit: BusinessUnit, selectedMonth: string) {
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

function WaterfallChart({ income, operating, fixed, corporate, nonRecurrent, net }: { income: number; operating: number; fixed: number; corporate: number; nonRecurrent: number; net: number }) {
  const rows = [
    { name: "Ingresos", value: income, fill: colors.income },
    { name: "Operativos", value: -operating, fill: colors.operating },
    { name: "Fijos", value: -fixed, fill: colors.fixed },
    { name: "Corporativo", value: -corporate, fill: colors.corporate },
    { name: "No rec.", value: -nonRecurrent, fill: colors.non_recurrent },
    { name: "Neta", value: net, fill: net >= 0 ? colors.income : colors.operating },
  ];
  return (
    <ResponsiveContainer width="100%" height={310}>
      <BarChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} tickFormatter={(value) => `$${Number(value) / 1000}k`} />
        <Tooltip formatter={(value: number) => `$${money(Math.abs(value))}`} contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7" }} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={850}>
          {rows.map((row) => <Cell key={row.name} fill={row.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ExpenseMixChart({ rows }: { rows: Array<{ label: string; group: StatementGroup; amount: number; count: number }> }) {
  const chartRows = rows.filter((row) => row.group !== "income" && row.amount > 0).slice(0, 8);
  const total = chartRows.reduce((sum, row) => sum + row.amount, 0);
  return (
    <div className="grid min-w-0 gap-3 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="h-[260px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartRows}
              dataKey="amount"
              nameKey="label"
              innerRadius={58}
              outerRadius={100}
              paddingAngle={3}
              isAnimationActive
              animationDuration={900}
            >
              {chartRows.map((row) => <Cell key={row.label} fill={colors[row.group]} />)}
            </Pie>
            <Tooltip
              formatter={(value: number, _name, item) => {
                const percent = total ? (Number(value) / total) * 100 : 0;
                return [`$${money(value)} (${percent.toFixed(1)}%)`, item.payload.label];
              }}
              contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="min-w-0 divide-y divide-zinc-100">
        {chartRows.map((row) => {
          const percent = total ? (row.amount / total) * 100 : 0;
          return (
            <div key={`${row.group}-${row.label}`} className="grid grid-cols-[1fr_auto] gap-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[row.group] }} />
                  <p className="truncate font-medium">{row.label}</p>
                </div>
                <p className="mt-1 text-xs text-zinc-500">{groupLabels[row.group]} - {row.count} registros</p>
              </div>
              <div className="text-right">
                <p className="font-semibold">${money(row.amount)}</p>
                <p className="mt-1 text-xs text-zinc-500">{percent.toFixed(1)}%</p>
              </div>
            </div>
          );
        })}
        {chartRows.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">Sin gastos para este filtro.</p>}
      </div>
    </div>
  );
}

function TrendChart({ rows }: { rows: Array<{ month: string; ingresos: number; gastos: number; utilidad: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={310}>
      <ComposedChart data={rows} margin={{ top: 18, right: 18, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} tickFormatter={(value) => `$${Number(value) / 1000}k`} />
        <Tooltip formatter={(value: number, name: string) => [`$${money(value)}`, name]} contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7" }} />
        <Bar dataKey="ingresos" fill={colors.income} radius={[5, 5, 0, 0]} maxBarSize={22} isAnimationActive animationDuration={800} />
        <Bar dataKey="gastos" fill={colors.operating} radius={[5, 5, 0, 0]} maxBarSize={22} isAnimationActive animationDuration={800} />
        <Area type="monotone" dataKey="utilidad" stroke={colors.utility} fill="#18181b22" strokeWidth={2.5} dot={false} isAnimationActive animationDuration={950} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function SiteContributionChart({ rows }: { rows: SiteContribution[] }) {
  const chartRows = rows
    .slice()
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 10)
    .map((row) => ({
      ...row,
      gastos: row.operating + row.fixed + row.corporate + row.nonRecurrent,
    }));

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={chartRows} layout="vertical" margin={{ top: 18, right: 24, bottom: 8, left: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} tickFormatter={(value) => `$${Number(value) / 1000}k`} />
        <YAxis type="category" dataKey="label" width={112} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} />
        <Tooltip formatter={(value: number, name: string) => [`$${money(Math.abs(value))}`, name]} contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7" }} />
        <Bar dataKey="income" name="Ingresos" fill={colors.income} radius={[0, 6, 6, 0]} maxBarSize={18} isAnimationActive animationDuration={800} />
        <Bar dataKey="gastos" name="Gastos" fill={colors.operating} radius={[0, 6, 6, 0]} maxBarSize={18} isAnimationActive animationDuration={850} />
        <Bar dataKey="net" name="Utilidad neta" fill="#2563eb" radius={[0, 6, 6, 0]} maxBarSize={18} isAnimationActive animationDuration={900}>
          {chartRows.map((row) => <Cell key={row.label} fill={row.net >= 0 ? "#2563eb" : colors.operating} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function IncomeStatementPanel({ data }: { data: AppData }) {
  const entries = useMemo(() => buildEntries(data), [data]);
  const latestDate = entries.map((entry) => entry.date).filter(Boolean).sort().at(-1) || new Date().toISOString();
  const [unit, setUnit] = useState<BusinessUnit>("consolidated");
  const [siteId, setSiteId] = useState("all");
  const [month, setMonth] = useState(latestDate.slice(0, 7));
  const filtered = entries.filter((entry) => matchesFilters(entry, unit, siteId, month));
  const income = sum(filtered, "income");
  const operating = sum(filtered, "operating");
  const fixed = sum(filtered, "fixed");
  const corporate = sum(filtered, "corporate");
  const nonRecurrent = sum(filtered, "non_recurrent");
  const operatingUtility = income - operating;
  const beforeCorporate = operatingUtility - fixed;
  const net = beforeCorporate - corporate - nonRecurrent;
  const margin = income ? (net / income) * 100 : 0;
  const categoryRows = groupByCategory(filtered);
  const otherExpense = categoryRows.filter((row) => row.label === "Otros").reduce((total, row) => total + row.amount, 0);
  const totalExpenses = operating + fixed + corporate + nonRecurrent;
  const trendRows = buildMonthlyTrend(entries, unit, siteId, month);
  const contributionRows = buildSiteContribution(entries, data.sites, unit, month);
  const visibleContributionRows = siteId === "all"
    ? contributionRows
    : contributionRows.filter((row) => String(row.siteId || "") === siteId);
  const bestSite = visibleContributionRows[0];
  const worstSite = visibleContributionRows.slice().sort((a, b) => a.net - b.net)[0];
  const fixedAndCorporate = fixed + corporate;
  const fixedAndCorporateRatio = income ? (fixedAndCorporate / income) * 100 : 0;
  const selectedSite = siteId === "all" ? "Todas las sedes" : data.sites.find((site: Site) => String(site.id) === siteId)?.name || "Sede";

  return (
    <div className="grid min-w-0 gap-5">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_210px_210px_210px]">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Estado de resultados</p>
            <h2 className="text-xl font-semibold">Rentabilidad por unidad de negocio</h2>
            <p className="mt-1 text-sm text-zinc-500">Reporte mensual calculado desde pagos confirmados y gastos aprobados, sin recapturar informacion.</p>
          </div>
          <SelectInput label="Unidad" value={unit} onChange={(event) => setUnit(event.target.value as BusinessUnit)}>
            {units.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </SelectInput>
          <SelectInput label="Sede" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            <option value="all">Todas las sedes</option>
            {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </SelectInput>
          <TextInput label="Mes" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Ingresos" value={`$${money(income)}`} helper={selectedSite} />
        <Metric label="Utilidad operativa" value={`$${money(operatingUtility)}`} helper="Antes de fijos y corporativo" />
        <Metric label="Utilidad neta" value={`$${money(net)}`} helper={`${margin.toFixed(1)}% de margen`} />
        <Metric label="Gastos totales" value={`$${money(totalExpenses)}`} />
        <Metric label="Otros / gastos" value={`${totalExpenses ? ((otherExpense / totalExpenses) * 100).toFixed(1) : "0.0"}%`} helper={`$${money(otherExpense)} sin clasificar`} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Mejor contribucion" value={bestSite ? `$${money(bestSite.net)}` : "$0.00"} helper={bestSite?.label || "Sin datos"} />
        <Metric label="Mayor presion" value={worstSite ? `$${money(worstSite.net)}` : "$0.00"} helper={worstSite?.label || "Sin datos"} />
        <Metric label="Fijos + corporativo" value={`$${money(fixedAndCorporate)}`} helper={`${fixedAndCorporateRatio.toFixed(1)}% de ingresos`} />
        <Metric label="No recurrente" value={`$${money(nonRecurrent)}`} helper="Mejoras / inversiones separadas de operacion" />
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <ChartCardHeader
            title="Puente de utilidad"
            count={6}
            help="Lee la grafica de izquierda a derecha: empieza con ingresos, resta gastos operativos, fijos, corporativos y no recurrentes. La ultima barra muestra la utilidad neta que queda despues de esas capas."
          />
          <WaterfallChart income={income} operating={operating} fixed={fixed} corporate={corporate} nonRecurrent={nonRecurrent} net={net} />
        </div>
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <ChartCardHeader
            title="Mezcla de gastos"
            count={categoryRows.filter((row) => row.group !== "income").length}
            help="Muestra de que categorias se compone el gasto del mes filtrado. La dona enseña proporcion; la lista de la derecha muestra monto, porcentaje, grupo financiero y cantidad de registros."
          />
          <ExpenseMixChart rows={categoryRows} />
        </div>
      </section>

      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <ChartCardHeader
          title="Tendencia anual"
          count={12}
          help="Compara mes por mes ingresos contra gastos. Las barras muestran volumen mensual y la linea/area muestra utilidad. Sirve para detectar meses donde la operacion vende bien pero el gasto se come el margen."
        />
        <TrendChart rows={trendRows} />
      </div>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <ChartCardHeader
            title="Contribucion por sede"
            count={visibleContributionRows.length}
            help="Ordena las sedes por impacto financiero. Ingresos indica venta, gastos indica presion de costos y utilidad neta indica lo que realmente aporta la sede despues de operacion, fijos, corporativo y no recurrentes."
          />
          <SiteContributionChart rows={visibleContributionRows} />
        </div>
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Lectura ejecutiva" count={4} />
          <div className="divide-y divide-zinc-100 text-sm">
            <div className="px-4 py-3">
              <p className="font-semibold">El consolidado no repite cobranza</p>
              <p className="mt-1 text-zinc-500">Agrupa pagos confirmados y gastos aprobados en capas financieras para explicar utilidad, no solo registrar movimientos.</p>
            </div>
            <div className="px-4 py-3">
              <p className="font-semibold">Fijos y corporativo se separan de operacion</p>
              <p className="mt-1 text-zinc-500">Esto evita castigar visualmente la operacion diaria cuando el problema viene de renta, corporativo o inversiones puntuales.</p>
            </div>
            <div className="px-4 py-3">
              <p className="font-semibold">Otros debe bajar</p>
              <p className="mt-1 text-zinc-500">Si “Otros” crece, faltan categorias o reglas de captura. Meta sugerida: mantenerlo por debajo de 5% de gastos.</p>
            </div>
            <div className="px-4 py-3">
              <p className="font-semibold">Utilidad neta compara sedes completas</p>
              <p className="mt-1 text-zinc-500">El ranking muestra sedes que venden mucho pero dejan poco margen despues de fijos, corporativo y no recurrentes.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Estado de resultados resumido" count={9} />
          <div className="divide-y divide-zinc-100 text-sm">
            {[
              ["Ingresos totales", income, "text-emerald-700"],
              ["Gastos operativos", -operating, "text-red-700"],
              ["Utilidad operativa", operatingUtility, operatingUtility >= 0 ? "text-emerald-700" : "text-red-700"],
              ["Gastos fijos", -fixed, "text-red-700"],
              ["Utilidad antes de corporativo", beforeCorporate, beforeCorporate >= 0 ? "text-emerald-700" : "text-red-700"],
              ["Gastos corporativos", -corporate, "text-red-700"],
              ["Gastos no recurrentes", -nonRecurrent, "text-zinc-700"],
              ["Utilidad neta", net, net >= 0 ? "text-emerald-700" : "text-red-700"],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className="flex items-center justify-between px-4 py-3">
                <span className="font-medium">{label}</span>
                <span className={`font-semibold tabular-nums ${tone}`}>${money(Number(value))}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Detalle auditable por categoria" count={categoryRows.length} />
          <div className="max-h-[460px] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Grupo</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3 text-right">Registros</th>
                  <th className="px-4 py-3 text-right">Monto</th>
                </tr>
              </thead>
              <tbody>
                {categoryRows.map((row) => (
                  <tr key={`${row.group}-${row.label}`} className="border-b border-zinc-100">
                    <td className="px-4 py-3 text-zinc-500">{groupLabels[row.group]}</td>
                    <td className="px-4 py-3 font-medium">{row.label}</td>
                    <td className="px-4 py-3 text-right">{row.count}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${row.group === "income" ? "text-emerald-700" : "text-red-700"}`}>${money(row.amount)}</td>
                  </tr>
                ))}
                {categoryRows.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center text-zinc-500" colSpan={4}>Sin registros para este filtro.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Ranking financiero por sede" count={visibleContributionRows.length} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Sede</th>
                <th className="px-4 py-3 text-right">Ingresos</th>
                <th className="px-4 py-3 text-right">Operativos</th>
                <th className="px-4 py-3 text-right">Fijos</th>
                <th className="px-4 py-3 text-right">Corporativo</th>
                <th className="px-4 py-3 text-right">No recurrente</th>
                <th className="px-4 py-3 text-right">Utilidad neta</th>
                <th className="px-4 py-3 text-right">Margen</th>
              </tr>
            </thead>
            <tbody>
              {visibleContributionRows.map((row) => (
                <tr key={`${row.siteId}-${row.label}`} className="border-b border-zinc-100">
                  <td className="px-4 py-3 font-medium">{row.label}</td>
                  <td className="px-4 py-3 text-right text-emerald-700">${money(row.income)}</td>
                  <td className="px-4 py-3 text-right text-red-700">${money(row.operating)}</td>
                  <td className="px-4 py-3 text-right text-red-700">${money(row.fixed)}</td>
                  <td className="px-4 py-3 text-right text-red-700">${money(row.corporate)}</td>
                  <td className="px-4 py-3 text-right text-zinc-700">${money(row.nonRecurrent)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${row.net >= 0 ? "text-blue-700" : "text-red-700"}`}>${money(row.net)}</td>
                  <td className={`px-4 py-3 text-right ${row.margin >= 0 ? "text-blue-700" : "text-red-700"}`}>{row.margin.toFixed(1)}%</td>
                </tr>
              ))}
              {visibleContributionRows.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-zinc-500" colSpan={8}>Sin registros para este filtro.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
