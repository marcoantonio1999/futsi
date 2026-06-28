import { AlertTriangle, CheckCircle2, Clock3, FolderOpen, Play, RefreshCw } from "lucide-react";
import { formatSpeed } from "./automaticAttendanceFormat";
import { statusTone, type AutomaticAttendanceJob, type AutomaticAttendanceStatus } from "./automaticAttendanceModel";

export function AutomaticAttendanceStatusSection({
  status,
  visibleJob,
  currentJobLabel,
  pendingCount,
  progress,
  isProcessing,
  canProcessPending,
  message,
  error,
  loadingStatus,
  onRefresh,
  onProcessAll,
  onOpenResults,
}: {
  status: AutomaticAttendanceStatus | null;
  visibleJob: AutomaticAttendanceJob | null;
  currentJobLabel: string;
  pendingCount: number;
  progress: number;
  isProcessing: boolean;
  canProcessPending: boolean;
  message: string;
  error: string;
  loadingStatus: boolean;
  onRefresh: () => void;
  onProcessAll: () => void;
  onOpenResults: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="border-b border-zinc-200 bg-zinc-50/80 p-4 dark:border-zinc-800 dark:bg-zinc-900/30">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Asistencia automatica</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold">
              <FolderOpen size={18} /> Pase de lista automatico
            </h2>
            <p className="mt-2 max-w-3xl break-all rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              {status?.pending_dir ?? "Cargando carpeta local..."}
            </p>
          </div>
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800" onClick={onRefresh} type="button">
              <RefreshCw size={15} /> Actualizar
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-400"
              disabled={!canProcessPending}
              onClick={onProcessAll}
              type="button"
            >
              <Play size={15} /> Procesar todos los pendientes
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">Servicio local</p>
            <p className={`mt-3 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm font-semibold ${status?.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
              {status?.enabled ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              {status?.enabled ? "Disponible" : "No habilitado"}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">Videos en cola</p>
            <p className="mt-2 text-3xl font-semibold">{pendingCount}</p>
          </div>
          <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">Ultimo trabajo</p>
            <p className={`mt-3 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm font-semibold ${statusTone(visibleJob?.status)}`}>
              <Clock3 size={15} />
              {visibleJob?.status ?? "Sin trabajos"}
            </p>
          </div>
        </div>
      </div>

      {visibleJob && (
        <div className="p-4">
          <div className="rounded-md border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase text-blue-700 dark:text-blue-300">Trabajo activo</p>
                <p className="mt-1 break-words text-sm font-semibold text-zinc-950 dark:text-zinc-50">{currentJobLabel}</p>
              </div>
              <button className="inline-flex items-center justify-center rounded-md border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-50 dark:border-blue-900 dark:bg-zinc-950 dark:text-blue-200 dark:hover:bg-blue-950/30" onClick={onOpenResults} type="button">
                Ver progreso y resultados
              </button>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-white dark:bg-zinc-900">
              <div className={`h-full rounded-full bg-blue-700 transition-all duration-700 ${isProcessing ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(progress, isProcessing ? 3 : 0)}%` }} />
            </div>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              {visibleJob.phase_label ? `${visibleJob.phase_label} - ` : ""}{visibleJob.processed}/{visibleJob.total} videos - {progress.toFixed(1)}%
              {visibleJob.download_percent != null ? ` - descarga ${visibleJob.download_percent.toFixed(1)}% (${formatSpeed(visibleJob.download_speed_bps)})` : ""}
              {visibleJob.process_frame ? ` - frame ${visibleJob.process_frame}` : ""}
            </p>
            {visibleJob.detail && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{visibleJob.detail}</p>}
          </div>
        </div>
      )}

      {(message || error || loadingStatus) && (
        <div className="px-4 pb-4">
          {message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {loadingStatus && <p className="text-sm text-zinc-500">Leyendo carpeta local...</p>}
        </div>
      )}
    </section>
  );
}
