import { Cloud, FolderOpen, Gauge, HardDrive, Play, RefreshCw } from "lucide-react";
import type { AppData } from "../../../types";
import {
  sessionTitle,
  videoClipStatusLabel,
  videoClipStatusTone,
  cameraDisplayLabel,
  type FramePackageMetadata,
  type AutomaticAttendanceJob,
  type PendingVideo,
  type SessionDisplaySource,
  type VideoClipMonitor,
} from "../model";

export function AutomaticAttendanceQueues({
  data,
  pendingVideos,
  videoClips,
  reprocessableVideos,
  recentJobs,
  pendingCount,
  hasLiveVideoClips,
  isProcessing,
  enabled,
  onProcess,
  onOpenProcessed,
  onReprocess,
  onOpenJob,
}: {
  data: AppData;
  pendingVideos: PendingVideo[];
  videoClips: VideoClipMonitor[];
  reprocessableVideos: PendingVideo[];
  recentJobs: AutomaticAttendanceJob[];
  pendingCount: number;
  hasLiveVideoClips: boolean;
  isProcessing: boolean;
  enabled?: boolean;
  onProcess: (path?: string) => void;
  onOpenProcessed: (video: PendingVideo) => void;
  onReprocess: (video: PendingVideo) => void;
  onOpenJob: (job: AutomaticAttendanceJob) => void;
}) {
  const localPendingByClipId = new Map(
    pendingVideos
      .filter((video) => video.source === "local" && video.metadata.video_clip_id)
      .map((video) => [String(video.metadata.video_clip_id), video]),
  );
  const localReadyCount = localPendingByClipId.size;

  return (
    <section className="grid gap-4 xl:grid-cols-3">
      <PendingVideosCard data={data} videos={pendingVideos} pendingCount={pendingCount} enabled={enabled} isProcessing={isProcessing} onProcess={onProcess} />
      <VideoClipsCard data={data} clips={videoClips} localPendingByClipId={localPendingByClipId} localReadyCount={localReadyCount} hasLiveVideoClips={hasLiveVideoClips} enabled={enabled} isProcessing={isProcessing} onProcess={onProcess} />
      <ProcessedVideosCard data={data} reprocessableVideos={reprocessableVideos} recentJobs={recentJobs} enabled={enabled} isProcessing={isProcessing} onOpenProcessed={onOpenProcessed} onReprocess={onReprocess} onOpenJob={onOpenJob} />
    </section>
  );
}

function cameraCountEntries(items: Array<{ camera_id?: string | null; camera_label?: string | null }>) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    const label = cameraDisplayLabel(item.camera_id, item.camera_label);
    if (label === "Sin camara") return;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function CameraSummaryBadges({ counts }: { counts: Array<{ label: string; count: number }> }) {
  if (!counts.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {counts.map((item) => (
        <span key={item.label} className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-800">
          {item.label}: {item.count}
        </span>
      ))}
    </div>
  );
}

function sessionTournamentLabel(session?: SessionDisplaySource | null) {
  return session?.tournament_name || "";
}

function pendingVideoTournamentLabel(video: PendingVideo, session?: SessionDisplaySource | null) {
  const metadata = video.metadata as PendingVideo["metadata"] & { tournament_name?: string | null };
  return sessionTournamentLabel(session) || metadata.tournament_name || "Sin torneo";
}

function clipTournamentLabel(clip: VideoClipMonitor, session?: SessionDisplaySource | null) {
  return sessionTournamentLabel(session) || clip.tournament_name || "Sin torneo";
}

