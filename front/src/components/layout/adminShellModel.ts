import type { AppData, TabKey } from "../../types";
import { tabItems } from "./adminNavigation";

export type AttendanceSubsection = "general" | "manual" | "automatic" | "report" | "occupancy" | "unknown" | "unknown-detail";
export type BillingSubsection = "program" | "scheduled";
export type StudentsSubsection = "create" | "registered";
export type BusinessScope = "academy" | "adult";
export type SidebarTab = ReturnType<typeof tabItems>[number];

export const academyMenuTabs: TabKey[] = [
  "dashboard",
  "calendar",
  "sports",
  "tournaments",
  "coaches",
  "uniforms",
  "attendance",
  "unknowns",
  "billing",
  "debts",
  "expenses",
  "students",
  "guardians",
  "sites",
  "users",
  "invoices",
  "historical",
  "discrepancies",
];

export const adultMenuTabs: TabKey[] = [
  "adult-dashboard",
  "calendar",
  "tournaments",
  "attendance",
  "unknowns",
  "billing",
  "debts",
  "expenses",
  "referees",
  "invoices",
  "sites",
  "users",
];

export const adultTabLabels: Partial<Record<TabKey, string>> = {
  "adult-dashboard": "Dashboard adultos",
  calendar: "Calendario adultos",
  tournaments: "Torneos adultos",
  attendance: "Asistencia adultos",
  unknowns: "Desconocidos",
  billing: "Cobranza adultos",
  debts: "Adeudos adultos",
  expenses: "Gastos adultos",
  referees: "Arbitros",
  invoices: "Facturas adultos",
};

export const academyDefaultTab: TabKey = "dashboard";
export const adultDefaultTab: TabKey = "adult-dashboard";
export const desktopSidebarAutoCollapseMs = 30000;
export const desktopSidebarOpenEdgePx = 28;
export const desktopSidebarNearPx = 28;

export type ShellTone = {
  appName: string;
  subtitle: string;
  activeClass: string;
  indicatorClass: string;
  hoverClass: string;
  menuTitle: string;
  demoCard: string;
  refreshButton: string;
};

export function shellToneForScope(scope: BusinessScope): ShellTone {
  return scope === "adult"
    ? {
        appName: "Liga adultos",
        subtitle: "Sistema de torneos adultos",
        activeClass: "bg-blue-50 text-blue-800",
        indicatorClass: "bg-blue-700",
        hoverClass: "hover:bg-blue-50",
        menuTitle: "Liga adultos",
        demoCard: "border border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-50",
        refreshButton: "bg-blue-700 text-white hover:bg-blue-800 dark:bg-white/15 dark:text-white dark:hover:bg-white/20",
      }
    : {
        appName: "Futsi",
        subtitle: "Mini ERP operativo",
        activeClass: "bg-emerald-50 text-emerald-800",
        indicatorClass: "bg-emerald-700",
        hoverClass: "hover:bg-zinc-50",
        menuTitle: "Academia",
        demoCard: "border border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-50",
        refreshButton: "bg-emerald-600 text-white hover:bg-emerald-700",
      };
}

export function adultLeagueData(data: AppData): AppData {
  const preferredTournament = data.tournaments.find((tournament) => tournament.name.trim().toLocaleLowerCase("es-MX") === "brasileÃ±a") ?? null;
  const playerTeamIds = new Set(data.players.map((player) => player.team));
  const adultTournamentIds = preferredTournament
    ? new Set([preferredTournament.id])
    : new Set(data.teams.filter((team) => playerTeamIds.has(team.id)).map((team) => team.tournament));
  const adultTeamIds = new Set(data.teams.filter((team) => adultTournamentIds.has(team.tournament)).map((team) => team.id));
  const adultChargeIds = new Set(data.charges.filter((charge) => charge.team && adultTeamIds.has(charge.team)).map((charge) => charge.id));
  const adultPaymentIds = new Set(data.payments.filter((payment) => payment.charge && adultChargeIds.has(payment.charge)).map((payment) => payment.id));
  const adultSessionIds = new Set(data.attendanceSessions.filter((session) => session.team && adultTeamIds.has(session.team)).map((session) => session.id));
  const adultStaffPaymentIds = new Set(data.staffPaymentRequests.filter((request) => request.kind === "referee_payroll").map((request) => request.id));

  return {
    ...data,
    users: data.users.filter((item) => item.role === "adult_player" || item.role === "adult_representative"),
    guardians: [],
    students: [],
    attendanceSessions: data.attendanceSessions.filter((session) => adultSessionIds.has(session.id)),
    attendanceRecords: [],
    charges: data.charges.filter((charge) => adultChargeIds.has(charge.id)),
    payments: data.payments.filter((payment) => adultPaymentIds.has(payment.id)),
    discounts: data.discounts.filter((discount) => Boolean(discount.charge && adultChargeIds.has(discount.charge))),
    expenses: data.expenses.filter((expense) => {
      const category = expense.category.toLowerCase();
      const description = expense.description.toLowerCase();
      return category.includes("arbit") || description.includes("arbit") || category.includes("referee") || description.includes("referee");
    }),
    staffPaymentRequests: data.staffPaymentRequests.filter((request) => adultStaffPaymentIds.has(request.id)),
    cashMovements: data.cashMovements.filter((movement) => Boolean(movement.staff_payment_request && adultStaffPaymentIds.has(movement.staff_payment_request))),
    coachWorkLogs: [],
    tournaments: data.tournaments.filter((tournament) => adultTournamentIds.has(tournament.id)),
    teams: data.teams.filter((team) => adultTeamIds.has(team.id)),
    studentTournamentRegistrations: [],
    players: data.players.filter((player) => adultTeamIds.has(player.team)),
    matches: data.matches.filter((match) => adultTournamentIds.has(match.tournament)),
    standings: data.standings.filter((row) => adultTournamentIds.has(row.tournament)),
    playerAttendanceRecords: data.playerAttendanceRecords.filter((record) => adultSessionIds.has(record.session)),
    studentAssessments: [],
    studentValueAssessments: [],
    invoices: data.invoices.filter((invoice) => {
      if (invoice.charge && adultChargeIds.has(invoice.charge)) return true;
      if (invoice.payment && adultPaymentIds.has(invoice.payment)) return true;
      return false;
    }),
  };
}

