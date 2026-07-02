import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Play, RefreshCw, Search } from "lucide-react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import { EvidenceImage } from "../automatic-attendance";
import { formatBytes } from "../automatic-attendance/format";
import {
  activityWindowStatusClass,
  activityWindowStatusLabel,
  captureIsOnDate,
  captureStatusClass,
  captureStatusLabel,
  daysAgoDateValue,
  formatTimeOnly,
  qualityText,
  statusTone,
  unknownCaptureSummary,
  type UnknownAttendanceJob,
  type UnknownAttendanceStatus,
  type UnknownDailyReport,
} from "./model";
export function UnknownAttendancePanel({ token, data, onOpenDetail }: { token: string; data: AppData; onOpenDetail: (date: string, report: UnknownDailyReport) => void }) {
  const [status, setStatus] = useState<UnknownAttendanceStatus | null>(null);
  const [job, setJob] = useState<UnknownAttendanceJob | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [acceptingSubjectId, setAcceptingSubjectId] = useState("");
  const selectedUnknownDate = "";

  const visibleJob = job ?? status?.active_job ?? null;
  const isProcessing = visibleJob?.status === "queued" || visibleJob?.status === "processing";
  const yesterdayDate = useMemo(() => daysAgoDateValue(1), []);
  const detailDate = selectedUnknownDate || yesterdayDate;
  const activeJobDate = visibleJob?.captured_date ?? "";
  const activePanelJob = isProcessing && activeJobDate && visibleJob ? visibleJob : null;
  const detailDateLabel = useMemo(() => new Date(`${detailDate}T00:00:00`).toLocaleDateString(), [detailDate]);
  const dailyReports = status?.daily_reports ?? [];
  const selectedReport = dailyReports.find((report) => report.date === selectedUnknownDate);
  const pendingCaptures = useMemo(() => (status?.pending ?? []).filter((capture) => captureIsOnDate(capture, detailDate)), [detailDate, status?.pending]);
  const pendingCount = status?.pending_count ?? pendingCaptures.length;
  const visibleSubjects = useMemo(() => (status?.subjects ?? []).filter((subject) => Boolean(subject.image_url)), [status?.subjects]);
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
    if (!pendingCaptures.length) return null;
    const sorted = pendingCaptures.slice().sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
    const siteNames = Array.from(
      new Set(
        sorted.map((capture) => data.sites.find((site) => site.id === capture.site_id)?.name ?? "Sin sede"),
      ),
    );
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
  }, [data.sites, pendingCaptures, status?.pending_summary]);
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
        `/unknown-attendance/status/?captured_date=${encodeURIComponent(detailDate)}&pending_limit=0&recent_limit=24&subject_limit=24&report_limit=0&activity_window_limit=8`,
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
      // Keep the fast summary visible; manual refresh can retry detail lists.
    }
  }

  async function loadStatus(silent = false) {
    if (silent && typeof document !== "undefined" && document.hidden) return;
    if (!silent) setLoadingStatus(true);
    try {
      const nextStatus = await apiRequest<UnknownAttendanceStatus>(
        `/unknown-attendance/status/?captured_date=${encodeURIComponent(detailDate)}&pending_limit=0&recent_limit=0&subject_limit=12&report_limit=45&activity_window_limit=8`,
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
      setError(err instanceof Error ? err.message : "No se pudo leer la seccion de desconocidos.");
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    loadStatus(false);
    const interval = window.setInterval(() => loadStatus(true), isProcessing ? 3000 : 30000);
    return () => window.clearInterval(interval);
  }, [detailDate, isProcessing, token]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (!document.hidden) void loadStatus(true);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [token]);

  async function processUnknown(dateValue = detailDate) {
    setMessage("");
    setError("");
    try {
      const nextJob = await apiRequest<UnknownAttendanceJob>("/unknown-attendance/process-pending/", token, {
        method: "POST",
        body: JSON.stringify({ captured_date: dateValue }),
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
  const activityWindows = status?.activity_windows ?? [];
  const visibleActivityWindows = activityWindows.filter((item) => ["unscheduled_candidate", "preliminary", "scheduled_overlap"].includes(item.status));
  const activityAlertReports = dailyReports.filter(
    (report) =>
      (report.unscheduled_activity_count ?? 0) > 0 ||
      (report.preliminary_activity_count ?? 0) > 0 ||
      (report.scheduled_activity_count ?? 0) > 0,
  );
  const ruleWindowMinutes = status?.thresholds.activity_window_minutes ?? 60;
  const ruleMinPeople = status?.thresholds.unscheduled_min_people ?? 6;

  if (!status) {
    return <UnknownAttendanceSkeleton error={error} loading={loadingStatus} onRefresh={() => loadStatus()} />;
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Rostros desconocidos</p>
            <h2 className="mt-1 flex items-center gap-2 text-lg font-semibold text-zinc-950 dark:text-zinc-50">
              <Search size={18} /> Detectar personas fuera de la base
            </h2>
            <p className="mt-2 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
              Procesa las fotos pendientes por bloque, descarta caras de baja calidad, cruza contra alumnos y adultos, y agrupa a los desconocidos sin duplicarlos.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => loadStatus()} type="button">
              <RefreshCw size={15} /> Actualizar
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500">Pendientes</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{pendingCount}</p>
          </div>
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500">Con evidencia visual</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{visibleSubjects.length}</p>
          </div>
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500">Calidad minima</p>
            <p className="mt-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              det {status?.thresholds.min_det_score ?? 0.8} - {status?.thresholds.min_face_size ?? 120}px - blur {status?.thresholds.min_blur ?? 80}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              ojos {status?.thresholds.min_eye_open_ratio ?? 0.45} - pose {status?.thresholds.max_pose_abs_degrees ?? 24} deg
            </p>
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
        {loadingStatus && <p className="mt-3 text-sm text-zinc-500">Cargando capturas desconocidas...</p>}
      </section>

      {activePanelJob ? (
        <section className="rounded-md border border-blue-200 bg-blue-50 p-4 text-blue-900 shadow-sm dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-100">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold">Trabajo activo de desconocidos</p>
              <p className="mt-1 text-sm">
                {new Date(`${activeJobDate}T00:00:00`).toLocaleDateString()} - {activePanelJob.phase_label ?? activePanelJob.status}
              </p>
              {downloadBytesLabel ? <p className="mt-1 text-xs font-semibold">{downloadBytesLabel}</p> : null}
              <p className="mt-1 text-xs">{activePanelJob.current_capture ?? `Trabajo ${activePanelJob.id.slice(0, 8)}`}</p>
            </div>
            <div className="min-w-[220px]">
              <div className="flex items-center justify-between text-xs">
                <span>{activePanelJob.processed ?? 0}/{activePanelJob.total ?? 0}</span>
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
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Posibles partidos fuera de agenda</h3>
            <p className="mt-1 text-xs text-zinc-500">
              Regla: ventana de {ruleWindowMinutes} min con {ruleMinPeople}+ personas unicas procesadas y sin partido agendado empalmado.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
              <p className="text-lg font-semibold">{activityAlertReports.reduce((sum, report) => sum + (report.unscheduled_activity_count ?? 0), 0)}</p>
              <p>No ag.</p>
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">
              <p className="text-lg font-semibold">{activityAlertReports.reduce((sum, report) => sum + (report.preliminary_activity_count ?? 0), 0)}</p>
              <p>Prelim.</p>
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">
              <p className="text-lg font-semibold">{activityAlertReports.reduce((sum, report) => sum + (report.scheduled_activity_count ?? 0), 0)}</p>
              <p>Agenda</p>
            </div>
          </div>
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-2 xl:grid-cols-3">
          {visibleActivityWindows.slice(0, 6).map((windowItem) => {
            const site = data.sites.find((item) => item.id === windowItem.site_id);
            const report = dailyReports.find((item) => item.date === windowItem.date);
            return (
              <article key={`${windowItem.camera_id}-${windowItem.window_start}`} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                      {new Date(`${windowItem.date}T00:00:00`).toLocaleDateString()} · {formatTimeOnly(windowItem.window_start)} - {formatTimeOnly(windowItem.window_end)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-500">{site?.name ?? "Sin sede"} · {windowItem.camera_id || "Sin camara"}</p>
                  </div>
                  <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${activityWindowStatusClass(windowItem.status)}`}>
                    {activityWindowStatusLabel(windowItem.status)}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">
                    <p className="font-semibold text-zinc-950 dark:text-zinc-50">{windowItem.unique_people}</p>
                    <p className="text-zinc-500">personas</p>
                  </div>
                  <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">
                    <p className="font-semibold text-zinc-950 dark:text-zinc-50">{windowItem.motion_captures}</p>
                    <p className="text-zinc-500">capturas</p>
                  </div>
                  <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">
                    <p className="font-semibold text-zinc-950 dark:text-zinc-50">{windowItem.active_minutes.toFixed(0)} min</p>
                    <p className="text-zinc-500">activo</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-zinc-500">{windowItem.reason}</p>
                <button
                  className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  onClick={() => onOpenDetail(windowItem.date, report ?? ({ date: windowItem.date } as UnknownDailyReport))}
                  type="button"
                >
                  Ver detalle y evidencia
                </button>
              </article>
            );
          })}
          {visibleActivityWindows.length === 0 && activityAlertReports.slice(0, 6).map((report) => {
            const unscheduledCount = report.unscheduled_activity_count ?? 0;
            const preliminaryCount = report.preliminary_activity_count ?? 0;
            const scheduledCount = report.scheduled_activity_count ?? 0;
            const activityStatus = unscheduledCount ? "unscheduled_candidate" : preliminaryCount ? "preliminary" : "scheduled_overlap";
            return (
              <article key={report.date} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{new Date(`${report.date}T00:00:00`).toLocaleDateString()}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {report.first_captured_at && report.last_captured_at ? `${formatTimeOnly(report.first_captured_at)} - ${formatTimeOnly(report.last_captured_at)}` : "Sin horario"}
                    </p>
                  </div>
                  <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${activityWindowStatusClass(activityStatus)}`}>
                    {activityWindowStatusLabel(activityStatus)}
                  </span>
                </div>
                <p className="mt-3 text-xs text-zinc-500">
                  {unscheduledCount} posible no agendado · {preliminaryCount} preliminar · {scheduledCount} con agenda.
                </p>
                <button
                  className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  onClick={() => onOpenDetail(report.date, report)}
                  type="button"
                >
                  Ver detalle y evidencia
                </button>
              </article>
            );
          })}
          {visibleActivityWindows.length === 0 && activityAlertReports.length === 0 && (
            <p className="text-sm text-zinc-500">No hay ventanas que cumplan la regla de posible partido fuera de agenda.</p>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Reporte diario de desconocidos</h3>
            <p className="mt-1 text-xs text-zinc-500">Una sesion por dia; abre el detalle para revisar capturas y consolidados.</p>
          </div>
        </div>
        <div className="max-h-[520px] overflow-auto">
          <table className="min-w-full border-collapse text-left text-sm text-zinc-900 dark:text-zinc-100">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Dia</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Horario</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Capturas</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Pendientes</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Conocidos</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Con evidencia</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Candidatos</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Actividad</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Accion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {dailyReports.map((report) => {
                const selected = selectedUnknownDate === report.date;
                const isActiveReport = isProcessing && activeJobDate === report.date;
                const unscheduledCount = report.unscheduled_activity_count ?? 0;
                const preliminaryCount = report.preliminary_activity_count ?? 0;
                const scheduledCount = report.scheduled_activity_count ?? 0;
                const activityStatus = unscheduledCount ? "unscheduled_candidate" : preliminaryCount ? "preliminary" : scheduledCount ? "scheduled_overlap" : "low_signal";
                return (
                  <tr key={report.date} className={isActiveReport ? "bg-blue-50/80 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/20 dark:ring-blue-900/60" : selected ? "bg-amber-50/70 dark:bg-amber-950/20" : "bg-white dark:bg-zinc-950"}>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{new Date(`${report.date}T00:00:00`).toLocaleDateString()}</p>
                        {isActiveReport ? (
                          <span className="rounded-md border border-blue-200 bg-blue-100 px-2 py-1 text-[11px] font-semibold text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-100">
                            Procesando
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-zinc-500">{formatBytes(report.total_bytes)}</p>
                      {isActiveReport ? <p className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-200">{visibleJob?.phase_label ?? "Trabajo activo"}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-300">
                      {report.first_captured_at && report.last_captured_at ? `${formatTimeOnly(report.first_captured_at)} - ${formatTimeOnly(report.last_captured_at)}` : "Sin horario"}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{report.total_captures}</p>
                      <p className="text-xs text-zinc-500">{report.processed_count} procesadas</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${report.pending_count ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{report.pending_count}</span>
                      {(report.pending_upload_count ?? 0) > 0 ? (
                        <p className="mt-1 text-xs font-semibold text-red-700">{report.pending_upload_count} sin subir</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{report.matched_known_count}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{report.visual_subjects}</p>
                      <p className="text-xs text-zinc-500">{report.accepted_subjects} aceptados</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{report.candidate_subjects}</p>
                      <p className="text-xs text-zinc-500">{report.failed_count} rechazadas</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${activityWindowStatusClass(activityStatus)}`}>
                        {activityWindowStatusLabel(activityStatus)}
                      </span>
                      <p className="mt-1 text-xs text-zinc-500">
                        {unscheduledCount} no ag. - {preliminaryCount} prelim. - {scheduledCount} agenda
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${
                            isActiveReport
                              ? "bg-blue-700 text-white dark:bg-blue-500 dark:text-blue-950"
                              : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                          }`}
                          disabled={!status?.enabled || report.pending_count === 0 || isProcessing}
                          onClick={() => processUnknown(report.date)}
                          type="button"
                        >
                          <Play size={13} /> {isActiveReport ? `${progress.toFixed(1)}%` : "Procesar"}
                        </button>
                        <button
                          className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                          onClick={() => onOpenDetail(report.date, report)}
                          type="button"
                        >
                          Ver detalles
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {dailyReports.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-sm text-zinc-500" colSpan={9}>Todavia no hay dias con capturas de desconocidos.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}

function UnknownAttendanceSkeleton({ error, loading, onRefresh }: { error: string; loading: boolean; onRefresh: () => void }) {
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
            <p className="mt-2 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
              Preparando resumen, ventanas de actividad y evidencia visual.
            </p>
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

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="h-4 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mt-2 h-3 w-96 max-w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
        </div>
        <div className="grid gap-3 p-4 lg:grid-cols-3">
          {rows.slice(0, 3).map((item) => (
            <div key={item} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mt-3 grid grid-cols-3 gap-2">
                <div className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                <div className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
                <div className="h-12 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="h-4 w-56 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.map((item) => (
            <div key={item} className="grid grid-cols-5 gap-4 px-4 py-3">
              <div className="h-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
              <div className="h-4 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
