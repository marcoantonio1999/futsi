import type { AppData, Role, StudentStatus } from "./types";

export const roleLabels: Record<Role, string> = {
  admin: "Administrador",
  dev: "Dev App",
  accounting: "Contador",
  owner: "Direccion",
  site_coordinator: "Coordinador",
  cashier: "Cajero",
  coach: "Coach",
  guardian: "Representante",
  adult_representative: "Representante adulto",
  adult_player: "Jugador adulto",
};

export const statusLabels: Record<StudentStatus, string> = {
  active: "Activo",
  trial: "Prueba",
  paused: "Pausa",
  injured: "Lesion",
  dropped: "Baja",
};

export const emptyData: AppData = {
  users: [],
  sites: [],
  guardians: [],
  students: [],
  attendanceSessions: [],
  attendanceRecords: [],
  charges: [],
  payments: [],
  discounts: [],
  expenses: [],
  staffPaymentRequests: [],
  cashMovements: [],
  coachWorkLogs: [],
  tournaments: [],
  teams: [],
  studentTournamentRegistrations: [],
  players: [],
  matches: [],
  standings: [],
  playerAttendanceRecords: [],
  studentAssessments: [],
  studentValueAssessments: [],
  invoices: [],
  historicalImports: [],
  historicalDiscrepancies: null,
};

