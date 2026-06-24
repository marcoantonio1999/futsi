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
import { ChartHelp } from "../charts/ChartHelp";
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


function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function durationFromRange(startsAt: string, endsAt: string) {
  const starts = minutesFromTime(startsAt);
  const ends = minutesFromTime(endsAt);
  if (starts === null || ends === null) return 120;
  const normalizedEnd = ends <= starts ? ends + 24 * 60 : ends;
  return Math.max(1, normalizedEnd - starts);
}

function addMinutesToTime(value: string | null, minutes: number) {
  if (!value) return "";
  const starts = minutesFromTime(value.slice(0, 5));
  if (starts === null) return "";
  const total = (starts + Math.max(1, minutes || 120)) % (24 * 60);
  const hours = Math.floor(total / 60).toString().padStart(2, "0");
  const mins = (total % 60).toString().padStart(2, "0");
  return `${hours}:${mins}`;
}

export function MatchScoreCard({ match, canEdit, onUpdateMatch }: { match: Match; canEdit: boolean; onUpdateMatch: (matchId: number, payload: unknown) => Promise<void> }) {
  const [homeGoals, setHomeGoals] = useState(String(match.home_goals));
  const [awayGoals, setAwayGoals] = useState(String(match.away_goals));
  const [playedOn, setPlayedOn] = useState(match.played_on);
  const [startsAt, setStartsAt] = useState(match.starts_at?.slice(0, 5) || "");
  const [endsAt, setEndsAt] = useState(addMinutesToTime(match.starts_at, match.duration_minutes || 120));
  const [status, setStatus] = useState(match.status);
  const durationMinutes = startsAt && endsAt ? durationFromRange(startsAt, endsAt) : match.duration_minutes || 120;

  useEffect(() => {
    setHomeGoals(String(match.home_goals));
    setAwayGoals(String(match.away_goals));
    setPlayedOn(match.played_on);
    setStartsAt(match.starts_at?.slice(0, 5) || "");
    setEndsAt(addMinutesToTime(match.starts_at, match.duration_minutes || 120));
    setStatus(match.status);
  }, [match.id, match.played_on, match.starts_at, match.home_goals, match.away_goals, match.duration_minutes, match.status]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onUpdateMatch(match.id, {
      played_on: playedOn,
      starts_at: startsAt || null,
      home_goals: Number(homeGoals),
      away_goals: Number(awayGoals),
      duration_minutes: durationMinutes,
      status,
    });
  }

  function cancelMatch() {
    onUpdateMatch(match.id, { status: "canceled" });
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-3 text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase text-zinc-500">Jornada {match.round_number || "-"}</p>
          <p className="mt-1 text-sm font-medium">{match.played_on} {match.starts_at?.slice(0, 5) || ""} - {match.duration_minutes || 120} min</p>
        </div>
        <span className={`rounded-md px-2 py-1 text-xs font-medium ${match.status === "live" ? "bg-red-50 text-red-700" : "bg-zinc-100 text-zinc-600"}`}>
          {match.status === "live" ? "En vivo" : match.status === "finished" ? "Finalizado" : match.status === "canceled" ? "Cancelado" : "Programado"}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <TextInput label="Fecha" type="date" value={playedOn} disabled={!canEdit} onChange={(event) => setPlayedOn(event.target.value)} />
        <TextInput label="Inicio" type="time" value={startsAt} disabled={!canEdit} onChange={(event) => setStartsAt(event.target.value)} />
        <TextInput label="Fin" type="time" value={endsAt} disabled={!canEdit} onChange={(event) => setEndsAt(event.target.value)} />
      </div>
      <div className="mt-3 grid grid-cols-[1fr_68px] items-center gap-2">
        <span className="truncate font-medium">{match.home_team_name}</span>
        <input className="rounded-md border border-zinc-300 px-2 py-2 text-center" type="number" min="0" value={homeGoals} disabled={!canEdit} onChange={(event) => setHomeGoals(event.target.value)} />
        <span className="truncate font-medium">{match.away_team_name}</span>
        <input className="rounded-md border border-zinc-300 px-2 py-2 text-center" type="number" min="0" value={awayGoals} disabled={!canEdit} onChange={(event) => setAwayGoals(event.target.value)} />
      </div>
      <SelectInput className="mt-3" label="Estado" value={status} disabled={!canEdit} onChange={(event) => setStatus(event.target.value as Match["status"])}>
        <option value="scheduled">Programado</option>
        <option value="live">En vivo</option>
        <option value="finished">Finalizado</option>
        <option value="canceled">Cancelado</option>
      </SelectInput>
      <p className="mt-2 text-xs font-medium text-zinc-500">Duracion calculada: {durationMinutes} min</p>
      {canEdit && (
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <button className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white dark:bg-zinc-50 dark:text-zinc-950">Guardar partido</button>
          {match.status !== "canceled" && (
            <button className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100" type="button" onClick={cancelMatch}>
              Cancelar
            </button>
          )}
        </div>
      )}
    </form>
  );
}

