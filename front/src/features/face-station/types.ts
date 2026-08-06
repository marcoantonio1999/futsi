export type TabId = "live" | "attendance" | "monthly" | "matches" | "identities";
export type SubjectKind = "known" | "unknown";
export type DetectionTarget =
  | {
      scope: "day";
      kind: SubjectKind;
      subjectKey: string;
      date: string;
      includeAllCrops?: boolean;
    }
  | {
      scope: "month";
      kind: SubjectKind;
      subjectKey: string;
      month: string;
      includeAllCrops?: boolean;
    };

export interface CameraStatus {
  label?: string;
  connected: boolean;
  last_error?: string;
  frames_read?: number;
  frames_dropped?: number;
  processed_frames?: number;
  processing_fps?: number;
  hardware_acceleration?: boolean;
  queue_depth?: number;
  roi?: [number, number];
  roi_active?: boolean;
  source_role?: "primary" | "fallback";
  using_fallback?: boolean;
  failover_count?: number;
  last_source_switch_at?: number;
  last_failover_reason?: string;
  capture_pipeline?: {
    pipeline_mode?: "async_mjpeg" | "opencv" | string;
    decode_reduction?: number;
    ingress_fps?: number;
    ingress_mbps?: number;
    decoded_frames?: number;
    decode_errors?: number;
    jpeg_errors?: number;
    compressed_frames_dropped?: number;
    packet_frames_dropped?: number;
    frames_drained_while_paused?: number;
    processing_enabled?: boolean;
    receiver_alive?: boolean;
    decoder_alive?: boolean;
    detection_resolution?: { width: number; height: number } | null;
    last_original_resolution?: { width: number; height: number } | null;
  };
}

export interface PersistenceStatus {
  queue_depth?: number;
  queue_capacity?: number;
  worker_active?: boolean;
  enqueued?: number;
  completed?: number;
  dropped?: number;
  failed?: number;
  last_error?: string;
  last_latency_ms?: number;
  raw_batch?: {
    max_items?: number;
    window_ms?: number;
    batches?: number;
    items?: number;
    largest?: number;
  };
  original_frames?: {
    queue_depth?: number;
    queue_capacity?: number;
    queue_high_water?: number;
    active?: number;
    worker_count?: number;
    workers_active?: number;
    worker_active?: boolean;
    enqueued?: number;
    completed?: number;
    decoded?: number;
    crops_enqueued?: number;
    dropped?: number;
    dropped_faces?: number;
    failed?: number;
    last_sequence?: number;
    last_error?: string;
    last_latency_ms?: number;
  };
}

export interface RecentDetection {
  subject_key: string;
  kind: SubjectKind;
  name: string;
  similarity: number;
  seen_at: string;
  detection_count: number;
  crop_id?: number | null;
  camera?: string;
  status?: "known" | "candidate" | "consolidated" | "linked" | string;
}

export interface StationStatus {
  running: boolean;
  state: string;
  last_error?: string;
  site_name: string;
  device_name: string;
  provider: string;
  target_fps: number;
  processing_fps: number;
  processed_frames: number;
  detected_faces: number;
  online: boolean;
  camera: {
    connected_count?: number;
    configured_count?: number;
  };
  cameras?: {
    primary?: CameraStatus;
    secondary?: CameraStatus;
  };
  references?: {
    total?: number;
    configured?: number;
    ready?: number;
    missing?: number;
  };
  sync: {
    pending: number;
    done: number;
  };
  persistence?: PersistenceStatus;
  benchmark?: {
    samples?: number;
    provider?: string;
    average_ms?: number;
    capacity_fps?: number;
    recommended_fps?: number;
  };
  recent?: RecentDetection[];
  recent_date?: string;
  recent_subjects_today?: number;
  recent_visible?: number;
  recent_total_today?: number;
  capture?: {
    date: string;
    frames_today: number;
    faces_today: number;
    night_batch_start_time: string;
    detection_paused: boolean;
  };
  crop_queue?: CropQueueSummary & {
    today?: CropQueueSummary;
    unassigned?: UnassignedCropSummary;
    batch_state: string;
    batch_processed: number;
    batch_discarded: number;
    batch_failed: number;
    current_crop_id: number;
    direct_embeddings: number;
    detection_fallbacks: number;
    embedding_batch_size?: number;
    embedding_batches?: number;
    embedding_batch_failures?: number;
    sqlite_writes?: {
      configured: boolean;
      mode: "atomic" | "legacy";
      atomic_commits: number;
      atomic_failures: number;
      legacy_writes: number;
      last_error?: string;
    };
    automatic?: {
      requested: boolean;
      active: boolean;
      run_date?: string;
      completed_date?: string;
      started_at?: string;
      finished_at?: string;
      initial_pending: number;
      last_error?: string;
      start_time: string;
      exclusive: boolean;
    };
    manual?: {
      requested: boolean;
      active: boolean;
      detection_paused: boolean;
      status: string;
      started_at?: string;
      finished_at?: string;
      initial_pending: number;
      processed: number;
      discarded: number;
      failed: number;
      last_error?: string;
    };
    evidence_maintenance?: {
      status?: "running" | "completed" | "failed" | string;
      started_at?: string;
      finished_at?: string;
      last_error?: string;
      daily_limit: number;
      safety_days: number;
      gallery_limit: number;
      curation?: {
        dates?: number;
        groups?: number;
        candidates?: number;
        selected?: number;
        redundant?: number;
      };
      retention?: {
        crops?: number;
        bytes?: number;
        cutoff_date?: string;
        status?: string;
      };
    };
  };
}

