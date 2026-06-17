import { ApiError, apiRequest } from "../api";
import { emptyData } from "../appState";
import type {
  AppData,
  AttendanceRecord,
  AttendanceSession,
  CashMovement,
  Charge,
  CoachWorkLog,
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
  StudentValueAssessment,
  StudentTournamentRegistration,
  Team,
  Tournament,
  User,
} from "../types";

function optionalApi<T>(path: string, authToken: string, fallback: T): Promise<T> {
  return apiRequest<T>(path, authToken).catch((err) => {
    if (err instanceof ApiError && err.status === 404) return fallback;
    throw err;
  });
}

export async function loadAppDataForUser(authToken: string): Promise<{ user: User; data: AppData }> {
  const me = await apiRequest<User>("/auth/me/", authToken);
  await apiRequest("/charges/generate-scheduled/", authToken, { method: "POST" }).catch(() => undefined);

  if (me.role === "guardian") {
    const [students, attendanceRecords, charges, payments, discounts, invoices, tournaments, matches, standings, studentAssessments, studentValueAssessments, studentTournamentRegistrations] = await Promise.all([
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
      apiRequest<StudentValueAssessment[]>("/student-value-assessments/", authToken),
      apiRequest<StudentTournamentRegistration[]>("/student-tournament-registrations/", authToken),
    ]);
    return {
      user: me,
      data: {
        ...emptyData,
        students,
        attendanceRecords,
        charges,
        payments,
        discounts,
        invoices,
        tournaments,
        matches,
        standings,
        studentAssessments,
        studentValueAssessments,
        studentTournamentRegistrations,
      },
    };
  }

  if (me.role === "cashier") {
    const [sites, students, attendanceSessions, attendanceRecords, charges, payments, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords, staffPaymentRequests, cashMovements] = await Promise.all([
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
      optionalApi<StaffPaymentRequest[]>("/staff-payment-requests/?mine=1", authToken, []),
      optionalApi<CashMovement[]>("/cash-movements/", authToken, []),
    ]);
    return {
      user: me,
      data: {
        ...emptyData,
        sites,
        students,
        attendanceSessions,
        attendanceRecords,
        charges,
        payments,
        tournaments,
        teams,
        studentTournamentRegistrations,
        players,
        matches,
        standings,
        playerAttendanceRecords,
        staffPaymentRequests,
        cashMovements,
      },
    };
  }

  if (me.role === "adult_representative" || me.role === "adult_player") {
    const [sites, attendanceSessions, charges, payments, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords] = await Promise.all([
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
    ]);
    return { user: me, data: { ...emptyData, sites, attendanceSessions, charges, payments, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords } };
  }

  if (me.role === "coach") {
    const [sites, students, attendanceSessions, attendanceRecords, coachWorkLogs, invoices, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords, studentAssessments, studentValueAssessments, staffPaymentRequests] = await Promise.all([
      apiRequest<Site[]>("/sites/", authToken),
      apiRequest<Student[]>("/students/", authToken),
      apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
      apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
      apiRequest<CoachWorkLog[]>("/coach-work-logs/", authToken),
      apiRequest<Invoice[]>("/invoices/", authToken),
      apiRequest<Tournament[]>("/tournaments/", authToken),
      apiRequest<Team[]>("/teams/", authToken),
      apiRequest<StudentTournamentRegistration[]>("/student-tournament-registrations/", authToken),
      apiRequest<Player[]>("/players/", authToken),
      apiRequest<Match[]>("/matches/", authToken),
      apiRequest<StandingRow[]>("/matches/standings/", authToken),
      apiRequest<PlayerAttendanceRecord[]>("/player-attendance-records/", authToken),
      apiRequest<StudentAssessment[]>("/student-assessments/", authToken),
      apiRequest<StudentValueAssessment[]>("/student-value-assessments/", authToken),
      optionalApi<StaffPaymentRequest[]>("/staff-payment-requests/?mine=1", authToken, []),
    ]);
    return { user: me, data: { ...emptyData, sites, students, attendanceSessions, attendanceRecords, coachWorkLogs, invoices, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords, studentAssessments, studentValueAssessments, staffPaymentRequests } };
  }

  const [sites, guardians, students, attendanceSessions, attendanceRecords, charges, payments, discounts, expenses, staffPaymentRequests, cashMovements, coachWorkLogs, users, invoices, historicalImports, historicalDiscrepancies, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords, studentAssessments, studentValueAssessments] = await Promise.all([
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
    apiRequest<CoachWorkLog[]>("/coach-work-logs/", authToken).catch(() => []),
    me.role === "admin" || me.role === "owner" || me.role === "dev" ? apiRequest<User[]>("/users/", authToken) : Promise.resolve([]),
    apiRequest<Invoice[]>("/invoices/", authToken),
    me.role === "admin" || me.role === "owner" || me.role === "dev" || me.role === "accounting" ? apiRequest<HistoricalImport[]>("/historical-imports/", authToken) : Promise.resolve([]),
    me.role === "admin" || me.role === "owner" || me.role === "dev" || me.role === "accounting" ? apiRequest<HistoricalDiscrepancyReport>("/historical-imports/discrepancies/", authToken) : Promise.resolve(null),
    apiRequest<Tournament[]>("/tournaments/", authToken),
    apiRequest<Team[]>("/teams/", authToken),
    apiRequest<StudentTournamentRegistration[]>("/student-tournament-registrations/", authToken),
    apiRequest<Player[]>("/players/", authToken),
    apiRequest<Match[]>("/matches/", authToken),
    apiRequest<StandingRow[]>("/matches/standings/", authToken),
    apiRequest<PlayerAttendanceRecord[]>("/player-attendance-records/", authToken),
    apiRequest<StudentAssessment[]>("/student-assessments/", authToken),
    apiRequest<StudentValueAssessment[]>("/student-value-assessments/", authToken),
  ]);
  return { user: me, data: { sites, guardians, students, attendanceSessions, attendanceRecords, charges, payments, discounts, expenses, staffPaymentRequests, cashMovements, users, coachWorkLogs, tournaments, teams, studentTournamentRegistrations, players, matches, standings, playerAttendanceRecords, studentAssessments, studentValueAssessments, invoices, historicalImports, historicalDiscrepancies } };
}
