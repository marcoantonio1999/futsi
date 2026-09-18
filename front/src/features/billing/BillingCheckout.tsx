import { useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Banknote, CreditCard, CheckCircle2 } from "lucide-react";
import type { AppData, Charge, Payment } from "../../types";
import { ApiError } from "../../api";
import { money } from "../../utils/format";
import { TextInput, SelectInput, paymentStatusLabel, paymentMethodLabel } from "../../components/views/shared";
import { chargeSubject } from "./BillingCollectionRow";
import { amountInCents, paymentValidation, type BillingMutation } from "./billingFlow";
import { BillingStudentIdentity } from "./BillingStudentSelect";

export function BillingCheckout({ charge, data, token, embedded = false, onBusyChange, onCreatePayment, onCreateDiscount, discountActionLabel, onClose, onAccepted }: {
  charge: Charge; data: AppData; token?: string; onCreatePayment?: BillingMutation; onCreateDiscount?: BillingMutation;
  discountActionLabel: string; onClose: () => void; onAccepted: () => void;
  embedded?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const [amount, setAmount] = useState(charge.balance);
  const student = data.students.find(item => item.id === charge.student);
  const [method, setMethod] = useState("cash");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const [discountAmount, setDiscountAmount] = useState("");
  const [reason, setReason] = useState("Hermanos");
  const [discountNotice, setDiscountNotice] = useState("");
  const payments = data.payments.filter(item => item.charge === charge.id);
  const discounts = data.discounts.filter(item => item.charge === charge.id);
  const pending = payments.some(item => ["processing", "awaiting_confirmation"].includes(item.status));
  const validation = paymentValidation(charge, amount);
  const remaining = ((amountInCents(charge.balance) ?? 0) - (amountInCents(amount) ?? 0)) / 100;
  async function submit(event: FormEvent, kind: "payment" | "discount") {
    event.preventDefault();
    const callback = kind === "payment" ? onCreatePayment : onCreateDiscount;
    const value = kind === "payment" ? amount : discountAmount;
    if (locked.current || !callback || paymentValidation(charge, value) || receipt || pending) return;
    locked.current = true; setBusy(true); onBusyChange?.(true); setError(""); setDiscountNotice("");
    try {
      const result = await callback(kind === "payment" ? {
        charge: charge.id, amount: value, method, channel: method === "card" ? "card_terminal" : "cash_confirmation",
      } : { charge: charge.id, amount: value, reason });
      if (!result || typeof result !== "object" || !("id" in result)) throw new Error("El servidor no confirmó el registro.");
      if (kind === "payment") { setReceipt(result as Payment); onAccepted(); }
      else { setDiscountNotice("Descuento registrado. Revisa su estado y el saldo actualizado antes de cobrar."); setDiscountAmount(""); locked.current = false; }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar el registro.");
      // Never offer a one-click retry when the server may already have written a payment.
      const rejected = err instanceof ApiError && err.status >= 400 && err.status < 500;
      setUncertain(!rejected);
      if (rejected) locked.current = false;
    } finally { setBusy(false); onBusyChange?.(false); }
  }
  return <section className={embedded ? "billing-inline-form" : "billing-box billing-checkout"}>
    <button className="billing-secondary" type="button" disabled={busy} onClick={onClose}><ArrowLeft size={16} /> {embedded ? "Cerrar detalle del cobro" : "Volver a los cobros"}</button>
    <div className="billing-heading mt-4"><div><h2>{charge.concept}</h2><p>{embedded ? "Revisa el descuento y registra el pago recibido." : `${chargeSubject(charge)} · ${charge.site_name}`}</p></div></div>
    {!embedded && student && <BillingStudentIdentity key={`${student.id}-${student.photo_url}`} student={student} token={token} />}
    {receipt ? <div className="billing-feedback" role="status">
      <CheckCircle2 size={28} /><h3 className="mt-2 text-xl font-bold">Pago registrado</h3>
      <p className="mt-2">${money(receipt.amount)} · {paymentMethodLabel(receipt.method)}</p>
      <p>Estado: {paymentStatusLabel(receipt.status)} · Folio #{receipt.id}</p>
      <p className="mt-2 text-sm">El saldo se actualiza según el estado del pago. No vuelvas a registrar este mismo movimiento.</p>
      <button type="button" className="billing-primary mt-4" onClick={onClose}>{embedded ? "Ver cargos del alumno" : "Cobrar a otra persona"}</button>
    </div> : <>
      <div className="billing-total"><span>Saldo pendiente</span><strong>${money(charge.balance)}</strong></div>
      {pending && <p className="billing-error">Hay un pago en proceso para este cargo. Revísalo en el historial antes de registrar otro.</p>}
      <div className="billing-payment-grid">
      {onCreatePayment && ["pending", "partial"].includes(charge.status) && <form className="billing-payment-pane" onSubmit={event => submit(event, "payment")}>
        <fieldset disabled={busy || uncertain || Boolean(discountNotice)} className="grid gap-5">
          <div><p className="font-semibold">1. ¿Cómo recibiste el pago?</p><div className="billing-methods">
            <button type="button" className="billing-secondary" aria-pressed={method === "cash"} onClick={() => setMethod("cash")}><Banknote size={18} /> Efectivo</button>
            <button type="button" className="billing-secondary" aria-pressed={method === "card"} onClick={() => setMethod("card")}><CreditCard size={18} /> Tarjeta</button>
          </div><p className="billing-muted mt-2">{method === "cash" ? "Registra únicamente el efectivo que ya recibiste." : "Este formulario registra el pago; no realiza un cargo bancario. Conserva el comprobante de la terminal."}</p></div>
          <div><TextInput label="2. Monto recibido" type="number" min="0.01" max={charge.balance} step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} />
            <button type="button" className="mt-2 text-sm font-semibold underline" onClick={() => setAmount(charge.balance)}>Usar saldo completo</button>
            {validation ? <p role="alert" className="billing-error">{validation}</p> : <p className="billing-muted mt-2">{remaining > 0 ? `Es un abono. Quedarán $${money(remaining)} si el pago se confirma.` : "Cubre el saldo completo si el pago se confirma."}</p>}
          </div>
          <button data-testid="cashier-create-payment" className="billing-primary w-full" type="submit" disabled={Boolean(validation) || pending || busy || uncertain}>
            {busy ? "Registrando…" : `Registrar pago de $${money(amount || 0)}`}
          </button>
        </fieldset>
      </form>}
      {error && <p role="alert" className="billing-error">{error}</p>}
      {uncertain && <p role="alert" className="billing-error">No se pudo confirmar el resultado. Revisa los movimientos actualizados antes de intentar otra vez; no se reenviará automáticamente.</p>}
      {discountNotice && <p role="status" className="billing-feedback">{discountNotice} <button type="button" className="underline" onClick={onClose}>Volver a consultar</button></p>}
      {onCreateDiscount && ["pending", "partial"].includes(charge.status) && <section className="billing-discount-pane"><h3 className="font-semibold">Descuento</h3><p className="billing-muted">Opcional. Aplícalo antes de registrar el pago.</p>
        <form className="mt-3 grid gap-3" onSubmit={event => submit(event, "discount")}><fieldset className="grid gap-3" disabled={busy || uncertain || Boolean(discountNotice)}>
          <SelectInput label="Motivo del descuento" value={reason} onChange={e => setReason(e.target.value)}>
            {["Hermanos", "Referido", "Promocion", "Lesion", "Pausa autorizada", "Autorizacion especial"].map(item => <option key={item}>{item}</option>)}
          </SelectInput>
          <TextInput label="Monto del descuento (opcional)" type="number" min="0.01" max={charge.balance} step="0.01" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} />
          <button className="billing-secondary" type="submit" disabled={Boolean(paymentValidation(charge, discountAmount)) || pending}>{discountActionLabel}</button>
          <p className="billing-muted">Se conservan los permisos actuales: caja solicita autorización; administración y contabilidad pueden aprobar.</p>
        </fieldset></form>
      </section>}
      </div>
    </>}
    <section className="billing-details"><h3 className="font-semibold">Detalle e historial ({payments.length + discounts.length})</h3>
      <p className="billing-muted mt-3">{charge.description || charge.concept} · Vencimiento: {charge.due_date || "Sin fecha"}</p>
      <p className="billing-muted">Tutor: {charge.payer_name || "Sin registro"} · {charge.payer_phone}</p>
      <p className="mt-3 text-sm">Cargo: ${money(charge.amount)} · Pagado: ${money(charge.paid_amount)} · Descuentos: ${money(charge.discount_amount)}</p>
      {payments.map(item => <div key={item.id} className="mt-3 border-t pt-2 text-sm"><strong>${money(item.amount)}</strong> · {paymentMethodLabel(item.method)} · {paymentStatusLabel(item.status)}<p className="billing-muted">{item.reference || `Folio #${item.id}`} · {(item.confirmed_at || item.paid_at || "").slice(0, 10)} · {item.received_by_username}</p></div>)}
      {discounts.map(item => <p key={item.id} className="mt-3 text-sm">Descuento ${money(item.amount)} · {item.reason} · {({ requested: "Pendiente", approved: "Aprobado", rejected: "Rechazado", canceled: "Cancelado" })[item.status]}</p>)}
      {!payments.length && !discounts.length && <p className="billing-muted mt-3">Sin movimientos anteriores.</p>}
    </section>
  </section>;
}
