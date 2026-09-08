import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Building2, CheckCircle2, Clock3, Plus, UsersRound, Wallet, X } from "lucide-react";
import type { AppData, StaffPaymentRequest, User } from "../../types";
import { SelectInput, TextInput } from "../../components/views/shared";
import { money } from "../../utils/format";
import { TournamentDialog } from "../tournaments/TournamentDialog";
import "../tournaments/tournaments.css";
import { CoachCreatePage } from "./CoachCreatePage";
import { coachName, coachStudents, coachPayrollExpenses, payrollData, type CoachesSection } from "./coachWorkspaceModel";
import "./coaches.css";

type Props = {
  data: AppData; section: CoachesSection; canManage: boolean;
  onSelectSection: (section: CoachesSection) => void;
  onCreate: (payload: unknown) => Promise<User>;
  onRequestPayment: (payload: unknown) => Promise<StaffPaymentRequest>;
};
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
const cash = (value: string | number) => `$${money(value)}`;
const hours = (value: number | string) => `${Number(value).toLocaleString("es-MX", { maximumFractionDigits: 2 })} h`;
const paymentLabels = { requested: "Por confirmar", accepted: "Aceptado", rejected: "Rechazado", canceled: "Cancelado" };
const paymentTones = { requested: "warning", accepted: "success", rejected: "error", canceled: "muted" };

export function CoachesWorkspace(props: Props) {
  const [site, setSite] = useState("");
  const [coach, setCoach] = useState("");
  const [month, setMonth] = useState(today().slice(0, 7));
  const [notice, setNotice] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const openPayroll = (id?: number) => { setCoach(id ? String(id) : ""); props.onSelectSection("payroll"); };
  return <div className="coach-ui" data-testid="coaches-workspace">
    {notice && <div className="coach-notice success" role="status"><CheckCircle2 size={18} /><span>{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice("")}><X size={17} /></button></div>}
    {props.section === "create" ? props.canManage ? <CoachCreatePage data={props.data} onBack={() => props.onSelectSection("overview")} onCreate={props.onCreate} /> : <p className="coach-notice warning">Solo administración puede crear cuentas de coach.</p>
      : props.section === "overview" ? <CoachOverview data={props.data} site={site} setSite={setSite} canManage={props.canManage} onCreate={() => props.onSelectSection("create")} onPayroll={openPayroll} />
      : <CoachPayroll data={props.data} site={site} setSite={value => { setSite(value); setCoach(""); }} coach={coach} setCoach={setCoach} month={month} setMonth={setMonth} canManage={props.canManage} onRequest={() => setPaymentOpen(true)} />}
    {paymentOpen && props.canManage && <CoachPaymentDialog data={props.data} initialCoach={coach} initialSite={site} onClose={() => setPaymentOpen(false)} onSave={async payload => { const result = await props.onRequestPayment(payload); setMonth(result.requested_payment_date.slice(0, 7)); setSite(String(result.site)); setCoach(String(result.recipient)); setNotice("Solicitud de nómina enviada. Queda pendiente de aceptación."); }} />}
  </div>;
}

