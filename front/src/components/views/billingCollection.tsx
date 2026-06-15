import { FormEvent, useEffect, useMemo, useState } from "react";
import { Metric } from "../cards/Metric";
import type { AppData, Charge } from "../../types";
import { money } from "../../utils/format";
import { SelectInput, TextInput, StatusPill, TableHeader, chargeStatusLabel, normalizeText } from "./shared";

function getChargeDueBucket(charge: Charge) {
  if (charge.status === "paid" || charge.status === "canceled") return charge.status;
  if (!charge.due_date) return "without_due_date";
  const todayDate = new Date(new Date().toISOString().slice(0, 10));
  const dueDate = new Date(charge.due_date);
  const days = Math.round((dueDate.getTime() - todayDate.getTime()) / 86400000);
  if (days < 0) return "overdue";
  if (days <= 2) return "due_soon";
  return "scheduled";
}

function dueLabel(charge: Charge) {
  const bucket = charge.due_bucket || getChargeDueBucket(charge);
  if (charge.status === "paid") return "Pagado";
  if (charge.status === "canceled") return "Cancelado";
  if (!charge.due_date) return "Sin fecha";
  const days = charge.due_in_days ?? Math.round((new Date(charge.due_date).getTime() - new Date(new Date().toISOString().slice(0, 10)).getTime()) / 86400000);
  if (bucket === "overdue") return `Vencido hace ${Math.abs(days)} dia(s)`;
  if (bucket === "due_soon") return days === 0 ? "Vence hoy" : `Vence en ${days} dia(s)`;
  return `Vence ${charge.due_date}`;
}

function dueTone(charge: Charge) {
  const bucket = charge.due_bucket || getChargeDueBucket(charge);
  if (bucket === "overdue") return "bg-red-50 text-red-700";
  if (bucket === "due_soon") return "bg-amber-50 text-amber-800";
  if (charge.status === "paid") return "bg-emerald-50 text-emerald-800";
  return "bg-zinc-100 text-zinc-600";
}

function chargeSubject(charge: Charge) {
  return charge.student_name || charge.team_name || "Cliente";
}

