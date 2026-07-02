import { FormEvent, useState } from "react";
import { CreditCard } from "lucide-react";
import { money } from "../../utils/format";
import type { AppData } from "../../types";
import { chargeLabel, SelectInput, TableHeader, TextInput } from "../../components/views/shared";

export function CashierPaymentPanel({
  data,
  onCreatePayment,
}: {
  data: AppData;
  onCreatePayment: (payload: unknown) => void;
}) {
  const openCharges = data.charges.filter((charge) => charge.status === "pending" || charge.status === "partial");
  const partialCharges = openCharges.filter((charge) => charge.status === "partial");
  const [paymentForm, setPaymentForm] = useState({
    charge: "",
    method: "cash",
    channel: "cash_confirmation",
    amount: "",
  });

  function changePaymentMethod(method: string) {
    const nextChannel = method === "card" ? "card_terminal" : "cash_confirmation";
    setPaymentForm({ ...paymentForm, method, channel: nextChannel });
  }

  function selectCharge(chargeId: string) {
    const charge = openCharges.find((item) => item.id === Number(chargeId));
    setPaymentForm({
      ...paymentForm,
      charge: chargeId,
      amount: charge ? charge.balance : "",
    });
  }

  function submitPayment(event: FormEvent) {
    event.preventDefault();
    onCreatePayment({
      charge: Number(paymentForm.charge),
      method: paymentForm.method,
      channel: paymentForm.channel,
      amount: paymentForm.amount,
    });
    setPaymentForm({ ...paymentForm, amount: "" });
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <form onSubmit={submitPayment} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <CreditCard size={16} /> Hacer cobro
        </h2>
        <div className="mt-4 grid gap-3">
          <SelectInput label="Cobro programado" required value={paymentForm.charge} onChange={(event) => selectCharge(event.target.value)}>
            <option value="">{openCharges.length ? "Seleccionar mensualidad, jornada o torneo" : "No hay cobros pendientes"}</option>
            {openCharges.map((charge) => (
              <option key={charge.id} value={charge.id}>
                {charge.student_name || charge.team_name} - {chargeLabel(charge)} - saldo ${money(charge.balance)}
              </option>
            ))}
          </SelectInput>
          <SelectInput label="Metodo" value={paymentForm.method} onChange={(event) => changePaymentMethod(event.target.value)}>
            <option value="cash">Efectivo</option>
            <option value="card">Tarjeta de credito</option>
          </SelectInput>
          <TextInput label="Monto a cobrar" type="number" min="0" step="0.01" required value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Si el cliente paga menos que el saldo, el cargo queda como pago parcial y sigue visible como incompleto.
          </p>
          <button className="flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white" data-testid="cashier-create-payment">
            <CreditCard size={16} /> Crear solicitud
          </button>
        </div>
      </form>
      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title="Pagos incompletos" count={partialCharges.length} />
        <div className="divide-y divide-zinc-100">
          {partialCharges.slice(0, 8).map((charge) => (
            <button key={charge.id} className="block w-full px-4 py-3 text-left hover:bg-zinc-50" onClick={() => selectCharge(String(charge.id))} type="button">
              <p className="font-medium">{charge.student_name || charge.team_name}</p>
              <p className="mt-1 text-sm text-zinc-500">{chargeLabel(charge)}</p>
              <p className="mt-1 text-xs text-amber-700">Pagado ${money(charge.paid_amount)} Â· pendiente ${money(charge.balance)}</p>
            </button>
          ))}
          {partialCharges.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin pagos parciales pendientes.</p>}
        </div>
      </div>
    </section>
  );
}
