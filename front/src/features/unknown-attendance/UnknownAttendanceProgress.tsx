import { formatBytes } from "../automatic-attendance/format";
import type { UnknownAttendanceJob } from "./model";

export function getUnknownJobProgress(visibleJob: UnknownAttendanceJob | null, isProcessing: boolean) {
  const progress = Math.max(0, Math.min(100, visibleJob?.percent ?? 0));
  const unknownPhase = visibleJob?.phase ?? (isProcessing ? "queued" : visibleJob ? "done" : "idle");
  const zipDownloadProgress = visibleJob?.download_total_bytes ? Math.max(0, Math.min(100, visibleJob.download_percent ?? ((visibleJob.download_bytes ?? 0) / visibleJob.download_total_bytes) * 100)) : null;
  const downloadProgress = visibleJob ? Math.max(0, Math.min(100, zipDownloadProgress ?? (progress >= 35 || ["references", "captures", "done"].includes(unknownPhase) ? 100 : (progress / 35) * 100))) : 0;
  const processingProgress = visibleJob ? Math.max(0, Math.min(100, progress >= 100 || unknownPhase === "done" ? 100 : progress <= 35 ? 0 : ((progress - 35) / 65) * 100)) : 0;
  const downloadBytesLabel = visibleJob?.download_total_bytes
    ? `${formatBytes(visibleJob.download_bytes ?? 0)} de ${formatBytes(visibleJob.download_total_bytes)}${visibleJob.download_rate_bps ? ` - ${formatBytes(visibleJob.download_rate_bps)}/s` : ""}`
    : "";
  const downloadStatusLabel = unknownPhase === "download" ? (downloadBytesLabel || "Descargando desde Drive") : downloadProgress >= 100 ? "Descarga completa" : "Esperando descarga";
  const processingStatusLabel = unknownPhase === "references" ? "Preparando referencias" : unknownPhase === "captures" ? "Procesando desde disco local" : processingProgress >= 100 ? "Proceso completo" : "Esperando proceso";
  const jobCountLabel = unknownPhase === "download" ? `${visibleJob?.processed ?? 0}/${visibleJob?.total ?? 0} descargas` : `${visibleJob?.processed ?? 0}/${visibleJob?.total ?? 0} capturas`;
  return { downloadBytesLabel, downloadProgress, downloadStatusLabel, jobCountLabel, processingProgress, processingStatusLabel, progress, unknownPhase };
}

export function UnknownJobProgressCard({ visibleJob, isProcessing }: { visibleJob: UnknownAttendanceJob | null; isProcessing: boolean }) {
  if (!visibleJob) return null;
  const { downloadProgress, downloadStatusLabel, jobCountLabel, processingProgress, processingStatusLabel, progress, unknownPhase } = getUnknownJobProgress(visibleJob, isProcessing);
  return (
    <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
      <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
        <div>
          <span className="font-medium text-zinc-950 dark:text-zinc-50">{visibleJob.current_capture ?? `Trabajo ${visibleJob.id.slice(0, 8)}`}</span>
          <p className="mt-1 text-xs text-zinc-500">{visibleJob.phase_label ?? (isProcessing ? "Preparando trabajo de desconocidos" : "Trabajo finalizado")}</p>
        </div>
        <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">{jobCountLabel}</span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <ProgressStep
          active={unknownPhase === "download"}
          barClassName="bg-blue-700"
          label="1. Descarga Drive"
          percent={downloadProgress}
          status={downloadStatusLabel}
          toneClassName="border-blue-100 bg-white dark:border-blue-900/60 dark:bg-zinc-950"
          trackClassName="bg-blue-50 dark:bg-blue-950/40"
          textClassName="text-blue-700 dark:text-blue-300"
        />
        <ProgressStep
          active={["references", "captures"].includes(unknownPhase)}
          barClassName="bg-amber-600"
          label="2. Proceso local"
          percent={processingProgress}
          status={processingStatusLabel}
          toneClassName="border-amber-100 bg-white dark:border-amber-900/60 dark:bg-zinc-950"
          trackClassName="bg-amber-50 dark:bg-amber-950/40"
          textClassName="text-amber-700 dark:text-amber-300"
        />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>Progreso total</span>
          <span>{progress.toFixed(1)}%</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div className={`h-full rounded-full bg-zinc-950 transition-all duration-700 dark:bg-zinc-50 ${isProcessing ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(progress, isProcessing ? 3 : 0)}%` }} />
        </div>
      </div>
      {visibleJob.detail && <p className="mt-2 text-sm text-red-700">{visibleJob.detail}</p>}
    </div>
  );
}

export function UnknownActiveJobBanner({
  dateLabel,
  description,
  downloadBytesLabel,
  progress,
  title,
  visibleJob,
}: {
  dateLabel: string;
  description?: string;
  downloadBytesLabel?: string;
  progress: number;
  title: string;
  visibleJob: UnknownAttendanceJob;
}) {
  return (
    <section className="rounded-md border border-blue-200 bg-blue-50 p-4 text-blue-900 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-100">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-sm">{dateLabel} - {visibleJob.phase_label ?? visibleJob.status}</p>
          {downloadBytesLabel ? <p className="mt-1 text-xs font-semibold">{downloadBytesLabel}</p> : null}
          <p className="mt-1 text-xs">{description ?? visibleJob.current_capture ?? `Trabajo ${visibleJob.id.slice(0, 8)}`}</p>
        </div>
        <div className="min-w-[220px]">
          <div className="flex items-center justify-between text-xs">
            <span>{visibleJob.processed ?? 0}/{visibleJob.total ?? 0}</span>
            <span>{progress.toFixed(1)}%</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/50">
            <div className="h-full rounded-full bg-blue-700 transition-all duration-700 progress-fill-active" style={{ width: `${Math.max(progress, 3)}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ProgressStep({
  active,
  barClassName,
  label,
  percent,
  status,
  textClassName,
  toneClassName,
  trackClassName,
}: {
  active: boolean;
  barClassName: string;
  label: string;
  percent: number;
  status: string;
  textClassName: string;
  toneClassName: string;
  trackClassName: string;
}) {
  return (
    <div className={`rounded-md border p-3 ${toneClassName}`}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={`font-semibold uppercase tracking-wide ${textClassName}`}>{label}</span>
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">{percent.toFixed(1)}%</span>
      </div>
      <div className={`mt-2 h-3 overflow-hidden rounded-full ${trackClassName}`}>
        <div className={`h-full rounded-full transition-all duration-700 ${barClassName} ${active ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(percent, active ? 3 : 0)}%` }} />
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{status}</p>
    </div>
  );
}
