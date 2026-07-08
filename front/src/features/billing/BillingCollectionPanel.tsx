import { FormEvent, useEffect, useMemo, useState } from "react";
import { Metric } from "../../components/cards/Metric";
import type { AppData, Charge } from "../../types";
import { money } from "../../utils/format";
import { SelectInput, TextInput, StatusPill, normalizeText, paymentMethodLabel, paymentStatusLabel } from "../../components/views/shared";
import { BillingCollectionRow, BillingDueNotices, billingHeaderGridClass, chargeSubject, getChargeDueBucket } from "./BillingCollectionRow";
export function BillingCollectionPanel({
  data,
  compact = false,
  onCreatePayment,
  onCreateDiscount,
  discountActionLabel = "Aplicar descuento",
}: {
  data: AppData;
  compact?: boolean;
  onCreatePayment?: (payload: unknown) => void;
  onCreateDiscount?: (payload: unknown) => void;
  discountActionLabel?: string;
}) {
  const [filters, setFilters] = useState({
    query: "",
    status: "open",
    site: "all",
    concept: "all",
    due: "attention",
    amountMin: "",
    amountMax: "",
    dateFrom: "",
    dateTo: "",
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
        const balance = Number(charge.balance || 0);
        if (filters.amountMin && balance < Number(filters.amountMin)) return false;
        if (filters.amountMax && balance > Number(filters.amountMax)) return false;
        if (filters.dateFrom && (!charge.due_date || charge.due_date < filters.dateFrom)) return false;
        if (filters.dateTo && (!charge.due_date || charge.due_date > filters.dateTo)) return false;
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
  const selectedPayments = useMemo(() => {
    if (!selectedChargeId) return [];
    return data.payments
      .filter((payment) => payment.charge === selectedChargeId)
      .sort((a, b) => {
        const dateA = a.confirmed_at || a.paid_at || a.expires_at || "";
        const dateB = b.confirmed_at || b.paid_at || b.expires_at || "";
        return dateB.localeCompare(dateA);
      });
  }, [data.payments, selectedChargeId]);
  const selectedDiscounts = useMemo(() => {
    if (!selectedChargeId) return [];
    return data.discounts
      .filter((discount) => discount.charge === selectedChargeId)
      .sort((a, b) => {
        const dateA = a.approved_at || a.created_at || "";
        const dateB = b.approved_at || b.created_at || "";
        return dateB.localeCompare(dateA);
      });
  }, [data.discounts, selectedChargeId]);
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
      dueSoon,
    };
  }, [data.charges]);

  const metricGridClass = compact ? "mt-4 grid gap-3 sm:grid-cols-2" : "mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4";
  const filterGridClass = compact
    ? "mt-4 grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-2 xl:grid-cols-4"
    : "mt-4 grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-9";
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
    const confirmedTotal = selectedPayments
      .filter((payment) => payment.status === "registered" || payment.status === "reconciled")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const pendingTotal = selectedPayments
      .filter((payment) => payment.status === "processing" || payment.status === "awaiting_confirmation")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const approvedDiscountTotal = selectedDiscounts
      .filter((discount) => discount.status === "approved")
      .reduce((sum, discount) => sum + Number(discount.amount || 0), 0);
    const requestedDiscountTotal = selectedDiscounts
      .filter((discount) => discount.status === "requested")
      .reduce((sum, discount) => sum + Number(discount.amount || 0), 0);
    return (
      <div onClick={(event) => event.stopPropagation()} className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="grid gap-3 rounded-md border border-emerald-200 bg-white p-3 dark:border-emerald-900 dark:bg-zinc-950/70 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">Cobro seleccionado</p>
            <p className="mt-1 truncate text-sm font-semibold text-emerald-950 dark:text-emerald-50">
              {chargeSubject(selectedCharge)} - {selectedCharge.concept}
            </p>
          </div>
          <div className="rounded-md bg-emerald-700 px-4 py-3 text-white shadow-sm sm:min-w-56 sm:text-right">
            <p className="text-xs font-semibold uppercase text-emerald-100">Saldo pendiente</p>
            <p className="mt-1 text-3xl font-black leading-none">${money(selectedCharge.balance)}</p>
          </div>
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
                <button data-testid="cashier-create-payment" className="col-span-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white lg:col-span-1 lg:self-end" type="submit">
                  Registrar pago
                </button>
              </div>
              <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">Efectivo se registra al momento. Tarjeta usa terminal fisica simulada.</p>
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
                  {discountActionLabel}
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                Admin/contador lo aplican directo. Caja lo deja como solicitud pendiente de aprobacion.
              </p>
            </form>
          )}
        </div>

        <div className="mt-3 rounded-md border border-zinc-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase text-zinc-500">Historial de pagos parciales</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Registrado ${money(confirmedTotal)} · En proceso ${money(pendingTotal)}
              </p>
            </div>
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
              {selectedPayments.length} movimiento(s)
            </span>
          </div>
          <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
            {selectedPayments.map((payment) => {
              const paidAt = payment.confirmed_at || payment.paid_at || payment.expires_at || "";
              return (
                <div key={payment.id} className="grid gap-2 py-2 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-medium">{paymentMethodLabel(payment.method)} - {payment.reference || payment.tracking_key || "folio automatico"}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {paidAt ? paidAt.slice(0, 16).replace("T", " ") : "Sin fecha"} · {payment.received_by_username || "sistema"}
                    </p>
                  </div>
                  <StatusPill label={paymentStatusLabel(payment.status)} />
                  <p className="font-semibold sm:text-right">${money(payment.amount)}</p>
                </div>
              );
            })}
            {selectedPayments.length === 0 && (
              <p className="py-3 text-sm text-zinc-500">Todavia no hay pagos parciales registrados para este cobro.</p>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-md border border-amber-200 bg-white/80 p-3 dark:border-amber-900 dark:bg-zinc-950/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase text-zinc-500">Historial de descuentos</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                Aplicado ${money(approvedDiscountTotal)} · Pendiente ${money(requestedDiscountTotal)}
              </p>
            </div>
            <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {selectedDiscounts.length} descuento(s)
            </span>
          </div>
          <div className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800">
            {selectedDiscounts.map((discount) => {
              const discountDate = discount.approved_at || discount.created_at || "";
              const label = {
                requested: "Pendiente",
                approved: "Aplicado",
                rejected: "Rechazado",
                canceled: "Cancelado",
              }[discount.status];
              return (
                <div key={discount.id} className="grid gap-2 py-2 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-medium">{discount.reason}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {discountDate ? discountDate.slice(0, 16).replace("T", " ") : "Sin fecha"} - firmo {discount.signed_by_username || discount.requested_by_username || "sistema"}
                      {discount.approved_by_username ? ` - aprobo ${discount.approved_by_username}` : ""}
                    </p>
                  </div>
                  <StatusPill label={label} />
                  <p className="font-semibold sm:text-right">-${money(discount.amount)}</p>
                </div>
              );
            })}
            {selectedDiscounts.length === 0 && (
              <p className="py-3 text-sm text-zinc-500">Todavia no hay descuentos registrados para este cobro.</p>
            )}
          </div>
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
          <TextInput label="Monto min." type="number" min="0" step="0.01" value={filters.amountMin} onChange={(event) => setFilters({ ...filters, amountMin: event.target.value })} />
          <TextInput label="Monto max." type="number" min="0" step="0.01" value={filters.amountMax} onChange={(event) => setFilters({ ...filters, amountMax: event.target.value })} />
          <TextInput label="Desde" type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} />
          <TextInput label="Hasta" type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} />
        </div>

          <div className="mt-4 min-w-0 overflow-hidden rounded-md border border-zinc-200">
            <div className={billingHeaderGridClass}>
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
                <BillingCollectionRow
                  key={charge.id}
                  charge={charge}
                  selectedChargeId={selectedChargeId}
                  onSelect={selectChargeForPayment}
                  renderSelectedActions={renderSelectedChargeActions}
                />
              ))}
              {visibleCharges.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay cobros con estos filtros.</p>}
            </div>
          </div>

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

      {!compact && <BillingDueNotices charges={billingSummary.dueSoon} />}
    </div>
  );
}
