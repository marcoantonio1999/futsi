import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { money } from "../../utils/format";
import { ChartCardHeader } from "./ChartHelp";
import { MiniMoneyTooltip } from "./ChartTooltips";
import type { MoneyRow } from "./chartTypes";

const incomeMethodColors = ["#059669", "#10b981", "#14b8a6", "#84cc16"];

export function PaymentMethodDonut({ title, rows }: { title: string; rows: MoneyRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const chartRows = rows.filter((row) => row.value > 0);
  const leader = [...rows].sort((a, b) => b.value - a.value)[0];
  const visibleRows = chartRows.length ? chartRows : [{ label: "Sin ingresos", value: 1 }];

  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Ingresos"
        title={title}
        help="La dona muestra la distribucion de ingresos confirmados por metodo de pago. El centro es el total; la lista indica monto por metodo y su peso relativo. Sirve para vigilar dependencia de efectivo, tarjeta o transferencia."
      />
      <div className="grid gap-4 p-4 sm:grid-cols-[210px_1fr]">
        <div className="relative h-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={visibleRows} dataKey="value" nameKey="label" innerRadius={62} outerRadius={92} paddingAngle={3} animationDuration={900}>
                {visibleRows.map((row, index) => (
                  <Cell key={row.label} fill={chartRows.length ? incomeMethodColors[index % incomeMethodColors.length] : "#d4d4d8"} />
                ))}
              </Pie>
              <Tooltip content={<MiniMoneyTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-xs uppercase text-zinc-500">Total</p>
              <p className="text-xl font-semibold">${money(total)}</p>
            </div>
          </div>
        </div>
        <div className="grid content-center gap-3">
          {rows.map((row, index) => {
            const percent = total ? (row.value / total) * 100 : 0;
            return (
              <div key={row.label}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-medium">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: incomeMethodColors[index % incomeMethodColors.length] }} />
                    <span className="truncate">{row.label}</span>
                  </span>
                  <span className="shrink-0 text-zinc-500">${money(row.value)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.max(3, percent)}%`, backgroundColor: incomeMethodColors[index % incomeMethodColors.length] }}
                  />
                </div>
              </div>
            );
          })}
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Principal: <span className="font-semibold">{leader?.label || "sin datos"}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
