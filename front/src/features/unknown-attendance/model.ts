export type UnknownFaceQuality = {
  det_score?: number;
  face_width?: number;
  face_height?: number;
  blur?: number;
  quality_score?: number;
  frontal_score?: number;
  pose_max_abs?: number;
  min_eye_open_ratio?: number;
  avg_eye_open_ratio?: number;
  eyes_open_score?: number;
  rejection_reason?: string;
  rejection_reasons?: string[];
};

export type UnknownCapture = {
  id: string;
  subject_id?: string | null;
  camera_id: string;
  site_id?: number | null;
  captured_at: string;
  local_file_name: string;
  drive_web_url?: string | null;
  size_bytes: number;
  status: string;
  upload_progress_percent?: number;
  uploaded_at?: string | null;
  processed_at?: string | null;
  error_message?: string | null;
  temporary_name?: string | null;
  subject_status?: string | null;
  image_url?: string;
  metadata?: {
    quality?: UnknownFaceQuality;
    quality_rejection?: string;
    known_match?: { type: string; id: number; name: string; similarity: number; margin: number };
    known_matches?: Array<{ type: string; id: number; name: string; similarity: number; margin: number }>;
    unknown_subject?: { id: string; temporary_name: string; duplicate_similarity?: number | null };
    unknown_subjects?: Array<{ unknown_subject: { id: string; temporary_name: string; duplicate_similarity?: number | null }; quality?: UnknownFaceQuality }>;
    rejected_faces?: Array<{ quality?: UnknownFaceQuality }>;
    face_crop_uri?: string;
  };
};

export type UnknownSubject = {
  id: string;
  temporary_name: string;
  status: string;
  site_id?: number | null;
  first_seen_at: string;
  last_seen_at: string;
  day_first_seen_at?: string | null;
  day_last_seen_at?: string | null;
  appearance_count?: number;
  appearance_times?: string[];
  capture_count: number;
  matched_person_type?: string | null;
  matched_student_id?: number | null;
  matched_player_id?: number | null;
  notes?: string | null;
  image_url?: string;
  metadata?: {
    quality?: UnknownFaceQuality;
    latest_quality?: UnknownFaceQuality;
    duplicate_similarity?: number;
    face_crop_uri?: string;
    accepted_at?: string;
  };
};

export type UnknownAttendanceJob = {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  created_at: string;
  updated_at: string;
  completed_at?: string;
  captured_date?: string | null;
  current_capture?: string | null;
  phase?: string | null;
  phase_label?: string | null;
  download_bytes?: number;
  download_total_bytes?: number;
  download_percent?: number;
  download_rate_bps?: number;
  total: number;
  processed: number;
  percent: number;
  detail?: string;
  results?: Array<{
    processed: Array<{
      capture_id: string;
      captured_at?: string | null;
      status: string;
      detail?: string;
      subject_id?: string;
      subject_name?: string;
      known_name?: string;
      similarity?: number;
      known_count?: number;
      unknown_count?: number;
      rejected_count?: number;
      face_crop_uri?: string;
      image_url?: string;
      quality?: UnknownFaceQuality;
    }>;
    skipped_references?: string[];
  }>;
};

export type UnknownDailyReport = {
  date: string;
  first_captured_at?: string | null;
  last_captured_at?: string | null;
  total_captures: number;
  total_bytes: number;
  pending_count: number;
  pending_upload_count?: number;
  processed_count: number;
  matched_known_count: number;
  unknown_confirmed_count: number;
  failed_count: number;
  candidate_subjects: number;
  visual_subjects: number;
  accepted_subjects: number;
  activity_window_count?: number;
  unscheduled_activity_count?: number;
  preliminary_activity_count?: number;
  scheduled_activity_count?: number;
};

export type UnknownActivityWindow = {
  date: string;
  window_start: string;
  window_end: string;
  first_capture?: string | null;
  last_capture?: string | null;
  site_id?: number | null;
  camera_id: string;
  motion_captures: number;
  processed_captures: number;
  known_people: number;
  unknown_people: number;
  unique_people: number;
  active_minutes: number;
  scheduled_match_id?: number | null;
  scheduled_match_label?: string;
  scheduled_starts_at?: string | null;
  scheduled_duration_minutes?: number;
  status: "unscheduled_candidate" | "scheduled_overlap" | "preliminary" | "low_signal" | string;
  is_unscheduled_candidate?: boolean;
  is_preliminary?: boolean;
  confidence?: number;
  reason?: string;
  evidence?: Array<{
    capture_id: string;
    captured_at?: string | null;
    status: string;
    subject_id?: string | null;
    subject_name?: string;
    known_name?: string;
    face_crop_uri?: string;
    image_url?: string;
    quality?: UnknownFaceQuality;
  }>;
};

export type UnknownAttendanceStatus = {
  enabled: boolean;
  daily_reports?: UnknownDailyReport[];
  pending_count?: number;
  pending_summary?: {
    first_captured_at?: string | null;
    last_captured_at?: string | null;
    count: number;
    total_bytes: number;
  } | null;
  pending: UnknownCapture[];
  recent: UnknownCapture[];
  subjects: UnknownSubject[];
  activity_windows?: UnknownActivityWindow[];
  active_job: UnknownAttendanceJob | null;
  jobs: UnknownAttendanceJob[];
  thresholds: {
    min_det_score: number;
    min_face_size: number;
    min_blur: number;
    min_eye_open_ratio?: number;
    max_pose_abs_degrees?: number;
    max_down_pitch_degrees?: number;
    min_quality_score?: number;
    known_similarity: number;
    duplicate_similarity: number;
    activity_window_minutes?: number;
    activity_step_minutes?: number;
    unscheduled_min_people?: number;
    unscheduled_min_processed_captures?: number;
    unscheduled_min_active_minutes?: number;
    preliminary_min_motion_captures?: number;
    schedule_grace_minutes?: number;
  };
};

