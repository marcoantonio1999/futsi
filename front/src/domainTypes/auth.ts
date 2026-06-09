export type Role = "admin" | "dev" | "accounting" | "owner" | "site_coordinator" | "cashier" | "coach" | "guardian" | "adult_representative" | "adult_player";
export type StudentStatus = "trial" | "active" | "paused" | "injured" | "dropped";
export type ThemeMode = "light" | "dark";

export type User = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  primary_site: number | null;
  primary_site_name?: string;
  guardian_id?: number;
  guardian_name?: string;
  guardian_virtual_clabe?: string;
  phone: string;
  avatar_url: string;
  coach_group_name: string;
  coach_hourly_rate: string;
  is_active: boolean;
};

export type Site = {
  id: number;
  name: string;
  code: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  is_active: boolean;
  close_editing_after_hours: number;
  student_count?: number;
};

