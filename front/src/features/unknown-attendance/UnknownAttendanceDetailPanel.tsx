import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, RefreshCw, Search } from "lucide-react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import {
  UnknownActivityWindowsSection,
  UnknownPendingSessionSection,
  UnknownProcessedResultsSection,
  UnknownRejectedFacesDebugSection,
  UnknownSubjectsSection,
} from "./UnknownAttendanceDetailSections";
import { getUnknownJobProgress, UnknownActiveJobBanner, UnknownJobProgressCard } from "./UnknownAttendanceProgress";
import { UnknownAttendanceDetailSkeleton } from "./UnknownAttendanceSkeletons";
import {
  captureIsOnDate,
  daysAgoDateValue,
  formatTimeOnly,
  statusTone,
  type UnknownAttendanceJob,
  type UnknownAttendanceStatus,
  type UnknownDailyReport,
  type UnknownRejectedFaceDebug,
  type UnknownRejectedFacesResponse,
} from "./model";

export function UnknownAttendanceDetailPanel({ token, data, date, initialReport, onBack }: { token: string; data: AppData; date: string; initialReport?: unknown; onBack: () => void }) {
  const [status, setStatus] = useState<UnknownAttendanceStatus | null>(null);
  const [job, setJob] = useState<UnknownAttendanceJob | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [acceptingSubjectId, setAcceptingSubjectId] = useState("");
  const [rejectedDebugOpen, setRejectedDebugOpen] = useState(false);
  const [rejectedDebugLoading, setRejectedDebugLoading] = useState(false);
  const [rejectedDebugError, setRejectedDebugError] = useState("");
  const [rejectedDebugItems, setRejectedDebugItems] = useState<UnknownRejectedFaceDebug[]>([]);
  const [rejectedDebugCount, setRejectedDebugCount] = useState(0);
  const [rejectedDebugNextOffset, setRejectedDebugNextOffset] = useState<number | null>(null);
  const rejectedDebugLoadingRef = useRef(false);

  const visibleJob = job ?? status?.active_job ?? null;
  const isProcessing = visibleJob?.status === "queued" || visibleJob?.status === "processing";
  const detailDate = date || daysAgoDateValue(1);
  const activeJobDate = visibleJob?.captured_date ?? "";
  const activeJobIsCurrentDate = Boolean(activeJobDate && activeJobDate === detailDate && isProcessing);
  const activeDifferentDateJob = Boolean(activeJobDate && activeJobDate !== detailDate && isProcessing) && visibleJob ? visibleJob : null;
  const detailDateLabel = useMemo(() => new Date(`${detailDate}T00:00:00`).toLocaleDateString(), [detailDate]);
  const dailyReports = status?.daily_reports ?? [];
  const selectedReport = dailyReports.find((report) => report.date === detailDate) ?? ((initialReport && typeof initialReport === "object") ? (initialReport as UnknownDailyReport) : undefined);
  const pendingUploadCount = selectedReport?.pending_upload_count ?? 0;
  const rawWithoutEvidenceCount = Math.max(0, (selectedReport?.candidate_subjects ?? 0) - (selectedReport?.visual_subjects ?? 0));
  const pendingCaptures = useMemo(() => (status?.pending ?? []).filter((capture) => captureIsOnDate(capture, detailDate)), [detailDate, status?.pending]);
  const pendingCount = status?.pending_count ?? selectedReport?.pending_count ?? pendingCaptures.length;
  const visibleSubjects = useMemo(() => (status?.subjects ?? []).filter((subject) => Boolean(subject.image_url)), [status?.subjects]);
  const activityWindows = status?.activity_windows ?? [];
  const unknownProcessingEnabled = status?.enabled ?? true;
  const { downloadBytesLabel, progress } = getUnknownJobProgress(visibleJob, isProcessing);

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
      setJob((current) => resolveVisibleJob(nextStatus, current));
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

  useEffect(() => {
    setRejectedDebugOpen(false);
    setRejectedDebugItems([]);
    setRejectedDebugCount(0);
    setRejectedDebugNextOffset(null);
    setRejectedDebugError("");
  }, [detailDate]);

  async function processUnknown(reprocessFailed = false) {
    setMessage("");
    setError("");
    try {
      const nextJob = await apiRequest<UnknownAttendanceJob>("/unknown-attendance/process-pending/", token, {
        method: "POST",
        body: JSON.stringify({ captured_date: detailDate, reprocess_failed: reprocessFailed }),
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

  async function loadRejectedDebug(offset = 0) {
    if (rejectedDebugLoadingRef.current) return;
    rejectedDebugLoadingRef.current = true;
    setRejectedDebugLoading(true);
    setRejectedDebugError("");
    try {
      const response = await apiRequest<UnknownRejectedFacesResponse>(
        `/unknown-attendance/rejected-faces/?captured_date=${encodeURIComponent(detailDate)}&limit=32&offset=${offset}`,
        token,
      );
      setRejectedDebugItems((current) => (offset ? [...current, ...response.results] : response.results));
      setRejectedDebugCount(response.count);
      setRejectedDebugNextOffset(response.next_offset ?? null);
    } catch (err) {
      setRejectedDebugError(err instanceof Error ? err.message : "No se pudieron cargar las caras rechazadas.");
    } finally {
      rejectedDebugLoadingRef.current = false;
      setRejectedDebugLoading(false);
    }
  }

  function toggleRejectedDebug() {
    if (rejectedDebugOpen) {
      setRejectedDebugOpen(false);
      return;
    }
    setRejectedDebugOpen(true);
    if (!rejectedDebugItems.length) void loadRejectedDebug(0);
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
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">Revisa las capturas pendientes y las personas desconocidas consolidadas de este dia.</p>
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
          <MetricCard label="Pendientes" value={pendingCount} />
          <MetricCard label="Con evidencia visual" value={visibleSubjects.length} />
          <MetricCard label="Candidatos crudos" value={selectedReport?.candidate_subjects ?? 0} detail={rawWithoutEvidenceCount > 0 ? `${rawWithoutEvidenceCount} sin evidencia` : undefined} />
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
        <UnknownJobProgressCard isProcessing={isProcessing} visibleJob={visibleJob} />
        {message && <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loadingStatus && <p className="mt-3 text-sm text-zinc-500">Cargando detalle de desconocidos...</p>}
      </section>

      {activeDifferentDateJob ? (
        <UnknownActiveJobBanner
          dateLabel={`Trabajo ${activeDifferentDateJob.id.slice(0, 8)} - ${new Date(`${activeJobDate}T00:00:00`).toLocaleDateString()}`}
          description={`El detalle actual es ${detailDateLabel}; por eso el bloque pendiente de este dia puede no moverse hasta que termine el trabajo activo.`}
          downloadBytesLabel={downloadBytesLabel}
          progress={progress}
          title="Hay una descarga/proceso activo en otro dia"
          visibleJob={activeDifferentDateJob}
        />
      ) : null}

      <UnknownPendingSessionSection
        activeJobIsCurrentDate={activeJobIsCurrentDate}
        detailDateLabel={detailDateLabel}
        isProcessing={isProcessing}
        onProcess={() => void processUnknown()}
        onReprocessFailed={() => void processUnknown(true)}
        pendingCount={pendingCount}
        pendingSession={pendingSession}
        pendingUploadCount={pendingUploadCount}
        progress={progress}
        selectedReport={selectedReport}
        unknownProcessingEnabled={unknownProcessingEnabled}
      />
      <UnknownActivityWindowsSection activityWindows={activityWindows} data={data} token={token} />
      <UnknownRejectedFacesDebugSection
        count={rejectedDebugCount}
        error={rejectedDebugError}
        items={rejectedDebugItems}
        loading={rejectedDebugLoading}
        nextOffset={rejectedDebugNextOffset}
        onLoad={toggleRejectedDebug}
        onScroll={(event) => {
          if (rejectedDebugLoading || rejectedDebugNextOffset == null) return;
          const target = event.currentTarget;
          const distanceToBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
          if (distanceToBottom < 300) void loadRejectedDebug(rejectedDebugNextOffset);
        }}
        open={rejectedDebugOpen}
        token={token}
      />
      <UnknownProcessedResultsSection processedResults={processedResults} token={token} />
      <UnknownSubjectsSection acceptingSubjectId={acceptingSubjectId} data={data} onAccept={(subjectId) => void acceptUnknownSubject(subjectId)} token={token} visibleSubjects={visibleSubjects} />
    </div>
  );
}

function resolveVisibleJob(nextStatus: UnknownAttendanceStatus, current: UnknownAttendanceJob | null) {
  if (nextStatus.active_job) return nextStatus.active_job;
  if (!current) return null;
  const hydratedJob = nextStatus.jobs?.find((candidate) => candidate.id === current.id);
  if (hydratedJob) return hydratedJob;
  return current.status === "queued" || current.status === "processing" ? null : current;
}

function MetricCard({ detail, label, value }: { detail?: string; label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      {detail ? <p className="mt-1 text-xs font-semibold text-red-700">{detail}</p> : null}
    </div>
  );
}
