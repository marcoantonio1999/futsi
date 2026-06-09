import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Camera,
  Check,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  Lock,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Upload,
  Shield,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { Metric } from "../cards/Metric";
import { CollectionFunnel } from "../charts/CollectionFunnel";
import { FinancialAxisChart } from "../charts/FinancialAxisChart";
import { FinancialComboChart } from "../charts/FinancialComboChart";
import { PaymentMethodDonut } from "../charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../charts/PendingBySiteChart";
import { StudentStatusDonut } from "../charts/StudentStatusDonut";
import { API_URL } from "../../api";
import { roleLabels, statusLabels } from "../../appState";
import { money } from "../../utils/format";
import type { AccountingSiteRow, AppData, AttendanceRecord, AttendanceSession, CashMovementType, Charge, ChargeStatus, Discount, Expense, ExpenseStatus, FaceRecognitionResponse, Guardian, HistoricalDiscrepancyReport, HistoricalImport, Invoice, Match, Payment, PaymentMethod, PaymentStatus, Player, PlayerAttendanceRecord, Role, Site, StaffPaymentKind, StaffPaymentRequest, StaffPaymentStatus, StandingRow, Student, StudentAssessment, Team, ThemeMode, User } from "../../types";

import {
  Avatar,
  AttendanceButton,
  FaceAttendanceCard,
  InfoChip,
  InvoiceGenerator,
  InvoiceRows,
  SelectInput,
  SimpleList,
  StaffPaymentInbox,
  StatusPill,
  TableHeader,
  TextInput,
  average,
  calculateCashBySite,
  calculateMonthlyTicketAverage,
  chargeLabel,
  chargeStatusLabel,
  collectionProgress,
  dateDay,
  dateMonthKey,
  expenseStatusLabel,
  exportAccountingWorkbook,
  cashMovementLabel,
  methodLabel,
  monthLabelFromKey,
  normalizeText,
  paymentMethodLabel,
  paymentMonthKey,
  paymentPayerKey,
  paymentStatusLabel,
  staffPaymentKindLabel,
  staffPaymentStatusLabel,
  sumAccountingRows,
} from "./shared";


import { MatchScoreCard, StudentStatsCard, AssessmentForm } from "./sportsDetails";

export function SportsPanel({
  data,
  canEditMatches,
  canEditAssessments,
  onUpdateMatch,
  onSaveAssessment,
}: {
  data: AppData;
  canEditMatches: boolean;
  canEditAssessments: boolean;
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
  onSaveAssessment: (payload: unknown) => Promise<void>;
}) {
  const activeTournament = data.tournaments.find((tournament) => tournament.is_active) ?? data.tournaments[0] ?? null;
  const matches = data.matches.filter((match) => !activeTournament || match.tournament === activeTournament.id);
  const standings = data.standings.filter((row) => !activeTournament || row.tournament === activeTournament.id);
  const liveMatches = matches.filter((match) => match.status === "live" || match.status === "scheduled").slice(0, 4);
  const selectedAssessment = data.studentAssessments[0] ?? null;
  const assessedStudentIds = new Set(data.studentAssessments.map((assessment) => assessment.student));
  const assessmentCoverage = data.students.length ? Math.round((assessedStudentIds.size / data.students.length) * 100) : 0;

  return (
    <section className="grid min-w-0 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="grid min-w-0 gap-5">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase text-emerald-700">Tabla de posiciones</p>
              <h2 className="font-semibold">{activeTournament?.name || "Torneo activo"}</h2>
              <p className="mt-1 text-sm text-zinc-500">Se recalcula con marcadores en vivo/finalizados. Orden: puntos, diferencia de goles y goles a favor.</p>
            </div>
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">Actualiza cada 12s</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Pos</th>
                  <th className="px-4 py-3">Equipo</th>
                  <th className="px-4 py-3">PJ</th>
                  <th className="px-4 py-3">G</th>
                  <th className="px-4 py-3">E</th>
                  <th className="px-4 py-3">P</th>
                  <th className="px-4 py-3">GF</th>
                  <th className="px-4 py-3">GC</th>
                  <th className="px-4 py-3">DG</th>
                  <th className="px-4 py-3">Pts</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, index) => (
                  <tr
                    key={row.team}
                    className={`border-b border-zinc-100 transition-all duration-500 ${row.is_leader ? "bg-emerald-50" : "bg-white"}`}
                    style={{ transform: `translateY(${Math.min(index, 6) * 0}px)` }}
                  >
                    <td className="px-4 py-3">
                      <span className={`inline-flex size-8 items-center justify-center rounded-full text-sm font-semibold ${row.is_leader ? "bg-emerald-700 text-white" : "bg-zinc-100 text-zinc-700"}`}>
                        {row.position}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {row.team_name}
                      {row.is_leader && <span className="ml-2 rounded-md bg-emerald-700 px-2 py-1 text-xs text-white">Lider</span>}
                    </td>
                    <td className="px-4 py-3">{row.played}</td>
                    <td className="px-4 py-3">{row.won}</td>
                    <td className="px-4 py-3">{row.drawn}</td>
                    <td className="px-4 py-3">{row.lost}</td>
                    <td className="px-4 py-3">{row.goals_for}</td>
                    <td className="px-4 py-3">{row.goals_against}</td>
                    <td className={`px-4 py-3 font-semibold ${row.goal_difference >= 0 ? "text-emerald-700" : "text-red-700"}`}>{row.goal_difference > 0 ? "+" : ""}{row.goal_difference}</td>
                    <td className="px-4 py-3 text-lg font-bold">{row.points}</td>
                  </tr>
                ))}
                {standings.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-zinc-500">No hay partidos con marcador para calcular posiciones.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Marcadores en vivo" count={liveMatches.length} />
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {liveMatches.map((match) => (
              <MatchScoreCard key={match.id} match={match} canEdit={canEditMatches} onUpdateMatch={onUpdateMatch} />
            ))}
            {liveMatches.length === 0 && <p className="text-sm text-zinc-500">No hay partidos activos.</p>}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-5">
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <Metric label="Evaluaciones" value={data.studentAssessments.length} helper={`${assessmentCoverage}% del grupo con stats`} />
          <Metric label="Rating promedio" value={data.studentAssessments.length ? Math.round(data.studentAssessments.reduce((sum, item) => sum + Number(item.overall_rating || 0), 0) / data.studentAssessments.length) : 0} />
          <Metric label="Partidos activos" value={matches.filter((match) => match.status === "live").length} />
        </div>

        <StudentStatsCard assessment={selectedAssessment} />

        {canEditAssessments && (
          <AssessmentForm students={data.students} assessments={data.studentAssessments} onSaveAssessment={onSaveAssessment} />
        )}
      </div>
    </section>
  );
}