function SiteOptions({ data }: { data: AppData }) { return <><option value="">Todas las sedes</option>{data.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</>; }
function Stat({ label, value, hint, tone = "info", icon }: { label: string; value: ReactNode; hint: string; tone?: string; icon: ReactNode }) {
  return <article className={`coach-stat ${tone}`}><div><span>{label}</span>{icon}</div><strong>{value}</strong><p>{hint}</p></article>;
}
function Empty({ children }: { children: ReactNode }) { return <p className="coach-empty">{children}</p>; }

function CoachOverview({ data, site, setSite, canManage, onCreate, onPayroll }: { data: AppData; site: string; setSite: (value: string) => void; canManage: boolean; onCreate: () => void; onPayroll: (id?: number) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [query, status, site]);
  const rows = useMemo(() => data.users.filter(user => user.role === "coach" && (!site || String(user.primary_site) === site) && (!status || user.is_active === (status === "active")) && `${coachName(user)} ${user.username} ${user.coach_group_name}`.toLocaleLowerCase("es-MX").includes(query.trim().toLocaleLowerCase("es-MX"))).sort((a, b) => Number(b.is_active) - Number(a.is_active) || coachName(a).localeCompare(coachName(b))), [data.users, site, status, query]);
  const pages = Math.max(1, Math.ceil(rows.length / 8));
  const currentPage = Math.min(page, pages - 1);
  const active = rows.filter(row => row.is_active);
  const covered = new Set(active.flatMap(row => coachStudents(data, row).filter(student => student.status === "active").map(student => student.id)));
  const pending = rows.filter(row => row.is_active && (!row.primary_site || Number(row.coach_hourly_rate) <= 0));
  return <>
    <header className="coach-heading"><div><p className="coach-eyebrow">Coaches / Resumen</p><h2>Tu equipo de coaches</h2><p>Revisa sus grupos, alumnos y datos pendientes de completar.</p></div>{canManage && <button className="coach-button primary" onClick={onCreate}><Plus size={17} />Nuevo coach</button>}</header>
    <div className="coach-surface coach-filters"><TextInput label="Buscar coach o grupo" placeholder="Nombre, usuario o grupo" value={query} onChange={event => setQuery(event.target.value)} /><SelectInput label="Sede" value={site} onChange={event => setSite(event.target.value)}><SiteOptions data={data} /></SelectInput><SelectInput label="Estado de la cuenta" value={status} onChange={event => setStatus(event.target.value)}><option value="">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></SelectInput></div>
    <div className="coach-stats"><Stat label="Coaches activos" value={active.length} hint={`${rows.length - active.length} cuentas inactivas en esta selección`} tone="success" icon={<UsersRound size={18} />} /><Stat label="Alumnos activos atendidos" value={covered.size} hint="Por sede y grupo, sin duplicar alumnos" icon={<UsersRound size={18} />} /><Stat label="Datos por completar" value={pending.length} hint="Coaches activos sin sede o con tarifa en cero" tone={pending.length ? "warning" : "success"} icon={<Building2 size={18} />} /></div>
    <div className="coach-section-heading"><div><h3>Directorio de coaches</h3><p>{rows.length} coaches encontrados · asignación actual por sede y grupo</p></div><button className="coach-back" onClick={() => onPayroll()}>Ver nómina y horas <ArrowRight size={16} /></button></div>
    <div className="coach-directory">{rows.slice(currentPage * 8, (currentPage + 1) * 8).map(row => {
      const students = coachStudents(data, row).filter(student => student.status === "active");
      return <article className="coach-surface coach-card" key={row.id}><header><span className="coach-avatar">{coachName(row).split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span><div><h3>{coachName(row)}</h3><p>@{row.username}</p></div><span className={`coach-badge ${row.is_active ? "success" : "muted"}`}>{row.is_active ? "Activo" : "Inactivo"}</span></header>
        <dl className="coach-card-details"><div><dt>Sede</dt><dd>{data.sites.find(item => item.id === row.primary_site)?.name || row.primary_site_name || "Sin sede asignada"}</dd></div><div><dt>Grupo</dt><dd>{row.primary_site ? row.coach_group_name || "Todos los grupos de la sede" : "Pendiente de asignar sede"}</dd></div></dl>
        <div className="coach-card-numbers"><div><strong>{students.length}</strong><span>alumnos activos</span></div><div><strong>{cash(row.coach_hourly_rate)}</strong><span>tarifa actual / hora</span></div></div>
        {row.is_active && (!row.primary_site || Number(row.coach_hourly_rate) <= 0) && <p className="coach-inline-warning">{!row.primary_site ? "Falta asignar una sede." : "Tarifa en cero: las nuevas horas no generarán importe."} {canManage && "Puedes actualizarla en Usuarios."}</p>}
        <footer><span>{row.phone || row.email || "Sin contacto registrado"}</span><button className="coach-back" onClick={() => onPayroll(row.id)}>Nómina y horas <ArrowRight size={15} /></button></footer></article>;
    })}</div>{pages > 1 && <div className="coach-pagination"><span>Página {currentPage + 1} de {pages} · {rows.length} coaches</span><button className="coach-button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Anterior</button><button className="coach-button" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button></div>}{!rows.length && <Empty>No hay coaches que coincidan con los filtros.</Empty>}
  </>;
}

function CoachPayroll({ data, site, setSite, coach, setCoach, month, setMonth, canManage, onRequest }: { data: AppData; site: string; setSite: (value: string) => void; coach: string; setCoach: (value: string) => void; month: string; setMonth: (value: string) => void; canManage: boolean; onRequest: () => void }) {
  const [detail, setDetail] = useState<"hours" | "payments" | "expenses">("hours");
  const [paymentStatus, setPaymentStatus] = useState("");
  const detailSection = useRef<HTMLElement>(null);
  const model = useMemo(() => payrollData(data, { month, site, coach }), [data, month, site, coach]);
  const expenses = useMemo(() => coachPayrollExpenses(data, { month, site, coach }), [data, month, site, coach]);
  const options = new Map(data.users.filter(user => user.role === "coach").map(user => [user.id, coachName(user)]));
  data.coachWorkLogs.forEach(log => { if (!options.has(log.coach)) options.set(log.coach, log.coach_name || log.coach_username || `Coach #${log.coach}`); });
  data.staffPaymentRequests.filter(request => request.kind === "coach_payroll").forEach(request => { if (!options.has(request.recipient)) options.set(request.recipient, request.recipient_name || request.recipient_username || `Receptor #${request.recipient}`); });
  const paymentRows = model.requests.filter(request => !paymentStatus || request.status === paymentStatus);
  const ids = [...new Set([...model.logs.map(log => log.coach), ...model.requests.map(request => request.recipient)])];
  return <>
    <header className="coach-heading"><div><p className="coach-eyebrow">Coaches / Nómina y horas</p><h2>Nómina y horas</h2><p>Consulta la bitácora y el estado de los pagos del periodo.</p></div>{canManage && <button className="coach-button primary" onClick={onRequest}><Plus size={17} />Solicitar pago</button>}</header>
    <div className="coach-surface coach-filters"><div><TextInput label="Mes de consulta" type="month" value={month} onChange={event => setMonth(event.target.value)} /><button className="coach-back mt-2" onClick={() => setMonth(month ? "" : today().slice(0, 7))}>{month ? "Ver todo el historial" : "Volver al mes actual"}</button></div><SelectInput label="Sede del registro" value={site} onChange={event => setSite(event.target.value)}><SiteOptions data={data} /></SelectInput><SelectInput label="Coach" value={coach} onChange={event => setCoach(event.target.value)}><option value="">Todos los coaches</option>{[...options].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</SelectInput></div>
    <p className="coach-period">{month ? `Periodo: ${month}` : "Todo el historial"}. Horas por fecha de actividad; pagos por fecha solicitada.</p>
    <div className="coach-stats four"><Stat label="Horas registradas" value={hours(model.hours)} hint={`${model.logs.length} registros de actividad`} icon={<Clock3 size={18} />} /><Stat label="Importe por horas" value={cash(model.estimated)} hint="Estimado con la tarifa histórica de cada registro" icon={<Wallet size={18} />} /><Stat label="Por confirmar" value={cash(model.pending)} hint={`${model.pendingCount} solicitudes pendientes de aceptación`} tone={model.pendingCount ? "warning" : "success"} icon={<Clock3 size={18} />} /><Stat label="Pagos aceptados" value={cash(model.accepted)} hint="Solicitudes con aceptación registrada" tone="success" icon={<CheckCircle2 size={18} />} /></div>
    {expenses.rows.length > 0 && <div className={`coach-notice ${expenses.pending ? "warning" : "success"}`}><Wallet size={18} /><span>Gastos de nómina del periodo: <strong>{cash(expenses.pending)} por aprobar</strong> · {cash(expenses.approved)} aprobados.</span><button className="coach-back" onClick={() => { setDetail("expenses"); requestAnimationFrame(() => detailSection.current?.scrollIntoView({ behavior: "smooth", block: "start" })); }}>Ver gastos</button></div>}
    <p className="coach-hint">El importe por horas y las solicitudes son registros independientes: no representan un saldo pendiente de nómina.</p>
    <section className="coach-surface"><div className="coach-section-heading padded"><h3>Resumen por coach</h3><span className="coach-badge info">{ids.length} con actividad</span></div><div className="coach-table-scroll"><table><thead><tr><th>Coach</th><th>Horas</th><th>Importe por horas</th><th>Por confirmar</th><th>Pagos aceptados</th></tr></thead><tbody>{ids.map(id => { const row = payrollData(data, { month, site, coach: String(id) }); return <tr key={id}><td><button className="coach-back" onClick={() => setCoach(String(id))}>{options.get(id)}</button></td><td>{hours(row.hours)}</td><td>{cash(row.estimated)}</td><td><span className={`coach-badge ${row.pendingCount ? "warning" : "muted"}`}>{cash(row.pending)}</span></td><td>{cash(row.accepted)}</td></tr>; })}</tbody></table></div>{!ids.length && <Empty>No hay horas ni solicitudes para esta selección.</Empty>}</section>
    <section ref={detailSection} className="coach-surface coach-detail-section"><div className="coach-section-heading padded"><div className="coach-detail-switch" aria-label="Detalle de nómina"><button aria-pressed={detail === "hours"} onClick={() => setDetail("hours")}>Bitácora de horas <span>{model.logs.length}</span></button><button aria-pressed={detail === "payments"} onClick={() => setDetail("payments")}>Solicitudes de pago <span>{model.requests.length}</span></button><button aria-pressed={detail === "expenses"} onClick={() => setDetail("expenses")}>Gastos de nómina <span>{expenses.rows.length}</span></button></div>{detail === "payments" && <SelectInput label="Estado del pago" value={paymentStatus} onChange={event => setPaymentStatus(event.target.value)}><option value="">Todos los estados</option>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</SelectInput>}</div>
      {detail === "hours" ? <><p className="coach-hint padded-hint">Las horas se registran desde la cuenta del coach.</p><PagedTable key={`hours:${month}:${site}:${coach}`} rows={model.logs} columns={["Fecha / actividad", "Coach / sede", "Grupo", "Horas", "Tarifa histórica", "Importe"]} render={log => <tr key={log.id}><td><strong>{log.work_date}</strong><span className="coach-cell-note">{log.activity}</span>{log.notes && <span className="coach-cell-note">{log.notes}</span>}</td><td>{options.get(log.coach)}<span className="coach-cell-note">{log.site_name || data.sites.find(row => row.id === log.site)?.name}</span></td><td>{log.group_name || "Todos los grupos"}</td><td>{hours(log.hours)}</td><td>{cash(log.hourly_rate_snapshot)}</td><td>{cash(log.total_amount)}</td></tr>} empty="No hay horas registradas en este periodo." /></>
      : detail === "payments" ? <PagedTable key={`payments:${month}:${site}:${coach}:${paymentStatus}`} rows={paymentRows} columns={["Fecha solicitada", "Coach / sede", "Concepto", "Monto", "Estado"]} render={request => <tr key={request.id}><td>{request.requested_payment_date}</td><td>{options.get(request.recipient)}<span className="coach-cell-note">{request.site_name || data.sites.find(row => row.id === request.site)?.name}</span></td><td>{request.description}{request.response_notes && <span className="coach-cell-note">{request.response_notes}</span>}</td><td>{cash(request.amount)}</td><td><span className={`coach-badge ${paymentTones[request.status]}`}>{paymentLabels[request.status]}</span></td></tr>} empty="No hay solicitudes de pago con estos filtros." />
      : <><p className="coach-hint padded-hint">Gastos de coaches capturados en Gastos o generados por una solicitud aceptada. No se suman a los pagos aceptados porque pueden representar el mismo movimiento. Se consultan por fecha del gasto.</p>{coach && <p className="coach-hint padded-hint">Por coach se muestran solo gastos vinculados a su solicitud. Selecciona «Todos los coaches» para consultar también los gastos sin un receptor vinculado.</p>}<PagedTable key={`expenses:${month}:${site}:${coach}`} rows={expenses.rows} columns={["Fecha / sede", "Persona / concepto", "Origen", "Monto", "Estado"]} render={expense => <tr key={expense.id}><td>{expense.expense_date}<span className="coach-cell-note">{expense.site_name || data.sites.find(row => row.id === expense.site)?.name}</span></td><td>{expense.provider_name || "Sin persona registrada"}<span className="coach-cell-note">{expense.description}</span></td><td>{expenses.linked.has(expense.id) ? "Solicitud de pago" : "Capturado en Gastos"}</td><td>{cash(expense.amount)}</td><td><span className={`coach-badge ${expense.status === "approved" ? "success" : expense.status === "pending" ? "warning" : expense.status === "rejected" ? "error" : "muted"}`}>{{ approved: "Aprobado", pending: "Por aprobar", rejected: "Rechazado", canceled: "Cancelado" }[expense.status]}</span></td></tr>} empty="No hay gastos de nómina para estos filtros." /></>}
    </section>
  </>;
}

function PagedTable<T>({ rows, columns, render, empty }: { rows: T[]; columns: string[]; render: (row: T) => ReactNode; empty: string }) {
  const [page, setPage] = useState(0);
  const count = Math.max(1, Math.ceil(rows.length / 12));
  const current = Math.min(page, count - 1);
  return <><div className="coach-table-scroll"><table><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.slice(current * 12, (current + 1) * 12).map(render)}</tbody></table></div>{!rows.length && <Empty>{empty}</Empty>}{count > 1 && <div className="coach-pagination"><span>Página {current + 1} de {count} · {rows.length} registros</span><button className="coach-button" disabled={!current} onClick={() => setPage(current - 1)}>Anterior</button><button className="coach-button" disabled={current + 1 === count} onClick={() => setPage(current + 1)}>Siguiente</button></div>}</>;
}

function CoachPaymentDialog({ data, initialCoach, initialSite, onClose, onSave }: { data: AppData; initialCoach: string; initialSite: string; onClose: () => void; onSave: (payload: unknown) => Promise<void> }) {
  const coaches = data.users.filter(row => row.role === "coach" && row.is_active);
  const [recipient, setRecipient] = useState(coaches.some(row => String(row.id) === initialCoach) ? initialCoach : "");
  const selected = coaches.find(row => String(row.id) === recipient);
  const [site, setSite] = useState(initialSite || (selected?.primary_site ? String(selected.primary_site) : ""));
  return <TournamentDialog title="Solicitar pago de nómina" description="El pago quedará por confirmar hasta que se registre su aceptación." submitLabel="Enviar solicitud" onClose={onClose} onSubmit={async form => {
    if (!recipient || !site) throw new Error("Selecciona el coach y la sede del pago.");
    await onSave({ recipient: Number(recipient), site: Number(site), kind: "coach_payroll", amount: form.get("amount"), requested_payment_date: form.get("date"), description: String(form.get("description") || "").trim(), payment_method: form.get("method") });
  }}><div className="coach-ui coach-form-grid"><SelectInput label="Coach que recibe" required value={recipient} onChange={event => { setRecipient(event.target.value); const next = coaches.find(row => String(row.id) === event.target.value); setSite(next?.primary_site ? String(next.primary_site) : ""); }}><option value="">Selecciona un coach</option>{coaches.map(row => <option key={row.id} value={row.id}>{coachName(row)}</option>)}</SelectInput><SelectInput label="Sede del pago" required value={site} onChange={event => setSite(event.target.value)}><option value="">Selecciona una sede</option>{data.sites.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</SelectInput><TextInput name="amount" label="Monto (MXN)" required type="number" min="0.01" max="9999999999.99" step="0.01" placeholder="0.00" /><TextInput name="date" label="Fecha solicitada de pago" required type="date" defaultValue={today()} /><TextInput name="description" label="Concepto y periodo que cubre" required maxLength={220} placeholder="Ej. Entrenamientos del 1 al 15 de septiembre" /><SelectInput name="method" label="Forma de pago" defaultValue="cash"><option value="cash">Efectivo</option><option value="transfer">Transferencia</option></SelectInput></div>{!coaches.length && <p className="tournament-feedback warning">Necesitas un coach activo para solicitar su pago.</p>}</TournamentDialog>;
}
