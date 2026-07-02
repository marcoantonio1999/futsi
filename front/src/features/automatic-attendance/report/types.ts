import type { AttendanceSession } from "../../../types";

export type ReportType = AttendanceSession["session_type"] | "all";

export type AutomaticSessionSummary = {
  id: number;
  site: number;
  site_name: string;
  date: string;
  starts_at: string | null;
  ends_at: string | null;
  duration_minutes: number;
  group_name: string;
  session_type?: string;
  match?: number | null;
  match_name?: string;
  team?: number | null;
  team_name?: string;
  tournament?: number | null;
  tournament_name?: string;
};

export type UnknownFace = {
  unknown_id: number;
  hits?: number;
  similarity: number;
  frame?: number;
  source_camera_id?: string;
  source_camera_label?: string;
  video_second?: number | null;
  video_time?: string;
  session_second?: number | null;
  session_time?: string;
  observed_at?: string;
  observed_date?: string;
  observed_time?: string;
  window_phase?: string;
  source_window?: string;
  source_total_frames?: number;
  source_duration_seconds?: number | null;
  evidence_url?: string;
  evidence_path?: string;
};

export type FaceComparison = {
  student_id: number;
  student_name: string;
  person_id?: number;
  person_type?: "student" | "player" | string;
  person_key?: string;
  team_id?: number | null;
  team_name?: string;
  is_expected_roster?: boolean;
  hits?: number;
  similarity: number;
  margin?: number;
  frame?: number;
  source_camera_id?: string;
  source_camera_label?: string;
  video_second?: number | null;
  video_time?: string;
  session_second?: number | null;
  session_time?: string;
  observed_at?: string;
  observed_date?: string;
  observed_time?: string;
  window_phase?: string;
  source_window?: string;
  source_total_frames?: number;
  source_duration_seconds?: number | null;
  core_hit_count?: number;
  padding_hit_count?: number;
  reason?: string;
  evidence_url?: string;
  evidence_path?: string;
  manual_confirmed?: boolean;
  candidates?: Array<{
    student_id: number;
    student_name: string;
    person_id?: number;
    person_type?: "student" | "player" | string;
    person_key?: string;
    team_id?: number | null;
    team_name?: string;
    is_expected_roster?: boolean;
    similarity: number;
  }>;
};

export type AutomaticSessionResult = {
  session: AutomaticSessionSummary;
  marked: FaceComparison[];
  review?: FaceComparison[];
  off_roster?: FaceComparison[];
  unknown_faces?: UnknownFace[];
  camera_id?: string | null;
  camera_label?: string | null;
  sampled_frames?: number;
  total_frames?: number;
  duration_seconds?: number | null;
  window?: string;
  probed_seconds?: number;
  active_seconds?: number;
  skipped_seconds?: number;
  face_groups?: number;
  rejected_quality_faces?: number;
  clustered_pipeline?: boolean;
  detail?: string;
  failed?: boolean;
  skipped?: string[];
  thresholds?: {
    similarity: number;
    margin: number;
    min_hits: number;
    review_similarity: number;
    duplicate_guard: number;
    second_probe?: boolean;
    dense_frame_stride?: number;
  };
};

export type AutomaticReportGroup = {
  id: string;
  primary: AttendanceSession;
  sessions: AttendanceSession[];
};

export type AttendanceDetailEntry = {
  name: string;
  detail: string;
  evidenceUrl?: string;
};

export type AutomaticSessionDetailCounts = {
  sessionId: number;
  label: string;
  confirmed: number;
  offRoster: number;
  insufficient: number;
};

export type AutomaticGroupDetailCounts = {
  confirmed: number;
  offRoster: number;
  insufficient: number;
  sessions: AutomaticSessionDetailCounts[];
};

export type AutomaticRosterPerson = {
  id: number;
  full_name: string;
  kind: "student" | "player";
  team?: number | null;
};
