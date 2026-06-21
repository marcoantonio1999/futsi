import type { User, Site, Guardian } from "./auth";
import type { Student, AttendanceSession, AttendanceRecord } from "./academy";
import type { Tournament, Team, StudentTournamentRegistration, Player, Match, StandingRow, StudentAssessment, StudentValueAssessment, PlayerAttendanceRecord } from "./sports";
import type { Charge, Payment, Discount, Expense, StaffPaymentRequest, CashMovement, CoachWorkLog, Invoice } from "./finance";
import type { HistoricalImport, HistoricalDiscrepancyReport } from "./historical";


export type AppData = {
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

export type TabKey = "dashboard" | "adult-dashboard" | "calendar" | "sports" | "values" | "tournaments" | "coaches" | "referees" | "uniforms" | "debts" | "sales-estimate" | "income-statement" | "daily-operation" | "attendance" | "billing" | "expenses" | "students" | "guardians" | "sites" | "users" | "invoices" | "historical" | "discrepancies";

export type AccountingSiteRow = {
  id: number;
  label: string;
  ingresos: number;
  egresos: number;
  utilidad: number;
  pendiente: number;
};

