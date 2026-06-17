import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import type { AppData, Charge, Payment, Site, Student } from "../../types";
import { StatusPill, TableHeader } from "./shared";

type UniformSiteRow = {
  site: Site;
  totalStudents: number;
  delivered: number;
  paid: number;
  pending: number;
  uniformCharges: number;
  paidAmount: number;
  balance: number;
};

type ChartRow = { label: string; value: number };

const designPalettes = [
  { primary: "#047857", secondary: "#111827", accent: "#f8fafc", pattern: "Franja diagonal" },
  { primary: "#1d4ed8", secondary: "#0f172a", accent: "#dbeafe", pattern: "Panel central" },
  { primary: "#dc2626", secondary: "#111827", accent: "#fee2e2", pattern: "Mangas contraste" },
  { primary: "#7c3aed", secondary: "#18181b", accent: "#ede9fe", pattern: "Banda lateral" },
  { primary: "#0891b2", secondary: "#164e63", accent: "#ecfeff", pattern: "Cuello contraste" },
  { primary: "#ca8a04", secondary: "#1c1917", accent: "#fef3c7", pattern: "Doble linea" },
  { primary: "#be123c", secondary: "#27272a", accent: "#ffe4e6", pattern: "Escudo alto" },
  { primary: "#4338ca", secondary: "#020617", accent: "#e0e7ff", pattern: "Hombro solido" },
];

function amount(value: string | number | null | undefined) {
  return Number(value || 0);
}

function isUniformConcept(text: string | undefined | null) {
  return (text || "").toLowerCase().includes("uniform");
}

function statusLabel(status: string) {
  if (status === "delivered") return "Entregado";
  if (status === "paid") return "Pagado sin entregar";
  return "Pendiente";
}

function statusTone(status: string) {
  if (status === "delivered") return "ok";
  if (status === "paid") return "warn";
  return "danger";
}

function buildUniformRows(data: AppData): UniformSiteRow[] {
  const uniformCharges = data.charges.filter((charge) => isUniformConcept(charge.concept) || isUniformConcept(charge.description));
  const uniformPayments = data.payments.filter((payment) => isUniformConcept(payment.charge_concept) || uniformCharges.some((charge) => charge.id === payment.charge));

  return data.sites.map((site) => {
    const students = data.students.filter((student) => student.site === site.id);
    const siteCharges = uniformCharges.filter((charge) => charge.site === site.id);
    const sitePayments = uniformPayments.filter((payment) => {
      const charge = uniformCharges.find((item) => item.id === payment.charge);
      return payment.site === site.id || charge?.site === site.id;
    });
    return {
      site,
      totalStudents: students.length,
      delivered: students.filter((student) => student.uniform_status === "delivered").length,
      paid: students.filter((student) => student.uniform_status === "paid").length,
      pending: students.filter((student) => student.uniform_status !== "delivered" && student.uniform_status !== "paid").length,
      uniformCharges: siteCharges.reduce((sum, charge) => sum + amount(charge.amount), 0),
      paidAmount: sitePayments
        .filter((payment) => payment.status === "registered" || payment.status === "reconciled")
        .reduce((sum, payment) => sum + amount(payment.amount), 0),
      balance: siteCharges.reduce((sum, charge) => sum + amount(charge.balance), 0),
    };
  });
}

function UniformTooltip({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm shadow-lg">
      <p className="font-semibold text-zinc-900">{label || payload[0]?.payload?.label}</p>
      {payload.map((item) => (
        <p key={item.dataKey} className="text-zinc-600">
          {item.name}: {Number(item.value || 0).toLocaleString("es-MX")}
        </p>
      ))}
    </div>
  );
}

