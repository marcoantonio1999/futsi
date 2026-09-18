import { useRef, useState, type FormEvent } from "react";
import type { AppData, Charge, Student } from "../../types";
import { ApiError } from "../../api";
import { Banknote, CreditCard, CheckCircle2 } from "lucide-react";
import { money } from "../../utils/format";
import { SelectInput, TextInput, paymentStatusLabel } from "../../components/views/shared";
import { amountInCents, collectDirect, type DirectCollectionAttempt, type BillingMutation } from "./billingFlow";
import { recurrenceDates } from "./recurrence";

export function InlineChargeForm({ student, data, onCreatePlan, onCreateCharge, onCreatePayment, onCreateDiscount, onCreated, onCompleted, onCancel, onBusyChange }: {
  student: Student; data: AppData; onCreateCharge: BillingMutation; onCreatePayment: BillingMutation; onCreateDiscount?: BillingMutation;
  onCreatePlan?: BillingMutation;
  onCreated: (charge: Charge) => void; onCompleted: (charge: Charge) => void; onCancel: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [concept, setConcept] = useState("Mensualidad");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState("cash");
  const [discountAmount, setDiscountAmount] = useState("");
  const [reason, setReason] = useState("Hermanos");
  const [recurring, setRecurring] = useState(false);
  const [month, setMonth] = useState(() => recurrenceDates(due.slice(0,7), 7, 2)[Number(due.slice(8)) > 7 ? 1 : 0].slice(0,7));
  const [day, setDay] = useState("7");
  const [count, setCount] = useState("6");
  const [interval, setInterval] = useState("1");
  const [registration, setRegistration] = useState("");
  const [collectFirst, setCollectFirst] = useState(false);
  const [savedPlan, setSavedPlan] = useState<Charge[] | null>(null);
  const requestKey = useRef(crypto.randomUUID());
  const dates = recurrenceDates(month, Number(day), Number(count), Number(interval));
  const registrations = data.studentTournamentRegistrations.filter(item => item.student === student.id && item.status === "registered");
  const [outcome, setOutcome] = useState<"complete" | "approval" | null>(null);
  const [savedCharge, setSavedCharge] = useState<Charge | null>(null);
  const attempt = useRef<DirectCollectionAttempt>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const locked = useRef(false);
  const duplicates = data.charges.filter(item => item.id !== savedCharge?.id && item.student === student.id && item.concept === concept && ["pending", "partial"].includes(item.status));
  const gross = amountInCents(amount);
  const discount = discountAmount.trim() ? amountInCents(discountAmount) : 0;
  const total = (gross ?? 0) - (discount ?? 0);
  const valid = gross !== null && gross > 0 && discount !== null && discount >= 0 && total >= 0 && (!recurring || dates.length > 0);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || locked.current) return;
    locked.current = true; setBusy(true); onBusyChange(true); setError("");
    try {
      if (recurring && onCreatePlan) {
        const response = await onCreatePlan({ request_key: requestKey.current, student: student.id, tournament_registration: registration ? Number(registration) : null,
          concept, amount, discount_amount: discountAmount || "0", reason, first_due_date: dates[0], day_of_month: Number(day),
          interval_months: Number(interval), installments: Number(count), collect_first: collectFirst, method }) as { charges: Charge[] };
        if (!Array.isArray(response?.charges) || response.charges.length !== dates.length || response.charges.some(c => !Number.isInteger(c.id))) throw new Error("No se confirmó el plan completo. Revisa los cargos antes de intentar otra vez.");
        response.charges.forEach(onCreated);
        setSavedPlan(response.charges);
        return;
      }
      const result = await collectDirect(attempt.current, {
        charge: { site: student.site, student: student.id, concept, amount, description: description.trim(), due_date: due || null },
        discountCents: discount ?? 0, totalCents: total, reason, method,
      }, { charge: onCreateCharge, payment: onCreatePayment, discount: onCreateDiscount, onCharge: charge => { setSavedCharge(charge); onCreated(charge); } });
      setOutcome(result);
      if (result === "complete") onCompleted(attempt.current.charge!);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar el cobro.");
      const rejected = err instanceof ApiError && err.status >= 400 && err.status < 500;
      setUncertain(!rejected);
      if (rejected) locked.current = false;
    } finally { setBusy(false); onBusyChange(false); }
  }
  if (savedPlan) return <section className="billing-inline-form billing-feedback" role="status"><CheckCircle2 /><h3 className="text-xl font-bold mt-3">Plan recurrente guardado</h3>
    <p>{savedPlan.length} cuotas para {student.full_name}, del {dates[0]} al {dates.at(-1)}.</p>
    <p>{collectFirst ? "Se procesó la primera cuota. Revisa su estado en los movimientos." : "No se registró ningún pago recibido."} Las cuotas aparecen en esta misma página, con su fecha y saldo.</p>
    <button type="button" className="billing-primary mt-4" onClick={onCancel}>Ver cuotas y cobrar</button></section>;
  if (outcome) return <section className="billing-inline-form billing-feedback" role="status"><CheckCircle2 /><h3 className="text-xl font-bold mt-3">{outcome === "approval" ? "Descuento pendiente de autorización" : attempt.current.payment ? "Pago registrado" : "Cargo cubierto por descuento"}</h3>
    <p>{student.full_name} · {concept}</p>
    {attempt.current.payment && <p>${money(attempt.current.payment.amount)} · {paymentStatusLabel(attempt.current.payment.status)} · Folio #{attempt.current.payment.id}</p>}
    {outcome === "approval" && <p>Se guardaron el cargo y la solicitud de descuento. No se registró un pago; primero debe autorizarse el descuento.</p>}
    <button type="button" className="billing-primary mt-4" onClick={onCancel}>Listo · ver movimientos</button>
  </section>;
  return <form className="billing-inline-form" onSubmit={submit}>
    <h3 className="text-lg font-bold">Nuevo cobro para {student.full_name}</h3>
    <p className="billing-muted mb-4">{recurring ? "Define las cuotas pendientes. Solo se registra un pago si indicas que ya recibiste la primera cuota." : "Completa los datos y registra el cobro con un solo botón."}</p>
    <fieldset className="grid gap-4" disabled={busy || uncertain}>
    <fieldset className="grid gap-4" disabled={Boolean(savedCharge)}>
      {onCreatePlan && <div className="billing-methods" role="group" aria-label="Tipo de cobro">
        <button type="button" className="billing-secondary" aria-pressed={!recurring} onClick={() => setRecurring(false)}>Cobro único</button>
        <button type="button" className="billing-secondary" aria-pressed={recurring} onClick={() => setRecurring(true)}>Cobro recurrente</button>
      </div>}
      <div className="billing-new-charge-grid"><div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectInput label="Concepto" value={concept} onChange={e => setConcept(e.target.value)}>{["Mensualidad", "Semanalidad torneo", "Torneo completo", "Jornada torneo", "Liguilla", "Uniforme", "Sancion"].map(item => <option key={item}>{item}</option>)}</SelectInput>
        <TextInput label={recurring ? "Importe por cuota" : "Monto del nuevo cobro"} autoFocus type="number" min="0.01" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} />
      </div>
      {!recurring && <section className="billing-details"><h4 className="font-semibold">Fecha y detalle (opcional)</h4><div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TextInput label="Fecha límite de pago" type="date" value={due} onChange={e => setDue(e.target.value)} />
        <TextInput label="Detalle" placeholder="Ej. Mensualidad de septiembre" value={description} onChange={e => setDescription(e.target.value)} />
      </div></section>}
      </div>
      {onCreateDiscount && <section className="billing-new-discount"><h4 className="font-semibold">{recurring ? "Descuento en cada cuota" : "Descuento opcional"}</h4><div className="mt-3 grid gap-3">
        <TextInput label="Descuento" type="number" min="0" max={amount || undefined} step="0.01" value={discountAmount} placeholder="0.00" onChange={e => setDiscountAmount(e.target.value)} />
        <SelectInput label="Motivo del descuento" value={reason} onChange={e => setReason(e.target.value)}>{["Hermanos", "Referido", "Promocion", "Lesion", "Pausa autorizada", "Autorizacion especial"].map(item => <option key={item}>{item}</option>)}</SelectInput>
      </div><p className="billing-muted mt-2">Si requiere autorización, se guardará la solicitud sin registrar el pago.</p></section>}
      </div>
      {recurring && <section className="billing-details"><h4 className="font-semibold">Calendario de cuotas</h4><div className="mt-3 grid gap-3 sm:grid-cols-2">
        <SelectInput label="Vincular a torneo (opcional)" value={registration} onChange={e => { setRegistration(e.target.value); const r = registrations.find(r => String(r.id) === e.target.value); if (r?.billing_starts_on) setMonth(r.billing_starts_on.slice(0,7)); }}><option value="">Sin torneo · plazo personalizado</option>{registrations.map(r => <option key={r.id} value={r.id}>{r.tournament_name || data.tournaments.find(t=>t.id===r.tournament)?.name || `Inscripción #${r.id}`}</option>)}</SelectInput>
        <TextInput label="Primer mes de cobro" type="month" required value={month} onChange={e => setMonth(e.target.value)} />
        <TextInput label="Día de pago de cada mes" type="number" min="1" max="31" step="1" required value={day} onChange={e => setDay(e.target.value)} />
        <SelectInput label="Repetir cada" value={interval} onChange={e => setInterval(e.target.value)}>{[1,2,3,6,12].map(n => <option key={n} value={n}>{n === 1 ? "Mes" : `${n} meses`}</option>)}</SelectInput>
        <TextInput label="Número de cuotas" type="number" min="1" max="120" step="1" required value={count} onChange={e => setCount(e.target.value)} />
      </div><p className="billing-muted mt-3">Para un torneo de 15 meses, elige cada mes y 15 cuotas. El plazo comienza en el primer mes seleccionado, no en el inicio del torneo. Solo se muestran inscripciones activas del alumno.</p>
      <p className="mt-3 font-semibold">{dates.length} cuotas · del {dates[0] || "—"} al {dates.at(-1) || "—"} · total neto previsto ${money(Math.max(0,total) * dates.length / 100)}</p>
      <div className="billing-schedule-dates" aria-label="Vista previa de cuotas">{dates.map((date,i) => <span key={date}>Cuota {i+1}: {date}</span>)}</div>
      <p className="billing-muted mt-2">Si el mes no tiene el día elegido, vence el último día de ese mes. Los descuentos sujetos a autorización aún no reducen el saldo.</p>
      <label className="flex items-center gap-2 mt-4"><input type="checkbox" checked={collectFirst} onChange={e => setCollectFirst(e.target.checked)} /> Ya recibí el pago de la primera cuota: registrarlo ahora</label></section>}
    </fieldset>
      {(!recurring || collectFirst) && <div><h4 className="font-semibold">¿Cómo recibiste el pago?</h4><div className="billing-methods">
        <button type="button" className="billing-secondary" aria-pressed={method === "cash"} onClick={() => setMethod("cash")}><Banknote size={18} /> Efectivo</button>
        <button type="button" className="billing-secondary" aria-pressed={method === "card"} onClick={() => setMethod("card")}><CreditCard size={18} /> Tarjeta</button>
      </div><p className="billing-muted mt-2">{method === "cash" ? "Registra únicamente el efectivo recibido." : "Registra el pago recibido en terminal; este formulario no carga una tarjeta bancaria."}</p></div>}
      {duplicates.length > 0 && <div className="billing-error">Ya hay {duplicates.length} cargo(s) pendiente(s) de {concept} para este alumno. Revisa antes de crear otro.</div>}
      {discount !== null && gross !== null && discount > gross && <p role="alert" className="billing-error">El descuento no puede superar el importe.</p>}
      <div className="billing-total"><div><p>Importe ${money((gross ?? 0) / 100)} − descuento ${money((discount ?? 0) / 100)}</p><span>{recurring ? "Neto por cuota" : "Total a cobrar"}</span><strong className="block">${money(Math.max(0, total) / 100)}</strong></div><button className="billing-primary" type="submit" disabled={!valid || busy}>{busy ? "Guardando…" : recurring ? collectFirst ? "Guardar plan y cobrar primera cuota" : "Guardar cuotas por cobrar" : savedCharge ? `Reintentar pago de $${money(total / 100)}` : `Cobrar $${money(Math.max(0, total) / 100)}`}</button></div>
    </fieldset>
    {error && <p role="alert" className="billing-error">{error}</p>}
    {savedCharge && error && <p role="status" className="billing-feedback">El cargo #{savedCharge.id} ya está guardado. {attempt.current.discount ? "El descuento también está guardado. " : ""}No se crearán otra vez al reintentar. No hay un pago confirmado.</p>}
    {uncertain && <p role="alert" className="billing-error">Resultado incierto. No se reenviará automáticamente. Revisa los cargos actualizados antes de volver a intentar.</p>}
    <button className="billing-secondary mt-3" type="button" disabled={busy} onClick={onCancel}>{uncertain || savedCharge ? "Cerrar y revisar cargos" : "Cancelar"}</button>
  </form>;
}
