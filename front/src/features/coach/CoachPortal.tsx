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
import { Metric } from "../../components/cards/Metric";
import { CollectionFunnel } from "../../components/charts/CollectionFunnel";
import { FinancialAxisChart } from "../../components/charts/FinancialAxisChart";
import { FinancialComboChart } from "../../components/charts/FinancialComboChart";
import { PaymentMethodDonut } from "../../components/charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../../components/charts/PendingBySiteChart";
import { StudentStatusDonut } from "../../components/charts/StudentStatusDonut";
import { API_URL } from "../../api";
import { roleLabels, statusLabels } from "../../appState";
import { money } from "../../utils/format";
import { canMarkSession, findCurrentMatch, findCurrentSession, sessionWindowText, studentsForAttendanceSession, todayKey } from "../../utils/attendance";
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
} from "../../components/views/shared";
import { FormationBoard } from "../../components/views/formationBoard";
import { SportsPanel } from "../../components/views/sports";
import { CoachAlertsPanel } from "./CoachAlertsPanel";
import { CoachAttendanceRow } from "./CoachAttendanceRow";
import { CoachHoursPanel } from "./CoachHoursPanel";

export function CoachPortal({
  user,
  data,
  onRefresh,
  onLogout,
  onCreateSession,
  onMark,
  onClose,
  onCreateWorkLog,
  onFaceAttendance,
  onDownloadFile,
  onUpdateMatch,
  onSaveAssessment,
  onAcceptStaffPayment,
  onRejectStaffPayment,
}: {
  user: User;
  data: AppData;
  onRefresh: () => void;
  onLogout: () => void;
  onCreateSession: (payload: unknown) => Promise<AttendanceSession>;
  onMark: (payload: unknown) => Promise<AttendanceRecord>;
  onClose: (sessionId: number) => Promise<void>;
  onCreateWorkLog: (payload: unknown) => void;
  onFaceAttendance: (payload: unknown) => Promise<FaceRecognitionResponse>;
  onDownloadFile: (path: string, filename: string) => void;
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
  onSaveAssessment: (payload: unknown) => Promise<void>;
  onAcceptStaffPayment: (requestId: number) => void;
  onRejectStaffPayment: (requestId: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const groupName = user.coach_group_name || data.students[0]?.group_name || "";
  const site = data.sites.find((item) => item.id === user.primary_site) ?? data.sites[0];
  const [date, setDate] = useState(today);
  const [startsAt, setStartsAt] = useState("17:00");
  const [durationMinutes, setDurationMinutes] = useState("120");
  const [matchId, setMatchId] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(data.attendanceSessions[0]?.id ?? null);
  const [savingStudentId, setSavingStudentId] = useState<number | null>(null);
  const [workForm, setWorkForm] = useState({ work_date: today, hours: "2", activity: "Entrenamiento", notes: "" });
  const listRef = useRef<HTMLDivElement | null>(null);

  const currentSession = useMemo(() => findCurrentSession(data.attendanceSessions, site?.id), [data.attendanceSessions, site?.id]);
  const currentMatch = useMemo(() => findCurrentMatch(data.matches, site?.id), [data.matches, site?.id]);
  const todayMatches = useMemo(
    () => data.matches.filter((match) => match.played_on === todayKey() && (!site?.id || match.site === site.id) && match.status !== "finished" && match.status !== "canceled"),
    [data.matches, site?.id],
  );
  const activeSession = data.attendanceSessions.find((session) => session.id === activeSessionId) ?? null;
  const activeSessionCanMark = activeSession ? canMarkSession(activeSession) : false;
  const attendanceRoster = useMemo(() => studentsForAttendanceSession(data, activeSession, site?.id ? String(site.id) : "", groupName), [activeSession, data, groupName, site?.id]);
  const recordsByStudent = useMemo(() => {
    const map = new Map<number, AttendanceRecord>();
    data.attendanceRecords
      .filter((record) => record.session === activeSessionId && record.student)
      .forEach((record) => map.set(record.student as number, record));
    return map;
  }, [activeSessionId, data.attendanceRecords]);
  const presentCount = Array.from(recordsByStudent.values()).filter((record) => record.status === "present").length;
  const absentCount = Array.from(recordsByStudent.values()).filter((record) => record.status === "absent").length;
  const medicalAlerts = data.students.filter((student) => student.medical_notes);
  const debtAlerts = data.students.filter((student) => student.open_charge_count > 0);
  const totalHours = data.coachWorkLogs.reduce((sum, log) => sum + Number(log.hours || 0), 0);
  const estimatedPay = data.coachWorkLogs.reduce((sum, log) => sum + Number(log.total_amount || 0), 0);

  useEffect(() => {
    if (!data.attendanceSessions.length) {
      setActiveSessionId(null);
      return;
    }
    if (currentSession && activeSessionId !== currentSession.id) {
      setActiveSessionId(currentSession.id);
      return;
    }
    if (!activeSessionId || !data.attendanceSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(data.attendanceSessions[0].id);
    }
  }, [data.attendanceSessions, activeSessionId, currentSession]);

  useEffect(() => {
    if (currentMatch && !matchId) {
      setMatchId(String(currentMatch.id));
      setDate(currentMatch.played_on);
      if (currentMatch.starts_at) setStartsAt(currentMatch.starts_at.slice(0, 5));
      setDurationMinutes(String(currentMatch.duration_minutes || 120));
    }
  }, [currentMatch, matchId]);

  async function startSession(event: FormEvent) {
    event.preventDefault();
    if (!site) return;
    const payload = matchId
      ? { match: Number(matchId) }
      : {
          site: site.id,
          session_type: "academy_class",
          date,
          starts_at: startsAt || null,
          duration_minutes: Number(durationMinutes || 120),
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
        override_reason: student.open_charge_count > 0 && status === "present" ? "Coach marco asistencia con pago pendiente visible" : "",
      });
    } finally {
      setSavingStudentId(null);
    }
  }

  function submitWorkLog(event: FormEvent) {
    event.preventDefault();
    onCreateWorkLog({
      work_date: workForm.work_date,
      hours: workForm.hours,
      activity: workForm.activity,
      notes: workForm.notes,
    });
    setWorkForm({ ...workForm, notes: "" });
  }

  function scrollToList() {
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950" data-testid="coach-portal">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Portal coach</p>
            <h1 className="text-xl font-semibold">{groupName || "Equipo asignado"}</h1>
            <p className="mt-1 text-sm text-zinc-500">{site?.name || "Sin sede"} - {user.first_name || user.username}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50" onClick={onRefresh} title="Actualizar">
              <RefreshCw size={16} />
            </button>
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50" onClick={onLogout} title="Salir">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Alumnos del grupo" value={data.students.length} />
          <Metric label="Alertas medicas" value={medicalAlerts.length} />
          <Metric label="Pagos pendientes" value={debtAlerts.length} />
          <Metric label="Horas registradas" value={totalHours.toFixed(1)} />
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <FormationBoard students={attendanceRoster.length ? attendanceRoster : data.students} groupName={groupName} />
          <div className="grid gap-5">
            <form onSubmit={startSession} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <ClipboardCheck size={16} /> Crear pase de lista
              </h2>
              <p className="mt-1 text-sm text-zinc-500">Primero crea o selecciona una sesion; despues marca asistencia manual o por camara.</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <SelectInput
                  label="Partido o entrenamiento"
                  value={matchId}
                  onChange={(event) => {
                    setMatchId(event.target.value);
                    const match = data.matches.find((item) => item.id === Number(event.target.value));
                    if (match) {
                      setDate(match.played_on);
                      if (match.starts_at) setStartsAt(match.starts_at.slice(0, 5));
                      setDurationMinutes(String(match.duration_minutes || 120));
                    }
                  }}
                >
                  <option value="">Entrenamiento del grupo</option>
                  {todayMatches.map((match) => (
                    <option key={match.id} value={match.id}>
                      {match.home_team_name} vs {match.away_team_name} - {match.starts_at?.slice(0, 5) || "sin hora"}
                    </option>
                  ))}
                </SelectInput>
                <TextInput label="Fecha" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                <TextInput label="Hora" type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
                <TextInput label="Duracion (min)" type="number" min="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
              </div>
              <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white" data-testid="coach-create-session">
                <Plus size={16} /> Crear sesion
              </button>
              <button
                type="button"
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
                disabled={!activeSession}
                onClick={scrollToList}
              >
                <ClipboardCheck size={16} /> Pasar lista manual
              </button>
              <div className="mt-4 grid gap-2">
                {data.attendanceSessions
                  .filter((session) => session.date === todayKey() && (!site?.id || session.site === site.id))
                  .slice(0, 4)
                  .map((session) => (
                  <button
                    type="button"
                    key={session.id}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${activeSessionId === session.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white"}`}
                    onClick={() => setActiveSessionId(session.id)}
                  >
                    <span className="font-medium">{session.date}</span>
                    <span className={activeSessionId === session.id ? "ml-2 text-zinc-200" : "ml-2 text-zinc-500"}>
                      {session.starts_at?.slice(0, 5) || "sin hora"} {session.match_name || session.group_name || ""} {canMarkSession(session) ? "- En ventana" : `- ${sessionWindowText(session)}`}
                    </span>
                  </button>
                ))}
              </div>
            </form>

            <FaceAttendanceCard
              activeSession={activeSession}
              roster={attendanceRoster}
              disabled={!activeSession || !activeSessionCanMark}
              onRecognize={onFaceAttendance}
            />

            <form onSubmit={submitWorkLog} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">Horas y nomina estimada</h2>
              <p className="mt-1 text-sm text-zinc-500">${money(user.coach_hourly_rate || 0)} por hora - estimado ${money(estimatedPay)}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <TextInput label="Fecha" type="date" value={workForm.work_date} onChange={(event) => setWorkForm({ ...workForm, work_date: event.target.value })} />
                <TextInput label="Horas" type="number" min="0" step="0.25" value={workForm.hours} onChange={(event) => setWorkForm({ ...workForm, hours: event.target.value })} />
              </div>
              <TextInput className="mt-3" label="Actividad" value={workForm.activity} onChange={(event) => setWorkForm({ ...workForm, activity: event.target.value })} />
              <TextInput className="mt-3" label="Notas" value={workForm.notes} onChange={(event) => setWorkForm({ ...workForm, notes: event.target.value })} />
              <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white" data-testid="coach-register-hours">
                <Plus size={16} /> Registrar horas
              </button>
            </form>
          </div>
        </section>

        <section className="mt-6">
          <SportsPanel
            data={data}
            canEditMatches
            canEditAssessments
            onUpdateMatch={onUpdateMatch}
            onSaveAssessment={onSaveAssessment}
          />
        </section>

        <section className="mt-6">
          <StaffPaymentInbox
            requests={data.staffPaymentRequests}
            currentUser={user}
            onAccept={onAcceptStaffPayment}
            onReject={onRejectStaffPayment}
          />
        </section>

        <section ref={listRef} className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="rounded-md border-2 border-emerald-700 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-medium uppercase text-emerald-700">Pasar lista manual</p>
                <h2 className="font-semibold">{activeSession ? "Asistencia del equipo" : "Crea una sesion para pasar lista"}</h2>
                <p className="mt-1 text-sm text-zinc-500">{presentCount} asisten - {absentCount} faltan - ventana {activeSession ? sessionWindowText(activeSession) : "sin sesion"}</p>
                {activeSession && !activeSessionCanMark && <p className="mt-1 text-sm font-medium text-amber-700">Fuera de ventana: no se puede modificar asistencia.</p>}
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
            <div className="divide-y divide-zinc-100">
              {attendanceRoster.map((student) => {
                const record = recordsByStudent.get(student.id);
                const locked = !activeSession || !activeSessionCanMark;
                return (
                  <CoachAttendanceRow
                    key={student.id}
                    student={student}
                    record={record}
                    locked={locked}
                    saving={savingStudentId === student.id}
                    onMark={mark}
                  />
                );
              })}
            </div>
          </div>

          <div className="grid gap-5">
            <CoachAlertsPanel medicalAlerts={medicalAlerts} debtAlerts={debtAlerts} />
            <CoachHoursPanel data={data} />
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Facturas del coach" count={data.invoices.length} />
        <InvoiceRows invoices={data.invoices.slice(0, 5)} onDownloadFile={onDownloadFile} />
      </section>
    </main>
  );
}