export function academyData(data: AppData): AppData {
  const preferredTournament = data.tournaments.find((tournament) => tournament.name.trim().toLocaleLowerCase("es-MX").includes("brasile")) ?? null;
  const playerTeamIds = new Set(data.players.map((player) => player.team));
  const adultTournamentIds = preferredTournament
    ? new Set([preferredTournament.id])
    : new Set(data.teams.filter((team) => playerTeamIds.has(team.id)).map((team) => team.tournament));
  const adultTeamIds = new Set(data.teams.filter((team) => adultTournamentIds.has(team.tournament)).map((team) => team.id));
  const adultMatchIds = new Set(data.matches.filter((match) => adultTournamentIds.has(match.tournament)).map((match) => match.id));
  const adultChargeIds = new Set(data.charges.filter((charge) => charge.team && adultTeamIds.has(charge.team)).map((charge) => charge.id));
  const adultPaymentIds = new Set(data.payments.filter((payment) => payment.charge && adultChargeIds.has(payment.charge)).map((payment) => payment.id));
  const adultSessionIds = new Set(
    data.attendanceSessions
      .filter((session) => (session.team && adultTeamIds.has(session.team)) || (session.match && adultMatchIds.has(session.match)))
      .map((session) => session.id),
  );
  const adultStaffPaymentIds = new Set(data.staffPaymentRequests.filter((request) => request.kind === "referee_payroll").map((request) => request.id));
  const adultInvoiceIds = new Set(
    data.invoices
      .filter((invoice) => {
        if (invoice.charge && adultChargeIds.has(invoice.charge)) return true;
        if (invoice.payment && adultPaymentIds.has(invoice.payment)) return true;
        return false;
      })
      .map((invoice) => invoice.id),
  );

  return {
    ...data,
    users: data.users.filter((item) => item.role !== "adult_player" && item.role !== "adult_representative"),
    attendanceSessions: data.attendanceSessions.filter((session) => !adultSessionIds.has(session.id)),
    charges: data.charges.filter((charge) => !adultChargeIds.has(charge.id)),
    payments: data.payments.filter((payment) => !adultPaymentIds.has(payment.id)),
    discounts: data.discounts.filter((discount) => !discount.charge || !adultChargeIds.has(discount.charge)),
    staffPaymentRequests: data.staffPaymentRequests.filter((request) => !adultStaffPaymentIds.has(request.id)),
    cashMovements: data.cashMovements.filter((movement) => !movement.staff_payment_request || !adultStaffPaymentIds.has(movement.staff_payment_request)),
    tournaments: data.tournaments.filter((tournament) => !adultTournamentIds.has(tournament.id)),
    teams: data.teams.filter((team) => !adultTeamIds.has(team.id)),
    studentTournamentRegistrations: data.studentTournamentRegistrations.filter((registration) => !adultTournamentIds.has(registration.tournament) && (!registration.team || !adultTeamIds.has(registration.team))),
    players: data.players.filter((player) => !adultTeamIds.has(player.team)),
    matches: data.matches.filter((match) => !adultMatchIds.has(match.id)),
    standings: data.standings.filter((row) => !adultTournamentIds.has(row.tournament)),
    playerAttendanceRecords: data.playerAttendanceRecords.filter((record) => !adultSessionIds.has(record.session)),
    invoices: data.invoices.filter((invoice) => !adultInvoiceIds.has(invoice.id)),
  };
}
