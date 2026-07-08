import { useMemo, useState } from "react";
import { AlertTriangle, Search, UsersRound } from "lucide-react";
import type { AppData, AttendanceRecord, Payment, PlayerAttendanceRecord } from "../../types";
import { money } from "../../utils/format";
import { EvidenceImage } from "../../features/automatic-attendance";

type Scope = "academy" | "adult";

type AttendanceStatus = AttendanceRecord["status"] | PlayerAttendanceRecord["status"];

type SummaryRow = {
  id: string;
  kind: "known" | "unknown";
  name: string;
  group: string;
  siteName: string;
  imageUrl?: string;
  presentDays: number;
  absentDays: number;
  justifiedDays: number;
  totalDays: number;
  captureCount?: number;
  lastSeenAt?: string | null;
  riskScore?: number;
  paymentStatus: "paid" | "partial" | "pending" | "none";
  paymentLabel: string;
  billed: number;
  paid: number;
  balance: number;
};

function currentMonthValue() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 7);
}

function monthLabel(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, (monthNumber || 1) - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });
}

function normalizeText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function dateMonth(value?: string | null) {
  return value ? value.slice(0, 7) : "";
}

function dateTimeLabel(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function paymentMonth(payment: Payment) {
  return dateMonth(payment.confirmed_at || payment.paid_at);
}

function isConfirmedPayment(payment: Payment) {
  return payment.status === "registered" || payment.status === "reconciled";
}

function addStatusDay(days: Record<AttendanceStatus, Set<string>>, status: AttendanceStatus, date?: string) {
  if (!date) return;
  days[status].add(date);
}

function paymentStatus(charges: Array<{ amount: string; balance: string; status: string }>, paidInMonth: number) {
  if (!charges.length && paidInMonth <= 0) {
    return { paymentStatus: "none" as const, paymentLabel: "Sin cargos del mes", billed: 0, paid: 0, balance: 0 };
  }
  const billed = charges.reduce((sum, charge) => sum + Number(charge.amount || 0), 0);
  const balance = charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
  if (balance <= 0 && (charges.length > 0 || paidInMonth > 0)) {
    return { paymentStatus: "paid" as const, paymentLabel: "Pagado", billed, paid: paidInMonth, balance: 0 };
  }
  if (paidInMonth > 0) {
    return { paymentStatus: "partial" as const, paymentLabel: "Pago parcial", billed, paid: paidInMonth, balance };
  }
  return { paymentStatus: "pending" as const, paymentLabel: "No pagado", billed, paid: 0, balance };
}

function statusClass(status: SummaryRow["paymentStatus"]) {
  if (status === "paid") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "partial") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "pending") return "border-red-200 bg-red-50 text-red-700";
  return "border-zinc-200 bg-zinc-50 text-zinc-600";
}

function buildAcademyRows(data: AppData, month: string): SummaryRow[] {
  const sessions = new Map(data.attendanceSessions.map((session) => [session.id, session]));
  const chargesByStudent = new Map<number, typeof data.charges>();
  data.charges
    .filter((charge) => charge.student && (dateMonth(charge.due_date) === month || (!charge.due_date && charge.status !== "canceled")))
    .forEach((charge) => {
      const studentId = charge.student as number;
      chargesByStudent.set(studentId, [...(chargesByStudent.get(studentId) ?? []), charge]);
    });
  const paidByStudent = new Map<number, number>();
  data.payments
    .filter((payment) => payment.student && isConfirmedPayment(payment) && paymentMonth(payment) === month)
    .forEach((payment) => {
      const studentId = payment.student as number;
      paidByStudent.set(studentId, (paidByStudent.get(studentId) ?? 0) + Number(payment.amount || 0));
    });

  const daysByStudent = new Map<number, Record<AttendanceStatus, Set<string>>>();
  data.attendanceRecords.forEach((record) => {
    if (!record.student) return;
    const session = sessions.get(record.session);
    if (!session || dateMonth(session.date) !== month) return;
    const days = daysByStudent.get(record.student) ?? { present: new Set<string>(), absent: new Set<string>(), justified: new Set<string>() };
    addStatusDay(days, record.status, session.date);
    daysByStudent.set(record.student, days);
  });

  return data.students.map((student) => {
    const site = data.sites.find((item) => item.id === student.site);
    const days = daysByStudent.get(student.id) ?? { present: new Set<string>(), absent: new Set<string>(), justified: new Set<string>() };
    const payment = paymentStatus(chargesByStudent.get(student.id) ?? [], paidByStudent.get(student.id) ?? 0);
    return {
      id: `student-${student.id}`,
      kind: "known",
      name: student.full_name,
      group: student.group_name || student.category || "Sin grupo",
      siteName: site?.name ?? student.site_name ?? "Sin sede",
      presentDays: days.present.size,
      absentDays: days.absent.size,
      justifiedDays: days.justified.size,
      totalDays: new Set([...days.present, ...days.absent, ...days.justified]).size,
      ...payment,
    };
  });
}

