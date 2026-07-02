export function MiniCountTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value || 0);
  const name = payload[0]?.payload?.label || payload[0]?.name || label;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-zinc-900">{name}</p>
      <p className="text-zinc-600">{value.toLocaleString("es-MX")} alumnos</p>
    </div>
  );
}
