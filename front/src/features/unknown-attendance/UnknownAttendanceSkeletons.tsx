import { RefreshCw, Search } from "lucide-react";

export function UnknownAttendanceSkeleton({ error, loading, onRefresh }: { error: string; loading: boolean; onRefresh: () => void }) {
  const rows = Array.from({ length: 5 }, (_, index) => index);
  return (
    <div className="grid gap-5">
      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Rostros desconocidos</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              <Search size={18} /> Cargando desconocidos
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">Preparando resumen, ventanas de actividad y evidencia visual.</p>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            disabled={loading}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCw size={15} /> {loading ? "Cargando..." : "Reintentar"}
          </button>
        </div>
        {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {rows.slice(0, 4).map((item) => (
            <div key={item} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-3 h-7 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </section>
      <UnknownTableSkeleton rows={rows} titleWidth="w-56" columns={5} />
    </div>
  );
}

export function UnknownAttendanceDetailSkeleton({
  dateLabel,
  error,
  loading,
  onBack,
  onRefresh,
}: {
  dateLabel: string;
  error: string;
  loading: boolean;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const rows = Array.from({ length: 6 }, (_, index) => index);
  return (
    <div className="grid gap-5">
      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Detalle de desconocidos</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              <Search size={18} /> Cargando sesion diaria del {dateLabel}
            </h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Preparando capturas, ventanas de actividad y evidencia visual.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={onBack} type="button">
              Volver al reporte
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              disabled={loading}
              onClick={onRefresh}
              type="button"
            >
              <RefreshCw size={15} /> {loading ? "Cargando..." : "Reintentar"}
            </button>
          </div>
        </div>
        {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-3 h-7 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-2 h-3 w-20 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="h-4 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-2 h-3 w-96 max-w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
        </div>
        <div className="p-4">
          <div className="h-24 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-900" />
        </div>
      </section>
      <UnknownTableSkeleton rows={rows} titleWidth="w-48" columns={6} />
      <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="h-4 w-72 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="aspect-square animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <div className="mt-3 h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-2 h-3 w-44 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function UnknownTableSkeleton({ columns, rows, titleWidth }: { columns: number; rows: number[]; titleWidth: string }) {
  const columnClassName = columns === 6 ? "md:grid-cols-6" : "md:grid-cols-5";
  return (
    <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className={`h-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 ${titleWidth}`} />
      </div>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((item) => (
          <div key={item} className={`grid gap-4 px-4 py-4 ${columnClassName}`}>
            {Array.from({ length: columns }, (_, index) => (
              <div key={index} className="h-5 animate-pulse rounded bg-zinc-100 first:bg-zinc-200 dark:bg-zinc-900 dark:first:bg-zinc-800" />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
