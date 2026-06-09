import { useEffect, useMemo, useState } from "react";
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

export function BillingCollectionPanel({ data }: { data: AppData }) {
  const today = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState({
    query: "",
    status: "open",
    site: "all",
    concept: "all",
    due: "attention",
  });
  const [page, setPage] = useState(1);
  const pageSize = 16;

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
  const billingSummary = useMemo(() => {
    const open = data.charges.filter((charge) => charge.status === "pending" || charge.status === "partial");
    const overdue = open.filter((charge) => (charge.due_bucket || getChargeDueBucket(charge)) === "overdue");
    const dueSoon = open.filter((charge) => (charge.due_bucket || getChargeDueBucket(charge)) === "due_soon");
    return {
      openBalance: open.reduce((sum, charge) => sum + Number(charge.balance || 0), 0),
      overdueBalance: overdue.reduce((sum, charge) => sum + Number(charge.balance || 0), 0),
      dueSoonBalance: dueSoon.reduce((sum, charge) => sum + Number(charge.balance || 0), 0),
      paidThisMonth: data.charges.filter((charge) => charge.status === "paid" && (charge.due_date || "").slice(0, 7) === today.slice(0, 7)).length,
      dueSoon,
    };
  }, [data.charges, today]);

  return (
    <div className="order-first grid min-w-0 gap-5 lg:order-none">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-zinc-500">Cobranza programada</p>
            <h2 className="text-lg font-semibold">Mensualidades, jornadas y torneos</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Los cobros recurrentes se generan automaticamente y cada cliente ve solo sus cargos en su portal.
            </p>
          </div>
          <span className="rounded-md bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-700">{filteredCharges.length} filtrados</span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Saldo abierto" value={`$${money(billingSummary.openBalance)}`} />
          <Metric label="Vencido" value={`$${money(billingSummary.overdueBalance)}`} />
          <Metric label="Por vencer" value={`$${money(billingSummary.dueSoonBalance)}`} />
          <Metric label="Pagados del mes" value={billingSummary.paidThisMonth} />
        </div>

        <div className="mt-4 grid gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 md:grid-cols-2 xl:grid-cols-5">
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

        <div className="mt-4 overflow-hidden rounded-md border border-zinc-200">
          <div className="hidden grid-cols-[1.3fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-semibold uppercase text-zinc-500 xl:grid">
            <span>Cliente</span>
            <span>Concepto</span>
            <span>Vence</span>
            <span>Monto</span>
            <span>Saldo</span>
            <span>Estado</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {visibleCharges.map((charge) => (
              <div key={charge.id} className="grid gap-3 px-4 py-4 xl:grid-cols-[1.3fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr] xl:items-center">
                <div>
                  <p className="font-semibold">{chargeSubject(charge)}</p>
                  <p className="mt-1 text-sm text-zinc-500">{charge.payer_name || "Sin pagador"} {charge.payer_phone ? `- ${charge.payer_phone}` : ""}</p>
                  <p className="mt-1 text-xs text-zinc-400">{charge.site_name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium">{charge.concept}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{charge.description || "Sin detalle"}</p>
                </div>
                <span className={`w-fit rounded-md px-2 py-1 text-xs font-semibold ${dueTone(charge)}`}>{dueLabel(charge)}</span>
                <p className="text-sm">${money(charge.amount)}</p>
                <p className="text-sm font-semibold">${money(charge.balance)}</p>
                <div className="flex flex-wrap gap-2">
                  <StatusPill label={chargeStatusLabel(charge.status)} />
                  {charge.schedule_type && charge.schedule_type !== "one_time" && (
                    <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-800">
                      {charge.schedule_type === "monthly" ? "Mensual" : charge.schedule_type === "weekly" ? "Semanal" : "Torneo"}
                    </span>
                  )}
                </div>
              </div>
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
    </div>
  );
}
