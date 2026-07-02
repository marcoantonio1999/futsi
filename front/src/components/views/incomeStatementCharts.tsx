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
import { money } from "../../utils/format";
import { groupLabels, statementColors, type SiteContribution, type StatementGroup } from "./incomeStatementModel";

export function WaterfallChart({ income, operating, fixed, corporate, nonRecurrent, net }: { income: number; operating: number; fixed: number; corporate: number; nonRecurrent: number; net: number }) {
  const rows = [
    { name: "Ingresos", value: income, fill: statementColors.income },
    { name: "Operativos", value: -operating, fill: statementColors.operating },
    { name: "Fijos", value: -fixed, fill: statementColors.fixed },
    { name: "Corporativo", value: -corporate, fill: statementColors.corporate },
    { name: "No rec.", value: -nonRecurrent, fill: statementColors.non_recurrent },
    { name: "Neta", value: net, fill: net >= 0 ? statementColors.income : statementColors.operating },
  ];
  return (
    <ResponsiveContainer width="100%" height={310}>
      <BarChart data={rows} margin={{ top: 18, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
        <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} tickFormatter={(value) => `$${Number(value) / 1000}k`} />
        <Tooltip formatter={(value: unknown) => `$${money(Math.abs(Number(value || 0)))}`} contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7" }} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive animationDuration={850}>
          {rows.map((row) => <Cell key={row.name} fill={row.fill} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ExpenseMixChart({ rows }: { rows: Array<{ label: string; group: StatementGroup; amount: number; count: number }> }) {
  const chartRows = rows.filter((row) => row.group !== "income" && row.amount > 0).slice(0, 8);
  const total = chartRows.reduce((sum, row) => sum + row.amount, 0);
  return (
    <div className="grid min-w-0 gap-3 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <div className="h-[260px] min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={chartRows} dataKey="amount" nameKey="label" innerRadius={58} outerRadius={100} paddingAngle={3} isAnimationActive animationDuration={900}>
              {chartRows.map((row) => <Cell key={row.label} fill={statementColors[row.group]} />)}
            </Pie>
            <Tooltip
              formatter={(value: unknown, _name: unknown, item: unknown) => {
                const percent = total ? (Number(value) / total) * 100 : 0;
                const label = (item as { payload?: { label?: string } }).payload?.label || String(_name ?? "");
                return [`$${money(Number(value || 0))} (${percent.toFixed(1)}%)`, label];
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
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: statementColors[row.group] }} />
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

export function TrendChart({ rows }: { rows: Array<{ month: string; ingresos: number; gastos: number; utilidad: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={310}>
      <ComposedChart data={rows} margin={{ top: 18, right: 18, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} tickFormatter={(value) => `$${Number(value) / 1000}k`} />
        <Tooltip formatter={(value: unknown, name: unknown) => [`$${money(Number(value || 0))}`, String(name ?? "")]} contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7" }} />
        <Bar dataKey="ingresos" fill={statementColors.income} radius={[5, 5, 0, 0]} maxBarSize={22} isAnimationActive animationDuration={800} />
        <Bar dataKey="gastos" fill={statementColors.operating} radius={[5, 5, 0, 0]} maxBarSize={22} isAnimationActive animationDuration={800} />
        <Area type="monotone" dataKey="utilidad" stroke={statementColors.utility} fill="#18181b22" strokeWidth={2.5} dot={false} isAnimationActive animationDuration={950} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function SiteContributionChart({ rows }: { rows: SiteContribution[] }) {
  const chartRows = rows
    .slice()
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 10)
    .map((row) => ({ ...row, gastos: row.operating + row.fixed + row.corporate + row.nonRecurrent }));

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={chartRows} layout="vertical" margin={{ top: 18, right: 24, bottom: 8, left: 18 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" horizontal={false} />
        <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} tickFormatter={(value) => `$${Number(value) / 1000}k`} />
        <YAxis type="category" dataKey="label" width={112} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#71717a" }} />
        <Tooltip formatter={(value: unknown, name: unknown) => [`$${money(Math.abs(Number(value || 0)))}`, String(name ?? "")]} contentStyle={{ borderRadius: 8, borderColor: "#e4e4e7" }} />
        <Bar dataKey="income" name="Ingresos" fill={statementColors.income} radius={[0, 6, 6, 0]} maxBarSize={18} isAnimationActive animationDuration={800} />
        <Bar dataKey="gastos" name="Gastos" fill={statementColors.operating} radius={[0, 6, 6, 0]} maxBarSize={18} isAnimationActive animationDuration={850} />
        <Bar dataKey="net" name="Utilidad neta" fill="#2563eb" radius={[0, 6, 6, 0]} maxBarSize={18} isAnimationActive animationDuration={900}>
          {chartRows.map((row) => <Cell key={row.label} fill={row.net >= 0 ? "#2563eb" : statementColors.operating} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
