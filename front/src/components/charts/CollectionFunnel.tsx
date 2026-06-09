import { money } from "../../utils/format";
import { ChartCardHeader } from "./ChartHelp";
import type { MoneyRow } from "./chartTypes";

export function CollectionFunnel({ title, rows }: { title: string; rows: MoneyRow[] }) {
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  const tones = [
    { bg: "bg-sky-500", soft: "bg-sky-50 text-sky-800", label: "Cerrado" },
    { bg: "bg-indigo-500", soft: "bg-indigo-50 text-indigo-800", label: "En validacion" },
    { bg: "bg-amber-500", soft: "bg-amber-50 text-amber-800", label: "Por cobrar" },
  ];

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Cobranza"
        title={title}
        help="Lee el embudo de arriba hacia abajo: confirmado, en validacion y pendiente por cobrar. Mientras mas ancha la barra, mayor dinero hay en esa etapa; lo sano es que lo pendiente sea menor que lo confirmado."
      />
      <div className="grid gap-4 p-4">
        {rows.map((row, index) => {
          const tone = tones[index % tones.length];
          const percent = (row.value / maxValue) * 100;
          return (
            <div key={row.label} className={`rounded-md px-3 py-3 ${tone.soft}`}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase opacity-80">{tone.label}</p>
                  <p className="font-semibold">{row.label}</p>
                </div>
                <p className="text-lg font-semibold">${money(row.value)}</p>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/70">
                <div className={`h-full rounded-full ${tone.bg} transition-all duration-700`} style={{ width: `${Math.max(4, percent)}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
