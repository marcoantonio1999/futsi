import { HelpCircle } from "lucide-react";
import type { ReactNode } from "react";

export function ChartHelp({ text }: { text: string }) {
  return (
    <div className="group relative">
      <button
        type="button"
        className="grid size-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-950"
        aria-label="Como leer esta grafica"
        title="Como leer esta grafica"
      >
        <HelpCircle size={16} />
      </button>
      <div className="pointer-events-none absolute right-0 top-10 z-30 hidden w-[min(78vw,340px)] rounded-md border border-zinc-200 bg-white p-3 text-left text-xs leading-relaxed text-zinc-600 shadow-lg group-hover:block group-focus-within:block">
        {text}
      </div>
    </div>
  );
}

export function ChartCardHeader({
  eyebrow,
  title,
  subtitle,
  count,
  help,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  count?: number;
  help: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3">
      <div>
        {eyebrow && <p className="text-xs font-medium uppercase text-emerald-700">{eyebrow}</p>}
        <h2 className="font-semibold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {right}
        {typeof count === "number" && <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{count}</span>}
        <ChartHelp text={help} />
      </div>
    </div>
  );
}