export interface QueuedCrop {
  id: number;
  captured_at: string;
  camera_key: string;
  camera_label: string;
  file_bytes: number;
  crop_width: number;
  crop_height: number;
  det_score: number;
  status: "pending" | "processing" | "error" | string;
  last_error?: string;
}

export interface CropQueueSummary {
  date: string;
  captured: number;
  pending: number;
  processing: number;
  processed: number;
  discarded: number;
  failed: number;
  active_bytes: number;
  captured_bytes: number;
  oldest_at?: string;
}

export interface UnassignedCropSummary {
  total: number;
  pending: number;
  resolved: number;
  discarded: number;
  low_quality: number;
  ambiguous: number;
}

export interface CropQueueResponse {
  date: string;
  items: QueuedCrop[];
  total: number;
  offset: number;
  limit: number;
  summary: CropQueueSummary;
}

export interface KnownAttendance {
  person_key: string;
  person_type: string;
  name: string;
  group_name?: string;
  team_name?: string;
  session_id?: number;
  session_label?: string;
  first_seen_at: string;
  last_seen_at: string;
  detection_count: number;
  synced?: number;
}

export interface UnknownAttendance {
  subject_id: string;
  temporary_name: string;
  status: string;
  first_seen_at: string;
  last_seen_at: string;
  detection_count: number;
  linked_person_key?: string | null;
  best_quality?: number;
  best_crop_id?: number | null;
  quality_hits?: number;
  merged_into?: string | null;
}

export interface PersonOption {
  person_key: string;
  person_type: string;
  name: string;
  group_name?: string;
  team_name?: string;
}

export interface DailyDashboard {
  known: KnownAttendance[];
  unknown: UnknownAttendance[];
  people: PersonOption[];
  pending_sync: number;
}

export interface MonthlyAttendanceRow {
  subject_kind: SubjectKind;
  subject_key: string;
  linked_person_key?: string | null;
  status?: string;
  name: string;
  person_type?: string;
  group_name?: string;
  team_name?: string;
  attendance_days: number;
  session_count: number;
  first_date: string;
  last_date: string;
  detection_count: number;
  payment_applicable?: number | boolean;
  payment_registered?: number | boolean;
  payment_count?: number;
  payment_amount?: number;
  last_paid_at?: string;
  expected_fee_applicable?: number | boolean;
  expected_fee_eligible?: number | boolean;
  expected_fee_minimum_days?: number;
  expected_monthly_amount?: number;
}

export interface MonthlySummary {
  people: number;
  known: number;
  unknown: number;
  attendance_days: number;
  detections?: number;
  expected_payers?: number;
  expected_revenue?: number;
  payment_registered?: number;
  payment_missing?: number;
}

export interface MonthlyResponse {
  items: MonthlyAttendanceRow[];
  total: number;
  offset: number;
  summary: MonthlySummary;
  revenue_policy?: {
    monthly_fee_amount: number;
    minimum_attendance_days: number;
    registered_minimum_attendance_days?: number;
    unknown_minimum_attendance_days?: number;
  };
}

