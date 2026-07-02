import type { User, Site } from "./auth";
import type { Guardian, Student, AttendanceSession, AttendanceRecord } from "./academy";
import type { Tournament, Team, StudentTournamentRegistration, Player, Match, StandingRow, StudentAssessment, StudentValueAssessment, PlayerAttendanceRecord } from "./sports";
import type { Charge, Payment, Discount, Expense, StaffPaymentRequest, CashMovement, CoachWorkLog, Invoice } from "./finance";
import type { HistoricalImport, HistoricalDiscrepancyReport } from "./historical";


export type AppData = {
  dashboardSummary: DashboardSummary | null;
  users: User[];
  sites: Site[];
  guardians: Guardian[];
  students: Student[];
  attendanceSessions: AttendanceSession[];
  attendanceRecords: AttendanceRecord[];
  charges: Charge[];
  payments: Payment[];
  discounts: Discount[];
  expenses: Expense[];
  staffPaymentRequests: StaffPaymentRequest[];
  cashMovements: CashMovement[];
  coachWorkLogs: CoachWorkLog[];
  tournaments: Tournament[];
  teams: Team[];
  studentTournamentRegistrations: StudentTournamentRegistration[];
  players: Player[];
  matches: Match[];
  standings: StandingRow[];
  playerAttendanceRecords: PlayerAttendanceRecord[];
  studentAssessments: StudentAssessment[];
  studentValueAssessments: StudentValueAssessment[];
  invoices: Invoice[];
  historicalImports: HistoricalImport[];
  historicalDiscrepancies: HistoricalDiscrepancyReport | null;
};

export type DashboardSummary = {
  metrics: {
    active_sites: number;
    students: number;
    pending_expenses: number;
    open_balance: number;
    total_income: number;
    approved_expenses: number;
    utility: number;
    pending_payment_total: number;
    requested_discounts: number;
    students_with_debt: number;
    attendance_with_debt: number;
    ticket_average: {
      amount: number;
      total: number;
      payer_count: number;
      month_key: string;
      month_label: string;
    };
  };
  site_rows: Array<{
    id: number;
    name: string;
    address?: string;
    latitude?: string | null;
    longitude?: string | null;
    is_active: boolean;
    students: number;
    payments: number;
    expenses: number;
    balance: number;
    attendance: number;
    utility: number;
  }>;
  method_rows: Array<{ label: string; value: number }>;
  student_status_rows: Array<{ label: string; value: number }>;
  payment_status_rows: Array<{ label: string; value: number }>;
  monthly_rows: Array<{ site_id: string; site_name: string; month: string; label: string; ingresos: number; egresos: number; utilidad: number }>;
  category_rows: Array<{ site_id: string; month: string; type: "Ingreso" | "Egreso"; label: string; amount: number; count: number }>;
  alerts: Array<{ id: string | number; title: string; subtitle: string }>;
};

export type TabKey = "dashboard" | "adult-dashboard" | "calendar" | "sports" | "tournaments" | "coaches" | "referees" | "uniforms" | "debts" | "sales-estimate" | "income-statement" | "daily-operation" | "attendance" | "unknowns" | "billing" | "expenses" | "students" | "guardians" | "sites" | "users" | "invoices" | "historical" | "discrepancies";

export type AccountingSiteRow = {
  id: number;
  label: string;
  ingresos: number;
  egresos: number;
  utilidad: number;
  pendiente: number;
};

