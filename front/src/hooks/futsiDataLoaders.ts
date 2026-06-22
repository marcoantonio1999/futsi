import { ApiError, apiRequest } from "../api";
import { emptyData } from "../appState";
import type {
  AppData,
  AttendanceRecord,
  AttendanceSession,
  CashMovement,
  Charge,
  CoachWorkLog,
  DashboardSummary,
  Discount,
  Expense,
  Guardian,
  HistoricalDiscrepancyReport,
  HistoricalImport,
  Invoice,
  Match,
  Payment,
  Player,
  PlayerAttendanceRecord,
  Site,
  StandingRow,
  StaffPaymentRequest,
  Student,
  StudentAssessment,
  StudentTournamentRegistration,
  TabKey,
  Team,
  Tournament,
  User,
} from "../types";

export type AppDataPatch = Partial<AppData>;

function optionalApi<T>(path: string, authToken: string, fallback: T): Promise<T> {
  return apiRequest<T>(path, authToken).catch((err) => {
    if (err instanceof ApiError && err.status === 404) return fallback;
    throw err;
  });
}

export function mergeAppData(current: AppData, patch: AppDataPatch): AppData {
  return { ...current, ...patch };
}

export function initialTabForUser(user: User): TabKey {
  if (user.role === "cashier") return "billing";
  if (user.role === "adult_representative" || user.role === "adult_player") return "adult-dashboard";
  if (user.role === "guardian") return "sports";
  return "dashboard";
}

async function loadDashboardData(authToken: string, user: User): Promise<AppDataPatch> {
  const [dashboardSummary, sites] = await Promise.all([
    apiRequest<DashboardSummary>("/dashboard/summary/", authToken),
    apiRequest<Site[]>("/sites/", authToken),
  ]);
  return { dashboardSummary, sites };
}

