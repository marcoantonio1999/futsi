import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Metric } from "../cards/Metric";
import { ChartCardHeader } from "../charts/ChartHelp";
import { MiniMoneyTooltip } from "../charts/ChartTooltips";
import { compactMoney, money } from "../../utils/format";
import type { AppData, StaffPaymentRequest, User } from "../../types";
import { getCoachStudentLoad } from "./coachLoad";
import { staffPaymentStatusLabel, TableHeader } from "./shared";

type MoneyRow = { label: string; value: number };
type CoachPayrollRow = {
  coach: User;
  name: string;
  siteName: string;
  groupName: string;
  students: number;
  activeStudents: number;
  debtStudents: number;
  medicalStudents: number;
  loggedHours: number;
  estimatedPayroll: number;
  requestedPayroll: number;
  acceptedPayroll: number;
};

function amount(value: string | number | null | undefined) {
  return Number(value || 0);
}

function userName(user: User) {
  return `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.username;
}

function monthKey(dateValue: string | null | undefined) {
  return (dateValue || "").slice(0, 7) || "Sin fecha";
}

function paymentSum(requests: StaffPaymentRequest[], status?: StaffPaymentRequest["status"]) {
  return requests
    .filter((request) => !status || request.status === status)
    .reduce((sum, request) => sum + amount(request.amount), 0);
}

function buildCoachRows(data: AppData): CoachPayrollRow[] {
  const loadRows = getCoachStudentLoad(data);
  return loadRows.map((row) => {
    const coachRequests = data.staffPaymentRequests.filter((request) => request.kind === "coach_payroll" && request.recipient === row.coach.id);
    const workLogs = data.coachWorkLogs.filter((log) => log.coach === row.coach.id);
    return {
      coach: row.coach,
      name: row.coachName,
      siteName: row.siteName,
      groupName: row.groupName,
      students: row.totalStudents,
      activeStudents: row.activeStudents,
      debtStudents: row.debtStudents,
      medicalStudents: row.medicalStudents,
      loggedHours: workLogs.reduce((sum, log) => sum + amount(log.hours), 0),
      estimatedPayroll: workLogs.reduce((sum, log) => sum + amount(log.total_amount), 0),
      requestedPayroll: paymentSum(coachRequests),
      acceptedPayroll: paymentSum(coachRequests, "accepted"),
    };
  });
}

function statusRows(requests: StaffPaymentRequest[]): MoneyRow[] {
  return [
    { label: "Solicitado", value: paymentSum(requests, "requested") },
    { label: "Aceptado", value: paymentSum(requests, "accepted") },
    { label: "Rechazado", value: paymentSum(requests, "rejected") },
    { label: "Cancelado", value: paymentSum(requests, "canceled") },
  ];
}

function payrollByMonth(requests: StaffPaymentRequest[]) {
  const months = new Map<string, number>();
  requests.forEach((request) => months.set(monthKey(request.requested_payment_date), (months.get(monthKey(request.requested_payment_date)) || 0) + amount(request.amount)));
  return [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value }));
}

function MiniCountTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0]?.value || 0);
  const name = payload[0]?.payload?.label || payload[0]?.name || label;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-zinc-900">{name}</p>
      <p className="text-zinc-600">{value.toLocaleString("es-MX")} alumnos</p>
    </div>
  );
}

function MoneyBarCard({
  title,
  eyebrow,
  rows,
  color,
  help,
  valueKind = "money",
}: {
  title: string;
  eyebrow: string;
  rows: MoneyRow[];
  color: string;
  help: string;
  valueKind?: "money" | "count";
}) {
  const chartRows = rows.filter((row) => row.value > 0).slice(0, 10);
  const isMoney = valueKind === "money";
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader eyebrow={eyebrow} title={title} help={help} />
      <div className="h-[320px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows.length ? chartRows : [{ label: "Sin datos", value: 0 }]} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 18 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e4e7" />
            <XAxis type="number" tickFormatter={(value) => isMoney ? compactMoney(Number(value)) : Number(value).toLocaleString("es-MX")} tick={{ fontSize: 12, fill: "#71717a" }} />
            <YAxis dataKey="label" type="category" width={118} tick={{ fontSize: 12, fill: "#71717a" }} />
            <Tooltip content={isMoney ? <MiniMoneyTooltip /> : <MiniCountTooltip />} />
            <Bar dataKey="value" fill={color} radius={[0, 6, 6, 0]} animationDuration={850} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function StatusDonut({ title, rows, help }: { title: string; rows: MoneyRow[]; help: string }) {
  const colors = ["#f59e0b", "#2563eb", "#ef4444", "#71717a"];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const visibleRows = rows.filter((row) => row.value > 0);
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader eyebrow="Flujo de pagos" title={title} help={help} />
      <div className="grid gap-4 p-4 sm:grid-cols-[210px_1fr]">
        <div className="relative h-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={visibleRows.length ? visibleRows : [{ label: "Sin datos", value: 1 }]} dataKey="value" nameKey="label" innerRadius={58} outerRadius={90} paddingAngle={3}>
                {(visibleRows.length ? visibleRows : [{ label: "Sin datos", value: 1 }]).map((row, index) => (
                  <Cell key={row.label} fill={visibleRows.length ? colors[index % colors.length] : "#d4d4d8"} />
                ))}
              </Pie>
              <Tooltip content={<MiniMoneyTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-xs uppercase text-zinc-500">Total</p>
              <p className="text-xl font-semibold">${money(total)}</p>
            </div>
          </div>
        </div>
        <div className="grid content-center gap-3">
          {rows.map((row, index) => (
            <div key={row.label} className="flex items-center justify-between gap-3 rounded-md bg-zinc-50 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                {row.label}
              </span>
              <span>${money(row.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MonthlyLineCard({ title, rows, color, help }: { title: string; rows: MoneyRow[]; color: string; help: string }) {
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader eyebrow="Linea de tiempo" title={title} help={help} />
      <div className="h-[300px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows.length ? rows : [{ label: "Sin datos", value: 0 }]} margin={{ top: 10, right: 24, bottom: 8, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#71717a" }} />
            <YAxis tickFormatter={(value) => compactMoney(Number(value))} tick={{ fontSize: 12, fill: "#71717a" }} />
            <Tooltip content={<MiniMoneyTooltip />} />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} animationDuration={850} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function CoachesConsolidatedPanel({ data }: { data: AppData }) {
  const rows = buildCoachRows(data);
  const coachRequests = data.staffPaymentRequests.filter((request) => request.kind === "coach_payroll");
  const totalStudents = rows.reduce((sum, row) => sum + row.students, 0);
  const totalHours = rows.reduce((sum, row) => sum + row.loggedHours, 0);
  const totalAccepted = rows.reduce((sum, row) => sum + row.acceptedPayroll, 0);
  const averageStudents = rows.length ? totalStudents / rows.length : 0;
  const byCoach = rows.map((row) => ({ label: row.name, value: row.students })).sort((a, b) => b.value - a.value);
  const payrollByCoach = rows.map((row) => ({ label: row.name, value: row.acceptedPayroll || row.requestedPayroll })).sort((a, b) => b.value - a.value);

  return (
    <div className="grid min-w-0 gap-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Coaches activos" value={rows.length} />
        <Metric label="Alumnos asignados" value={totalStudents} helper={`Promedio ${averageStudents.toFixed(1)} por coach`} />
        <Metric label="Horas registradas" value={totalHours.toFixed(1)} helper="Bitacora operativa del coach" />
        <Metric label="Nomina aceptada" value={`$${money(totalAccepted)}`} helper="Pagos confirmados por usuario" />
      </section>

      <section className="grid min-w-0 gap-5 lg:grid-cols-2">
        <MoneyBarCard
          eyebrow="Carga operativa"
          title="Alumnos por coach"
          rows={byCoach}
          color="#2563eb"
          help="Ordena a los coaches por alumnos asignados. Sirve para revisar sobrecarga, balance de grupos y si algun coach atiende demasiados alumnos frente a otros."
          valueKind="count"
        />
        <MoneyBarCard
          eyebrow="Nomina"
          title="Nomina por coach"
          rows={payrollByCoach}
          color="#dc2626"
          help="Muestra el dinero pagado o solicitado por coach. Comparalo contra alumnos y horas para detectar pagos fuera de proporcion."
        />
      </section>

      <section className="grid min-w-0 gap-5 lg:grid-cols-2">
        <StatusDonut
          title="Estatus de pagos a coaches"
          rows={statusRows(coachRequests)}
          help="Distribuye la nomina de coaches entre solicitado, aceptado, rechazado y cancelado. Lo sano es que no se acumulen solicitudes sin respuesta."
        />
        <MonthlyLineCard
          title="Nomina coaches por mes"
          rows={payrollByMonth(coachRequests)}
          color="#2563eb"
          help="Sigue la tendencia mensual de pagos a coaches. Un pico debe explicarse por mas horas, mas alumnos, bonos o pagos atrasados."
        />
      </section>

      <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Consolidado de coaches" count={rows.length} />
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Coach</th>
                <th className="px-4 py-3">Sede</th>
                <th className="px-4 py-3">Grupo</th>
                <th className="px-4 py-3">Alumnos</th>
                <th className="px-4 py-3">Activos</th>
                <th className="px-4 py-3">Adeudo</th>
                <th className="px-4 py-3">Alertas medicas</th>
                <th className="px-4 py-3">Horas</th>
                <th className="px-4 py-3">Estimado</th>
                <th className="px-4 py-3">Pagado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.coach.id} className="border-b border-zinc-100">
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3">{row.siteName}</td>
                  <td className="px-4 py-3">{row.groupName}</td>
                  <td className="px-4 py-3">{row.students}</td>
                  <td className="px-4 py-3">{row.activeStudents}</td>
                  <td className="px-4 py-3">{row.debtStudents}</td>
                  <td className="px-4 py-3">{row.medicalStudents}</td>
                  <td className="px-4 py-3">{row.loggedHours.toFixed(1)}</td>
                  <td className="px-4 py-3">${money(row.estimatedPayroll)}</td>
                  <td className="px-4 py-3 font-semibold">${money(row.acceptedPayroll)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function RefereesConsolidatedPanel({ data }: { data: AppData }) {
  const refereeRequests = data.staffPaymentRequests.filter((request) => request.kind === "referee_payroll");
  const refereeExpenses = data.expenses.filter((expense) => `${expense.category} ${expense.description} ${expense.provider_name}`.toLowerCase().includes("arbitr"));
  const refereeSiteRows = data.sites
    .map((site) => ({
      label: site.name,
      value:
        refereeRequests.filter((request) => request.site === site.id).reduce((sum, request) => sum + amount(request.amount), 0) +
        refereeExpenses.filter((expense) => expense.site === site.id && expense.status === "approved").reduce((sum, expense) => sum + amount(expense.amount), 0),
    }))
    .sort((a, b) => b.value - a.value);
  const recipients = new Map<number, { name: string; total: number; accepted: number; requested: number; count: number }>();
  refereeRequests.forEach((request) => {
    const current = recipients.get(request.recipient) || {
      name: request.recipient_name || request.recipient_username || `Usuario ${request.recipient}`,
      total: 0,
      accepted: 0,
      requested: 0,
      count: 0,
    };
    current.total += amount(request.amount);
    current.count += 1;
    if (request.status === "accepted") current.accepted += amount(request.amount);
    if (request.status === "requested") current.requested += amount(request.amount);
    recipients.set(request.recipient, current);
  });
  const recipientRows = [...recipients.values()].sort((a, b) => b.total - a.total);
  const totalRequested = paymentSum(refereeRequests);
  const totalAccepted = paymentSum(refereeRequests, "accepted");
  const totalExpenses = refereeExpenses.filter((expense) => expense.status === "approved").reduce((sum, expense) => sum + amount(expense.amount), 0);
  const matchCount = data.matches.length || 1;

  return (
    <div className="grid min-w-0 gap-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Solicitudes arbitraje" value={refereeRequests.length} />
        <Metric label="Nomina arbitros aceptada" value={`$${money(totalAccepted)}`} />
        <Metric label="Gasto arbitraje aprobado" value={`$${money(totalExpenses)}`} />
        <Metric label="Costo promedio por partido" value={`$${money((totalAccepted || totalExpenses) / matchCount)}`} helper={`${data.matches.length} partidos registrados`} />
      </section>

      <section className="grid min-w-0 gap-5 lg:grid-cols-2">
        <MoneyBarCard
          eyebrow="Costo por sede"
          title="Arbitraje por sede"
          rows={refereeSiteRows}
          color="#dc2626"
          help="Muestra cuanto cuesta el arbitraje por sede sumando solicitudes de pago y gastos aprobados. Las barras mas largas requieren revision operativa."
        />
        <StatusDonut
          title="Estatus de pagos a arbitros"
          rows={statusRows(refereeRequests)}
          help="Distribuye pagos de arbitraje por estatus. Si solicitado es alto, hay pagos pendientes de confirmar; si rechazado sube, hay friccion operativa."
        />
      </section>

      <section className="grid min-w-0 gap-5 lg:grid-cols-2">
        <MonthlyLineCard
          title="Nomina arbitros por mes"
          rows={payrollByMonth(refereeRequests)}
          color="#dc2626"
          help="Sigue la tendencia mensual de pagos a arbitros. Debe moverse junto con jornadas, dobles jornadas y numero de partidos."
        />
        <MoneyBarCard
          eyebrow="Responsables"
          title="Pagos por receptor"
          rows={recipientRows.map((row) => ({ label: row.name, value: row.total }))}
          color="#7c3aed"
          help="Agrupa pagos por usuario receptor. En produccion conviene separar arbitros como usuarios propios; en la demo algunos pagos caen a responsables operativos."
        />
      </section>

      <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Solicitudes de pago a arbitros" count={refereeRequests.length} />
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Receptor</th>
                <th className="px-4 py-3">Sede</th>
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Descripcion</th>
                <th className="px-4 py-3">Monto</th>
                <th className="px-4 py-3">Estatus</th>
                <th className="px-4 py-3">Solicito</th>
              </tr>
            </thead>
            <tbody>
              {refereeRequests.map((request) => (
                <tr key={request.id} className="border-b border-zinc-100">
                  <td className="px-4 py-3 font-medium">{request.recipient_name || request.recipient_username}</td>
                  <td className="px-4 py-3">{request.site_name}</td>
                  <td className="px-4 py-3">{request.requested_payment_date}</td>
                  <td className="px-4 py-3">{request.description}</td>
                  <td className="px-4 py-3">${money(request.amount)}</td>
                  <td className="px-4 py-3">{staffPaymentStatusLabel(request.status)}</td>
                  <td className="px-4 py-3">{request.requested_by_username}</td>
                </tr>
              ))}
              {refereeRequests.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    No hay solicitudes de arbitraje registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
