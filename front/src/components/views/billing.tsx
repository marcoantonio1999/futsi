import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Camera,
  Check,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  Lock,
  LogOut,
  Menu,
  Moon,
  Plus,
  RefreshCw,
  Upload,
  Shield,
  Sun,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { Metric } from "../cards/Metric";
import { CollectionFunnel } from "../charts/CollectionFunnel";
import { FinancialAxisChart } from "../charts/FinancialAxisChart";
import { FinancialComboChart } from "../charts/FinancialComboChart";
import { PaymentMethodDonut } from "../charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../charts/PendingBySiteChart";
import { StudentStatusDonut } from "../charts/StudentStatusDonut";
import { API_URL } from "../../api";
import { roleLabels, statusLabels } from "../../appState";
import { money } from "../../utils/format";
import type { AccountingSiteRow, AppData, AttendanceRecord, AttendanceSession, CashMovementType, Charge, ChargeStatus, Discount, Expense, ExpenseStatus, FaceRecognitionResponse, Guardian, HistoricalDiscrepancyReport, HistoricalImport, Invoice, Match, Payment, PaymentMethod, PaymentStatus, Player, PlayerAttendanceRecord, Role, Site, StaffPaymentKind, StaffPaymentRequest, StaffPaymentStatus, StandingRow, Student, StudentAssessment, Team, ThemeMode, User } from "../../types";

import {
  Avatar,
  AttendanceButton,
  FaceAttendanceCard,
  InfoChip,
  InvoiceGenerator,
  InvoiceRows,
  SelectInput,
  SimpleList,
  StaffPaymentInbox,
  StatusPill,
  TableHeader,
  TextInput,
  average,
  calculateCashBySite,
  calculateMonthlyTicketAverage,
  chargeLabel,
  chargeStatusLabel,
  collectionProgress,
  dateDay,
  dateMonthKey,
  expenseStatusLabel,
  exportAccountingWorkbook,
  cashMovementLabel,
  methodLabel,
  monthLabelFromKey,
  normalizeText,
  paymentMethodLabel,
  paymentMonthKey,
  paymentPayerKey,
  paymentStatusLabel,
  staffPaymentKindLabel,
  staffPaymentStatusLabel,
  sumAccountingRows,
} from "./shared";
import { BillingCollectionPanel } from "./billingCollection";

