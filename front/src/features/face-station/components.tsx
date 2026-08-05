import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";

export const panelClass = "overflow-hidden rounded-xl border border-emerald-950/10 bg-white shadow-[0_10px_35px_rgba(6,78,59,0.06)]";

export function Button({
  tone = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "primary" | "secondary" | "danger" }) {
  const tones = {
    primary: "border-emerald-700 bg-emerald-700 text-white shadow-sm hover:border-emerald-800 hover:bg-emerald-800",
    secondary: "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800",
    danger: "border-red-200 bg-white text-red-700 hover:bg-red-50",
  };
  return (
    <button
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${tones[tone]} ${className}`}
      {...props}
    />
  );
}

export function MetricCard({ label, value, detail, accent = "emerald" }: { label: string; value: ReactNode; detail: ReactNode; accent?: "emerald" | "blue" | "violet" | "amber" }) {
  const accents = {
    emerald: "from-emerald-500 to-emerald-700",
    blue: "from-blue-500 to-blue-700",
    violet: "from-violet-500 to-violet-700",
    amber: "from-amber-400 to-amber-600",
  };
  return (
    <article className="relative min-w-0 overflow-hidden rounded-xl border border-emerald-950/10 bg-white px-4 py-3.5 shadow-[0_8px_28px_rgba(6,78,59,0.05)]">
      <span className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accents[accent]}`} />
      <p className="truncate text-[10px] font-extrabold uppercase tracking-[0.09em] text-zinc-500">{label}</p>
      <strong className="mt-1.5 block truncate text-[23px] font-bold leading-none tracking-tight text-zinc-900">{value}</strong>
      <small className="mt-2 block truncate text-[11px] text-zinc-500">{detail}</small>
    </article>
  );
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-zinc-100 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.12em] text-emerald-700">{eyebrow}</p> : null}
        <h2 className="text-base font-bold tracking-tight text-zinc-900">{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, detail, error = false, action }: { title: string; detail?: string; error?: boolean; action?: ReactNode }) {
  return (
    <div className="col-span-full flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
      <span className={`mb-3 grid size-11 place-items-center rounded-full ${error ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-700"}`}>
        {error ? <AlertCircle size={20} /> : <span className="text-lg font-bold">···</span>}
      </span>
      <strong className="text-sm text-zinc-800">{title}</strong>
      {detail ? <p className="mt-1.5 max-w-md text-xs leading-5 text-zinc-500">{detail}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Cargando datos locales..." }: { label?: string }) {
  return (
    <div className="col-span-full flex min-h-44 items-center justify-center gap-2 text-xs font-medium text-zinc-500">
      <LoaderCircle className="animate-spin text-emerald-700" size={18} /> {label}
    </div>
  );
}

export function FilterChip({ active, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      aria-pressed={active}
      className={`min-h-8 rounded-full border px-3 text-[10px] font-bold transition ${active ? "border-emerald-200 bg-emerald-50 text-emerald-800 shadow-sm" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-800"}`}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function StatusDot({ ok, warning = false, label }: { ok: boolean; warning?: boolean; label: string }) {
  const tone = ok ? "border-emerald-400/30 text-emerald-50" : warning ? "border-amber-300/30 text-amber-50" : "border-red-300/30 text-red-50";
  const dot = ok ? "bg-emerald-400" : warning ? "bg-amber-400" : "bg-red-400";
  return (
    <span className={`inline-flex min-h-8 items-center gap-2 rounded-full border bg-white/5 px-3 text-[10px] font-bold ${tone}`}>
      <i className={`size-1.5 rounded-full ${dot}`} /> {label}
    </span>
  );
}