export function BillingCollectionPanel({
  data,
  compact = false,
  onCreatePayment,
  onCreateDiscount,
}: {
  data: AppData;
  compact?: boolean;
  onCreatePayment?: (payload: unknown) => void;
  onCreateDiscount?: (payload: unknown) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState({
    query: "",
    status: "open",
    site: "all",
    concept: "all",
    due: "attention",
  });
  const [page, setPage] = useState(1);
  const [selectedChargeId, setSelectedChargeId] = useState<number | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    method: "cash",
    amount: "",
  });
  const [discountForm, setDiscountForm] = useState({
    reason: "Hermanos",
    amount: "",
  });
  const pageSize = compact ? 8 : 16;

  const conceptOptions = useMemo(() => {
    return Array.from(new Set(data.charges.map((charge) => charge.concept).filter(Boolean))).sort();
  }, [data.charges]);

  const filteredCharges = useMemo(() => {
    const query = normalizeText(filters.query);
    return data.charges
      .filter((charge) => {
        const subject = charge.student_name || charge.team_name || "";
        const payer = charge.payer_name || "";
        const text = normalizeText(`${subject} ${payer} ${charge.concept} ${charge.description} ${charge.site_name || ""}`);
        const isOpen = charge.status === "pending" || charge.status === "partial";
        const dueBucket = charge.due_bucket || getChargeDueBucket(charge);
        if (query && !text.includes(query)) return false;
        if (filters.status === "open" && !isOpen) return false;
        if (filters.status !== "all" && filters.status !== "open" && charge.status !== filters.status) return false;
        if (filters.site !== "all" && String(charge.site) !== filters.site) return false;
        if (filters.concept !== "all" && charge.concept !== filters.concept) return false;
        if (filters.due === "attention" && !["overdue", "due_soon"].includes(dueBucket)) return false;
        if (filters.due !== "all" && filters.due !== "attention" && dueBucket !== filters.due) return false;
        return true;
      })
      .sort((a, b) => {
        const aOpen = a.status === "pending" || a.status === "partial" ? 0 : 1;
        const bOpen = b.status === "pending" || b.status === "partial" ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31");
      });
  }, [data.charges, filters]);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  const pageCount = Math.max(1, Math.ceil(filteredCharges.length / pageSize));
  const visibleCharges = filteredCharges.slice((page - 1) * pageSize, page * pageSize);
  const selectedCharge = data.charges.find((charge) => charge.id === selectedChargeId) ?? null;
  const billingSummary = useMemo(() => {
    const open = data.charges.filter((charge) => charge.status === "pending" || charge.status === "partial");
    const overdue = open.filter((charge) => (charge.due_bucket || getChargeDueBucket(charge)) === "overdue");
    const dueSoon = open.filter((charge) => (charge.due_bucket || getChargeDueBucket(charge)) === "due_soon");
    return {
      openBalance: open.reduce((sum, charge) => sum + Number(charge.balance || 0), 0),
      partialBalance: open.filter((charge) => charge.status === "partial").reduce((sum, charge) => sum + Number(charge.balance || 0), 0),
      partialCount: open.filter((charge) => charge.status === "partial").length,
      overdueBalance: overdue.reduce((sum, charge) => sum + Number(charge.balance || 0), 0),
      dueSoonBalance: dueSoon.reduce((sum, charge) => sum + Number(charge.balance || 0), 0),
      paidThisMonth: data.charges.filter((charge) => charge.status === "paid" && (charge.due_date || "").slice(0, 7) === today.slice(0, 7)).length,
      dueSoon,
    };
  }, [data.charges, today]);

  const metricGridClass = compact ? "mt-4 grid gap-3 sm:grid-cols-2" : "mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4";
  const filterGridClass = compact
    ? "mt-4 grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-2 lg:grid-cols-3"
    : "mt-4 grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-2 xl:grid-cols-5";
  const headerGridClass = "hidden grid-cols-[1.3fr_1fr_0.8fr_0.7fr_0.7fr_0.7fr_0.8fr] gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold uppercase text-zinc-500 xl:grid";
  const rowGridClass = "grid min-w-0 gap-3 px-4 py-4 xl:grid-cols-[1.3fr_1fr_0.8fr_0.7fr_0.7fr_0.7fr_0.8fr] xl:items-center";

  function selectChargeForPayment(charge: Charge) {
    setSelectedChargeId(charge.id);
    setPaymentForm({ method: "cash", amount: String(charge.balance || charge.amount || "") });
    setDiscountForm({ reason: "Hermanos", amount: "" });
  }

  function submitPayment(event: FormEvent) {
    event.preventDefault();
    if (!selectedCharge || !onCreatePayment) return;
    onCreatePayment({
      charge: selectedCharge.id,
      method: paymentForm.method,
      channel: paymentForm.method === "card" ? "card_terminal" : "cash_confirmation",
      amount: paymentForm.amount,
    });
    setPaymentForm({ ...paymentForm, amount: "" });
  }

  function submitDiscount(event: FormEvent) {
    event.preventDefault();
    if (!selectedCharge || !onCreateDiscount) return;
    onCreateDiscount({
      charge: selectedCharge.id,
      reason: discountForm.reason,
      amount: discountForm.amount,
    });
    setDiscountForm({ ...discountForm, amount: "" });
  }

  function renderSelectedChargeActions() {
    if (!selectedCharge || (!onCreatePayment && !onCreateDiscount)) return null;
    return (
      <div onClick={(event) => event.stopPropagation()} className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
            Cobro seleccionado <span className="font-normal text-emerald-700 dark:text-emerald-300">- saldo ${money(selectedCharge.balance)}</span>
          </p>
          <p className="mt-1 hidden truncate text-xs text-emerald-800/80 dark:text-emerald-200/80 sm:block">
            {chargeSubject(selectedCharge)} - {selectedCharge.concept}
          </p>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {onCreatePayment && (
            <form onSubmit={submitPayment} className="rounded-md border border-emerald-200 bg-white/70 p-3 dark:border-emerald-900 dark:bg-zinc-950/60">
              <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">Hacer cobro</p>
              <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-[160px_160px_auto]">
                <SelectInput label="Metodo" value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}>
                  <option value="cash">Efectivo</option>
                  <option value="card">Tarjeta de credito</option>
                </SelectInput>
                <TextInput label="Monto" type="number" min="0" step="0.01" required value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
                <button className="col-span-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white lg:col-span-1 lg:self-end" type="submit">
                  Crear solicitud
                </button>
              </div>
              <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">Efectivo requiere confirmacion. Tarjeta usa terminal fisica simulada.</p>
            </form>
          )}

          {onCreateDiscount && (
            <form onSubmit={submitDiscount} className="rounded-md border border-amber-200 bg-white/70 p-3 dark:border-amber-900 dark:bg-zinc-950/60">
              <p className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-300">Agregar descuento</p>
              <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-[180px_160px_auto]">
                <SelectInput label="Motivo" value={discountForm.reason} onChange={(event) => setDiscountForm({ ...discountForm, reason: event.target.value })}>
                  <option value="Hermanos">Hermanos</option>
                  <option value="Referido">Referido</option>
                  <option value="Promocion">Promocion</option>
                  <option value="Lesion">Lesion</option>
                  <option value="Pausa autorizada">Pausa autorizada</option>
                  <option value="Autorizacion especial">Autorizacion especial</option>
                </SelectInput>
                <TextInput label="Monto" type="number" min="0" step="0.01" required value={discountForm.amount} onChange={(event) => setDiscountForm({ ...discountForm, amount: event.target.value })} />
                <button className="col-span-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white lg:col-span-1 lg:self-end" type="submit">
                  Guardar descuento
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">Queda registrado con usuario, motivo y monto para mantener trazabilidad.</p>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="order-first grid min-w-0 gap-5 lg:order-none">
      <div className="min-w-0 rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">Cobranza programada</p>
            <h2 className="text-lg font-semibold">Mensualidades, jornadas y torneos</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Los cobros recurrentes se generan automaticamente y cada cliente ve solo sus cargos en su portal.
            </p>
          </div>
          <span className="shrink-0 rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
            {filteredCharges.length} filtrados
          </span>
        </div>

        <div className={metricGridClass}>
          <Metric label="Saldo abierto" value={`$${money(billingSummary.openBalance)}`} />
          <Metric label="Pagos incompletos" value={`$${money(billingSummary.partialBalance)}`} helper={`${billingSummary.partialCount} cargos parciales`} />
          <Metric label="Vencido" value={`$${money(billingSummary.overdueBalance)}`} />
          <Metric label="Por vencer" value={`$${money(billingSummary.dueSoonBalance)}`} />
        </div>

        <div className={filterGridClass}>
          <TextInput label="Buscar" placeholder="Alumno, equipo, tutor, concepto" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
          <SelectInput label="Estado" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="open">Abiertos</option>
            <option value="all">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="partial">Parcial</option>
            <option value="paid">Pagado</option>
            <option value="canceled">Cancelado</option>
          </SelectInput>
          <SelectInput label="Sede" value={filters.site} onChange={(event) => setFilters({ ...filters, site: event.target.value })}>
            <option value="all">Todas</option>
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </SelectInput>
          <SelectInput label="Concepto" value={filters.concept} onChange={(event) => setFilters({ ...filters, concept: event.target.value })}>
            <option value="all">Todos</option>
            {conceptOptions.map((concept) => (
              <option key={concept} value={concept}>{concept}</option>
            ))}
          </SelectInput>
          <SelectInput label="Vencimiento" value={filters.due} onChange={(event) => setFilters({ ...filters, due: event.target.value })}>
            <option value="attention">Requiere atencion</option>
            <option value="all">Todos</option>
            <option value="overdue">Vencidos</option>
            <option value="due_soon">Vencen en 2 dias</option>
            <option value="scheduled">Programados</option>
            <option value="without_due_date">Sin fecha</option>
          </SelectInput>
        </div>

        {compact ? (
          <>
            {selectedCharge && <div className="mt-4">{renderSelectedChargeActions()}</div>}
            <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleCharges.map((charge) => (
                <div
                  key={charge.id}
                  className={`min-w-0 rounded-md border bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-950 ${
                    selectedChargeId === charge.id ? "border-emerald-500 ring-2 ring-emerald-100 dark:ring-emerald-950" : "border-zinc-200 dark:border-zinc-800"
                  }`}
                  onClick={() => selectChargeForPayment(charge)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") selectChargeForPayment(charge);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-base font-semibold leading-snug">{chargeSubject(charge)}</p>
                      <p className="mt-1 break-words text-sm text-zinc-500">{charge.payer_name || "Sin pagador"}</p>
                      {charge.payer_phone && <p className="mt-1 text-sm font-medium text-zinc-600 dark:text-zinc-300">{charge.payer_phone}</p>}
                    </div>
                    <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${dueTone(charge)}`}>{dueLabel(charge)}</span>
                  </div>

                <div className="mt-4 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
                  <p className="text-sm font-semibold">{charge.concept}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{charge.description || "Sin detalle"}</p>
                  <p className="mt-2 text-xs text-zinc-400">{charge.site_name}</p>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-zinc-400">Monto</p>
                    <p className="mt-1 font-medium">${money(charge.amount)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-zinc-400">Pagado</p>
                    <p className="mt-1 font-medium">${money(charge.paid_amount || 0)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase text-zinc-400">Saldo</p>
                    <p className="mt-1 font-bold">${money(charge.balance)}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusPill label={chargeStatusLabel(charge.status)} />
                  {charge.status === "partial" && (
                    <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Pago parcial</span>
                  )}
                  {charge.schedule_type && charge.schedule_type !== "one_time" && (
                    <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">
                      {charge.schedule_type === "monthly" ? "Mensual" : charge.schedule_type === "weekly" ? "Semanal" : "Torneo"}
                    </span>
                  )}
                </div>
                </div>
              ))}
              {visibleCharges.length === 0 && <p className="rounded-md border border-zinc-200 px-4 py-8 text-sm text-zinc-500">No hay cobros con estos filtros.</p>}
            </div>
          </>
        ) : (
          <div className="mt-4 min-w-0 overflow-hidden rounded-md border border-zinc-200">
            <div className={headerGridClass}>
              <span>Cliente</span>
              <span>Concepto</span>
              <span>Vence</span>
              <span>Monto</span>
              <span>Pagado</span>
              <span>Saldo</span>
              <span>Estado</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {visibleCharges.map((charge) => (
                <div key={charge.id}>
                  <div
                    className={`${rowGridClass} text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                      selectedChargeId === charge.id ? "bg-emerald-50 dark:bg-emerald-950/30" : ""
                    }`}
                    onClick={() => selectChargeForPayment(charge)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") selectChargeForPayment(charge);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="min-w-0">
                      <p className="break-words font-semibold">{chargeSubject(charge)}</p>
                      <p className="mt-1 text-sm text-zinc-500">{charge.payer_name || "Sin pagador"} {charge.payer_phone ? `- ${charge.payer_phone}` : ""}</p>
                      <p className="mt-1 text-xs text-zinc-400">{charge.site_name}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{charge.concept}</p>
                      <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{charge.description || "Sin detalle"}</p>
                    </div>
                    <span className={`w-fit rounded-md px-2 py-1 text-xs font-semibold ${dueTone(charge)}`}>{dueLabel(charge)}</span>
                    <p className="text-sm">${money(charge.amount)}</p>
                    <p className="text-sm">${money(charge.paid_amount || 0)}</p>
                    <p className="text-sm font-semibold">${money(charge.balance)}</p>
                    <div className="flex flex-wrap gap-2">
                      <StatusPill label={chargeStatusLabel(charge.status)} />
                      {charge.status === "partial" && (
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Pago parcial</span>
                      )}
                      {charge.schedule_type && charge.schedule_type !== "one_time" && (
                        <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">
                          {charge.schedule_type === "monthly" ? "Mensual" : charge.schedule_type === "weekly" ? "Semanal" : "Torneo"}
                        </span>
                      )}
                    </div>
                  </div>
                  {selectedChargeId === charge.id && <div className="px-4 pb-4">{renderSelectedChargeActions()}</div>}
                </div>
              ))}
              {visibleCharges.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay cobros con estos filtros.</p>}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-zinc-500">Pagina {page} de {pageCount}</p>
          <div className="flex gap-2">
            <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
              Anterior
            </button>
            <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-40" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">
              Siguiente
            </button>
          </div>
        </div>
      </div>

      {!compact && (
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Avisos de vencimiento simulados" count={billingSummary.dueSoon.length} />
          <div className="divide-y divide-zinc-100">
            {billingSummary.dueSoon.slice(0, 8).map((charge) => (
              <div key={charge.id} className="px-4 py-3">
                <p className="font-medium">{chargeSubject(charge)} - ${money(charge.balance)}</p>
                <p className="mt-1 text-sm text-zinc-500">{charge.customer_notice || dueLabel(charge)}</p>
                <p className="mt-1 text-xs text-zinc-400">Simulado: WhatsApp/SMS a {charge.payer_phone || "telefono no registrado"}</p>
              </div>
            ))}
            {billingSummary.dueSoon.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin avisos por vencer en los proximos 2 dias.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
