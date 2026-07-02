import { useEffect, useMemo, useState } from "react";
import { Clock3, Play, RefreshCw, Search } from "lucide-react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import { UnknownAttendanceActivityOverview } from "./UnknownAttendanceActivityOverview";
import { UnknownAttendanceDailyReportsTable } from "./UnknownAttendanceDailyReportsTable";
import { getUnknownJobProgress, UnknownActiveJobBanner, UnknownJobProgressCard } from "./UnknownAttendanceProgress";
import { UnknownAttendanceSkeleton } from "./UnknownAttendanceSkeletons";
import {
  captureIsOnDate,
  daysAgoDateValue,
  statusTone,
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
  const selectedUnknownDate = "";

  const visibleJob = job ?? status?.active_job ?? null;
  const isProcessing = visibleJob?.status === "queued" || visibleJob?.status === "processing";
  const yesterdayDate = useMemo(() => daysAgoDateValue(1), []);
  const detailDate = selectedUnknownDate || yesterdayDate;
  const activeJobDate = visibleJob?.captured_date ?? "";
  const activePanelJob = isProcessing && activeJobDate && visibleJob ? visibleJob : null;
  const dailyReports = status?.daily_reports ?? [];
  const pendingCaptures = useMemo(() => (status?.pending ?? []).filter((capture) => captureIsOnDate(capture, detailDate)), [detailDate, status?.pending]);
  const pendingCount = status?.pending_count ?? pendingCaptures.length;
  const allPendingCount = dailyReports.reduce((sum, report) => sum + (report.pending_count ?? 0), 0) || pendingCount;
  const visibleSubjects = useMemo(() => (status?.subjects ?? []).filter((subject) => Boolean(subject.image_url)), [status?.subjects]);
  const { downloadBytesLabel, progress } = getUnknownJobProgress(visibleJob, isProcessing);

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
      setJob((current) => resolveVisibleJob(nextStatus, current));
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

  async function processUnknown(dateValue?: string | null) {
    setMessage("");
    setError("");
    try {
      const nextJob = await apiRequest<UnknownAttendanceJob>("/unknown-attendance/process-pending/", token, {
        method: "POST",
        body: dateValue ? JSON.stringify({ captured_date: dateValue }) : undefined,
      });
      setJob(nextJob);
      setMessage("Procesamiento de desconocidos iniciado.");
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar el procesamiento de desconocidos.");
    }
  }

  if (!status) {
    return <UnknownAttendanceSkeleton error={error} loading={loadingStatus} onRefresh={() => loadStatus()} />;
  }

  const activityWindows = status.activity_windows ?? [];
  const visibleActivityWindows = activityWindows.filter((item) => ["unscheduled_candidate", "preliminary", "scheduled_overlap"].includes(item.status));
  const activityAlertReports = dailyReports.filter(
    (report) =>
      (report.unscheduled_activity_count ?? 0) > 0 ||
      (report.preliminary_activity_count ?? 0) > 0 ||
      (report.scheduled_activity_count ?? 0) > 0,
  );

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
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600"
              disabled={!status.enabled || allPendingCount === 0 || isProcessing}
              onClick={() => void processUnknown(null)}
              type="button"
            >
              <Play size={15} /> Procesar todos los pendientes
            </button>
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => loadStatus()} type="button">
              <RefreshCw size={15} /> Actualizar
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <MetricCard label="Pendientes" value={pendingCount} />
          <MetricCard label="Con evidencia visual" value={visibleSubjects.length} />
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500">Calidad minima</p>
            <p className="mt-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              det {status.thresholds.min_det_score ?? 0.8} - {status.thresholds.min_face_size ?? 120}px - blur {status.thresholds.min_blur ?? 80}
            </p>
            <p className="mt-1 text-xs text-zinc-500">ojos {status.thresholds.min_eye_open_ratio ?? 0.45} - pose {status.thresholds.max_pose_abs_degrees ?? 24} deg</p>
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
        {loadingStatus && <p className="mt-3 text-sm text-zinc-500">Cargando capturas desconocidas...</p>}
      </section>

      {activePanelJob ? (
        <UnknownActiveJobBanner
          dateLabel={new Date(`${activeJobDate}T00:00:00`).toLocaleDateString()}
          downloadBytesLabel={downloadBytesLabel}
          progress={progress}
          title="Trabajo activo de desconocidos"
          visibleJob={activePanelJob}
        />
      ) : null}

      <UnknownAttendanceActivityOverview
        activityAlertReports={activityAlertReports}
        dailyReports={dailyReports}
        data={data}
        onOpenDetail={onOpenDetail}
        ruleMinPeople={status.thresholds.unscheduled_min_people ?? 6}
        ruleWindowMinutes={status.thresholds.activity_window_minutes ?? 60}
        visibleActivityWindows={visibleActivityWindows}
      />

      <UnknownAttendanceDailyReportsTable
        activeJobDate={activeJobDate}
        dailyReports={dailyReports}
        isProcessing={isProcessing}
        onOpenDetail={onOpenDetail}
        onProcess={(date) => void processUnknown(date)}
        progress={progress}
        selectedUnknownDate={selectedUnknownDate}
        statusEnabled={status.enabled}
        visibleJob={visibleJob}
      />
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

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
    </div>
  );
}
