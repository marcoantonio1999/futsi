import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api";
import type { AppData } from "../../types";
import { AutomaticAttendanceReportPanel, type AutomaticSessionResult } from "./automaticAttendanceReport";
import { AutomaticJobResultsModal } from "./automaticAttendanceJobResultsModal";
import { AutomaticAttendanceLoadingSkeleton } from "./automaticAttendanceLoading";
import { AutomaticAttendanceQueues } from "./automaticAttendanceQueues";
import { AutomaticAttendanceStatusSection } from "./automaticAttendanceStatusSection";
import { isLiveVideoClip, type AutomaticAttendanceJob, type AutomaticAttendanceStatus, type PendingVideo } from "./automaticAttendanceModel";

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

  const visibleJob = job ?? status?.active_job ?? status?.jobs?.[0] ?? null;
  const recentJobs = useMemo(() => {
    const seen = new Set<string>();
    return [job, status?.active_job, ...(status?.jobs ?? [])].filter(Boolean).filter((candidate) => {
      const current = candidate as AutomaticAttendanceJob;
      if (seen.has(current.id)) return false;
      seen.add(current.id);
      return true;
    }) as AutomaticAttendanceJob[];
  }, [job, status?.active_job, status?.jobs]);
  const isProcessing = visibleJob?.status === "queued" || visibleJob?.status === "processing";
  const videoClips = status?.video_clips ?? [];
  const hasLiveVideoClips = videoClips.some(isLiveVideoClip);
  const automaticResultsBySession = useMemo(() => {
    const resultMap = new Map<number, { result: AutomaticSessionResult; video: string; jobId: string }>();
    const seenJobs = new Set<string>();
    recentJobs.forEach((candidate) => {
      if (seenJobs.has(candidate.id)) return;
      seenJobs.add(candidate.id);
      candidate.results?.forEach((videoResult) => {
        videoResult.sessions?.forEach((sessionResult) => {
          if (!resultMap.has(sessionResult.session.id)) {
            resultMap.set(sessionResult.session.id, { result: sessionResult, video: videoResult.video, jobId: candidate.id });
          }
        });
      });
    });
    return resultMap;
  }, [recentJobs]);

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
  const progress = Math.max(0, Math.min(100, visibleJob?.percent ?? 0));
  const canProcessPending = Boolean(status?.enabled && pendingCount > 0 && !isProcessing);
  const currentJobLabel = visibleJob?.current_video ?? (visibleJob ? `Trabajo ${visibleJob.id.slice(0, 8)}` : "Sin trabajo activo");

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
      {resultsModalOpen && visibleJob ? <AutomaticJobResultsModal job={visibleJob} token={token} onClose={() => setResultsModalOpen(false)} /> : null}
      <AutomaticAttendanceStatusSection
        status={status}
        visibleJob={visibleJob}
        currentJobLabel={currentJobLabel}
        pendingCount={pendingCount}
        progress={progress}
        isProcessing={isProcessing}
        canProcessPending={canProcessPending}
        message={message}
        error={error}
        loadingStatus={loadingStatus}
        onRefresh={() => loadStatus()}
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
