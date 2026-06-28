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
    quality?: { det_score?: number; face_width?: number; face_height?: number; blur?: number };
    quality_rejection?: string;
    known_match?: { type: string; id: number; name: string; similarity: number; margin: number };
    known_matches?: Array<{ type: string; id: number; name: string; similarity: number; margin: number }>;
    unknown_subject?: { id: string; temporary_name: string; duplicate_similarity?: number | null };
    unknown_subjects?: Array<{ unknown_subject: { id: string; temporary_name: string; duplicate_similarity?: number | null }; quality?: { det_score?: number; face_width?: number; face_height?: number; blur?: number } }>;
    rejected_faces?: Array<{ quality?: { det_score?: number; face_width?: number; face_height?: number; blur?: number } }>;
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
    quality?: { det_score?: number; face_width?: number; face_height?: number; blur?: number };
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
  current_capture?: string | null;
  phase?: string | null;
  phase_label?: string | null;
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
      quality?: { det_score?: number; face_width?: number; face_height?: number; blur?: number };
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
  processed_count: number;
  matched_known_count: number;
  unknown_confirmed_count: number;
  failed_count: number;
  candidate_subjects: number;
  visual_subjects: number;
  accepted_subjects: number;
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
  active_job: UnknownAttendanceJob | null;
  jobs: UnknownAttendanceJob[];
  thresholds: {
    min_det_score: number;
    min_face_size: number;
    min_blur: number;
    known_similarity: number;
    duplicate_similarity: number;
  };
};

export function qualityText(quality?: { det_score?: number; face_width?: number; face_height?: number; blur?: number }) {
  if (!quality) return "Sin calidad medida";
  return `det ${(quality.det_score ?? 0).toFixed(2)} - ${quality.face_width ?? 0}x${quality.face_height ?? 0}px - blur ${(quality.blur ?? 0).toFixed(0)}`;
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
    unknown_confirmed: "Desconocido",
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
