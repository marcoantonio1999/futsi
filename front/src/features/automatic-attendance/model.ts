import type { AppData, AttendanceSession } from "../../types";
import { formatBytes } from "./format";
import type { AutomaticSessionResult } from "./report/AutomaticAttendanceReport";

export type PendingVideo = {
  filename: string;
  path: string;
  source?: "local" | "drive";
  size: number;
  modified_at: string;
  metadata: {
    site_id?: string | number | null;
    session_id?: string | number | null;
    recorded_date?: string | null;
    start_minute?: string | number | null;
    duration_minutes?: string | number | null;
    alert_threshold?: string | number | null;
    site_source?: string;
    date_source?: string;
    video_clip_id?: string;
    status?: string;
    processed_at?: string | null;
    error_message?: string | null;
    camera_id?: string | null;
    camera_label?: string | null;
    frame_package?: FramePackageMetadata;
    analysis_video?: FramePackageMetadata;
  };
  reprocessable?: boolean;
};

export type FramePackageMetadata = {
  status?: string;
  package_type?: string;
  size_bytes?: number;
  remote_path?: string;
  video_file_name?: string;
  proxy_fps?: number;
  frame_interval_seconds?: number;
};

export type AutomaticAttendanceJob = {
  id: string;
  status: "queued" | "processing" | "done" | "error" | "canceled";
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
  total: number;
  processed: number;
  percent: number;
  current_video?: string | null;
  current_video_started_at?: string | null;
  download_percent?: number | null;
  downloaded_bytes?: number | null;
  download_total_bytes?: number | null;
  download_speed_bps?: number | null;
  download_average_bps?: number | null;
  download_eta_seconds?: number | null;
  download_log_tail?: string | null;
  download_source?: string | null;
  phase?: string | null;
  phase_label?: string | null;
  processing_video_source?: string | null;
  proxy_scan_frame?: number | null;
  proxy_scan_total_frames?: number | null;
  proxy_sampled_frames?: number | null;
  proxy_raw_faces?: number | null;
  proxy_rejected_faces?: number | null;
  proxy_candidate_seconds?: number | null;
  proxy_candidate_seconds_preview?: number[];
  proxy_candidate_windows?: number | null;
  proxy_candidate_windows_preview?: Array<{ start_second: number; end_second: number; candidate_count?: number }>;
  proxy_scan_max_dimension?: number | null;
  process_frame?: number | null;
  process_total_frames?: number | null;
  process_sampled_frames?: number | null;
  process_probed_seconds?: number | null;
  process_active_seconds?: number | null;
  process_skipped_seconds?: number | null;
  process_face_groups?: number | null;
  process_rejected_faces?: number | null;
  process_candidate_windows_total?: number | null;
  process_candidate_windows_done?: number | null;
  process_pipeline_read_mode?: string | null;
  process_window?: string | null;
  video_duration_seconds?: number | null;
  video_total_frames?: number | null;
  video_fps?: number | null;
  process_window_seconds?: number | null;
  detail?: string;
  cancel_requested?: boolean;
  cancel_requested_at?: string;
  local_cache?: LocalVideoCacheSummary;
  results?: Array<{
    video: string;
    camera_id?: string | null;
    camera_label?: string | null;
    detail?: string;
    sessions?: AutomaticSessionResult[];
  }>;
};

export type LocalVideoCacheSummary = {
  path: string;
  count: number;
  bytes: number;
  retention_days: number;
  source_dirs: string[];
};

export type VideoClipMonitor = {
  id: string;
  filename: string;
  camera_id: string;
  clip_type: string;
  status: "recording" | "recorded" | "uploading" | "uploaded" | "processing" | "processed" | "failed" | "deleted" | string;
  size: number;
  recorded_at?: string | null;
  uploaded_at?: string | null;
  processed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  recording_started_at?: string | null;
  recording_ended_at?: string | null;
  duration_seconds?: number | null;
  recording_progress_percent?: number | null;
  upload_progress_percent?: number | null;
  last_heartbeat_at?: string | null;
  last_error_at?: string | null;
  error_message?: string;
  drive_web_url?: string;
  attendance_session_id?: number | null;
  match_id?: number | null;
  site_id?: number | null;
  site_name?: string;
  team_name?: string;
  tournament_name?: string;
  session_label?: string;
  processable?: boolean;
  metadata?: {
    frame_package?: FramePackageMetadata;
    [key: string]: unknown;
  };
};

