import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { compactMoney, money } from "../../utils/format";
import { FinancialChartTooltip } from "./ChartTooltips";
import type { FinancialRow } from "./chartTypes";

type Props = { title: string; rows: FinancialRow[]; compact?: boolean; mode?: "site" | "time" };

export function FinancialComboChart({ title, rows, compact = false, mode = "site" }: Props) {
  const [view, setView] = useState("profit");
  const [showAll, setShowAll] = useState(false);
  const timeline = mode === "time";
  const ordered = timeline ? rows : [...rows].sort((a, b) =>
    view === "income" ? b.ingresos - a.ingresos : view === "lowest" ? a.utilidad - b.utilidad : b.utilidad - a.utilidad);
  const limit = timeline ? 12 : compact ? 5 : 6;
  const visible = showAll ? ordered : timeline ? ordered.slice(-limit) : ordered.slice(0, limit);
  const negative = rows.filter(row => row.utilidad < 0).length;

  return <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
    <div className="border-b border-zinc-200 px-4 py-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">{timeline
        ? "Meses con movimientos, en orden cronológico. La línea muestra ingresos menos gastos aprobados."
        : "Cada sede se compara de forma independiente. El resultado es ingresos menos gastos aprobados."}</p>
    </div>
    {!timeline && <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
      <label className="flex items-center gap-2 text-xs text-zinc-500">Ordenar por
        <select aria-label="Orden de sedes" className="max-w-full rounded-md border border-zinc-200 bg-white px-2 py-2 text-sm text-zinc-700" value={view} onChange={event => setView(event.target.value)}>
          <option value="profit">Mayor resultado</option><option value="income">Mayor ingreso</option><option value="lowest">Menor resultado</option>
        </select>
      </label>
      <p className="text-xs text-zinc-500 sm:ml-auto">{negative} {negative === 1 ? "sede con resultado negativo" : "sedes con resultado negativo"}</p>
    </div>}
    {!rows.length ? <p className="p-8 text-sm text-zinc-500">Sin movimientos para el periodo seleccionado.</p> : <>
      <div className="overflow-x-auto p-2 sm:p-4">
        <div style={{ height: timeline ? 300 : visible.length * 76 + 85, minWidth: timeline ? Math.max(250, visible.length * 65) : undefined }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visible} layout={timeline ? "horizontal" : "vertical"} margin={{ top: 12, right: 14, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#a1a1aa" strokeOpacity={0.25} horizontal={timeline} vertical={!timeline} />
              {timeline ? <XAxis dataKey="label" interval={0} tick={{ fontSize: 11, fill: "#71717a" }} /> : <XAxis type="number" tickFormatter={value => compactMoney(Number(value))} tick={{ fontSize: 10, fill: "#71717a" }} />}
              {timeline ? <YAxis width={60} tickFormatter={value => compactMoney(Number(value))} tick={{ fontSize: 10, fill: "#71717a" }} /> : <YAxis dataKey="label" type="category" width={100} interval={0} tick={{ fontSize: 11, fill: "#71717a" }} />}
              {timeline ? <ReferenceLine y={0} stroke="#a1a1aa" /> : <ReferenceLine x={0} stroke="#a1a1aa" />}
              <Tooltip content={<FinancialChartTooltip />} />
              <Legend verticalAlign="top" height={38} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="ingresos" name="Ingresos" fill="#059669" radius={2} maxBarSize={22} animationDuration={800} />
              <Bar dataKey="egresos" name="Gastos" fill="#ef4444" radius={2} maxBarSize={22} animationDuration={800} />
              {timeline ? <Line type="linear" dataKey="utilidad" name="Resultado" stroke="#d97706" strokeWidth={2.5} dot={{ r: 4 }} animationDuration={800} /> : <Bar dataKey="utilidad" name="Resultado" fill="#d97706" radius={2} maxBarSize={22} animationDuration={800} />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4 text-xs text-zinc-500">
        <p>Mostrando {visible.length} de {rows.length} {timeline ? "meses" : "sedes"}{timeline && !showAll && rows.length > limit ? " · más recientes" : ""}.</p>
        {rows.length > limit && <button type="button" className="rounded-md border border-zinc-200 px-3 py-2 font-semibold text-zinc-700" onClick={() => setShowAll(value => !value)}>{showAll ? "Ver menos" : timeline ? "Ver todos los meses" : "Ver todas las sedes"}</button>}
      </div>
      <details className="border-t border-zinc-200 p-4">
        <summary className="cursor-pointer text-sm font-medium">Ver cifras exactas · {rows.length} {timeline ? "meses" : "sedes"}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map(row => <article key={row.label} className="rounded-md border border-zinc-200 p-3 text-xs">
            <h3 className="mb-2 text-sm font-semibold">{row.label}</h3>
            <dl className="grid gap-1.5">
              {[["Ingresos", "$" + money(row.ingresos)], ["Gastos", "$" + money(row.egresos)], ["Resultado", "$" + money(row.utilidad)], ["Margen sobre ingresos", row.ingresos ? ((row.utilidad / row.ingresos) * 100).toFixed(1) + "%" : "No aplica"]].map(([label, value]) => <div key={label} className="flex justify-between gap-3"><dt className="text-zinc-500">{label}</dt><dd className="font-medium">{value}</dd></div>)}
            </dl>
            <p className={"mt-2 font-medium " + (row.utilidad < 0 ? "text-red-600" : row.utilidad > 0 ? "text-emerald-600" : "text-zinc-500")}>Resultado {row.utilidad < 0 ? "negativo" : row.utilidad > 0 ? "positivo" : "en cero"}</p>
          </article>)}
        </div>
      </details>
    </>}
  </section>;
}
