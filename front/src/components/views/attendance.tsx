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
import { canMarkSession, findCurrentMatch, findCurrentSession, sessionWindowText, studentsForAttendanceSession, todayKey } from "../../utils/attendance";
import type { AccountingSiteRow, AppData, AttendanceRecord, AttendanceSession, CashMovementType, Charge, ChargeStatus, Discount, Expense, ExpenseStatus, FaceRecognitionResponse, Guardian, HistoricalDiscrepancyReport, HistoricalImport, Invoice, Match, Payment, PaymentMethod, PaymentStatus, Player, PlayerAttendanceRecord, Role, Site, StaffPaymentKind, StaffPaymentRequest, StaffPaymentStatus, StandingRow, Student, StudentAssessment, Team, ThemeMode, User } from "../../types";
import { SelectInput, TextInput } from "./sharedParts/metrics";

import {
  Avatar,
  AttendanceButton,
  FaceAttendanceCard,
  InfoChip,
  InvoiceGenerator,
  InvoiceRows,
  SimpleList,
  StaffPaymentInbox,
  StatusPill,
  TableHeader,
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

export function AttendancePanel({
  data,
  user,
  onCreateSession,
  onMark,
  onClose,
  onFaceAttendance,
}: {
  data: AppData;
  user?: User;
  onCreateSession: (payload: unknown) => Promise<AttendanceSession>;
  onMark: (payload: unknown) => Promise<AttendanceRecord>;
  onClose: (sessionId: number) => Promise<void>;
  onFaceAttendance: (payload: unknown) => Promise<FaceRecognitionResponse>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const isCoach = user?.role === "coach";
  const initialSiteId = isCoach && user?.primary_site ? String(user.primary_site) : data.sites[0]?.id ? String(data.sites[0].id) : "";
  const [siteId, setSiteId] = useState(initialSiteId);
  const [groupName, setGroupName] = useState(isCoach ? user?.coach_group_name || data.students[0]?.group_name || "" : "");
  const [date, setDate] = useState(today);
  const [startsAt, setStartsAt] = useState("17:00");
  const [matchId, setMatchId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(isCoach ? null : data.attendanceSessions[0]?.id ?? null);
  const [savingStudentId, setSavingStudentId] = useState<number | null>(null);
  const numericSiteId = siteId ? Number(siteId) : null;

  const groups = useMemo(() => {
    const names = data.students
      .filter((student) => !siteId || student.site === Number(siteId))
      .map((student) => student.group_name)
      .filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [data.students, siteId]);

  const coachTodaySessions = useMemo(() => {
    if (!isCoach) return [];
    return data.attendanceSessions
      .filter((session) => {
        if (session.date !== todayKey()) return false;
        if (numericSiteId && session.site !== numericSiteId) return false;
        if (user?.coach_group_name && session.session_type !== "tournament_match" && session.group_name && session.group_name !== user.coach_group_name) return false;
        return true;
      })
      .sort((a, b) => (a.starts_at || "99:99").localeCompare(b.starts_at || "99:99"));
  }, [data.attendanceSessions, isCoach, numericSiteId, user?.coach_group_name]);
  const visibleTodaySessions = useMemo(() => {
    const sessions = isCoach
      ? coachTodaySessions
      : data.attendanceSessions.filter((session) => session.date === todayKey() && (!numericSiteId || session.site === numericSiteId));
    return sessions.slice(0, isCoach ? 12 : 6);
  }, [coachTodaySessions, data.attendanceSessions, isCoach, numericSiteId]);
  const currentSession = useMemo(() => findCurrentSession(isCoach ? coachTodaySessions : data.attendanceSessions, numericSiteId), [coachTodaySessions, data.attendanceSessions, isCoach, numericSiteId]);
  const currentMatch = useMemo(() => findCurrentMatch(data.matches, numericSiteId), [data.matches, numericSiteId]);
  const todayMatches = useMemo(
    () => data.matches.filter((match) => match.played_on === todayKey() && (!numericSiteId || match.site === numericSiteId) && match.status !== "finished" && match.status !== "canceled"),
    [data.matches, numericSiteId],
  );
  const selectableSessions = isCoach ? coachTodaySessions : data.attendanceSessions;
  const activeSession = selectableSessions.find((session) => session.id === activeSessionId) ?? null;
  const activeSessionCanMark = activeSession ? canMarkSession(activeSession) : false;

  const roster = useMemo(() => {
    if (isCoach && !activeSession) return [];
    return studentsForAttendanceSession(data, activeSession, siteId, groupName);
  }, [activeSession, data, groupName, isCoach, siteId]);

  const recordsByStudent = useMemo(() => {
    const map = new Map<number, AttendanceRecord>();
    data.attendanceRecords
      .filter((record) => record.session === activeSessionId && record.student)
      .forEach((record) => map.set(record.student as number, record));
    return map;
  }, [activeSessionId, data.attendanceRecords]);

  const sessionSummary = useMemo(() => {
    const records = Array.from(recordsByStudent.values());
    return {
      present: records.filter((record) => record.status === "present").length,
      absent: records.filter((record) => record.status === "absent").length,
      justified: records.filter((record) => record.status === "justified").length,
    };
  }, [recordsByStudent]);

  useEffect(() => {
    if (isCoach && user?.primary_site && siteId !== String(user.primary_site)) {
      setSiteId(String(user.primary_site));
      return;
    }
    if (!siteId && data.sites[0]) setSiteId(String(data.sites[0].id));
  }, [data.sites, isCoach, siteId, user?.primary_site]);

  useEffect(() => {
    if (isCoach) {
      const preferredSession = currentSession ?? coachTodaySessions[0] ?? null;
      if (preferredSession && activeSessionId !== preferredSession.id) {
        setActiveSessionId(preferredSession.id);
        return;
      }
      if (!preferredSession && activeSessionId !== null) {
        setActiveSessionId(null);
      }
      return;
    }
    if (currentSession && activeSessionId !== currentSession.id) {
      setActiveSessionId(currentSession.id);
    }
  }, [activeSessionId, coachTodaySessions, currentSession, isCoach]);

  useEffect(() => {
    if (currentMatch && !matchId) {
      setMatchId(String(currentMatch.id));
      if (currentMatch.starts_at) setStartsAt(currentMatch.starts_at.slice(0, 5));
      setDate(currentMatch.played_on);
    }
  }, [currentMatch, matchId]);

  async function startSession(event: FormEvent) {
    event.preventDefault();
    const payload = matchId
      ? { match: Number(matchId) }
      : {
          site: Number(siteId),
          session_type: "academy_class",
          date,
          starts_at: startsAt || null,
          group_name: groupName,
        };
    const session = await onCreateSession(payload);
    setActiveSessionId(session.id);
  }

  async function mark(student: Student, status: AttendanceRecord["status"]) {
    if (!activeSession || !activeSessionCanMark) return;
    setSavingStudentId(student.id);
    try {
      await onMark({
        session: activeSession.id,
        student: student.id,
        status,
        override_reason: student.open_charge_count > 0 && status === "present" ? "Alumno con pago pendiente autorizado en cancha" : "",
      });
    } finally {
      setSavingStudentId(null);
    }
  }

  return (
    <>
      <div className="grid gap-5">
      <form onSubmit={startSession} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ClipboardCheck size={16} /> {isCoach ? "Sesiones de hoy" : "Pase de lista"}
        </h2>
        {isCoach ? (
          <div className="mt-4 grid gap-3">
            <p className="text-sm text-zinc-500 dark:text-zinc-300">
              Selecciona el entrenamiento o partido programado para hoy. No se muestran sesiones historicas en el perfil del coach.
            </p>
            {coachTodaySessions.length > 0 ? (
              <SelectInput
                label="Entrenamiento o partido de hoy"
                value={activeSessionId ? String(activeSessionId) : ""}
                onChange={(event) => setActiveSessionId(event.target.value ? Number(event.target.value) : null)}
              >
                {coachTodaySessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.starts_at?.slice(0, 5) || "Sin hora"} - {session.match_name || session.group_name || "Sesion de hoy"} - {canMarkSession(session) ? "en ventana" : sessionWindowText(session)}
                  </option>
                ))}
              </SelectInput>
            ) : (
              <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                No hay entrenamientos o partidos programados para hoy.
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-3">
            <SelectInput label="Sede" required value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </SelectInput>
            <SelectInput label="Grupo" value={groupName} onChange={(event) => setGroupName(event.target.value)}>
              <option value="">Todos los grupos</option>
              {groups.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </SelectInput>
            <SelectInput
              label="Partido o entrenamiento"
              value={matchId}
              onChange={(event) => {
                setMatchId(event.target.value);
                const match = data.matches.find((item) => item.id === Number(event.target.value));
                if (match) {
                  setDate(match.played_on);
                  if (match.starts_at) setStartsAt(match.starts_at.slice(0, 5));
                }
              }}
            >
              <option value="">Entrenamiento por grupo</option>
              {todayMatches.map((match) => (
                <option key={match.id} value={match.id}>
                  {match.home_team_name} vs {match.away_team_name} - {match.starts_at?.slice(0, 5) || "sin hora"}
                </option>
              ))}
            </SelectInput>
            <TextInput label="Fecha" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
            <TextInput label="Hora" type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
            <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white" data-testid="coach-create-session">
              <Plus size={16} /> Crear sesion
            </button>
          </div>
        )}

        <div className="mt-5 border-t border-zinc-200 pt-4">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{isCoach ? "Agenda del dia" : "Sesiones recientes"}</p>
          <div className="mt-2 grid gap-2">
            {visibleTodaySessions.map((session) => (
              <button
                type="button"
                key={session.id}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  activeSessionId === session.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
                }`}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span className="block font-medium">{session.site_name}</span>
                <span className={activeSessionId === session.id ? "text-zinc-200" : "text-zinc-500"}>
                  {session.starts_at?.slice(0, 5) || "sin hora"} {session.match_name || session.group_name || "Todos"} - {canMarkSession(session) ? "En ventana" : `Fuera de ventana (${sessionWindowText(session)})`}
                </span>
              </button>
            ))}
            {visibleTodaySessions.length === 0 && <p className="text-sm text-zinc-500">{isCoach ? "Sin sesiones para hoy." : "Todavia no hay sesiones."}</p>}
          </div>
        </div>
      </form>

      {(!isCoach || activeSession) && (
        <FaceAttendanceCard
          activeSession={activeSession}
          roster={roster}
          disabled={!activeSession || !activeSessionCanMark}
          onRecognize={onFaceAttendance}
        />
      )}
      </div>

      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">{activeSession ? "Lista de asistencia" : isCoach ? "Sin sesion para hoy" : "Selecciona o crea una sesion"}</h2>
            {activeSession && (
              <>
                <p className="mt-1 text-sm text-zinc-500">
                  {activeSession.site_name} - {activeSession.date} - {activeSession.match_name || activeSession.group_name || "Todos los grupos"} - ventana {sessionWindowText(activeSession)}
                </p>
                {!activeSessionCanMark && <p className="mt-1 text-sm font-medium text-amber-700">Solo se puede pasar lista durante la ventana operativa de esta sesion.</p>}
              </>
            )}
          </div>
          {activeSession && (
            <button
              className="flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
              disabled={Boolean(activeSession.closed_at)}
              onClick={() => onClose(activeSession.id)}
            >
              <Lock size={16} /> {activeSession.closed_at ? "Cerrada" : "Cerrar"}
            </button>
          )}
        </div>

        {activeSession && (
          <div className="grid grid-cols-3 border-b border-zinc-200 text-center text-sm">
            <div className="px-3 py-3">
              <p className="text-xs uppercase text-zinc-500">Asisten</p>
              <p className="text-xl font-semibold">{sessionSummary.present}</p>
            </div>
            <div className="border-x border-zinc-200 px-3 py-3">
              <p className="text-xs uppercase text-zinc-500">Faltan</p>
              <p className="text-xl font-semibold">{sessionSummary.absent}</p>
            </div>
            <div className="px-3 py-3">
              <p className="text-xs uppercase text-zinc-500">Justif.</p>
              <p className="text-xl font-semibold">{sessionSummary.justified}</p>
            </div>
          </div>
        )}

        <div className="divide-y divide-zinc-100">
          {!activeSession && <p className="px-4 py-8 text-sm text-zinc-500">{isCoach ? "Cuando exista un entrenamiento o partido programado para hoy, aparecera aqui para pasar lista." : "Crea una sesion para empezar el pase de lista."}</p>}
          {activeSession &&
            roster.map((student) => {
              const record = recordsByStudent.get(student.id);
              const locked = !activeSessionCanMark;
              return (
                <div key={student.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="flex gap-3">
                    <Avatar name={student.full_name} imageUrl={student.photo_url} />
                    <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{student.full_name}</p>
                      <StatusPill label={statusLabels[student.status]} />
                      <StatusPill label={student.uniform_status === "delivered" ? "Uniforme entregado" : "Uniforme pendiente"} />
                      {student.open_charge_count > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                          <AlertTriangle size={12} /> Pago pendiente ${student.balance_due}
                        </span>
                      )}
                      {student.pause_start && (
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                          Pausa {student.pause_start} a {student.pause_end || "abierta"}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {student.group_name || student.category} - {student.guardian_name} - {student.guardian_phone}
                    </p>
                    {student.medical_notes && <p className="mt-1 text-xs text-red-700">Medico: {student.medical_notes}</p>}
                    {student.active_discounts.length > 0 && (
                      <p className="mt-1 text-xs text-emerald-700">
                        Descuentos activos: {student.active_discounts.map((discount) => `${discount.reason} $${money(discount.amount)}`).join(", ")}
                      </p>
                    )}
                    {student.waiver_url && <p className="mt-1 text-xs text-zinc-500">Responsiva registrada</p>}
                    {record?.override_reason && <p className="mt-1 text-xs text-amber-700">{record.override_reason}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <AttendanceButton
                      active={record?.status === "present"}
                      disabled={locked || savingStudentId === student.id}
                      label="Asiste"
                      icon={<Check size={16} />}
                      onClick={() => mark(student, "present")}
                    />
                    <AttendanceButton
                      active={record?.status === "absent"}
                      disabled={locked || savingStudentId === student.id}
                      label="Falta"
                      icon={<X size={16} />}
                      onClick={() => mark(student, "absent")}
                    />
                    <AttendanceButton
                      active={record?.status === "justified"}
                      disabled={locked || savingStudentId === student.id}
                      label="Justif."
                      icon={<ClipboardCheck size={16} />}
                      onClick={() => mark(student, "justified")}
                    />
                  </div>
                </div>
              );
            })}
          {activeSession && roster.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay alumnos para este filtro.</p>}
        </div>
      </div>
    </>
  );
}
