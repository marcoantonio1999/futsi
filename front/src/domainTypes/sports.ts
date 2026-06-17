
export type Tournament = {
  id: number;
  site: number;
  name: string;
  billing_type: string;
  starts_on: string | null;
  expected_weeks: number | null;
  is_active: boolean;
};

export type Team = {
  id: number;
  tournament: number;
  tournament_name?: string;
  site?: number;
  site_name?: string;
  name: string;
  representative_user?: number | null;
  representative_name: string;
  representative_phone: string;
  representative_email: string;
  player_count?: number;
  is_active: boolean;
};

export type StudentTournamentRegistration = {
  id: number;
  tournament: number;
  tournament_name?: string;
  site?: number;
  site_name?: string;
  student: number;
  student_name?: string;
  student_category?: string;
  student_group_name?: string;
  team: number | null;
  team_name?: string;
  jersey_number: number | null;
  billing_type: "weekly_match" | "full_tournament";
  weekly_amount: string;
  full_amount: string;
  billing_starts_on: string | null;
  status: string;
  notes: string;
  registered_by?: number | null;
  registered_by_username?: string;
  created_at: string;
  updated_at: string;
};

export type Player = {
  id: number;
  user: number | null;
  team: number;
  team_name?: string;
  tournament?: number;
  tournament_name?: string;
  site?: number;
  site_name?: string;
  full_name: string;
  phone: string;
  email: string;
  jersey_number: number | null;
  photo_url: string;
  is_active: boolean;
};

export type PlayerAttendanceRecord = {
  id: number;
  session: number;
  player: number;
  player_name?: string;
  team?: number;
  team_name?: string;
  status: "present" | "absent" | "justified";
  had_team_debt_at_capture: boolean;
  override_reason: string;
  captured_by_username?: string;
};

export type Match = {
  id: number;
  tournament: number;
  tournament_name?: string;
  site: number;
  site_name?: string;
  round: number | null;
  round_number?: number;
  home_team: number;
  home_team_name?: string;
  away_team: number;
  away_team_name?: string;
  played_on: string;
  starts_at: string | null;
  home_goals: number;
  away_goals: number;
  status: "scheduled" | "live" | "finished" | "canceled";
  updated_by_username?: string;
  updated_at: string;
};

export type StandingRow = {
  position: number;
  team: number;
  team_name: string;
  tournament: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  is_leader: boolean;
};

export type StudentAssessment = {
  id: number;
  student: number;
  student_name?: string;
  student_photo_url?: string;
  category?: string;
  group_name?: string;
  coach: number;
  coach_name?: string;
  site: number;
  site_name?: string;
  assessment_month: string;
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defense: number;
  physical: number;
  attitude: number;
  overall_rating: number;
  notes: string;
  updated_at: string;
};

export type StudentValueAssessment = {
  id: number;
  student: number;
  student_name?: string;
  student_photo_url?: string;
  category?: string;
  group_name?: string;
  coach: number;
  coach_name?: string;
  site: number;
  site_name?: string;
  assessment_month: string;
  respect: number;
  discipline: number;
  teamwork: number;
  responsibility: number;
  sportsmanship: number;
  overall_values_rating: number;
  minutes_recommendation: string;
  notes: string;
  updated_at: string;
};