function buildAdultRows(data: AppData, month: string): SummaryRow[] {
  const sessions = new Map(data.attendanceSessions.map((session) => [session.id, session]));
  const chargesByTeam = new Map<number, typeof data.charges>();
  data.charges
    .filter((charge) => charge.team && (dateMonth(charge.due_date) === month || (!charge.due_date && charge.status !== "canceled")))
    .forEach((charge) => {
      const teamId = charge.team as number;
      chargesByTeam.set(teamId, [...(chargesByTeam.get(teamId) ?? []), charge]);
    });
  const paidByTeam = new Map<number, number>();
  data.payments
    .filter((payment) => payment.team && isConfirmedPayment(payment) && paymentMonth(payment) === month)
    .forEach((payment) => {
      const teamId = payment.team as number;
      paidByTeam.set(teamId, (paidByTeam.get(teamId) ?? 0) + Number(payment.amount || 0));
    });

  const daysByPlayer = new Map<number, Record<AttendanceStatus, Set<string>>>();
  data.playerAttendanceRecords.forEach((record) => {
    const session = sessions.get(record.session);
    if (!session || dateMonth(session.date) !== month) return;
    const days = daysByPlayer.get(record.player) ?? { present: new Set<string>(), absent: new Set<string>(), justified: new Set<string>() };
    addStatusDay(days, record.status, session.date);
    daysByPlayer.set(record.player, days);
  });

  return data.players.map((player) => {
    const team = data.teams.find((item) => item.id === player.team);
    const site = data.sites.find((item) => item.id === player.site);
    const days = daysByPlayer.get(player.id) ?? { present: new Set<string>(), absent: new Set<string>(), justified: new Set<string>() };
    const payment = paymentStatus(chargesByTeam.get(player.team) ?? [], paidByTeam.get(player.team) ?? 0);
    return {
      id: `player-${player.id}`,
      kind: "known",
      name: player.full_name,
      group: team?.name ?? player.team_name ?? "Sin equipo",
      siteName: site?.name ?? player.site_name ?? team?.site_name ?? "Sin sede",
      presentDays: days.present.size,
      absentDays: days.absent.size,
      justifiedDays: days.justified.size,
      totalDays: new Set([...days.present, ...days.absent, ...days.justified]).size,
      ...payment,
    };
  });
}

function buildUnknownRows(data: AppData, month: string): SummaryRow[] {
  const recordsBySubject = new Map<string, typeof data.unknownAttendanceRecords>();
  data.unknownAttendanceRecords
    .filter((record) => dateMonth(record.attendance_date) === month)
    .forEach((record) => {
      recordsBySubject.set(record.subject_id, [...(recordsBySubject.get(record.subject_id) ?? []), record]);
    });

  return Array.from(recordsBySubject.entries()).map(([subjectId, records]) => {
    const sorted = [...records].sort((a, b) => (b.last_seen_at || "").localeCompare(a.last_seen_at || ""));
    const latest = sorted[0];
    const visits = records.length;
    const uniqueDates = new Set(records.map((record) => record.attendance_date).filter(Boolean));
    const captureCount = records.reduce((sum, record) => sum + Number(record.capture_count || 0), 0);
    const unscheduledVisits = records.filter((record) => record.is_unscheduled).length;
    return {
      id: `unknown-${subjectId}`,
      kind: "unknown",
      name: latest?.temporary_name || `Desconocido ${subjectId.slice(0, 8)}`,
      group: unscheduledVisits ? "Desconocido sin agenda" : "Desconocido en horario agendado",
      siteName: latest?.site_name || "Sin sede",
      imageUrl: latest?.image_url,
      presentDays: visits,
      absentDays: 0,
      justifiedDays: 0,
      totalDays: uniqueDates.size,
      captureCount,
      lastSeenAt: latest?.last_seen_at,
      riskScore: visits >= 3 ? visits : 0,
      paymentStatus: "pending" as const,
      paymentLabel: visits >= 3 ? "Riesgo: sin registro" : "Sin registro",
      billed: 0,
      paid: 0,
      balance: 0,
    };
  });
}

