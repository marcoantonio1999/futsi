import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactMoney, money } from "../../utils/format";
import { ChartHelp } from "./ChartHelp";
import { FinancialChartTooltip } from "./ChartTooltips";
import type { FinancialRow } from "./chartTypes";

type FinancialComboChartProps = {
  title: string;
  rows: FinancialRow[];
  compact?: boolean;
};

export function FinancialComboChart({ title, rows, compact = false }: FinancialComboChartProps) {
  const [view, setView] = useState<"profit" | "income" | "risk">("profit");
  const totalIncome = rows.reduce((sum, row) => sum + row.ingresos, 0);
  const totalExpense = rows.reduce((sum, row) => sum + row.egresos, 0);
  const totalUtility = totalIncome - totalExpense;
  const sortedRows = [...rows].sort((a, b) => {
    if (view === "income") return b.ingresos - a.ingresos;
    if (view === "risk") return a.utilidad - b.utilidad;
    return b.utilidad - a.utilidad;
  });
  const chartRows = sortedRows.slice(0, compact ? 8 : 13).map((row) => ({
    ...row,
    margen: row.ingresos ? Number(((row.utilidad / row.ingresos) * 100).toFixed(1)) : 0,
  }));
  const riskRows = sortedRows.filter((row) => row.utilidad < 0);

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-zinc-500">Barras agrupadas por sede: ingresos y egresos. La linea muestra utilidad.</p>
        </div>
        <div className="flex items-start gap-3">
        <div className="grid grid-cols-3 gap-3 text-left text-xs sm:text-right">
          <div>
            <p className="text-zinc-500">Ingresos</p>
            <p className="font-semibold">${money(totalIncome)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Egresos</p>
            <p className="font-semibold">${money(totalExpense)}</p>
          </div>
          <div>
            <p className="text-zinc-500">Utilidad</p>
            <p className={`font-semibold ${totalUtility >= 0 ? "text-emerald-700" : "text-red-700"}`}>${money(totalUtility)}</p>
          </div>
        </div>
        <ChartHelp text="Compara cada sede: la barra verde son ingresos, la roja son egresos y la linea amarilla es utilidad. Usa los botones para ordenar por utilidad, ingreso o riesgo; si la utilidad baja de cero, la sede requiere revision." />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-zinc-100 px-4 py-3 text-sm">
        {[
          ["profit", "Mayor utilidad"],
          ["income", "Mayor ingreso"],
          ["risk", "Mayor riesgo"],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key as "profit" | "income" | "risk")}
            className={`rounded-md border px-3 py-1.5 font-medium ${view === key ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-700"}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-zinc-500">{riskRows.length} sedes en riesgo</span>
      </div>

      <div className="h-[420px] min-w-0 p-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartRows} margin={{ top: 18, right: 24, bottom: 56, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="label" interval={0} angle={-28} textAnchor="end" height={72} tick={{ fontSize: 12, fill: "#71717a" }} />
            <YAxis tickFormatter={(value) => compactMoney(Number(value))} tick={{ fontSize: 12, fill: "#71717a" }} width={72} />
            <Tooltip content={<FinancialChartTooltip />} />
            <Legend verticalAlign="top" height={32} />
            <Bar dataKey="ingresos" name="Ingresos" fill="#059669" radius={[5, 5, 0, 0]} />
            <Bar dataKey="egresos" name="Egresos" fill="#ef4444" radius={[5, 5, 0, 0]} />
            <Line
              type="monotone"
              dataKey="utilidad"
              name="Utilidad"
              stroke="#f59e0b"
              strokeWidth={3}
              dot={{ r: 4, fill: "#f59e0b" }}
              activeDot={{ r: 6 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="border-t border-zinc-100 px-4 py-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="py-2">Sede</th>
                <th className="py-2 text-right">Ingresos</th>
                <th className="py-2 text-right">Egresos</th>
                <th className="py-2 text-right">Utilidad</th>
                <th className="py-2 text-right">Margen</th>
                <th className="py-2 text-right">Estado</th>
              </tr>
            </thead>
            <tbody>
              {chartRows.map((row) => (
                <tr key={row.label} className="border-t border-zinc-100">
                  <td className="py-2 font-medium">{row.label}</td>
                  <td className="py-2 text-right">${money(row.ingresos)}</td>
                  <td className="py-2 text-right">${money(row.egresos)}</td>
                  <td className={`py-2 text-right font-semibold ${row.utilidad >= 0 ? "text-emerald-700" : "text-red-700"}`}>${money(row.utilidad)}</td>
                  <td className={`py-2 text-right ${row.margen >= 0 ? "text-emerald-700" : "text-red-700"}`}>{row.margen.toFixed(1)}%</td>
                  <td className="py-2 text-right">
                    <span className={`rounded-md px-2 py-1 text-xs font-medium ${row.utilidad >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {row.utilidad >= 0 ? "Rentable" : "Riesgo"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