export type UnknownRejectedFaceDebug = {
  capture_id: string;
  camera_id: string;
  site_id?: number | null;
  captured_at?: string | null;
  local_file_name: string;
  status: string;
  error_message?: string;
  quality_rejection?: string;
  face_index: number;
  quality?: UnknownFaceQuality;
  image_url?: string;
  capture_image_url?: string;
};

export type UnknownRejectedFacesResponse = {
  count: number;
  limit: number;
  offset: number;
  next_offset?: number | null;
  results: UnknownRejectedFaceDebug[];
};

export type RegisteredUnknownPerson = {
  subject_id: string;
  person_type: "player" | "student";
  person_id: number;
  full_name: string;
  photo_url: string;
};

export function qualityText(quality?: UnknownFaceQuality) {
  if (!quality) return "Sin calidad medida";
  const base = `score ${(quality.quality_score ?? 0).toFixed(2)} - det ${(quality.det_score ?? 0).toFixed(2)} - ${quality.face_width ?? 0}x${quality.face_height ?? 0}px - blur ${(quality.blur ?? 0).toFixed(0)}`;
  const face = `frontal ${(quality.frontal_score ?? 0).toFixed(2)} - ojos ${(quality.min_eye_open_ratio ?? 0).toFixed(2)}`;
  return `${base} - ${face}`;
}

export function qualityRejectText(quality?: UnknownFaceQuality) {
  const reasons = quality?.rejection_reasons?.length ? quality.rejection_reasons : quality?.rejection_reason ? [quality.rejection_reason] : [];
  if (!reasons.length) return "";
  const labels: Record<string, string> = {
    low_detection: "deteccion baja",
    small_face: "cara pequena",
    blur: "borrosa",
    overlay_text: "texto encima",
    underexposed: "oscura",
    not_frontal: "no frontal",
    looking_down: "mirada abajo",
    eyes_closed: "ojos cerrados",
    low_quality_score: "score bajo",
  };
  return reasons.map((reason) => labels[reason] ?? reason).join(", ");
}

export function unknownCaptureSummary(capture: UnknownCapture) {
  const knownCount = capture.metadata?.known_matches?.length ?? (capture.metadata?.known_match ? 1 : 0);
  const unknownCount = capture.metadata?.unknown_subjects?.length ?? (capture.metadata?.unknown_subject ? 1 : 0);
  const rejectedCount = capture.metadata?.rejected_faces?.length ?? 0;
  if (!knownCount && !unknownCount && !rejectedCount) return "";
  return `${knownCount} conocidos - ${unknownCount} desconocidos - ${rejectedCount} rechazados`;
}

export function captureStatusLabel(status: string) {
  const labels: Record<string, string> = {
    uploaded: "Pendiente",
    processing: "Procesando",
    matched_known: "Ya estaba en DB",
    unknown_confirmed: "Desconoc.",
    failed: "Rechazado",
    deleted: "Eliminado",
  };
  return labels[status] ?? status;
}

export function captureStatusClass(status: string) {
  if (status === "unknown_confirmed") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "matched_known") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "failed") return "border-red-200 bg-red-50 text-red-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

export function activityWindowStatusLabel(status: string) {
  const labels: Record<string, string> = {
    unscheduled_candidate: "Posible no agendado",
    scheduled_overlap: "Empalma con agenda",
    preliminary: "Preliminar",
    low_signal: "Actividad baja",
  };
  return labels[status] ?? status;
}

export function activityWindowStatusClass(status: string) {
  if (status === "unscheduled_candidate") return "border-red-200 bg-red-50 text-red-700";
  if (status === "scheduled_overlap") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "preliminary") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-zinc-200 bg-zinc-50 text-zinc-700";
}

export function statusTone(status?: string) {
  if (status === "done") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (status === "error") return "text-red-700 bg-red-50 border-red-200";
  return "text-amber-800 bg-amber-50 border-amber-200";
}

export function localDateValue(date: Date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

export function daysAgoDateValue(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return localDateValue(date);
}

export function captureIsOnDate(capture: UnknownCapture, dateValue: string) {
  return localDateValue(new Date(capture.captured_at)) === dateValue;
}

export function formatTimeOnly(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function minuteOfDay(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getHours() * 60 + date.getMinutes();
}

export function appearanceTimeLabel(value?: string | null) {
  const minute = minuteOfDay(value);
  if (!value || minute == null) return "Sin horario";
  return `${formatTimeOnly(value)} h - min ${minute}`;
}

export function subjectAppearanceTimes(subject: UnknownSubject) {
  const fallbackTimes = [subject.day_first_seen_at ?? subject.first_seen_at, subject.day_last_seen_at ?? subject.last_seen_at].filter(Boolean) as string[];
  const times = subject.appearance_times?.length ? subject.appearance_times : fallbackTimes;
  return Array.from(new Set(times)).slice(0, 8);
}