function PendingVideosCard({ data, videos, pendingCount, enabled, isProcessing, onProcess }: { data: AppData; videos: PendingVideo[]; pendingCount: number; enabled?: boolean; isProcessing: boolean; onProcess: (path?: string) => void }) {
  const cameraCounts = cameraCountEntries(videos.map((video) => ({ camera_id: video.metadata.camera_id, camera_label: video.metadata.camera_label })));
  return (
    <div className="rounded-md border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold">Videos pendientes</h3>
          <p className="mt-1 text-xs text-zinc-500">Listos para procesar desde Drive o carpeta local.</p>
          <CameraSummaryBadges counts={cameraCounts} />
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{pendingCount}</span>
      </div>
      <div className="max-h-[560px] divide-y divide-zinc-100 overflow-auto dark:divide-zinc-800">
        {videos.map((video) => {
          const session = data.attendanceSessions.find((item) => String(item.id) === String(video.metadata.session_id));
          const linkedSessionLabel = session ? sessionTitle(session, data) : video.metadata.recorded_date ? `Fecha ${video.metadata.recorded_date}` : "Sin sesion ligada";
          return (
            <div key={video.path} className="m-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">{session ? sessionTitle(session, data) : "Video sin sesion ligada"}</p>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <CameraBadge cameraId={video.metadata.camera_id} cameraLabel={video.metadata.camera_label} />
                    <SourceBadge source={video.source} />
                    <FrameProxyBadge packageMetadata={video.metadata.frame_package} />
                    <AnalysisVideoBadge packageMetadata={video.metadata.analysis_video} />
                  </div>
                </div>
                <p className={`mt-1 line-clamp-2 text-xs ${session ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{session ? pendingVideoTournamentLabel(video, session) : linkedSessionLabel}</p>
              </div>
              <button className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" disabled={!enabled || isProcessing} onClick={() => onProcess(video.path)} type="button">
                <Play size={13} /> {video.metadata.video_clip_id ? "Procesar sesion/camaras" : "Procesar este video"}
              </button>
            </div>
          );
        })}
        {videos.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay videos en pendientes.</p>}
      </div>
    </div>
  );
}

function hasFrameProxy(packageMetadata?: FramePackageMetadata) {
  return packageMetadata?.status === "uploaded" && packageMetadata.package_type === "video_proxy_1fps";
}

function hasAnalysisVideo(packageMetadata?: FramePackageMetadata) {
  return packageMetadata?.status === "uploaded" && packageMetadata.package_type === "video_frame_index_mod8";
}

function CameraBadge({ cameraId, cameraLabel }: { cameraId?: string | null; cameraLabel?: string | null }) {
  const label = cameraDisplayLabel(cameraId, cameraLabel);
  if (label === "Sin camara") return null;
  return <span className="inline-flex shrink-0 rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-800">{label}</span>;
}

function FrameProxyBadge({ packageMetadata }: { packageMetadata?: FramePackageMetadata }) {
  if (!hasFrameProxy(packageMetadata)) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-800">
      <Gauge size={12} /> Proxy 1 FPS
    </span>
  );
}

function AnalysisVideoBadge({ packageMetadata }: { packageMetadata?: FramePackageMetadata }) {
  if (!hasAnalysisVideo(packageMetadata)) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">
      <Gauge size={12} /> Analisis
    </span>
  );
}

function SourceBadge({ source }: { source?: PendingVideo["source"] }) {
  if (source === "local") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
        <HardDrive size={12} /> Local
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
      <Cloud size={12} /> Drive
    </span>
  );
}

function VideoClipsCard({
  data,
  clips,
  localPendingByClipId,
  localReadyCount,
  hasLiveVideoClips,
  enabled,
  isProcessing,
  onProcess,
}: {
  data: AppData;
  clips: VideoClipMonitor[];
  localPendingByClipId: Map<string, PendingVideo>;
  localReadyCount: number;
  hasLiveVideoClips: boolean;
  enabled?: boolean;
  isProcessing: boolean;
  onProcess: (path?: string) => void;
}) {
  const cameraCounts = cameraCountEntries(clips.map((clip) => ({ camera_id: clip.camera_id, camera_label: clip.metadata?.camera_label as string | undefined })));
  return (
    <div className="rounded-md border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold">Grabaciones y subida</h3>
          <p className="mt-1 text-xs text-zinc-500">{localReadyCount} videos ya estan en esta PC. Actualiza cada {hasLiveVideoClips ? "5" : "15"}s.</p>
          <CameraSummaryBadges counts={cameraCounts} />
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{clips.length}</span>
      </div>
      <div className="max-h-[560px] divide-y divide-zinc-100 overflow-auto dark:divide-zinc-800">
        {clips.map((clip) => <VideoClipRow key={clip.id} clip={clip} data={data} localPendingVideo={localPendingByClipId.get(String(clip.id))} enabled={enabled} isProcessing={isProcessing} onProcess={onProcess} />)}
        {clips.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay grabaciones registradas.</p>}
      </div>
    </div>
  );
}

function VideoClipRow({ clip, data, localPendingVideo, enabled, isProcessing, onProcess }: { clip: VideoClipMonitor; data: AppData; localPendingVideo?: PendingVideo; enabled?: boolean; isProcessing: boolean; onProcess: (path?: string) => void }) {
  const recordingPercent = Math.max(0, Math.min(100, clip.recording_progress_percent ?? (clip.recording_ended_at ? 100 : 0)));
  const uploadPercent = Math.max(0, Math.min(100, clip.upload_progress_percent ?? (clip.uploaded_at ? 100 : 0)));
  const session = data.attendanceSessions.find((item) => String(item.id) === String(clip.attendance_session_id));
  const match = clip.match_id ? data.matches.find((item) => item.id === clip.match_id) : undefined;
  const clipTitle = session ? sessionTitle(session, data) : match?.home_team_name && match.away_team_name ? `${match.home_team_name} vs ${match.away_team_name}` : clip.session_label || "Grabacion sin sesion ligada";
  const clipMeta = clipTournamentLabel(clip, session);
  const framePackage = clip.metadata?.frame_package;
  const analysisVideo = clip.metadata?.analysis_video as FramePackageMetadata | undefined;
  return (
    <div className="m-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/55">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">{clipTitle}</p>
          <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{clipMeta}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <CameraBadge cameraId={clip.camera_id} cameraLabel={clip.metadata?.camera_label as string | undefined} />
          {localPendingVideo ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
              <HardDrive size={12} /> En esta PC
            </span>
          ) : null}
          <FrameProxyBadge packageMetadata={framePackage} />
          <AnalysisVideoBadge packageMetadata={analysisVideo} />
          <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${videoClipStatusTone(clip.status)}`}>{videoClipStatusLabel(clip.status)}</span>
        </div>
      </div>
      <ProgressPair recordingPercent={recordingPercent} uploadPercent={uploadPercent} status={clip.status} />
      {clip.processable ? (
        <button className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 shadow-sm disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100" disabled={!enabled || isProcessing} onClick={() => onProcess(`video_clip:${clip.id}`)} type="button">
          <Play size={13} /> Procesar sesion/camaras
        </button>
      ) : null}
      {clip.error_message ? <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">{clip.error_message}</p> : null}
    </div>
  );
}

function ProgressPair({ recordingPercent, uploadPercent, status }: { recordingPercent: number; uploadPercent: number; status: string }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-600 dark:text-zinc-300">
      <div>
        <div className="mb-1 flex justify-between"><span>Grabacion</span><span className="font-semibold">{recordingPercent.toFixed(0)}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white dark:bg-zinc-800"><div className={`h-full rounded-full bg-amber-500 transition-all duration-700 ${status === "recording" ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(recordingPercent, status === "recording" ? 3 : 0)}%` }} /></div>
      </div>
      <div>
        <div className="mb-1 flex justify-between"><span>Drive</span><span className="font-semibold">{uploadPercent.toFixed(0)}%</span></div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white dark:bg-zinc-800"><div className={`h-full rounded-full bg-blue-600 transition-all duration-700 ${status === "uploading" ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(uploadPercent, status === "uploading" ? 3 : 0)}%` }} /></div>
      </div>
    </div>
  );
}

function ProcessedVideosCard({ data, reprocessableVideos, recentJobs, enabled, isProcessing, onOpenProcessed, onReprocess, onOpenJob }: { data: AppData; reprocessableVideos: PendingVideo[]; recentJobs: AutomaticAttendanceJob[]; enabled?: boolean; isProcessing: boolean; onOpenProcessed: (video: PendingVideo) => void; onReprocess: (video: PendingVideo) => void; onOpenJob: (job: AutomaticAttendanceJob) => void }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div><h3 className="text-sm font-semibold">Procesados recientes</h3><p className="mt-1 text-xs text-zinc-500">Reprocesa clips o abre resultados locales.</p></div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{reprocessableVideos.length + recentJobs.length}</span>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {reprocessableVideos.map((video) => <ReprocessableVideoRow key={`reprocess-${video.path}`} video={video} data={data} enabled={enabled} isProcessing={isProcessing} onOpenProcessed={onOpenProcessed} onReprocess={onReprocess} />)}
          {recentJobs.map((job) => <RecentJobRow key={`history-${job.id}`} job={job} data={data} onOpenJob={onOpenJob} />)}
          {reprocessableVideos.length + recentJobs.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay procesados recientes.</p>}
        </div>
      </div>
    </div>
  );
}

function ReprocessableVideoRow({ video, data, enabled, isProcessing, onOpenProcessed, onReprocess }: { video: PendingVideo; data: AppData; enabled?: boolean; isProcessing: boolean; onOpenProcessed: (video: PendingVideo) => void; onReprocess: (video: PendingVideo) => void }) {
  const session = data.attendanceSessions.find((item) => String(item.id) === String(video.metadata.session_id));
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">{session ? sessionTitle(session, data) : "Video procesado sin sesion ligada"}</p>
        <CameraBadge cameraId={video.metadata.camera_id} cameraLabel={video.metadata.camera_label} />
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{pendingVideoTournamentLabel(video, session)}</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => onOpenProcessed(video)} type="button"><FolderOpen size={13} /> Ver detalles</button>
        <button className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" disabled={!enabled || isProcessing} onClick={() => onReprocess(video)} type="button"><RefreshCw size={13} /> Reprocesar sesion/camaras</button>
      </div>
    </div>
  );
}

function RecentJobRow({ job, data, onOpenJob }: { job: AutomaticAttendanceJob; data: AppData; onOpenJob: (job: AutomaticAttendanceJob) => void }) {
  const firstResult = job.results?.[0];
  const firstSessionResult = job.results?.flatMap((result) => result.sessions ?? [])[0]?.session;
  const fullSession = firstSessionResult ? data.attendanceSessions.find((session) => session.id === firstSessionResult.id) : undefined;
  const timestamp = job.completed_at ?? job.updated_at ?? job.created_at;
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">{fullSession ? sessionTitle(fullSession, data) : firstSessionResult ? sessionTitle(firstSessionResult as SessionDisplaySource, data) : "Trabajo procesado"}</p>
        <CameraBadge cameraId={firstResult?.camera_id} cameraLabel={firstResult?.camera_label} />
      </div>
      <p className="mt-1 text-xs text-zinc-500">{timestamp ? new Date(timestamp).toLocaleString() : "Sin fecha"} - {job.status}</p>
      <button className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => onOpenJob(job)} type="button">Ver detalles</button>
    </div>
  );
}
