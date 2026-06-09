import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ChartCardHeader } from "./ChartHelp";
import type { MoneyRow } from "./chartTypes";

const studentStatusColors = ["#2563eb", "#7c3aed", "#f59e0b", "#ec4899", "#64748b"];

export function StudentStatusDonut({ title, rows }: { title: string; rows: MoneyRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const chartRows = rows.filter((row) => row.value > 0);
  const visibleRows = chartRows.length ? chartRows : [{ label: "Sin alumnos", value: 1 }];

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Alumnos"
        title={title}
        help="Muestra cuantos alumnos hay por estatus: activo, prueba, pausa o baja. El centro es el total; la lista ayuda a detectar si hay demasiadas pruebas sin convertir o pausas que afectan cobranza."
      />
      <div className="grid gap-4 p-4 sm:grid-cols-[200px_1fr]">
        <div className="relative h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={visibleRows} dataKey="value" nameKey="label" innerRadius={56} outerRadius={88} paddingAngle={2} animationDuration={900}>
                {visibleRows.map((row, index) => (
                  <Cell key={row.label} fill={chartRows.length ? studentStatusColors[index % studentStatusColors.length] : "#d4d4d8"} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-xs uppercase text-zinc-500">Total</p>
              <p className="text-2xl font-semibold">{total}</p>
            </div>
          </div>
        </div>
        <div className="grid content-center gap-2">
          {rows.map((row, index) => (
            <div key={row.label} className="flex items-center justify-between gap-3 rounded-md border border-zinc-100 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: studentStatusColors[index % studentStatusColors.length] }} />
                <span className="truncate">{row.label}</span>
              </span>
              <span className="text-lg font-semibold">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
