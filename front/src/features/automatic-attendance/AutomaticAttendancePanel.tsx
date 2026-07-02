import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import { AutomaticJobResultsModal } from "./jobs/AutomaticAttendanceJobResultsModal";
import { AutomaticAttendanceLoadingSkeleton } from "./loading/AutomaticAttendanceLoading";
import { AutomaticAttendanceQueues } from "./queues/AutomaticAttendanceQueues";
import { AutomaticAttendanceReportPanel } from "./report/AutomaticAttendanceReport";
import { AutomaticAttendanceStatusSection } from "./status/AutomaticAttendanceStatusSection";
import { elapsedSecondsSince } from "./format";
import { isLiveVideoClip, type AutomaticAttendanceJob, type AutomaticAttendanceStatus, type PendingVideo } from "./model";
import { buildAutomaticResultsBySession } from "./resultMerge";

export function AutomaticAttendancePanel({
  token,
  data,
  onRefreshData,
  mode = "process",
}: {
  token: string;
  data: AppData;
  onRefreshData: () => Promise<void> | void;
  mode?: "process" | "report";
}) {
  const [status, setStatus] = useState<AutomaticAttendanceStatus | null>(null);
  const [job, setJob] = useState<AutomaticAttendanceJob | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [resultsModalOpen, setResultsModalOpen] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());

  const jobIsActive = (candidate?: AutomaticAttendanceJob | null) => candidate?.status === "queued" || candidate?.status === "processing";
  const activeJob = jobIsActive(job) ? job : jobIsActive(status?.active_job) ? status?.active_job ?? null : null;
  const visibleJob = resultsModalOpen ? job ?? activeJob ?? status?.jobs?.[0] ?? null : activeJob;
  const recentJobs = useMemo(() => {
    const seen = new Set<string>();
    return [job, status?.active_job, ...(status?.jobs ?? [])].filter(Boolean).filter((candidate) => {
      const current = candidate as AutomaticAttendanceJob;
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      return true;
    }) as AutomaticAttendanceJob[];
  }, [job, status?.active_job, status?.jobs]);
  const isProcessing = Boolean(activeJob);
  const videoClips = status?.video_clips ?? [];
  const hasLiveVideoClips = videoClips.some(isLiveVideoClip);
  const automaticResultsBySession = useMemo(() => buildAutomaticResultsBySession(recentJobs, mode), [mode, recentJobs]);

  async function loadStatus(silent = false) {
    if (!silent) setLoadingStatus(true);
    try {
      const statusPath = mode === "report" ? "/automatic-attendance/status/?mode=report" : "/automatic-attendance/status/";
      const nextStatus = await apiRequest<AutomaticAttendanceStatus>(statusPath, token);
      setStatus(nextStatus);
      if (nextStatus.active_job) {
        setJob(nextStatus.active_job);
      } else {
        setJob((current) => {
          if (!current) return null;
          if (!resultsModalOpen && !jobIsActive(current)) return null;
          return nextStatus.jobs.some((candidate) => candidate.id === current.id) ? current : null;
        });
      }
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el estado local.");
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    loadStatus(false);
  }, [mode, token]);

  useEffect(() => {
    const interval = window.setInterval(() => loadStatus(true), hasLiveVideoClips ? 5000 : 15000);
    return () => window.clearInterval(interval);
  }, [hasLiveVideoClips, mode, token]);

  useEffect(() => {
    if (!visibleJob?.id || !isProcessing) return;
    const interval = window.setInterval(async () => {
      try {
        const nextJob = await apiRequest<AutomaticAttendanceJob>(`/automatic-attendance/jobs/${visibleJob.id}/`, token);
        setJob(nextJob);
        if (nextJob.status === "done") {
          await onRefreshData();
          await loadStatus(true);
        }
      } catch (err) {
        const nextMessage = err instanceof Error ? err.message : "No se pudo leer el progreso.";
        if (nextMessage.toLowerCase().includes("no existe") || nextMessage.includes("404")) {
          setJob(null);
          setResultsModalOpen(false);
          await loadStatus(true);
          return;
        }
        setError(nextMessage);
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [isProcessing, onRefreshData, token, visibleJob?.id]);

  useEffect(() => {
    if (!visibleJob && resultsModalOpen) setResultsModalOpen(false);
  }, [resultsModalOpen, visibleJob]);

  async function processPending(path?: string) {
    setMessage("");
    setError("");
    try {
      const nextJob = await apiRequest<AutomaticAttendanceJob>("/automatic-attendance/process-pending/", token, {
        method: "POST",
        body: path ? JSON.stringify({ path }) : undefined,
      });
      setJob(nextJob);
      setResultsModalOpen(true);
      setMessage(path ? "Procesamiento del video seleccionado iniciado." : "Procesamiento local iniciado.");
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar el procesamiento.");
    }
  }

  async function downloadPendingToLocal() {
    setMessage("");
    setError("");
    try {
      const nextJob = await apiRequest<AutomaticAttendanceJob>("/automatic-attendance/download-pending-local/", token, {
        method: "POST",
      });
      setJob(nextJob);
      setResultsModalOpen(true);
      setMessage("Descarga a cache local iniciada.");
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la descarga local.");
    }
  }

  async function reprocessVideoClip(video: PendingVideo) {
    const clipId = video.metadata.video_clip_id;
    if (!clipId) {
      setError("Este video no tiene video_clip_id para reprocesar.");
      return;
    }
    setMessage("");
    setError("");
    try {
      const nextJob = await apiRequest<AutomaticAttendanceJob>("/automatic-attendance/reprocess-video-clip/", token, {
        method: "POST",
        body: JSON.stringify({ video_clip_id: clipId }),
      });
      setJob(nextJob);
      setResultsModalOpen(true);
      setMessage(`Reprocesamiento iniciado para ${video.filename}.`);
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar el reprocesamiento.");
    }
  }

  const pendingCount = status?.pending.length ?? 0;
  const reprocessableVideos = status?.reprocessable ?? [];
  const progress = Math.max(0, Math.min(100, activeJob?.percent ?? 0));
  const canProcessPending = Boolean(status?.enabled && pendingCount > 0 && !isProcessing);
  const canDownloadPending = Boolean(status?.enabled && pendingCount > 0 && !isProcessing);
  const currentJobLabel = activeJob?.current_video ?? (activeJob ? `Trabajo ${activeJob.id.slice(0, 8)}` : "Sin trabajo activo");
  const elapsedSeconds = visibleJob
    ? elapsedSecondsSince(
        visibleJob.current_video_started_at ?? visibleJob.created_at ?? visibleJob.updated_at,
        visibleJob.status === "done" || visibleJob.status === "error" ? visibleJob.completed_at : null,
        clockTick,
      )
    : null;

  useEffect(() => {
    if (!visibleJob || (visibleJob.status !== "queued" && visibleJob.status !== "processing")) return;
    const interval = window.setInterval(() => setClockTick(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [visibleJob?.id, visibleJob?.status]);

  function openProcessedDetails(video: PendingVideo) {
    const matchingJob = recentJobs.find((candidate) =>
      candidate.results?.some((result) => result.video === video.filename || result.video.endsWith(video.filename) || video.filename.endsWith(result.video)),
    );
    if (!matchingJob) {
      setMessage("");
      setError(`No encontre detalles locales para ${video.filename}. Reprocesalo para generar resultados en esta PC.`);
      return;
    }
    setMessage("");
    setError("");
    setJob(matchingJob);
    setResultsModalOpen(true);
  }

  if (mode === "report") {
    return (
      <div className="grid gap-5">
        <AutomaticAttendanceReportPanel token={token} data={data} resultsBySession={automaticResultsBySession} onRefresh={() => loadStatus()} />
      </div>
    );
  }
  if (!status && loadingStatus) return <AutomaticAttendanceLoadingSkeleton />;

  return (
    <div className="grid gap-5">
      {resultsModalOpen && visibleJob ? <AutomaticJobResultsModal job={visibleJob} token={token} elapsedSeconds={elapsedSeconds} onClose={() => setResultsModalOpen(false)} /> : null}
      <AutomaticAttendanceStatusSection
        status={status}
        visibleJob={activeJob}
        currentJobLabel={currentJobLabel}
        pendingCount={pendingCount}
        progress={progress}
        elapsedSeconds={elapsedSeconds}
        isProcessing={isProcessing}
        canProcessPending={canProcessPending}
        canDownloadPending={canDownloadPending}
        message={message}
        error={error}
        loadingStatus={loadingStatus}
        onRefresh={() => loadStatus()}
        onDownloadPending={downloadPendingToLocal}
        onProcessAll={() => processPending()}
        onOpenResults={() => setResultsModalOpen(true)}
      />
      <AutomaticAttendanceQueues
        data={data}
        pendingVideos={status?.pending ?? []}
        videoClips={videoClips}
        reprocessableVideos={reprocessableVideos}
        recentJobs={recentJobs}
        pendingCount={pendingCount}
        hasLiveVideoClips={hasLiveVideoClips}
        isProcessing={isProcessing}
        enabled={status?.enabled}
        onProcess={processPending}
        onOpenProcessed={openProcessedDetails}
        onReprocess={reprocessVideoClip}
        onOpenJob={(nextJob) => {
          setJob(nextJob);
          setResultsModalOpen(true);
        }}
      />
    </div>
  );
}