export function AttendanceGeneralPanel({ data, scope, token }: { data: AppData; scope: Scope; token: string }) {
  const [month, setMonth] = useState(currentMonthValue());
  const [query, setQuery] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");
  const [personFilter, setPersonFilter] = useState("all");

  const rows = useMemo(() => [...(scope === "adult" ? buildAdultRows(data, month) : buildAcademyRows(data, month)), ...buildUnknownRows(data, month)], [data, month, scope]);
  const visibleRows = useMemo(() => {
    const text = normalizeText(query);
    return rows
      .filter((row) => !text || normalizeText(`${row.name} ${row.group} ${row.siteName}`).includes(text))
      .filter((row) => personFilter === "all" || row.kind === personFilter)
      .filter((row) => paymentFilter === "all" || row.paymentStatus === paymentFilter)
      .filter((row) => activityFilter === "all" || (activityFilter === "with" ? row.totalDays > 0 : row.totalDays === 0))
      .sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0) || b.balance - a.balance || b.presentDays - a.presentDays || a.name.localeCompare(b.name));
  }, [activityFilter, paymentFilter, personFilter, query, rows]);

  const titleColorClass = scope === "adult" ? "text-blue-700 dark:text-blue-300" : "text-emerald-700 dark:text-emerald-300";
  const unknownRiskCount = rows.filter((row) => row.kind === "unknown" && (row.riskScore ?? 0) >= 3).length;

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className={`mt-1 flex items-center gap-2 text-lg font-semibold ${titleColorClass}`}>
                <UsersRound size={18} /> Resumen mensual por persona
              </h2>
              {unknownRiskCount > 0 && (
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-700">
                  <AlertTriangle size={15} /> {unknownRiskCount} desconocido(s) con 3+ visitas en {monthLabel(month)}.
                </p>
              )}
            </div>
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end xl:w-auto">
              <input aria-label="Mes" className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-800 outline-none transition focus:border-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-36" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
              <label className="relative block w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" size={14} />
                <input
                  aria-label="Buscar"
                  className="h-9 w-full rounded-md border border-zinc-300 bg-white pl-8 pr-3 text-xs font-medium text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar"
                />
              </label>
              <select className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-800 outline-none transition focus:border-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-36" value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
                <option value="all">Todos los pagos</option>
                <option value="paid">Pagado</option>
                <option value="partial">Pago parcial</option>
                <option value="pending">No pagado</option>
                <option value="none">Sin cargos</option>
              </select>
              <select className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-800 outline-none transition focus:border-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-40" value={personFilter} onChange={(event) => setPersonFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="known">Conocidos</option>
                <option value="unknown">Desconocidos</option>
              </select>
              <select className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-xs font-medium text-zinc-800 outline-none transition focus:border-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 sm:w-44" value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}>
                <option value="all">Todos</option>
                <option value="with">Con asistencia</option>
                <option value="without">Sin asistencia</option>
              </select>
            </div>
          </div>
        </div>
        <div className="max-h-[calc(100dvh-300px)] overflow-auto xl:max-h-[calc(100dvh-260px)]">
          <table className="min-w-full border-collapse text-left text-sm text-zinc-900 dark:text-zinc-100">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Persona</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Grupo / equipo</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Asistio</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Falto</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Just.</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Pago</th>
                <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Saldo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {visibleRows.map((row) => (
                <tr key={row.id} className="bg-white dark:bg-zinc-950">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {row.imageUrl ? (
                        <div className="size-11 shrink-0 overflow-hidden rounded-md">
                          <EvidenceImage url={row.imageUrl} token={token} fit="cover" ratio="square" />
                        </div>
                      ) : null}
                      <div className="min-w-0">
                        <p className="font-semibold">{row.name}</p>
                        <p className="text-xs text-zinc-500">{row.siteName}</p>
                        {row.kind === "unknown" && (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">Desconocido</span>
                            {(row.riskScore ?? 0) >= 3 ? <span className="rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">3+ visitas</span> : null}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {row.group}
                    {row.kind === "unknown" && (
                      <p className="mt-1 text-xs text-zinc-500">
                        {row.totalDays} dia(s) - {row.captureCount ?? 0} captura(s){row.lastSeenAt ? ` - ultima ${dateTimeLabel(row.lastSeenAt)}` : ""}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">{row.presentDays}</td>
                  <td className="px-4 py-3 font-semibold text-red-700">{row.absentDays}</td>
                  <td className="px-4 py-3 font-semibold text-zinc-600">{row.justifiedDays}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(row.paymentStatus)}`}>{row.paymentLabel}</span>
                    <p className="mt-1 text-xs text-zinc-500">Cargos del mes ${money(row.billed)} - pagado en el mes ${money(row.paid)}</p>
                  </td>
                  <td className="px-4 py-3 font-semibold">${money(row.balance)}</td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-sm text-zinc-500" colSpan={7}>No hay personas para los filtros seleccionados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
