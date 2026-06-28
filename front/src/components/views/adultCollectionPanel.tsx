import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Charge, Team } from "../../types";
import { money } from "../../utils/format";
import { chargeLabel, chargeStatusLabel, normalizeText, SelectInput, TableHeader, TextInput } from "./shared";

export type AdultPaymentForm = {
  charge: string;
  amount: string;
  method: string;
  channel: string;
};

type AdultCollectionPanelProps = {
  adultTeams: Team[];
  openAdultCharges: Charge[];
  selectedTeam: Team | null;
  paymentForm: AdultPaymentForm;
  onPaymentFormChange: (form: AdultPaymentForm) => void;
  onSelectPendingCharge: (chargeId: number) => void;
  onChangePaymentMethod: (method: string) => void;
  onSubmitPayment: (event: FormEvent) => void;
};

const adultChargePageSize = 8;

export function AdultCollectionPanel({
  adultTeams,
  openAdultCharges,
  selectedTeam,
  paymentForm,
  onPaymentFormChange,
  onSelectPendingCharge,
  onChangePaymentMethod,
  onSubmitPayment,
}: AdultCollectionPanelProps) {
  const [filters, setFilters] = useState({
    query: "",
    status: "all",
    minAmount: "",
    maxAmount: "",
    fromDate: "",
    toDate: "",
  });
  const [page, setPage] = useState(1);

  const filteredCharges = useMemo(() => {
    const query = normalizeText(filters.query);
    const minAmount = filters.minAmount === "" ? null : Number(filters.minAmount);
    const maxAmount = filters.maxAmount === "" ? null : Number(filters.maxAmount);
    return openAdultCharges.filter((charge) => {
      const team = adultTeams.find((item) => item.id === charge.team);
      const balance = Number(charge.balance || 0);
      const searchable = normalizeText([
        charge.team_name,
        team?.name,
        team?.representative_name,
        team?.representative_phone,
        charge.payer_name,
        charge.payer_phone,
        charge.concept,
        charge.description,
        charge.site_name,
      ].filter(Boolean).join(" "));

      if (query && !searchable.includes(query)) return false;
      if (filters.status !== "all" && charge.status !== filters.status) return false;
      if (minAmount !== null && balance < minAmount) return false;
      if (maxAmount !== null && balance > maxAmount) return false;
      if (filters.fromDate && (!charge.due_date || charge.due_date < filters.fromDate)) return false;
      if (filters.toDate && (!charge.due_date || charge.due_date > filters.toDate)) return false;
      return true;
    });
  }, [adultTeams, filters, openAdultCharges]);

  const totalPages = Math.max(1, Math.ceil(filteredCharges.length / adultChargePageSize));
  const paginatedCharges = filteredCharges.slice((page - 1) * adultChargePageSize, page * adultChargePageSize);

  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <div className="rounded-md border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
        <TableHeader title="Cobros pendientes adultos" count={filteredCharges.length} />
        <div className="grid gap-3 border-b border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-2 lg:grid-cols-6">
          <TextInput label="Buscar" placeholder="Equipo, representante, concepto" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} />
          <SelectInput label="Estado" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="all">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="partial">Parcial</option>
          </SelectInput>
          <TextInput label="Monto min." type="number" min="0" step="0.01" value={filters.minAmount} onChange={(event) => setFilters({ ...filters, minAmount: event.target.value })} />
          <TextInput label="Monto max." type="number" min="0" step="0.01" value={filters.maxAmount} onChange={(event) => setFilters({ ...filters, maxAmount: event.target.value })} />
          <TextInput label="Desde" type="date" value={filters.fromDate} onChange={(event) => setFilters({ ...filters, fromDate: event.target.value })} />
          <TextInput label="Hasta" type="date" value={filters.toDate} onChange={(event) => setFilters({ ...filters, toDate: event.target.value })} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <tr>
                <th className="px-4 py-3">Equipo</th>
                <th className="px-4 py-3">Representante</th>
                <th className="px-4 py-3">Cobro</th>
                <th className="px-4 py-3">Vence</th>
                <th className="px-4 py-3">Saldo</th>
                <th className="px-4 py-3">Accion</th>
              </tr>
            </thead>
            <tbody className="bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
              {paginatedCharges.map((charge) => {
                const team = adultTeams.find((item) => item.id === charge.team);
                return (
                  <tr key={charge.id} className="border-b border-zinc-100 bg-white dark:border-zinc-800 dark:bg-zinc-950">
                    <td className="px-4 py-3 font-semibold">{charge.team_name || team?.name || "Equipo"}</td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">
                      {team?.representative_name || charge.payer_name || "Sin representante"}
                      <br />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">{team?.representative_phone || charge.payer_phone || "Sin telefono"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{charge.concept}</p>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">{charge.description || "Sin detalle"}</p>
                      <span className={`mt-2 inline-flex rounded-md px-2 py-1 text-[11px] font-semibold ${charge.status === "partial" ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}`}>
                        {chargeStatusLabel(charge.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-700 dark:text-zinc-200">{charge.due_date || "Sin fecha"}</td>
                    <td className="px-4 py-3 text-base font-bold">${money(charge.balance)}</td>
                    <td className="px-4 py-3">
                      <button className="rounded-md bg-blue-700 px-3 py-2 text-xs font-semibold text-white" onClick={() => onSelectPendingCharge(charge.id)} type="button">
                        Cobrar
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredCharges.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={6}>Sin cobros pendientes de liga adultos.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filteredCharges.length > adultChargePageSize && (
          <div className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-300 sm:flex-row sm:items-center sm:justify-between">
            <span>Mostrando {(page - 1) * adultChargePageSize + 1}-{Math.min(page * adultChargePageSize, filteredCharges.length)} de {filteredCharges.length}</span>
            <div className="flex gap-2">
              <button className="rounded-md border border-zinc-200 px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
                Anterior
              </button>
              <button className="rounded-md border border-zinc-200 px-3 py-2 font-semibold disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))} type="button">
                Siguiente
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Hacer cobro</h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-300">
          {selectedTeam?.name || "Selecciona un cobro pendiente"} - {selectedTeam?.representative_name || "representante"}
        </p>
        <form onSubmit={onSubmitPayment} className="mt-4 grid gap-3">
          <SelectInput label="Cobro pendiente" value={paymentForm.charge} onChange={(event) => onSelectPendingCharge(Number(event.target.value))} required>
            <option value="">{filteredCharges.length ? "Seleccionar cobro filtrado" : "Sin cobros pendientes"}</option>
            {filteredCharges.slice(0, 30).map((charge) => (
              <option key={charge.id} value={charge.id}>{charge.team_name} - {chargeLabel(charge)} - ${money(charge.balance)}</option>
            ))}
          </SelectInput>
          <SelectInput label="Metodo" value={paymentForm.method} onChange={(event) => onChangePaymentMethod(event.target.value)}>
            <option value="cash">Efectivo</option>
            <option value="card">Tarjeta</option>
          </SelectInput>
          <TextInput label="Monto" type="number" min="0" step="0.01" value={paymentForm.amount} onChange={(event) => onPaymentFormChange({ ...paymentForm, amount: event.target.value })} required />
          <button className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white" type="submit">Crear solicitud de cobro</button>
        </form>
      </div>
    </div>
  );
}