export async function loadSectionData(authToken: string, user: User, tab: TabKey): Promise<AppDataPatch> {
  if (tab === "dashboard") return loadDashboardData(authToken, user);

  if (tab === "adult-dashboard") {
    const [sites, attendanceSessions, charges, payments, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords, invoices] = await Promise.all([
      apiRequest<Site[]>("/sites/", authToken),
      apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
      apiRequest<Charge[]>("/charges/", authToken),
      apiRequest<Payment[]>("/payments/", authToken),
      apiRequest<Tournament[]>("/tournaments/", authToken),
      apiRequest<Team[]>("/teams/", authToken),
      apiRequest<StudentTournamentRegistration[]>("/student-tournament-registrations/", authToken),
      apiRequest<Player[]>("/players/", authToken),
      apiRequest<Match[]>("/matches/", authToken),
      apiRequest<StandingRow[]>("/matches/standings/", authToken),
      apiRequest<PlayerAttendanceRecord[]>("/player-attendance-records/", authToken),
      apiRequest<Invoice[]>("/invoices/", authToken),
    ]);
    return { sites, attendanceSessions, charges, payments, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords, invoices };
  }

  if (tab === "calendar" || tab === "attendance") {
    const [sites, students, attendanceSessions, attendanceRecords, charges, payments, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords] = await Promise.all([
      apiRequest<Site[]>("/sites/", authToken),
      apiRequest<Student[]>("/students/", authToken),
      apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
      apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
      apiRequest<Charge[]>("/charges/", authToken),
      apiRequest<Payment[]>("/payments/", authToken),
      apiRequest<Tournament[]>("/tournaments/", authToken),
      apiRequest<Team[]>("/teams/", authToken),
      apiRequest<StudentTournamentRegistration[]>("/student-tournament-registrations/", authToken),
      apiRequest<Player[]>("/players/", authToken),
      apiRequest<Match[]>("/matches/", authToken),
      apiRequest<StandingRow[]>("/matches/standings/", authToken),
      apiRequest<PlayerAttendanceRecord[]>("/player-attendance-records/", authToken),
    ]);
    return { sites, students, attendanceSessions, attendanceRecords, charges, payments, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords };
  }

  if (tab === "sports" || tab === "tournaments") {
    const [sites, students, tournaments, teams, studentTournamentRegistrations, players, matches, standings, attendanceSessions, attendanceRecords, playerAttendanceRecords, studentAssessments] = await Promise.all([
      apiRequest<Site[]>("/sites/", authToken),
      apiRequest<Student[]>("/students/", authToken),
      apiRequest<Tournament[]>("/tournaments/", authToken),
      apiRequest<Team[]>("/teams/", authToken),
      apiRequest<StudentTournamentRegistration[]>("/student-tournament-registrations/", authToken),
      apiRequest<Player[]>("/players/", authToken),
      apiRequest<Match[]>("/matches/", authToken),
      apiRequest<StandingRow[]>("/matches/standings/", authToken),
      apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
      apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
      apiRequest<PlayerAttendanceRecord[]>("/player-attendance-records/", authToken),
      apiRequest<StudentAssessment[]>("/student-assessments/", authToken),
    ]);
    return { sites, students, tournaments, teams, studentTournamentRegistrations, players, matches, standings, attendanceSessions, attendanceRecords, playerAttendanceRecords, studentAssessments };
  }

  if (tab === "billing" || tab === "debts") {
    const [sites, guardians, students, charges, payments, discounts, tournaments, teams, studentTournamentRegistrations, players] = await Promise.all([
      apiRequest<Site[]>("/sites/", authToken),
      user.role === "cashier" ? Promise.resolve<Guardian[]>([]) : apiRequest<Guardian[]>("/guardians/", authToken),
      apiRequest<Student[]>("/students/", authToken),
      apiRequest<Charge[]>("/charges/", authToken),
      apiRequest<Payment[]>("/payments/", authToken),
      apiRequest<Discount[]>("/discounts/", authToken),
      apiRequest<Tournament[]>("/tournaments/", authToken),
      apiRequest<Team[]>("/teams/", authToken),
      apiRequest<StudentTournamentRegistration[]>("/student-tournament-registrations/", authToken),
      apiRequest<Player[]>("/players/", authToken),
    ]);
    return { sites, guardians, students, charges, payments, discounts, tournaments, teams, studentTournamentRegistrations, players };
  }

  if (tab === "expenses" || tab === "income-statement" || tab === "daily-operation" || tab === "sales-estimate" || tab === "referees" || tab === "coaches") {
    const [sites, expenses, staffPaymentRequests, cashMovements, coachWorkLogs, charges, payments, discounts, tournaments, teams, players, matches] = await Promise.all([
      apiRequest<Site[]>("/sites/", authToken),
      apiRequest<Expense[]>("/expenses/", authToken),
      optionalApi<StaffPaymentRequest[]>("/staff-payment-requests/", authToken, []),
      optionalApi<CashMovement[]>("/cash-movements/", authToken, []),
      apiRequest<CoachWorkLog[]>("/coach-work-logs/", authToken).catch(() => []),
      apiRequest<Charge[]>("/charges/", authToken),
      apiRequest<Payment[]>("/payments/", authToken),
      apiRequest<Discount[]>("/discounts/", authToken),
      apiRequest<Tournament[]>("/tournaments/", authToken),
      apiRequest<Team[]>("/teams/", authToken),
      apiRequest<Player[]>("/players/", authToken),
      apiRequest<Match[]>("/matches/", authToken),
    ]);
    return { sites, expenses, staffPaymentRequests, cashMovements, coachWorkLogs, charges, payments, discounts, tournaments, teams, players, matches };
  }

  if (tab === "students" || tab === "uniforms") {
    const [sites, guardians, students, charges, payments, discounts] = await Promise.all([
      apiRequest<Site[]>("/sites/", authToken),
      apiRequest<Guardian[]>("/guardians/", authToken),
      apiRequest<Student[]>("/students/", authToken),
      apiRequest<Charge[]>("/charges/", authToken),
      apiRequest<Payment[]>("/payments/", authToken),
      apiRequest<Discount[]>("/discounts/", authToken),
    ]);
    return { sites, guardians, students, charges, payments, discounts };
  }

  if (tab === "guardians") {
    const [guardians, students] = await Promise.all([
      apiRequest<Guardian[]>("/guardians/", authToken),
      apiRequest<Student[]>("/students/", authToken),
    ]);
    return { guardians, students };
  }

  if (tab === "sites") return { sites: await apiRequest<Site[]>("/sites/", authToken) };
  if (tab === "users") return { users: await apiRequest<User[]>("/users/", authToken) };
  if (tab === "invoices") return { invoices: await apiRequest<Invoice[]>("/invoices/", authToken) };
  if (tab === "historical") return { historicalImports: await apiRequest<HistoricalImport[]>("/historical-imports/", authToken) };
  if (tab === "discrepancies") return { historicalDiscrepancies: await apiRequest<HistoricalDiscrepancyReport>("/historical-imports/discrepancies/", authToken) };
  return {};
}

