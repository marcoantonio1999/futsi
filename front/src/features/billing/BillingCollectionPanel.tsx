import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { AppData, Charge, Student } from "../../types";
import { money } from "../../utils/format";
import { SelectInput, TextInput, chargeStatusLabel } from "../../components/views/shared";
import { chargeSubject, dueLabel, getChargeDueBucket } from "./BillingCollectionRow";
import { BillingCheckout } from "./BillingCheckout";
import type { BillingMutation } from "./billingFlow";
import "./billing.css";
import { BillingStudentIdentity, BillingStudentSelect } from "./BillingStudentSelect";
import { InlineChargeForm } from "./InlineChargeForm";

export function BillingCollectionPanel({ data, token, compact = false, onCreatePlan, onCreateCharge, onCreatePayment, onCreateDiscount, renderStudentExtras, discountActionLabel = "Aplicar descuento" }: {
  data: AppData; token?: string; compact?: boolean; onCreatePayment?: BillingMutation;
  onCreateCharge?: BillingMutation; onCreateDiscount?: BillingMutation; discountActionLabel?: string;
  onCreatePlan?: BillingMutation;
  renderStudentExtras?: (student: Student) => ReactNode;
}) {
  const [filters, setFilters] = useState({ query: "", site: "all", status: "open", concept: "all", due: "all", amountMin: "", amountMax: "", dateFrom: "", dateTo: "" });
  const [advanced, setAdvanced] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [studentId, setStudentId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createdCharges, setCreatedCharges] = useState<Charge[]>([]);
  const allCharges = useMemo(() => [...data.charges, ...createdCharges.filter(item => !data.charges.some(saved => saved.id === item.id))], [data.charges, createdCharges]);
  const eligibleStudents = data.students.filter(item => filters.site === "all" || String(item.site) === filters.site);
  const selectedStudent = eligibleStudents.find(item => item.id === studentId);
  const [accepted, setAccepted] = useState<Record<number, string>>({});
  const pageSize = 6;
  const searching = Boolean(selectedStudent);
  const charges = useMemo(() => allCharges.filter(charge => {
    if (!selectedStudent || charge.student !== selectedStudent.id) return false;
    if (filters.site !== "all" && String(charge.site) !== filters.site) return false;
    if (filters.status === "open" && !["pending", "partial"].includes(charge.status)) return false;
    if (!["open", "all"].includes(filters.status) && charge.status !== filters.status) return false;
    if (filters.concept !== "all" && charge.concept !== filters.concept) return false;
    const due = charge.due_bucket || getChargeDueBucket(charge);
    if (filters.due !== "all" && due !== filters.due) return false;
    if (filters.amountMin && Number(charge.balance) < Number(filters.amountMin)) return false;
    if (filters.amountMax && Number(charge.balance) > Number(filters.amountMax)) return false;
    if (filters.dateFrom && (!charge.due_date || charge.due_date < filters.dateFrom)) return false;
    if (filters.dateTo && (!charge.due_date || charge.due_date > filters.dateTo)) return false;
    return true;
  }).sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || chargeSubject(a).localeCompare(chargeSubject(b))), [allCharges, selectedStudent, filters]);
  useEffect(() => { setPage(1); }, [filters, studentId]);
  const pageCount = Math.max(1, Math.ceil(charges.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const selected = allCharges.find(item => item.id === selectedId && item.student === studentId);
  const summary = charges.filter(item => ["pending", "partial"].includes(item.status));
  const concepts = [...new Set(data.charges.map(item => item.concept))].sort();
  const change = (key: keyof typeof filters, value: string) => setFilters(current => ({ ...current, [key]: value }));
  const visible = searching ? charges.slice((safePage - 1) * pageSize, safePage * pageSize) : [];
  return <div className="billing-workspace">
    <section className="billing-box">
      {selectedStudent && <div className="billing-heading"><div><h2>Cobrar</h2><p>Busca a la persona, elige su cargo y registra el pago recibido.</p></div>
        {searching && <div className="text-right"><strong className="text-xl">${money(summary.reduce((sum, item) => sum + Number(item.balance), 0))}</strong><p className="billing-muted">pendientes en esta búsqueda · {summary.length} cargos</p></div>}
      </div>}
      <fieldset disabled={busy} className={selectedStudent ? "billing-search" : "min-w-0"}>
        <BillingStudentSelect students={selectedStudent ? eligibleStudents : data.students} selected={selectedStudent} onSelect={student => { setStudentId(student?.id ?? null); setSelectedId(null); setCreating(false); change("site", "all"); if (!student) setAdvanced(false); }} />
        {selectedStudent && <><SelectInput label="Sede" value={filters.site} onChange={e => { change("site", e.target.value); setStudentId(null); setSelectedId(null); setCreating(false); }}><option value="all">Todas las sedes</option>{data.sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</SelectInput>
        <button className="billing-secondary" type="button" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}><SlidersHorizontal size={16} /> Filtros</button></>}
      </fieldset>
      {selectedStudent && <div className="billing-person-workspace">
      {selectedStudent && <aside className="billing-person-sidebar"><BillingStudentIdentity key={`${selectedStudent.id}-${selectedStudent.photo_url}`} student={selectedStudent} token={token} /></aside>}
      <div className="billing-person-main">
      {selectedStudent && onCreateCharge && !creating && !selected && <button type="button" className="billing-primary mt-4" onClick={() => setCreating(true)}>+ Nuevo cobro para este alumno</button>}
      {creating && selectedStudent && onCreateCharge && onCreatePayment ? <InlineChargeForm key={selectedStudent.id} student={selectedStudent} data={{ ...data, charges: allCharges }} onCreatePlan={onCreatePlan} onCreateCharge={onCreateCharge} onCreatePayment={onCreatePayment} onCreateDiscount={onCreateDiscount} onBusyChange={setBusy} onCancel={() => setCreating(false)}
        onCompleted={charge => setAccepted(current => ({ ...current, [charge.id]: charge.balance }))} onCreated={charge => { setCreatedCharges(current => [...current, charge]); setFilters(current => ({ ...current, status: "open", concept: "all", due: "all", amountMin: "", amountMax: "", dateFrom: "", dateTo: "" })); }} /> : selected ? <BillingCheckout key={selected.id} embedded charge={selected} data={data} token={token} onCreatePayment={onCreatePayment} onBusyChange={setBusy}
        onCreateDiscount={onCreateDiscount} discountActionLabel={discountActionLabel}
        onClose={() => setSelectedId(null)} onAccepted={() => setAccepted(current => ({ ...current, [selected.id]: selected.balance }))} /> : <>
      <div className="mt-4 flex flex-wrap gap-2">
        {([["open", "Por cobrar"], ["partial", "Abonos pendientes"], ["paid", "Pagados"], ["all", "Todos"]] as const).map(([value, label]) =>
          <button key={value} type="button" className={filters.status === value ? "billing-primary" : "billing-secondary"} aria-pressed={filters.status === value} onClick={() => change("status", value)}>{label}</button>)}
      </div>
      {advanced && <div className="mt-4 grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3">
        <SelectInput label="Estado" value={filters.status} onChange={e => change("status", e.target.value)}>{[["open","Por cobrar"],["all","Todos"],["pending","Pendiente"],["partial","Parcial"],["paid","Pagado"],["canceled","Cancelado"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</SelectInput>
        <SelectInput label="Concepto" value={filters.concept} onChange={e => change("concept", e.target.value)}><option value="all">Todos</option>{concepts.map(item => <option key={item}>{item}</option>)}</SelectInput>
        <SelectInput label="Vencimiento" value={filters.due} onChange={e => change("due", e.target.value)}>{[["all","Todos"],["overdue","Vencidos"],["due_soon","Vencen en 2 días"],["scheduled","Futuros"],["without_due_date","Sin fecha"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</SelectInput>
        <TextInput label="Saldo mínimo" type="number" min="0" value={filters.amountMin} onChange={e => change("amountMin", e.target.value)} />
        <TextInput label="Saldo máximo" type="number" min="0" value={filters.amountMax} onChange={e => change("amountMax", e.target.value)} />
        <TextInput label="Vence desde" type="date" value={filters.dateFrom} onChange={e => change("dateFrom", e.target.value)} />
        <TextInput label="Vence hasta" type="date" value={filters.dateTo} onChange={e => change("dateTo", e.target.value)} />
        <button className="billing-secondary" type="button" onClick={() => setFilters({ query: "", site: "all", status: "open", concept: "all", due: "all", amountMin: "", amountMax: "", dateFrom: "", dateTo: "" })}>Limpiar filtros</button>
      </div>}
      <div className="billing-list">
        {visible.map(charge => {
          const open = ["pending", "partial"].includes(charge.status) && Number(charge.balance) > 0;
          const stale = accepted[charge.id] === charge.balance;
          return <article className="billing-charge" key={charge.id} data-testid="cashier-charge-row">
            <div><h3>{chargeSubject(charge)}</h3><p>{charge.concept} · {charge.site_name}</p>{charge.billing_plan && <p className="billing-muted">{charge.description}</p>}<p className="billing-muted">{dueLabel(charge)}{charge.status === "partial" ? " · Pago parcial" : ""}</p></div>
            <div className="text-right"><strong className="text-lg">${money(charge.balance)}</strong><p className="billing-muted">{open ? "por cobrar" : chargeStatusLabel(charge.status)}</p></div>
            <button className={open ? "billing-primary" : "billing-secondary"} type="button" disabled={stale}
              aria-label={`${open ? "Cobrar a" : "Ver detalle de"} ${chargeSubject(charge)} · ${charge.concept}`}
              onClick={() => setSelectedId(charge.id)}>{stale ? "Pago registrado · actualiza" : open && onCreatePayment ? "Cobrar" : "Ver detalle"}</button>
          </article>;
        })}
        {!visible.length && <div className="py-6 text-center"><Search className="mx-auto mb-3" size={24} /><p>{searching ? "Este alumno no tiene cargos con los filtros actuales." : "¿A quién vamos a cobrar?"}</p><p className="billing-muted">{searching ? onCreateCharge ? "Usa Nuevo cobro para este alumno. No necesitas volver a buscarlo." : "Solicita a administración que cree el cargo para este alumno." : "Escribe su nombre y selecciónalo en las sugerencias para ver su foto y sus cargos."}</p></div>}
      </div>
      {searching && charges.length > 0 && <footer className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="billing-muted">{charges.length} cargos · Página {safePage} de {pageCount}</p><div className="flex gap-2">
        <button type="button" className="billing-secondary" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Anterior</button>
        <button type="button" className="billing-secondary" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Siguiente</button>
      </div></footer>}
    </>}
      </div></div>}
    </section>
    {selectedStudent && renderStudentExtras?.(selectedStudent)}
  </div>;
}
