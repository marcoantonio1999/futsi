import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, Play, RefreshCw, Search } from "lucide-react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import { EvidenceImage } from "./automaticAttendanceEvidence";
import { formatBytes } from "./automaticAttendanceFormat";
import {
  appearanceTimeLabel,
  captureIsOnDate,
  captureStatusClass,
  captureStatusLabel,
  daysAgoDateValue,
  formatTimeOnly,
  qualityText,
  statusTone,
  subjectAppearanceTimes,
  type UnknownAttendanceJob,
  type UnknownAttendanceStatus,
  type UnknownDailyReport,
} from "./unknownAttendanceModel";
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
  const detailDateLabel = useMemo(() => new Date(`${detailDate}T00:00:00`).toLocaleDateString(), [detailDate]);
  const dailyReports = status?.daily_reports ?? [];
  const selectedReport = dailyReports.find((report) => report.date === detailDate) ?? ((initialReport && typeof initialReport === "object") ? (initialReport as UnknownDailyReport) : undefined);
  const pendingCaptures = useMemo(() => (status?.pending ?? []).filter((capture) => captureIsOnDate(capture, detailDate)), [detailDate, status?.pending]);
  const pendingCount = status?.pending_count ?? selectedReport?.pending_count ?? pendingCaptures.length;
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
  const downloadProgress = visibleJob ? Math.max(0, Math.min(100, progress >= 35 || ["references", "captures", "done"].includes(unknownPhase) ? 100 : (progress / 35) * 100)) : 0;
  const processingProgress = visibleJob ? Math.max(0, Math.min(100, progress >= 100 || unknownPhase === "done" ? 100 : progress <= 35 ? 0 : ((progress - 35) / 65) * 100)) : 0;
  const downloadStatusLabel = unknownPhase === "download" ? "Descargando desde Drive" : downloadProgress >= 100 ? "Descarga completa" : "Esperando descarga";
  const processingStatusLabel = unknownPhase === "references" ? "Preparando referencias" : unknownPhase === "captures" ? "Procesando desde disco local" : processingProgress >= 100 ? "Proceso completo" : "Esperando proceso";
  const jobCountLabel = unknownPhase === "download" ? `${visibleJob?.processed ?? 0}/${visibleJob?.total ?? 0} descargas` : `${visibleJob?.processed ?? 0}/${visibleJob?.total ?? 0} capturas`;

  async function loadDetailLists() {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const detailStatus = await apiRequest<UnknownAttendanceStatus>(
        `/unknown-attendance/status/?captured_date=${encodeURIComponent(detailDate)}&pending_limit=0&recent_limit=24&subject_limit=24&report_limit=0`,
        token,
      );
      setStatus((current) => ({
        ...(current ?? detailStatus),
        daily_reports: detailStatus.daily_reports ?? current?.daily_reports ?? [],
        recent: detailStatus.recent,
        subjects: detailStatus.subjects,
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
        `/unknown-attendance/status/?captured_date=${encodeURIComponent(detailDate)}&pending_limit=0&recent_limit=0&subject_limit=24&report_limit=0`,
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
    loadStatus(true);
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
            <p className="text-xs font-medium uppercase text-zinc-500">Candidatos crudos</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{selectedReport?.candidate_subjects ?? 0}</p>
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
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
                  disabled={!unknownProcessingEnabled || pendingCount === 0 || isProcessing}
                  onClick={() => processUnknown()}
                  type="button"
                >
                  <Play size={15} /> Procesar toda la sesion
                </button>
              </div>
            </div>
          ) : (
            <p className="py-6 text-sm text-zinc-500">{selectedReport?.pending_count ? "No se pudo cargar el bloque pendiente de este dia." : "No hay capturas pendientes para procesar en este dia."}</p>
          )}
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
                <EvidenceImage url={item.image_url} token={token} />
                <div className="mt-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{item.subject_name ?? item.known_name ?? item.capture_id.slice(0, 8)}</p>
                    {item.captured_at && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Aparecio: {appearanceTimeLabel(item.captured_at)}</p>}
                    <p className="mt-1 text-xs text-zinc-500">{qualityText(item.quality)}</p>
                    {(item.known_count || item.unknown_count || item.rejected_count) ? (
                      <p className="mt-1 text-xs text-zinc-500">{item.known_count ?? 0} conocidos - {item.unknown_count ?? 0} desconocidos - {item.rejected_count ?? 0} rechazados</p>
                    ) : null}
                    {item.detail && <p className="mt-1 text-xs text-red-700">{item.detail}</p>}
                  </div>
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${captureStatusClass(item.status)}`}>{captureStatusLabel(item.status)}</span>
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
                <EvidenceImage url={subject.image_url} token={token} />
                <div className="mt-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{subject.temporary_name}</p>
                    <p className="mt-1 text-xs text-zinc-500">{site?.name ?? "Sin sede"} - {subject.appearance_count ?? subject.capture_count} capturas del dia</p>
                    <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Primera aparicion: {appearanceTimeLabel(firstAppearance)}</p>
                    <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Ultima aparicion: {appearanceTimeLabel(lastAppearance)}</p>
                    <p className="mt-1 text-xs text-zinc-500">{qualityText(subject.metadata?.quality)}</p>
                  </div>
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${isAccepted ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
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