export interface MatchParticipant {
  kind: "known" | "unknown";
  key: string;
  name: string;
  person_type?: string;
  first_seen_at: string;
  last_seen_at: string;
  detection_count: number;
  best_crop_id: number;
  best_crop_seen_at: string;
  best_quality?: number;
  camera?: string;
}

export interface MatchWindow {
  id: number;
  analysis_date: string;
  window_index: number;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  max_unique_people: number;
  participant_count: number;
  known_count: number;
  unknown_count: number;
  participants: MatchParticipant[];
  window_type: "scheduled" | "unscheduled";
  window_status:
    | "scheduled"
    | "scheduled_with_evidence"
    | "scheduled_no_evidence"
    | "outside_schedule";
  schedule_id?: number | null;
  tournament?: string;
  home_team?: string;
  away_team?: string;
  scheduled_starts_at?: string;
  scheduled_ends_at?: string;
  evidence_starts_at?: string;
  evidence_ends_at?: string;
  tolerance_minutes?: number;
}

export interface MatchAnalysisDay {
  analysis_date: string;
  status: "complete" | "processing" | string;
  match_detected: number | boolean;
  window_count: number;
  scheduled_count: number;
  scheduled_confirmed_count: number;
  unscheduled_count: number;
  max_unique_people: number;
  source_crop_count: number;
  source_queue_count: number;
  unresolved_queue_count: number;
  first_seen_at?: string;
  last_seen_at?: string;
  analyzed_at?: string;
  windows: MatchWindow[];
}

export interface MatchAnalysisSummary {
  total_days: number;
  detected_days: number;
  clear_days: number;
  processing_days: number;
  total_windows: number;
  scheduled_matches: number;
  scheduled_confirmed: number;
  scheduled_unconfirmed: number;
  unscheduled_matches: number;
  first_date: string;
  last_date: string;
}

export interface MatchAnalysisStatus {
  running: boolean;
  force: boolean;
  started_at?: string;
  finished_at?: string;
  current_date?: string;
  processed_days: number;
  total_days: number;
  last_error?: string;
  window_minutes: number;
  minimum_unique_people: number;
  schedule_tolerance_minutes?: number;
  analysis_version?: string;
}

export interface MatchAnalysisResponse {
  items: MatchAnalysisDay[];
  total: number;
  offset: number;
  limit: number;
  summary: MatchAnalysisSummary;
  analysis: MatchAnalysisStatus;
}

export type IdentityStatus = "all" | "ready" | "missing" | "duplicates" | "unknown";

export interface IdentityRow {
  person_key: string;
  person_type: string;
  name: string;
  group_name?: string;
  team_name?: string;
  reference_ready: boolean | number;
  registration_count: number;
}

export interface IdentitySummary {
  identities: number;
  ready: number;
  missing: number;
  duplicates: number;
  unknown_total: number;
  unknown_review: number;
  unknown_candidate: number;
  unknown_consolidated: number;
  unknown_linked: number;
  unknown_ignored: number;
  unknown_quarantined: number;
  unknown_archived: number;
}

export interface IdentityResponse {
  items: IdentityRow[];
  total: number;
  offset: number;
  summary: IdentitySummary;
}

export type UnknownCatalogStatus =
  | "all"
  | "review"
  | "candidate"
  | "consolidated"
  | "linked"
  | "ignored"
  | "quarantined"
  | "archived";

export interface UnknownIdentityRow {
  subject_id: string;
  temporary_name: string;
  status: Exclude<UnknownCatalogStatus, "all" | "review">;
  best_quality: number;
  quality_score: number;
  quality_hits: number;
  quality_reasons: string[];
  detection_count: number;
  crop_count: number;
  valid_crop_count: number;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
  linked_person_key?: string | null;
  linked_person_name?: string;
  merged_into?: string | null;
  merged_into_name?: string;
  image_available: boolean;
  yaw: number;
  pitch: number;
  roll: number;
  sharpness: number;
}

export interface UnknownIdentitySummary {
  total: number;
  review: number;
  candidate: number;
  consolidated: number;
  linked: number;
  ignored: number;
  quarantined: number;
  archived: number;
}

