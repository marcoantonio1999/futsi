import { money } from "../../utils/format";

export function MiniMoneyTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value || 0);
  const name = payload[0]?.name || label;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-zinc-900">{name}</p>
      <p className="text-zinc-600">${money(value)}</p>
    </div>
  );
}

export function FinancialChartTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const values = Object.fromEntries(payload.map((item) => [item.dataKey, Number(item.value || 0)]));
  const ingresos = Number(values.ingresos || 0);
  const utilidad = Number(values.utilidad || 0);
  const margen = ingresos ? (utilidad / ingresos) * 100 : 0;

  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-zinc-900">{label}</p>
      <p className="mt-1 text-emerald-700">Ingresos: ${money(ingresos)}</p>
      <p className="text-red-700">Egresos: ${money(Number(values.egresos || 0))}</p>
      <p className={utilidad >= 0 ? "text-zinc-900" : "text-red-700"}>Utilidad: ${money(utilidad)}</p>
      <p className="text-zinc-500">Margen: {margen.toFixed(1)}%</p>
    </div>
  );
}