export function StudentStatsCard({ assessment }: { assessment: StudentAssessment | null }) {
  if (!assessment) {
    return (
      <section className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-500 shadow-sm">
        No hay evaluaciones deportivas todavia.
      </section>
    );
  }
  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Stats del alumno</p>
            <h2 className="font-semibold">{assessment.student_name}</h2>
            <p className="mt-1 text-sm text-zinc-500">{assessment.category} - {assessment.group_name} - {assessment.assessment_month.slice(0, 7)}</p>
          </div>
          <ChartHelp text="La grafica radial compara habilidades del alumno en escala 0 a 100. Mientras mas grande y equilibrada sea el area azul, mejor rendimiento general; huecos pequenos muestran puntos a trabajar por el coach." />
        </div>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[240px_1fr]">
        <RadarChart assessment={assessment} />
        <div className="grid gap-2">
          <p className="text-sm text-zinc-500">Overall Rating <span className="font-bold text-emerald-700">{assessment.overall_rating}</span></p>
          {[
            ["Ritmo", assessment.pace],
            ["Tiro", assessment.shooting],
            ["Pase", assessment.passing],
            ["Regate", assessment.dribbling],
            ["Defensa", assessment.defense],
            ["Fisico", assessment.physical],
            ["Actitud", assessment.attitude],
          ].map(([label, value]) => (
            <div key={String(label)}>
              <div className="flex justify-between text-xs"><span>{label}</span><span>{value}</span></div>
              <div className="mt-1 h-2 rounded-full bg-zinc-100"><div className="h-2 rounded-full bg-emerald-600 transition-all duration-500" style={{ width: `${value}%` }} /></div>
            </div>
          ))}
          {assessment.notes && <p className="mt-2 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-600">{assessment.notes}</p>}
        </div>
      </div>
    </section>
  );
}

export function RadarChart({ assessment }: { assessment: StudentAssessment }) {
  const stats = [
    ["PAC", assessment.pace],
    ["SHO", assessment.shooting],
    ["PAS", assessment.passing],
    ["DRI", assessment.dribbling],
    ["DEF", assessment.defense],
    ["PHY", assessment.physical],
  ] as const;
  const center = 110;
  const radius = 76;
  const points = stats.map(([, value], index) => {
    const angle = (Math.PI * 2 * index) / stats.length - Math.PI / 2;
    const scaled = radius * (Number(value) / 100);
    return `${center + Math.cos(angle) * scaled},${center + Math.sin(angle) * scaled}`;
  }).join(" ");
  const axisPoints = stats.map(([label], index) => {
    const angle = (Math.PI * 2 * index) / stats.length - Math.PI / 2;
    return { label, x: center + Math.cos(angle) * (radius + 22), y: center + Math.sin(angle) * (radius + 22), lineX: center + Math.cos(angle) * radius, lineY: center + Math.sin(angle) * radius };
  });
  return (
    <svg viewBox="0 0 220 220" className="mx-auto h-56 w-56">
      {[0.33, 0.66, 1].map((scale) => (
        <polygon
          key={scale}
          points={stats.map(([,], index) => {
            const angle = (Math.PI * 2 * index) / stats.length - Math.PI / 2;
            return `${center + Math.cos(angle) * radius * scale},${center + Math.sin(angle) * radius * scale}`;
          }).join(" ")}
          fill="none"
          stroke="#d4d4d8"
        />
      ))}
      {axisPoints.map((point) => (
        <g key={point.label}>
          <line x1={center} y1={center} x2={point.lineX} y2={point.lineY} stroke="#e4e4e7" />
          <text x={point.x} y={point.y} textAnchor="middle" dominantBaseline="middle" className="fill-zinc-500 text-[10px] font-semibold">{point.label}</text>
        </g>
      ))}
      <polygon points={points} fill="#67e8f9" fillOpacity="0.58" stroke="#0891b2" strokeWidth="2" className="transition-all duration-500" />
      <circle cx={center} cy={center} r="3" fill="#0891b2" />
    </svg>
  );
}