export interface UnknownIdentityResponse {
  items: UnknownIdentityRow[];
  total: number;
  offset: number;
  limit: number;
  snapshot: number;
  status: UnknownCatalogStatus;
  summary: UnknownIdentitySummary;
}

export interface CropEvidence {
  id: number;
  seen_at: string;
  date?: string;
  camera?: string;
  similarity?: number;
  quality?: number;
  quality_pass?: number | boolean;
  evidence_selected?: number | boolean;
  evidence_reason?: string;
}

export interface DetectionDaySummary {
  date: string;
  detections: number;
  sessions: number;
  crops: number;
  first_seen_at?: string;
  last_seen_at?: string;
}

export interface DetectionDetail {
  scope: "day" | "month";
  value: string;
  date?: string;
  month?: string;
  subject: {
    subject_key?: string;
    name?: string;
    person_type?: string;
    group_name?: string;
    team_name?: string;
    status?: string;
    linked_person_key?: string | null;
  };
  summary: {
    detections?: number;
    crops?: number;
    attendance_days?: number;
    sessions?: number;
    first_seen_at?: string;
    last_seen_at?: string;
  };
  days?: DetectionDaySummary[];
  crops: CropEvidence[];
  total_crops?: number;
  next_cursor?: string | null;
  limit?: number;
  evidence_policy?: {
    daily_limit?: number;
    curated?: boolean;
    full_catalog?: boolean;
  };
}

export interface RecentResponse {
  items: RecentDetection[];
  offset: number;
  total_subjects: number;
  total_detections: number;
}

export interface UnknownMergeResponse {
  merged: boolean;
  target: UnknownAttendance;
  merged_subject_ids: string[];
  merged_names: string[];
  crops_moved: number;
  attendance_rows_merged: number;
}

export interface UnknownIgnoreResponse {
  ignored: boolean;
  subject_ids: string[];
  names: string[];
  count: number;
}

export interface IgnoredUnknownsResponse {
  items: UnknownAttendance[];
  total: number;
  offset: number;
  limit: number;
}

export interface StudentRegistrationCrop {
  id: number;
  seen_at: string;
  similarity?: number;
  quality?: number;
  quality_pass?: number;
  camera?: string;
  is_subject_best?: number;
}

export interface StudentRegistrationCropsResponse {
  subject: {
    subject_id: string;
    temporary_name: string;
    status: string;
  };
  suggested_crop_id?: number | null;
  crops: StudentRegistrationCrop[];
}

export interface QuickStudentResponse {
  created: boolean;
  duplicate: boolean;
  person: PersonOption;
  selected_crop_id: number;
  events?: Array<{
    event_id?: string;
    status?: string;
    session_id?: number | null;
  }>;
}

export interface StationConfig {
  api_url: string;
  reference_proxy_url?: string;
  station_token?: string;
  camera_url: string;
  camera_fallback_url?: string;
  camera_id: string;
  camera_label: string;
  camera_async_mjpeg_enabled: boolean;
  camera_mjpeg_decode_reduction: 1 | 2 | 4 | 8;
  camera_roi_left: number;
  camera_roi_right: number;
  secondary_camera_enabled: boolean;
  secondary_camera_url?: string;
  secondary_camera_id?: string;
  secondary_camera_label?: string;
  secondary_camera_username?: string;
  secondary_camera_password?: string;
  secondary_camera_roi_left: number;
  secondary_camera_roi_right: number;
  processing_device: "auto" | "gpu" | "cpu";
  detector_size: number;
  processing_width: number;
  preview_width: number;
  target_fps: number;
  capture_priority_start_hour: number;
  capture_priority_end_hour: number;
  night_batch_start_time: string;
  night_batch_atomic_commit_enabled: boolean;
  night_embedding_batch_size: number;
  batch_idle_seconds: number;
  spool_jpeg_quality: number;
  known_threshold: number;
  unknown_threshold: number;
  unknown_confirmation_threshold: number;
  adaptive_known_min_similarity: number;
  adaptive_known_min_margin: number;
  adaptive_unknown_min_similarity: number;
  daily_evidence_limit: number;
  evidence_safety_days: number;
  monthly_fee_amount: number;
  [key: string]: string | number | boolean | undefined;
}

export interface ToastMessage {
  id: number;
  text: string;
  tone: "success" | "error";
}
