import { money } from "../../utils/format";
import { ChartCardHeader } from "./ChartHelp";
import type { MoneyRow } from "./chartTypes";

export function CollectionFunnel({ title, rows }: { title: string; rows: MoneyRow[] }) {
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  const tones = [
    { bg: "bg-sky-500", soft: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200", label: "Periodo financiero seleccionado" },
    { bg: "bg-indigo-500", soft: "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200", label: "Estado actual · en validación" },
    { bg: "bg-amber-500", soft: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200", label: "Saldo actual por cobrar" },
  ];

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Cobranza"
        title={title}
        help="Son importes independientes, no etapas de un embudo. Los confirmados corresponden al periodo; los pagos en proceso y saldos son actuales. Las barras usan la misma escala, sin un ancho mínimo artificial."
      />
      <div className="grid gap-4 p-4">
        {rows.map((row, index) => {
          const tone = tones[index % tones.length];
          const percent = (row.value / maxValue) * 100;
          return (
            <div key={row.label} className={`rounded-md px-3 py-3 ${tone.soft}`}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase opacity-80">{tone.label}</p>
                  <p className="font-semibold">{row.label}</p>
                </div>
                <p className="text-lg font-semibold">${money(row.value)}</p>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                <div className={`h-full rounded-full ${tone.bg} transition-all duration-700`} style={{ width: `${percent}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