export function AssessmentForm({ students, assessments, onSaveAssessment }: { students: Student[]; assessments: StudentAssessment[]; onSaveAssessment: (payload: unknown) => Promise<void> }) {
  const todayMonth = new Date().toISOString().slice(0, 7) + "-01";
  const [studentId, setStudentId] = useState(students[0]?.id ? String(students[0].id) : "");
  const current = assessments.find((item) => item.student === Number(studentId));
  const [form, setForm] = useState({
    assessment_month: current?.assessment_month || todayMonth,
    pace: String(current?.pace ?? 70),
    shooting: String(current?.shooting ?? 70),
    passing: String(current?.passing ?? 70),
    dribbling: String(current?.dribbling ?? 70),
    defense: String(current?.defense ?? 70),
    physical: String(current?.physical ?? 70),
    attitude: String(current?.attitude ?? 80),
    notes: current?.notes || "",
  });

  useEffect(() => {
    const next = assessments.find((item) => item.student === Number(studentId));
    setForm({
      assessment_month: next?.assessment_month || todayMonth,
      pace: String(next?.pace ?? 70),
      shooting: String(next?.shooting ?? 70),
      passing: String(next?.passing ?? 70),
      dribbling: String(next?.dribbling ?? 70),
      defense: String(next?.defense ?? 70),
      physical: String(next?.physical ?? 70),
      attitude: String(next?.attitude ?? 80),
      notes: next?.notes || "",
    });
  }, [studentId, assessments.length]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!studentId) return;
    onSaveAssessment({
      student: Number(studentId),
      assessment_month: form.assessment_month,
      pace: Number(form.pace),
      shooting: Number(form.shooting),
      passing: Number(form.passing),
      dribbling: Number(form.dribbling),
      defense: Number(form.defense),
      physical: Number(form.physical),
      attitude: Number(form.attitude),
      notes: form.notes,
    });
  }

  const fields: Array<[keyof typeof form, string]> = [
    ["pace", "Ritmo"],
    ["shooting", "Tiro"],
    ["passing", "Pase"],
    ["dribbling", "Regate"],
    ["defense", "Defensa"],
    ["physical", "Fisico"],
    ["attitude", "Actitud"],
  ];

  return (
    <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Examen mensual del alumno</h2>
      <p className="mt-1 text-sm text-zinc-500">El coach actualiza estos stats cada mes; se reflejan de inmediato en el dashboard.</p>
      <SelectInput className="mt-4" label="Alumno" value={studentId} onChange={(event) => setStudentId(event.target.value)}>
        {students.map((student) => <option key={student.id} value={student.id}>{student.full_name}</option>)}
      </SelectInput>
      <TextInput className="mt-3" label="Mes" type="date" value={form.assessment_month} onChange={(event) => setForm({ ...form, assessment_month: event.target.value })} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label]) => (
          <label key={key} className="text-sm">
            <span className="flex justify-between font-medium text-zinc-700"><span>{label}</span><span>{form[key]}</span></span>
            <input className="mt-2 w-full accent-emerald-700" type="range" min="0" max="100" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
          </label>
        ))}
      </div>
      <TextInput className="mt-3" label="Notas" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
      <button className="mt-3 w-full rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">Guardar stats</button>
    </form>
  );
}