export type AutomaticAttendanceStatus = {
  enabled: boolean;
  root: string;
  pending_dir: string;
  local_cache?: LocalVideoCacheSummary;
  pending: PendingVideo[];
  video_clips?: VideoClipMonitor[];
  reprocessable?: PendingVideo[];
  active_job: AutomaticAttendanceJob | null;
  jobs: AutomaticAttendanceJob[];
};

export type SessionDisplaySource = Pick<AttendanceSession, "id" | "date" | "starts_at" | "duration_minutes" | "site_name" | "session_type" | "group_name" | "tournament_name" | "team_name" | "match" | "match_name">;

export function sessionTitle(session: SessionDisplaySource, data?: AppData) {
  if (session.session_type === "tournament_match") {
    const match = session.match ? data?.matches.find((item) => item.id === session.match) : undefined;
    if (match?.home_team_name && match.away_team_name) return `${match.home_team_name} vs ${match.away_team_name}`;
    if (session.match_name) return session.match_name;
    if (session.team_name) return `${session.team_name} vs rival por definir`;
    return "Partido sin equipos definidos";
  }
  return `Entrenamiento: ${session.group_name || session.team_name || "Grupo general"}`;
}

export function sessionMeta(session: SessionDisplaySource) {
  const dateTime = `${session.date} ${session.starts_at ?? "--:--"}`;
  return [dateTime, session.site_name ?? "Sede", session.tournament_name].filter(Boolean).join(" - ");
}

export function videoFileLabel(filename: string, size?: number) {
  return `Archivo: ${filename}${size ? ` - ${formatBytes(size)}` : ""}`;
}

export function cameraDisplayLabel(cameraId?: string | null, cameraLabel?: string | null) {
  const configured = String(cameraLabel || "").trim();
  if (configured) return configured;
  const value = String(cameraId || "").trim();
  if (!value) return "Sin camara";
  const suffix = value.match(/(\d+)$/)?.[1];
  return suffix ? `Camara ${suffix}` : value.replace(/_/g, " ");
}

export function sessionLabel(session: AttendanceSession) {
  const type = session.session_type === "tournament_match" ? "Partido" : "Entrenamiento";
  return `${session.date} ${session.starts_at ?? "--:--"} (${session.duration_minutes || 120} min) - ${type} - ${session.site_name ?? "Sede"} - ${sessionTitle(session)}`;
}

export function hasUsablePersonPhoto(person: { photo?: string; photo_url?: string }) {
  const url = person.photo_url ?? "";
  return Boolean(person.photo) || url.startsWith("supabase://") || url.includes("/media/");
}

export function statusTone(status?: AutomaticAttendanceJob["status"]) {
  if (status === "done") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (status === "canceled") return "text-zinc-700 bg-zinc-50 border-zinc-200";
  if (status === "error") return "text-red-700 bg-red-50 border-red-200";
  return "text-amber-800 bg-amber-50 border-amber-200";
}

export function videoClipStatusLabel(status: string) {
  const labels: Record<string, string> = {
    recording: "Grabando",
    recorded: "Grabado",
    uploading: "Subiendo a Drive",
    uploaded: "Listo para pase de lista",
    processing: "Procesando pase de lista",
    processed: "Procesado",
    failed: "Fallo",
    deleted: "Eliminado",
  };
  return labels[status] ?? status;
}

export function videoClipStatusTone(status: string) {
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
  if (status === "uploaded") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "processed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "recording" || status === "uploading" || status === "processing") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

export function isLiveVideoClip(clip: VideoClipMonitor) {
  return ["recording", "uploading", "processing"].includes(clip.status);
}
