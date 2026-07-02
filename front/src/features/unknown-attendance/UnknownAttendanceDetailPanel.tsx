import { Fragment, useEffect, useMemo, useState } from "react";
import { Check, Clock3, Play, RefreshCw, Search } from "lucide-react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import { EvidenceImage } from "../automatic-attendance";
import { formatBytes } from "../automatic-attendance/format";
import {
  activityWindowStatusClass,
  activityWindowStatusLabel,
  appearanceTimeLabel,
  captureIsOnDate,
  captureStatusClass,
  captureStatusLabel,
  daysAgoDateValue,
  formatTimeOnly,
  qualityRejectText,
  qualityText,
  statusTone,
  subjectAppearanceTimes,
  type UnknownAttendanceJob,
  type UnknownAttendanceStatus,
  type UnknownDailyReport,
} from "./model";
export function UnknownAttendanceDetailPanel({ token, data, date, initialReport, onBack }: { token: string; data: AppData; date: string; initialReport?: unknown; onBack: () => void }) {
  const [status, setStatus] = useState<UnknownAttendanceStatus | null>(null);
  const [job, setJob] = useState<UnknownAttendanceJob | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [acceptingSubjectId, setAcceptingSubjectId] = useState("");

  const visibleJob = job ?? status?.active_job ?? null;
  const isProcessing = visibleJob?.status === "queued" || visibleJob?.status === "processing";
  const detailDate = date || daysAgoDateValue(1);
  const activeJobDate = visibleJob?.captured_date ?? "";
  const activeJobIsCurrentDate = Boolean(activeJobDate && activeJobDate === detailDate && isProcessing);
  const activeJobIsDifferentDate = Boolean(activeJobDate && activeJobDate !== detailDate && isProcessing);
  const activeDifferentDateJob = activeJobIsDifferentDate && visibleJob ? visibleJob : null;
  const detailDateLabel = useMemo(() => new Date(`${detailDate}T00:00:00`).toLocaleDateString(), [detailDate]);
  const dailyReports = status?.daily_reports ?? [];
  const selectedReport = dailyReports.find((report) => report.date === detailDate) ?? ((initialReport && typeof initialReport === "object") ? (initialReport as UnknownDailyReport) : undefined);
  const pendingUploadCount = selectedReport?.pending_upload_count ?? 0;
  const rawWithoutEvidenceCount = Math.max(0, (selectedReport?.candidate_subjects ?? 0) - (selectedReport?.visual_subjects ?? 0));
  const pendingCaptures = useMemo(() => (status?.pending ?? []).filter((capture) => captureIsOnDate(capture, detailDate)), [detailDate, status?.pending]);
  const pendingCount = status?.pending_count ?? selectedReport?.pending_count ?? pendingCaptures.length;
  const visibleSubjects = useMemo(() => (status?.subjects ?? []).filter((subject) => Boolean(subject.image_url)), [status?.subjects]);
  const activityWindows = status?.activity_windows ?? [];
  const pendingSession = useMemo(() => {
    if (status?.pending_summary) {
      return {
        siteLabel: "Capturas del dia",
        cameraLabel: `${status.pending_summary.count} pendiente${status.pending_summary.count === 1 ? "" : "s"}`,
        timeRange:
          status.pending_summary.first_captured_at && status.pending_summary.last_captured_at
            ? `${formatTimeOnly(status.pending_summary.first_captured_at)} - ${formatTimeOnly(status.pending_summary.last_captured_at)}`
            : "Sin horario",
        totalBytes: status.pending_summary.total_bytes,
      };
    }
    if (selectedReport?.pending_count) {
      return {
        siteLabel: "Capturas del dia",
        cameraLabel: `${selectedReport.pending_count} pendiente${selectedReport.pending_count === 1 ? "" : "s"}`,
        timeRange:
          selectedReport.first_captured_at && selectedReport.last_captured_at
            ? `${formatTimeOnly(selectedReport.first_captured_at)} - ${formatTimeOnly(selectedReport.last_captured_at)}`
            : "Sin horario",
        totalBytes: selectedReport.total_bytes,
      };
    }
    if (!pendingCaptures.length) return null;
    const sorted = pendingCaptures.slice().sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
    const siteNames = Array.from(new Set(sorted.map((capture) => data.sites.find((site) => site.id === capture.site_id)?.name ?? "Sin sede")));
    const cameraIds = Array.from(new Set(sorted.map((capture) => capture.camera_id).filter(Boolean)));
    const totalBytes = sorted.reduce((sum, capture) => sum + Number(capture.size_bytes || 0), 0);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    return {
      siteLabel: siteNames.join(", "),
      cameraLabel: cameraIds.length ? `${cameraIds.length} camara${cameraIds.length === 1 ? "" : "s"}` : "Sin camara",
      timeRange: first && last ? `${formatTimeOnly(first.captured_at)} - ${formatTimeOnly(last.captured_at)}` : "Sin horario",
      totalBytes,
    };
  }, [data.sites, pendingCaptures, selectedReport, status?.pending_summary]);
  const unknownProcessingEnabled = status?.enabled ?? true;
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

  async function loadDetailLists() {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const detailStatus = await apiRequest<UnknownAttendanceStatus>(
        `/unknown-attendance/status/?captured_date=${encodeURIComponent(detailDate)}&pending_limit=0&recent_limit=24&subject_limit=24&report_limit=0&activity_window_limit=50`,
        token,
      );
      setStatus((current) => ({
        ...(current ?? detailStatus),
        daily_reports: detailStatus.daily_reports?.length ? detailStatus.daily_reports : current?.daily_reports ?? [],
        recent: detailStatus.recent,
        subjects: detailStatus.subjects,
        activity_windows: detailStatus.activity_windows?.length ? detailStatus.activity_windows : current?.activity_windows ?? [],
        jobs: detailStatus.jobs,
        active_job: detailStatus.active_job,
        thresholds: detailStatus.thresholds,
      }));
    } catch {
      // Manual refresh can retry detail lists.
    }
  }

  async function loadStatus(silent = false) {
    if (silent && typeof document !== "undefined" && document.hidden) return;
    if (!silent) setLoadingStatus(true);
    try {
      const nextStatus = await apiRequest<UnknownAttendanceStatus>(
        `/unknown-attendance/status/?captured_date=${encodeURIComponent(detailDate)}&pending_limit=0&recent_limit=0&subject_limit=24&report_limit=45&activity_window_limit=50`,
        token,
      );
      setStatus((current) => ({
        ...nextStatus,
        recent: nextStatus.recent.length ? nextStatus.recent : current?.recent ?? [],
        subjects: nextStatus.subjects.length ? nextStatus.subjects : current?.subjects ?? [],
      }));
      if (!silent || !(status?.recent?.length || status?.subjects?.length)) {
        void loadDetailLists();
      }
      if (nextStatus.active_job) {
        setJob(nextStatus.active_job);
      } else {
        setJob((current) => {
          if (!current) return null;
          const hydratedJob = nextStatus.jobs?.find((candidate) => candidate.id === current.id);
          if (hydratedJob) return hydratedJob;
          return current.status === "queued" || current.status === "processing" ? null : current;
        });
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el detalle de desconocidos.");
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    loadStatus(false);
    const interval = window.setInterval(() => loadStatus(true), isProcessing ? 3000 : 30000);
    return () => window.clearInterval(interval);
  }, [detailDate, isProcessing, token]);

  async function processUnknown() {
    setMessage("");
    setError("");
    try {
      const nextJob = await apiRequest<UnknownAttendanceJob>("/unknown-attendance/process-pending/", token, {
        method: "POST",
        body: JSON.stringify({ captured_date: detailDate }),
      });
      setJob(nextJob);
      setMessage("Procesamiento de desconocidos iniciado.");
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar el procesamiento de desconocidos.");
    }
  }

  async function acceptUnknownSubject(subjectId: string) {
    setAcceptingSubjectId(subjectId);
    setMessage("");
    setError("");
    try {
      await apiRequest(`/unknown-attendance/subjects/${encodeURIComponent(subjectId)}/accept/`, token, { method: "POST" });
      setMessage("Desconocido consolidado aceptado y subido a Storage.");
      await loadStatus(true);
      await loadDetailLists();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aceptar el desconocido.");
    } finally {
      setAcceptingSubjectId("");
    }
  }

  const processedResults = (visibleJob?.results?.flatMap((result) => result.processed ?? []) ?? []).filter((item) => !item.detail?.includes("se detectaron 0 caras"));

  if (!status) {
    return <UnknownAttendanceDetailSkeleton dateLabel={detailDateLabel} error={error} loading={loadingStatus} onBack={onBack} onRefresh={() => loadStatus()} />;
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Detalle de desconocidos</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              <Search size={18} /> Sesion diaria del {detailDateLabel}
            </h2>
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
              Revisa las capturas pendientes y las personas desconocidas consolidadas de este dia.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={onBack} type="button">
              Volver al reporte
            </button>
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => loadStatus()} type="button">
              <RefreshCw size={15} /> Actualizar
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500">Pendientes</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{pendingCount}</p>
          </div>
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500">Con evidencia visual</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{visibleSubjects.length}</p>
          </div>
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500">Candidatos crudos</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{selectedReport?.candidate_subjects ?? 0}</p>
            {rawWithoutEvidenceCount > 0 ? <p className="mt-1 text-xs font-semibold text-red-700">{rawWithoutEvidenceCount} sin evidencia</p> : null}
          </div>
          <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/20">
            <p className="text-xs font-medium uppercase text-red-700 dark:text-red-300">Sin subir</p>
            <p className="mt-2 text-2xl font-semibold text-red-800 dark:text-red-100">{pendingUploadCount}</p>
            <p className="mt-1 text-xs text-red-700 dark:text-red-200">No procesables aun</p>
          </div>
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500">Trabajo</p>
            <p className={`mt-2 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm font-medium ${statusTone(visibleJob?.status)}`}>
              <Clock3 size={15} /> {visibleJob?.status ?? "Sin trabajos"}
            </p>
          </div>
        </div>
        {visibleJob ? (
          <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-800 dark:bg-zinc-900/30">
            <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
              <div>
                <span className="font-medium text-zinc-950 dark:text-zinc-50">{visibleJob.current_capture ?? `Trabajo ${visibleJob.id.slice(0, 8)}`}</span>
                <p className="mt-1 text-xs text-zinc-500">{visibleJob.phase_label ?? (isProcessing ? "Preparando trabajo de desconocidos" : "Trabajo finalizado")}</p>
              </div>
              <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">{jobCountLabel}</span>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border border-blue-100 bg-white p-3 dark:border-blue-900/60 dark:bg-zinc-950">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">1. Descarga Drive</span>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-200">{downloadProgress.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-blue-50 dark:bg-blue-950/40">
                  <div className={`h-full rounded-full bg-blue-700 transition-all duration-700 ${unknownPhase === "download" ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(downloadProgress, unknownPhase === "download" ? 3 : 0)}%` }} />
                </div>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{downloadStatusLabel}</p>
              </div>
              <div className="rounded-md border border-amber-100 bg-white p-3 dark:border-amber-900/60 dark:bg-zinc-950">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">2. Proceso local</span>
                  <span className="font-semibold text-zinc-700 dark:text-zinc-200">{processingProgress.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-amber-50 dark:bg-amber-950/40">
                  <div className={`h-full rounded-full bg-amber-600 transition-all duration-700 ${["references", "captures"].includes(unknownPhase) ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(processingProgress, ["references", "captures"].includes(unknownPhase) ? 3 : 0)}%` }} />
                </div>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{processingStatusLabel}</p>
              </div>
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
        ) : null}
        {message && <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loadingStatus && <p className="mt-3 text-sm text-zinc-500">Cargando detalle de desconocidos...</p>}
      </section>

      {activeDifferentDateJob ? (
        <section className="rounded-md border border-blue-200 bg-blue-50 p-4 text-blue-900 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-100">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold">Hay una descarga/proceso activo en otro dia</p>
              <p className="mt-1 text-sm">
                Trabajo {activeDifferentDateJob.id.slice(0, 8)} - {new Date(`${activeJobDate}T00:00:00`).toLocaleDateString()} - {activeDifferentDateJob.phase_label ?? activeDifferentDateJob.status}
              </p>
              {downloadBytesLabel ? <p className="mt-1 text-xs font-semibold">{downloadBytesLabel}</p> : null}
              <p className="mt-1 text-xs">El detalle actual es {detailDateLabel}; por eso el bloque pendiente de este dia puede no moverse hasta que termine el trabajo activo.</p>
            </div>
            <div className="min-w-[220px]">
              <div className="flex items-center justify-between text-xs">
                <span>{activeDifferentDateJob.processed ?? 0}/{activeDifferentDateJob.total ?? 0}</span>
                <span>{progress.toFixed(1)}%</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/50">
                <div className="h-full rounded-full bg-blue-700 transition-all duration-700 progress-fill-active" style={{ width: `${Math.max(progress, 3)}%` }} />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Detalle de desconocidos del dia</h3>
            <p className="mt-1 text-xs text-zinc-500">Sesion diaria del {detailDateLabel}.</p>
          </div>
          <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{pendingCount}</span>
        </div>
        <div className="p-4">
          {pendingSession ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{pendingSession.siteLabel}</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {detailDateLabel} - {pendingSession.timeRange} - {pendingSession.cameraLabel}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {pendingCount} capturas - {formatBytes(pendingSession.totalBytes)}
                  </p>
                </div>
                <button
                  className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                    activeJobIsCurrentDate
                      ? "bg-blue-700 text-white dark:bg-blue-500 dark:text-blue-950"
                      : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                  }`}
                  disabled={!unknownProcessingEnabled || pendingCount === 0 || isProcessing}
                  onClick={() => processUnknown()}
                  type="button"
                >
                  <Play size={15} /> {activeJobIsCurrentDate ? `Procesando ${progress.toFixed(1)}%` : "Procesar toda la sesion"}
                </button>
              </div>
            </div>
          ) : pendingUploadCount > 0 ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100">
              <p className="text-sm font-semibold">Capturas detectadas, pero todavia no subidas por el cron</p>
              <p className="mt-1 text-sm">
                Hay {pendingUploadCount} capturas en estado local/sin subir. El backend no puede descargar ni procesar caras hasta que el cron las suba a Drive y queden como pendientes procesables.
              </p>
              <p className="mt-2 text-xs">Por eso no aparecen imagenes de caras ni boton de procesamiento para este dia.</p>
            </div>
          ) : (
            <p className="py-6 text-sm text-zinc-500">{selectedReport?.pending_count ? "No se pudo cargar el bloque pendiente de este dia." : "No hay capturas pendientes para procesar en este dia."}</p>
          )}
        </div>
      </section>

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Actividad no agendada</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Ventanas de {status?.thresholds.activity_window_minutes ?? 60} min; posible no agendado si hay {status?.thresholds.unscheduled_min_people ?? 6}+ personas unicas y no empalma con agenda.
            </p>
          </div>
          <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{activityWindows.length}</span>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full border-collapse text-left text-sm text-zinc-900 dark:text-zinc-100">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Ventana</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Personas</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Capturas</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Sede / camara</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Agenda</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {activityWindows.map((windowItem) => {
                const site = data.sites.find((item) => item.id === windowItem.site_id);
                const evidence = windowItem.evidence ?? [];
                return (
                  <Fragment key={`${windowItem.camera_id}-${windowItem.window_start}`}>
                    <tr key={`${windowItem.camera_id}-${windowItem.window_start}`} className="bg-white dark:bg-zinc-950">
                      <td className="whitespace-nowrap px-4 py-3">
                        <p className="font-semibold">{formatTimeOnly(windowItem.window_start)} - {formatTimeOnly(windowItem.window_end)}</p>
                        <p className="text-xs text-zinc-500">activo {windowItem.active_minutes.toFixed(1)} min</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{windowItem.unique_people}</p>
                        <p className="text-xs text-zinc-500">{windowItem.known_people} conocidos - {windowItem.unknown_people} desconocidos</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{windowItem.motion_captures}</p>
                        <p className="text-xs text-zinc-500">{windowItem.processed_captures} con rostro procesado</p>
                        {windowItem.processed_captures === 0 ? <p className="mt-1 text-xs font-semibold text-red-700">sin imagenes de cara</p> : null}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold">{site?.name ?? "Sin sede"}</p>
                        <p className="text-xs text-zinc-500">{windowItem.camera_id || "Sin camara"}</p>
                      </td>
                      <td className="px-4 py-3">
                        {windowItem.scheduled_match_id ? (
                          <>
                            <p className="font-semibold">{windowItem.scheduled_match_label}</p>
                            <p className="text-xs text-zinc-500">Partido {windowItem.scheduled_match_id} - {windowItem.scheduled_starts_at ?? "sin hora"}</p>
                          </>
                        ) : (
                          <p className="text-sm font-semibold text-red-700">Sin partido empalmado</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${activityWindowStatusClass(windowItem.status)}`}>
                          {activityWindowStatusLabel(windowItem.status)}
                        </span>
                        <p className="mt-1 max-w-xs text-xs text-zinc-500">{windowItem.reason}</p>
                      </td>
                    </tr>
                    <tr key={`${windowItem.camera_id}-${windowItem.window_start}-evidence`} className="bg-zinc-50/70 dark:bg-zinc-900/30">
                      <td className="px-4 py-3" colSpan={6}>
                        {evidence.length ? (
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {evidence.map((item) => (
                              <article key={item.capture_id} className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
                                <EvidenceImage url={item.image_url} token={token} fit="contain" ratio="square" />
                                <div className="mt-2 flex flex-col gap-2">
                                  <div>
                                    <p className="break-words text-xs font-semibold text-zinc-950 dark:text-zinc-50">{item.subject_name || item.known_name || "Persona detectada"}</p>
                                    <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{item.captured_at ? appearanceTimeLabel(item.captured_at) : "Sin hora"}</p>
                                    <p className="mt-1 text-[11px] text-zinc-500">{qualityText(item.quality)}</p>
                                  </div>
                                  <span className={`inline-flex w-fit max-w-full items-center justify-center rounded-md border px-2 py-1 text-center text-[11px] font-semibold leading-tight ${captureStatusClass(item.status)}`}>{captureStatusLabel(item.status)}</span>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-500">
                            {windowItem.status === "preliminary"
                              ? "Ventana preliminar por movimiento: todavia no hay rostros procesados ni evidencia visual para listar personas."
                              : "No hay evidencia visual ligada a esta ventana."}
                          </p>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              {activityWindows.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-sm text-zinc-500" colSpan={6}>No hay ventanas de actividad suficientes para este dia.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {processedResults.length ? (
        <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Resultado del ultimo procesamiento</h3>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {processedResults.map((item) => (
              <article key={item.capture_id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <EvidenceImage url={item.image_url} token={token} fit="contain" ratio="square" />
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-zinc-950 dark:text-zinc-50">{item.subject_name ?? item.known_name ?? item.capture_id.slice(0, 8)}</p>
                    {item.captured_at && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Aparecio: {appearanceTimeLabel(item.captured_at)}</p>}
                    <p className="mt-1 text-xs text-zinc-500">{qualityText(item.quality)}</p>
                    {qualityRejectText(item.quality) && <p className="mt-1 text-xs font-semibold text-red-700">Rechazo: {qualityRejectText(item.quality)}</p>}
                    {(item.known_count || item.unknown_count || item.rejected_count) ? (
                      <p className="mt-1 text-xs text-zinc-500">{item.known_count ?? 0} conocidos - {item.unknown_count ?? 0} desconocidos - {item.rejected_count ?? 0} rechazados</p>
                    ) : null}
                    {item.detail && <p className="mt-1 text-xs text-red-700">{item.detail}</p>}
                  </div>
                  <span className={`inline-flex w-fit max-w-full shrink-0 items-center justify-center rounded-md border px-2 py-1 text-center text-xs font-semibold leading-tight ${captureStatusClass(item.status)}`}>{captureStatusLabel(item.status)}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Personas desconocidas consolidadas</h3>
            <p className="mt-1 text-xs text-zinc-500">Un mismo rostro se agrupa por similitud para evitar duplicados.</p>
          </div>
          <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{visibleSubjects.length}</span>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {visibleSubjects.map((subject) => {
            const site = data.sites.find((item) => item.id === subject.site_id);
            const isAccepted = Boolean(subject.metadata?.accepted_at);
            const firstAppearance = subject.day_first_seen_at ?? subject.first_seen_at;
            const lastAppearance = subject.day_last_seen_at ?? subject.last_seen_at;
            const appearanceTimes = subjectAppearanceTimes(subject);
            return (
              <article key={subject.id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <EvidenceImage url={subject.image_url} token={token} fit="contain" ratio="square" />
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-zinc-950 dark:text-zinc-50">{subject.temporary_name}</p>
                    <p className="mt-1 text-xs text-zinc-500">{site?.name ?? "Sin sede"} - {subject.appearance_count ?? subject.capture_count} capturas del dia</p>
                    <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Primera aparicion: {appearanceTimeLabel(firstAppearance)}</p>
                    <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Ultima aparicion: {appearanceTimeLabel(lastAppearance)}</p>
                    <p className="mt-1 text-xs text-zinc-500">{qualityText(subject.metadata?.quality)}</p>
                    {subject.metadata?.latest_quality && subject.metadata.latest_quality.quality_score !== subject.metadata.quality?.quality_score ? (
                      <p className="mt-1 text-xs text-zinc-500">Ultima captura: {qualityText(subject.metadata.latest_quality)}</p>
                    ) : null}
                  </div>
                  <span className={`inline-flex w-fit max-w-full shrink-0 items-center justify-center rounded-md border px-2 py-1 text-center text-xs font-semibold leading-tight ${isAccepted ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                    {isAccepted ? "Aceptado" : "Revision"}
                  </span>
                </div>
                {appearanceTimes.length ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {appearanceTimes.map((time) => (
                      <span key={`${subject.id}-${time}`} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                        {formatTimeOnly(time)}
                      </span>
                    ))}
                    {(subject.appearance_count ?? appearanceTimes.length) > appearanceTimes.length && (
                      <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                        +{(subject.appearance_count ?? appearanceTimes.length) - appearanceTimes.length}
                      </span>
                    )}
                  </div>
                ) : null}
                <button
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  disabled={isAccepted || acceptingSubjectId === subject.id}
                  onClick={() => acceptUnknownSubject(subject.id)}
                  type="button"
                >
                  <Check size={15} /> {isAccepted ? "Aceptado" : acceptingSubjectId === subject.id ? "Aceptando..." : "Aceptar consolidado"}
                </button>
              </article>
            );
          })}
          {visibleSubjects.length === 0 && <p className="text-sm text-zinc-500">Todavia no hay desconocidos con evidencia visual.</p>}
        </div>
      </section>

    </div>
  );
}

function UnknownAttendanceDetailSkeleton({ dateLabel, error, loading, onBack, onRefresh }: { dateLabel: string; error: string; loading: boolean; onBack: () => void; onRefresh: () => void }) {
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

      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="h-4 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((item) => (
            <div key={item} className="grid gap-4 px-4 py-4 md:grid-cols-6">
              <div className="h-5 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
          ))}
        </div>
      </section>

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
