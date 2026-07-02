import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Cloud, Download, FileVideo, FolderOpen, Play, RefreshCw, Search } from "lucide-react";
import { formatBytes, formatDuration, formatSpeed } from "../format";
import { statusTone, type AutomaticAttendanceJob, type AutomaticAttendanceStatus } from "../model";

export function AutomaticAttendanceStatusSection({
  status,
  visibleJob,
  currentJobLabel,
  pendingCount,
  progress,
  elapsedSeconds,
  isProcessing,
  canProcessPending,
  canDownloadPending,
  message,
  error,
  loadingStatus,
  onRefresh,
  onDownloadPending,
  onProcessAll,
  onOpenResults,
}: {
  status: AutomaticAttendanceStatus | null;
  visibleJob: AutomaticAttendanceJob | null;
  currentJobLabel: string;
  pendingCount: number;
  progress: number;
  elapsedSeconds: number | null;
  isProcessing: boolean;
  canProcessPending: boolean;
  canDownloadPending: boolean;
  message: string;
  error: string;
  loadingStatus: boolean;
  onRefresh: () => void;
  onDownloadPending: () => void;
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
              className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-500 dark:border-blue-900 dark:bg-zinc-950 dark:text-blue-100 dark:hover:bg-blue-950/30 dark:disabled:border-zinc-800 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-500"
              disabled={!canDownloadPending}
              onClick={onDownloadPending}
              type="button"
            >
              <Download size={15} /> Descargar pendientes a local
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

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
            <p className="text-xs font-semibold uppercase text-zinc-500 dark:text-zinc-400">Cache local</p>
            <p className="mt-2 text-3xl font-semibold">{status?.local_cache?.count ?? 0}</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {formatBytes(status?.local_cache?.bytes ?? 0)} - {status?.local_cache?.retention_days ?? 5} dias
            </p>
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
              {elapsedSeconds != null ? ` - transcurrido ${formatDuration(elapsedSeconds)}` : ""}
              {visibleJob.download_percent != null ? ` - descarga ${visibleJob.download_percent.toFixed(1)}% (${formatSpeed(visibleJob.download_speed_bps)})` : ""}
              {visibleJob.process_frame ? ` - frame ${visibleJob.process_frame}` : ""}
            </p>
            <ProxyPipelineProgress job={visibleJob} />
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

function ProxyPipelineProgress({ job }: { job: AutomaticAttendanceJob }) {
  if (!isProxyPipelineJob(job)) return null;
  const proxyPercent = job.download_source === "frame_proxy_1fps" && job.download_percent != null ? `${job.download_percent.toFixed(1)}%` : stepState(job, "proxy") === "done" ? "100%" : "Esperando";
  const scanTotal = job.proxy_scan_total_frames ?? 0;
  const scanCurrent = scanTotal ? Math.min(scanTotal, job.proxy_scan_frame ?? job.proxy_sampled_frames ?? 0) : (job.proxy_scan_frame ?? job.proxy_sampled_frames ?? 0);
  const detailTotal = job.process_candidate_windows_total ?? 0;
  const detailDone = job.process_candidate_windows_done ?? 0;
  return (
    <div className="mt-4 grid gap-2 lg:grid-cols-4">
      <PipelineStep
        icon={<Cloud size={14} />}
        title="1. Proxy"
        state={stepState(job, "proxy")}
        detail={`${proxyPercent}${job.downloaded_bytes ? ` - ${formatBytes(job.downloaded_bytes)}` : ""}`}
      />
      <PipelineStep
        icon={<Search size={14} />}
        title="2. Candidatos"
        state={stepState(job, "scan")}
        detail={`${scanTotal ? `${scanCurrent}/${scanTotal} frames` : "Pendiente"} - ${job.proxy_candidate_seconds ?? 0} segundos - ${job.proxy_candidate_windows ?? 0} ventanas${job.proxy_scan_max_dimension ? ` - ${job.proxy_scan_max_dimension}px` : ""}`}
      />
      <PipelineStep
        icon={<FileVideo size={14} />}
        title="3. Original"
        state={stepState(job, "original")}
        detail={stepState(job, "original") === "active" ? "Descargando o esperando original" : stepState(job, "original") === "done" ? "Original listo" : "Pendiente"}
      />
      <PipelineStep
        icon={<CheckCircle2 size={14} />}
        title="4. Detalle"
        state={stepState(job, "detail")}
        detail={`${detailTotal ? `${detailDone}/${detailTotal} ventanas` : "Pendiente"} - ${job.process_sampled_frames ?? 0} frames - ${job.process_face_groups ?? 0} grupos`}
      />
      <CandidateTimeline job={job} />
    </div>
  );
}

function CandidateTimeline({ job }: { job: AutomaticAttendanceJob }) {
  const seconds = job.proxy_candidate_seconds_preview ?? [];
  const windows = job.proxy_candidate_windows_preview ?? [];
  if (!seconds.length && !windows.length) return null;
  return (
    <div className="lg:col-span-4 rounded-md border border-zinc-200 bg-white p-3 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-semibold">Segundos candidatos</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{seconds.length ? `Mostrando ultimos ${seconds.length}` : `${windows.length} ventanas agrupadas`}</p>
      </div>
      {seconds.length ? (
        <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-auto">
          {seconds.map((second, index) => (
            <span key={`${second}-${index}`} className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              {formatSecondLabel(second)}
            </span>
          ))}
        </div>
      ) : null}
      {windows.length ? (
        <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-auto">
          {windows.map((window, index) => (
            <span key={`${window.start_second}-${window.end_second}-${index}`} className="rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
              {formatSecondLabel(window.start_second)}-{formatSecondLabel(window.end_second)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatSecondLabel(value: number) {
  if (!Number.isFinite(value)) return "-";
  const total = Math.max(0, Math.round(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function PipelineStep({ icon, title, state, detail }: { icon: ReactNode; title: string; state: "pending" | "active" | "done"; detail: string }) {
  const tone =
    state === "done"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
      : state === "active"
        ? "border-blue-200 bg-white text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100"
        : "border-zinc-200 bg-white text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400";
  const dot = state === "done" ? "bg-emerald-500" : state === "active" ? "bg-blue-600 progress-fill-active" : "bg-zinc-300";
  return (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-2 text-xs font-semibold">{icon}{title}</p>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      </div>
      <p className="mt-2 text-xs">{detail}</p>
    </div>
  );
}

function isProxyPipelineJob(job: AutomaticAttendanceJob) {
  return (
    job.download_source === "frame_proxy_1fps" ||
    job.phase === "proxy_scan" ||
    job.phase === "downloading_original" ||
    job.processing_video_source === "full_video_detail_from_proxy" ||
    job.process_pipeline_read_mode === "detail-from-proxy" ||
    Boolean(job.process_candidate_windows_total)
  );
}

function stepState(job: AutomaticAttendanceJob, step: "proxy" | "scan" | "original" | "detail"): "pending" | "active" | "done" {
  if (job.status === "done") return "done";
  if (step === "proxy") {
    if (job.download_source === "frame_proxy_1fps" && (job.phase === "downloading" || (job.download_percent ?? 0) < 100)) return "active";
    return ["proxy_scan", "downloading_original", "processing"].includes(String(job.phase)) ? "done" : "pending";
  }
  if (step === "scan") {
    if (job.phase === "proxy_scan") return "active";
    return ["downloading_original", "processing"].includes(String(job.phase)) || Boolean(job.process_candidate_windows_total) ? "done" : "pending";
  }
  if (step === "original") {
    if (job.phase === "downloading_original") return "active";
    return job.phase === "processing" && Boolean(job.process_candidate_windows_total) ? "done" : "pending";
  }
  if (job.phase === "processing" && Boolean(job.process_candidate_windows_total)) return "active";
  return "pending";
}