export async function loadAppDataForUser(authToken: string): Promise<{ user: User; data: AppData; initialSection: TabKey }> {
  const user = await apiRequest<User>("/auth/me/", authToken);

  const initialSection = initialTabForUser(user);
  if (user.role === "guardian") {
    const [students, attendanceRecords, charges, payments, discounts, invoices, tournaments, matches, standings, studentAssessments, studentTournamentRegistrations] = await Promise.all([
      apiRequest<Student[]>("/students/", authToken),
      apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
      apiRequest<Charge[]>("/charges/", authToken),
      apiRequest<Payment[]>("/payments/", authToken),
      apiRequest<Discount[]>("/discounts/", authToken),
      apiRequest<Invoice[]>("/invoices/", authToken),
      apiRequest<Tournament[]>("/tournaments/", authToken),
      apiRequest<Match[]>("/matches/", authToken),
      apiRequest<StandingRow[]>("/matches/standings/", authToken),
      apiRequest<StudentAssessment[]>("/student-assessments/", authToken),
      apiRequest<StudentTournamentRegistration[]>("/student-tournament-registrations/", authToken),
    ]);
    return { user, initialSection, data: { ...emptyData, students, attendanceRecords, charges, payments, discounts, invoices, tournaments, matches, standings, studentAssessments, studentTournamentRegistrations } };
  }

  if (user.role === "accounting") {
    const [
      sites,
      guardians,
      students,
      attendanceSessions,
      attendanceRecords,
      charges,
      payments,
      discounts,
      expenses,
      staffPaymentRequests,
      cashMovements,
      invoices,
      historicalImports,
      historicalDiscrepancies,
      tournaments,
      teams,
      studentTournamentRegistrations,
      players,
      matches,
      standings,
      playerAttendanceRecords,
    ] = await Promise.all([
      apiRequest<Site[]>("/sites/", authToken),
      apiRequest<Guardian[]>("/guardians/", authToken),
      apiRequest<Student[]>("/students/", authToken),
      apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
      apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
      apiRequest<Charge[]>("/charges/", authToken),
      apiRequest<Payment[]>("/payments/", authToken),
      apiRequest<Discount[]>("/discounts/", authToken),
      apiRequest<Expense[]>("/expenses/", authToken),
      optionalApi<StaffPaymentRequest[]>("/staff-payment-requests/", authToken, []),
      optionalApi<CashMovement[]>("/cash-movements/", authToken, []),
      apiRequest<Invoice[]>("/invoices/", authToken),
      apiRequest<HistoricalImport[]>("/historical-imports/", authToken),
      apiRequest<HistoricalDiscrepancyReport>("/historical-imports/discrepancies/", authToken),
      apiRequest<Tournament[]>("/tournaments/", authToken),
      apiRequest<Team[]>("/teams/", authToken),
      apiRequest<StudentTournamentRegistration[]>("/student-tournament-registrations/", authToken),
      apiRequest<Player[]>("/players/", authToken),
      apiRequest<Match[]>("/matches/", authToken),
      apiRequest<StandingRow[]>("/matches/standings/", authToken),
      apiRequest<PlayerAttendanceRecord[]>("/player-attendance-records/", authToken),
    ]);
    return {
      user,
      initialSection,
      data: { ...emptyData, sites, guardians, students, attendanceSessions, attendanceRecords, charges, payments, discounts, expenses, staffPaymentRequests, cashMovements, invoices, historicalImports, historicalDiscrepancies, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords },
    };
  }

  return {
    user,
    initialSection,
    data: mergeAppData(emptyData, await loadSectionData(authToken, user, initialSection)),
  };
}