function UniformStatusChart({ rows }: { rows: ChartRow[] }) {
  const colors = ["#059669", "#f59e0b", "#dc2626"];
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Estatus"
        title="Estado de uniformes"
        help="La dona separa alumnos con uniforme entregado, pagado sin entregar y pendiente. Sirve para detectar deuda operativa: dinero cobrado pero uniforme no entregado, o alumnos activos que todavia deben uniforme."
      />
      <div className="grid gap-4 p-4 sm:grid-cols-[210px_1fr]">
        <div className="relative h-[210px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={rows} dataKey="value" nameKey="label" innerRadius={58} outerRadius={90} paddingAngle={3} animationDuration={850}>
                {rows.map((row, index) => (
                  <Cell key={row.label} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip content={<UniformTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-xs uppercase text-zinc-500">Alumnos</p>
              <p className="text-xl font-semibold">{total}</p>
            </div>
          </div>
        </div>
        <div className="grid content-center gap-3">
          {rows.map((row, index) => {
            const percent = total ? (row.value / total) * 100 : 0;
            return (
              <div key={row.label}>
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                    {row.label}
                  </span>
                  <span className="text-zinc-500">{row.value} ({percent.toFixed(1)}%)</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(3, percent)}%`, backgroundColor: colors[index % colors.length] }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function UniformBySiteChart({ rows }: { rows: UniformSiteRow[] }) {
  const chartRows = rows
    .filter((row) => row.totalStudents > 0)
    .sort((a, b) => b.pending + b.paid - (a.pending + a.paid))
    .slice(0, 10)
    .map((row) => ({ label: row.site.name, Entregados: row.delivered, "Pagados sin entregar": row.paid, Pendientes: row.pending }));

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Sedes"
        title="Uniformes por sede"
        help="Barras apiladas por sede: verde es entregado, amarillo es pagado sin entregar y rojo es pendiente. Las sedes con mas amarillo/rojo requieren accion operativa."
      />
      <div className="h-[340px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows} margin={{ top: 10, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#71717a" }} interval={0} angle={-20} textAnchor="end" height={70} />
            <YAxis tick={{ fontSize: 12, fill: "#71717a" }} />
            <Tooltip content={<UniformTooltip />} />
            <Bar dataKey="Entregados" stackId="a" fill="#059669" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Pagados sin entregar" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Pendientes" stackId="a" fill="#dc2626" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function UniformMoneyChart({ rows }: { rows: UniformSiteRow[] }) {
  const chartRows = rows
    .filter((row) => row.paidAmount > 0 || row.balance > 0)
    .sort((a, b) => b.paidAmount + b.balance - (a.paidAmount + a.balance))
    .slice(0, 8)
    .map((row) => ({ label: row.site.name, Cobrado: row.paidAmount, Pendiente: row.balance }));

  return (
    <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
      <ChartCardHeader
        eyebrow="Cobranza"
        title="Uniformes: cobrado vs pendiente"
        help="Compara dinero ya cobrado por uniformes contra saldo pendiente. Verde es ingreso confirmado y rojo es adeudo abierto relacionado con uniformes."
      />
      <div className="h-[320px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartRows.length ? chartRows : [{ label: "Sin datos", Cobrado: 0, Pendiente: 0 }]} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e4e4e7" />
            <XAxis type="number" tickFormatter={(value) => compactMoney(Number(value))} tick={{ fontSize: 12, fill: "#71717a" }} />
            <YAxis dataKey="label" type="category" width={96} tick={{ fontSize: 12, fill: "#71717a" }} />
            <Tooltip content={<MiniMoneyTooltip />} />
            <Bar dataKey="Cobrado" fill="#059669" radius={[0, 6, 6, 0]} animationDuration={850} />
            <Bar dataKey="Pendiente" fill="#dc2626" radius={[0, 6, 6, 0]} animationDuration={850} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

export function UniformKitPreview({ site, index, compact = false }: { site: Site; index: number; compact?: boolean }) {
  const palette = designPalettes[index % designPalettes.length];
  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-[88px_1fr]" : "grid-cols-[110px_1fr]"}`}>
      <div className={`relative mx-auto ${compact ? "h-28 w-20" : "h-32 w-24"}`}>
        <div className="absolute left-1/2 top-0 h-5 w-10 -translate-x-1/2 rounded-b-full" style={{ backgroundColor: palette.secondary }} />
        <div className="absolute left-3 top-4 h-24 w-18 rounded-t-[28px] rounded-b-md shadow-inner" style={{ backgroundColor: palette.primary }}>
          <div className="absolute inset-y-0 left-1/2 w-4 -translate-x-1/2" style={{ backgroundColor: palette.accent, opacity: 0.9 }} />
          <div className="absolute left-1/2 top-8 grid size-8 -translate-x-1/2 place-items-center rounded-full text-xs font-bold" style={{ backgroundColor: palette.secondary, color: palette.accent }}>
            F
          </div>
        </div>
        <div className="absolute left-0 top-8 h-14 w-5 rounded-l-full" style={{ backgroundColor: palette.secondary }} />
        <div className="absolute right-0 top-8 h-14 w-5 rounded-r-full" style={{ backgroundColor: palette.secondary }} />
        <div className="absolute bottom-0 left-6 h-8 w-12 rounded-md" style={{ backgroundColor: palette.secondary }} />
      </div>
      <div className="grid content-center gap-2 text-sm">
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">Camiseta asignada</p>
          <p className="font-semibold text-zinc-950 dark:text-zinc-50">{site.name}</p>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-300">{palette.pattern}</p>
        </div>
        <div className="flex gap-2">
          {[palette.primary, palette.secondary, palette.accent].map((color) => (
            <span key={color} className="size-5 rounded-full border border-zinc-200" style={{ backgroundColor: color }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function UniformDesignCard({ site, index, row }: { site: Site; index: number; row: UniformSiteRow }) {
  const palette = designPalettes[index % designPalettes.length];
  return (
    <article className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">Uniforme sede</p>
          <h3 className="font-semibold">{site.name}</h3>
          <p className="mt-1 text-sm text-zinc-500">{palette.pattern}</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{row.totalStudents} alumnos</span>
      </div>
      <div className="mt-4 grid grid-cols-[110px_1fr] gap-4">
        <UniformKitPreview site={site} index={index} compact />
        <div className="grid content-center gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Entregados</span>
            <span className="font-semibold">{row.delivered}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Pagados sin entrega</span>
            <span className="font-semibold text-amber-700">{row.paid}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Pendientes</span>
            <span className="font-semibold text-red-700">{row.pending}</span>
          </div>
          <div className="mt-2 flex gap-2">
            {[palette.primary, palette.secondary, palette.accent].map((color) => (
              <span key={color} className="size-5 rounded-full border border-zinc-200" style={{ backgroundColor: color }} />
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export function UniformsPanel({ data }: { data: AppData }) {
  const rows = buildUniformRows(data);
  const uniformCharges = data.charges.filter((charge) => isUniformConcept(charge.concept) || isUniformConcept(charge.description));
  const uniformPayments = data.payments.filter((payment) => isUniformConcept(payment.charge_concept) || uniformCharges.some((charge) => charge.id === payment.charge));
  const pendingStudents = data.students.filter((student) => student.uniform_status !== "delivered");
  const paidNotDelivered = data.students.filter((student) => student.uniform_status === "paid");
  const delivered = data.students.filter((student) => student.uniform_status === "delivered");
  const totalCharged = uniformCharges.reduce((sum, charge) => sum + amount(charge.amount), 0);
  const totalPaid = uniformPayments
    .filter((payment) => payment.status === "registered" || payment.status === "reconciled")
    .reduce((sum, payment) => sum + amount(payment.amount), 0);
  const totalBalance = uniformCharges.reduce((sum, charge) => sum + amount(charge.balance), 0);
  const statusRows = [
    { label: "Entregado", value: delivered.length },
    { label: "Pagado sin entregar", value: paidNotDelivered.length },
    { label: "Pendiente", value: pendingStudents.filter((student) => student.uniform_status !== "paid").length },
  ];

  return (
    <div className="grid min-w-0 gap-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Uniformes cobrados" value={`$${money(totalPaid)}`} helper={`Programado $${money(totalCharged)}`} />
        <Metric label="Saldo pendiente" value={`$${money(totalBalance)}`} />
        <Metric label="Entregados" value={delivered.length} helper={`${data.students.length ? ((delivered.length / data.students.length) * 100).toFixed(1) : "0.0"}% del alumnado`} />
        <Metric label="Pagados sin entregar" value={paidNotDelivered.length} />
        <Metric label="Pendientes operativos" value={pendingStudents.length} />
      </section>

      <section className="grid min-w-0 gap-5 lg:grid-cols-2">
        <UniformStatusChart rows={statusRows} />
        <UniformMoneyChart rows={rows} />
      </section>

      <UniformBySiteChart rows={rows} />

      <section className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row, index) => (
          <UniformDesignCard key={row.site.id} site={row.site} row={row} index={index} />
        ))}
      </section>

      <section className="min-w-0 rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Alumnos con uniforme pendiente o sin entrega" count={pendingStudents.length} />
        <div className="max-w-full overflow-x-auto">
          <table className="w-full min-w-[940px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3">Alumno</th>
                <th className="px-4 py-3">Sede</th>
                <th className="px-4 py-3">Grupo</th>
                <th className="px-4 py-3">Representante</th>
                <th className="px-4 py-3">Telefono</th>
                <th className="px-4 py-3">Estado uniforme</th>
                <th className="px-4 py-3">Adeudo total alumno</th>
              </tr>
            </thead>
            <tbody>
              {pendingStudents.map((student) => (
                <tr key={student.id} className="border-b border-zinc-100">
                  <td className="px-4 py-3 font-medium">{student.full_name}</td>
                  <td className="px-4 py-3">{student.site_name}</td>
                  <td className="px-4 py-3">{student.group_name}</td>
                  <td className="px-4 py-3">{student.guardian_name}</td>
                  <td className="px-4 py-3">{student.guardian_phone}</td>
                  <td className="px-4 py-3"><StatusPill label={statusLabel(student.uniform_status)} tone={statusTone(student.uniform_status) as any} /></td>
                  <td className="px-4 py-3">${money(student.balance_due)}</td>
                </tr>
              ))}
              {pendingStudents.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    No hay uniformes pendientes.
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
