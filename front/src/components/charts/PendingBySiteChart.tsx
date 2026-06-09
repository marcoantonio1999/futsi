import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactMoney, money } from "../../utils/format";
import { ChartCardHeader } from "./ChartHelp";
import { MiniMoneyTooltip } from "./ChartTooltips";
import type { MoneyRow } from "./chartTypes";

export function PendingBySiteChart({ title, rows }: { title: string; rows: MoneyRow[] }) {
  const chartRows = [...rows]
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Por cobrar"
        title={title}
        help="Ordena las sedes con mayor saldo pendiente. Cada barra representa dinero aun no cobrado; las barras mas largas son prioridad para cobranza o revision de fuga operativa."
        right={<p className="text-right text-sm font-semibold text-amber-700">${money(total)}</p>}
      />
      <div className="h-[300px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows.length ? chartRows : [{ label: "Sin cobros", value: 0 }]} layout="vertical" margin={{ top: 6, right: 20, bottom: 6, left: 18 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e4e7" />
            <XAxis type="number" tickFormatter={(value) => compactMoney(Number(value))} tick={{ fontSize: 12, fill: "#71717a" }} />
            <YAxis dataKey="label" type="category" width={96} tick={{ fontSize: 12, fill: "#71717a" }} />
            <Tooltip content={<MiniMoneyTooltip />} />
            <Bar dataKey="value" name="Cobro pendiente" fill="#f59e0b" radius={[0, 6, 6, 0]} animationDuration={900} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
