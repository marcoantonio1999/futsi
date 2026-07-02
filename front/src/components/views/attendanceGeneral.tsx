import { useMemo, useState } from "react";
import { Search, UsersRound } from "lucide-react";
import type { AppData, AttendanceRecord, PlayerAttendanceRecord } from "../../types";
import { money } from "../../utils/format";

type Scope = "academy" | "adult";

type AttendanceStatus = AttendanceRecord["status"] | PlayerAttendanceRecord["status"];

type SummaryRow = {
  id: string;
  name: string;
  group: string;
  siteName: string;
  presentDays: number;
  absentDays: number;
  justifiedDays: number;
  totalDays: number;
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

function addStatusDay(days: Record<AttendanceStatus, Set<string>>, status: AttendanceStatus, date?: string) {
  if (!date) return;
  days[status].add(date);
}

function paymentStatus(charges: Array<{ amount: string; paid_amount: string; balance: string; status: string }>) {
  if (!charges.length) {
    return { paymentStatus: "none" as const, paymentLabel: "Sin cargos del mes", billed: 0, paid: 0, balance: 0 };
  }
  const billed = charges.reduce((sum, charge) => sum + Number(charge.amount || 0), 0);
  const paid = charges.reduce((sum, charge) => sum + Number(charge.paid_amount || 0), 0);
  const balance = charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
  if (balance <= 0 || charges.every((charge) => charge.status === "paid")) {
    return { paymentStatus: "paid" as const, paymentLabel: "Pagado", billed, paid, balance: 0 };
  }
  if (paid > 0) {
    return { paymentStatus: "partial" as const, paymentLabel: "Pago parcial", billed, paid, balance };
  }
  return { paymentStatus: "pending" as const, paymentLabel: "No pagado", billed, paid, balance };
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
    const payment = paymentStatus(chargesByStudent.get(student.id) ?? []);
    return {
      id: `student-${student.id}`,
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
    const payment = paymentStatus(chargesByTeam.get(player.team) ?? []);
    return {
      id: `player-${player.id}`,
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

export function AttendanceGeneralPanel({ data, scope }: { data: AppData; scope: Scope }) {
  const [month, setMonth] = useState(currentMonthValue());
  const [query, setQuery] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");

  const rows = useMemo(() => (scope === "adult" ? buildAdultRows(data, month) : buildAcademyRows(data, month)), [data, month, scope]);
  const visibleRows = useMemo(() => {
    const text = normalizeText(query);
    return rows
      .filter((row) => !text || normalizeText(`${row.name} ${row.group} ${row.siteName}`).includes(text))
      .filter((row) => paymentFilter === "all" || row.paymentStatus === paymentFilter)
      .filter((row) => activityFilter === "all" || (activityFilter === "with" ? row.totalDays > 0 : row.totalDays === 0))
      .sort((a, b) => b.balance - a.balance || b.presentDays - a.presentDays || a.name.localeCompare(b.name));
  }, [activityFilter, paymentFilter, query, rows]);

  const titleColorClass = scope === "adult" ? "text-blue-700 dark:text-blue-300" : "text-emerald-700 dark:text-emerald-300";

  return (
    <div className="grid gap-5">
      <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className={`mt-1 flex items-center gap-2 text-lg font-semibold ${titleColorClass}`}>
                <UsersRound size={18} /> Resumen mensual por persona
              </h2>
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
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-xs text-zinc-500">{row.siteName}</p>
                  </td>
                  <td className="px-4 py-3">{row.group}</td>
                  <td className="px-4 py-3 font-semibold text-emerald-700">{row.presentDays}</td>
                  <td className="px-4 py-3 font-semibold text-red-700">{row.absentDays}</td>
                  <td className="px-4 py-3 font-semibold text-zinc-600">{row.justifiedDays}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${statusClass(row.paymentStatus)}`}>{row.paymentLabel}</span>
                    <p className="mt-1 text-xs text-zinc-500">Facturado ${money(row.billed)} - pagado ${money(row.paid)}</p>
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