export function BillingPanel({
  data,
  onCreateCharge,
  onCreatePayment,
  onCreateDiscount,
  onApproveDiscount,
  onRejectDiscount,
}: {
  data: AppData;
  onCreateCharge: (payload: unknown) => void;
  onCreatePayment: (payload: unknown) => void;
  onCreateDiscount: (payload: unknown) => void;
  onApproveDiscount: (discountId: number) => void;
  onRejectDiscount: (discountId: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const openCharges = data.charges.filter((charge) => charge.status === "pending" || charge.status === "partial");
  const requestedDiscounts = data.discounts.filter((discount) => discount.status === "requested");
  const [chargeForm, setChargeForm] = useState({
    student: "",
    concept: "Mensualidad",
    description: "",
    amount: "",
    due_date: today,
  });
  const [paymentForm, setPaymentForm] = useState({
    charge: "",
    method: "cash",
    channel: "cash_confirmation",
    amount: "",
  });
  const [discountForm, setDiscountForm] = useState({
    charge: "",
    reason: "Promocion",
    amount: "",
  });

  function submitCharge(event: FormEvent) {
    event.preventDefault();
    const student = data.students.find((item) => item.id === Number(chargeForm.student));
    if (!student) return;
    onCreateCharge({
      site: student.site,
      student: student.id,
      concept: chargeForm.concept,
      description: chargeForm.description,
      amount: chargeForm.amount,
      due_date: chargeForm.due_date || null,
    });
    setChargeForm({ ...chargeForm, description: "", amount: "" });
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

  function changePaymentMethod(method: string) {
    const nextChannel =
      method === "transfer" ? "transfer_clabe" : method === "card" ? "card_terminal" : method === "cash" ? "cash_confirmation" : "courtesy";
    setPaymentForm({ ...paymentForm, method, channel: nextChannel });
  }

  function selectPaymentCharge(chargeId: string) {
    const charge = openCharges.find((item) => item.id === Number(chargeId));
    setPaymentForm({
      ...paymentForm,
      charge: chargeId,
      amount: charge ? charge.balance : "",
    });
  }

  function submitDiscount(event: FormEvent) {
    event.preventDefault();
    onCreateDiscount({
      charge: Number(discountForm.charge),
      reason: discountForm.reason,
      amount: discountForm.amount,
    });
    setDiscountForm({ ...discountForm, amount: "" });
  }

  return (
    <>
      <div className="order-2 grid gap-5 lg:order-none">
        <form onSubmit={submitCharge} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Plus size={16} /> Programar cobro
          </h2>
          <div className="mt-4 grid gap-3">
            <SelectInput label="Alumno" required value={chargeForm.student} onChange={(event) => setChargeForm({ ...chargeForm, student: event.target.value })}>
              <option value="">Seleccionar</option>
              {data.students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.full_name}
                </option>
              ))}
            </SelectInput>
            <SelectInput label="Tipo de cobro" value={chargeForm.concept} onChange={(event) => setChargeForm({ ...chargeForm, concept: event.target.value })}>
              <option value="Mensualidad">Mensualidad</option>
              <option value="Semanalidad torneo">Semanalidad torneo</option>
              <option value="Torneo completo">Torneo completo</option>
              <option value="Jornada torneo">Jornada torneo</option>
              <option value="Liguilla">Liguilla</option>
              <option value="Uniforme">Uniforme</option>
              <option value="Sancion">Sancion</option>
            </SelectInput>
            <TextInput label="Monto" type="number" min="0" step="0.01" required value={chargeForm.amount} onChange={(event) => setChargeForm({ ...chargeForm, amount: event.target.value })} />
            <TextInput label="Vence" type="date" value={chargeForm.due_date} onChange={(event) => setChargeForm({ ...chargeForm, due_date: event.target.value })} />
            <TextInput label="Detalle operativo" placeholder="Ej. Jornada 4, doble jornada, liguilla semifinal" value={chargeForm.description} onChange={(event) => setChargeForm({ ...chargeForm, description: event.target.value })} />
            <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
              <Plus size={16} /> Guardar cobro
            </button>
          </div>
        </form>

        <form onSubmit={submitPayment} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CreditCard size={16} /> Crear solicitud de pago
          </h2>
          <div className="mt-4 grid gap-3">
            <SelectInput label="Cobro programado" required value={paymentForm.charge} onChange={(event) => selectPaymentCharge(event.target.value)}>
              <option value="">{openCharges.length ? "Seleccionar mensualidad, jornada o torneo" : "No hay cobros pendientes"}</option>
              {openCharges.map((charge) => (
                <option key={charge.id} value={charge.id}>
                  {charge.student_name} - {chargeLabel(charge)} - ${money(charge.balance)}
                </option>
              ))}
            </SelectInput>
            <SelectInput label="Metodo" value={paymentForm.method} onChange={(event) => changePaymentMethod(event.target.value)}>
              <option value="cash">Efectivo</option>
              <option value="transfer">Transferencia</option>
              <option value="card">Tarjeta</option>
              <option value="courtesy">Cortesia</option>
            </SelectInput>
            {paymentForm.method === "card" && (
              <SelectInput label="Canal de tarjeta" value={paymentForm.channel} onChange={(event) => setPaymentForm({ ...paymentForm, channel: event.target.value })}>
                <option value="card_terminal">Terminal fisica simulada</option>
                <option value="card_link">Link de pago al cliente</option>
              </SelectInput>
            )}
            <TextInput label="Monto a cobrar" type="number" min="0" step="0.01" required value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
            <p className="text-xs text-zinc-500">
              No se captura referencia ni clave de rastreo manual. El sistema genera folio, CLABE, link o autorizacion simulada segun el metodo.
            </p>
            {paymentForm.method === "transfer" && (
              <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Transferencia queda en proceso y se confirma con webhook SPEI simulado.
              </p>
            )}
            {paymentForm.method === "cash" && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Efectivo queda pendiente hasta que el representante acepte en su portal.
              </p>
            )}
            <button className="flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
              <CreditCard size={16} /> Crear solicitud
            </button>
          </div>
        </form>

        <form onSubmit={submitDiscount} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle size={16} /> Solicitar descuento
          </h2>
          <div className="mt-4 grid gap-3">
            <SelectInput label="Cobro programado" required value={discountForm.charge} onChange={(event) => setDiscountForm({ ...discountForm, charge: event.target.value })}>
              <option value="">Seleccionar</option>
              {openCharges.map((charge) => (
                <option key={charge.id} value={charge.id}>
                  {charge.student_name} - {chargeLabel(charge)} - ${money(charge.balance)}
                </option>
              ))}
            </SelectInput>
            <SelectInput label="Motivo" value={discountForm.reason} onChange={(event) => setDiscountForm({ ...discountForm, reason: event.target.value })}>
              <option value="Promocion">Promocion</option>
              <option value="Hermanos">Hermanos</option>
              <option value="Lesion">Lesion</option>
              <option value="Pausa autorizada">Pausa autorizada</option>
              <option value="Autorizacion especial">Autorizacion especial</option>
            </SelectInput>
            <TextInput label="Monto" type="number" min="0" step="0.01" required value={discountForm.amount} onChange={(event) => setDiscountForm({ ...discountForm, amount: event.target.value })} />
            <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
              <Plus size={16} /> Solicitar descuento
            </button>
          </div>
        </form>
      </div>

      <div className="order-1 grid min-w-0 gap-5 lg:order-none">
        <BillingCollectionPanel data={data} />

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Descuentos pendientes" count={requestedDiscounts.length} />
          <div className="divide-y divide-zinc-100">
            {requestedDiscounts.map((discount) => (
              <div key={discount.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="font-medium">{discount.student_name} - ${money(discount.amount)}</p>
                  <p className="mt-1 text-sm text-zinc-500">{discount.charge_concept} - {discount.reason}</p>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white" onClick={() => onApproveDiscount(discount.id)}>
                    Aprobar
                  </button>
                  <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium" onClick={() => onRejectDiscount(discount.id)}>
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
            {requestedDiscounts.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin descuentos pendientes.</p>}
          </div>
        </div>

        <SimpleList
          title="Pagos recientes"
          count={data.payments.length}
          rows={data.payments.slice(0, 8).map((payment) => ({
            id: payment.id,
            title: `${payment.student_name} - $${money(payment.amount)}`,
            subtitle: `${paymentMethodLabel(payment.method)} - ${paymentStatusLabel(payment.status)} - ${payment.reference || payment.tracking_key || payment.payment_url || "folio automatico"}`,
          }))}
        />
      </div>
    </>
  );
}
