import type { StudentStatus } from "./auth";

export type Guardian = {
  id: number;
  full_name: string;
  phone: string;
  email: string;
  tax_name: string;
  tax_id: string;
  virtual_clabe: string;
  notes: string;
  username?: string;
};

export type Student = {
  id: number;
  site: number;
  site_name?: string;
  guardian: number;
  guardian_name?: string;
  guardian_phone?: string;
  full_name: string;
  birth_date: string | null;
  category: string;
  group_name: string;
  status: StudentStatus;
  photo?: string;
  photo_url: string;
  waiver_url: string;
  medical_notes: string;
  emergency_contact: string;
  emergency_phone: string;
  uniform_status: string;
  pause_start: string | null;
  pause_end: string | null;
  pause_reason: string;
  open_charge_count: number;
  balance_due: string;
  active_discounts: Array<{ id: number; reason: string; amount: string; charge: number | null }>;
};

export type AttendanceSession = {
  id: number;
  site: number;
  site_name?: string;
  session_type: "academy_class" | "tournament_match";
  date: string;
  starts_at: string | null;
  ends_at: string | null;
  duration_minutes: number;
  group_name: string;
  tournament: number | null;
  tournament_name?: string;
  round: number | null;
  team: number | null;
  team_name?: string;
  match: number | null;
  match_name?: string;
  captured_by: number;
  captured_by_username?: string;
  closed_at: string | null;
  record_count?: number;
  can_mark_attendance?: boolean;
  attendance_window?: string;
};

export type AttendanceRecord = {
  id: number;
  session: number;
  student: number | null;
  student_name?: string;
  team: number | null;
  status: "present" | "absent" | "justified";
  had_debt_at_capture: boolean;
  override_reason: string;
};
