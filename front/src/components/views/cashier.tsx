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
import { SportsPanel } from "./sports";

export function CashierPortal({
  user,
  data,
  onRefresh,
  onLogout,
  onCreatePayment,
  onPaymentAction,
  onUpdateMatch,
  onCreateCashMovement,
  onAcceptStaffPayment,
  onRejectStaffPayment,
}: {
  user: User;
  data: AppData;
  onRefresh: () => void;
  onLogout: () => void;
  onCreatePayment: (payload: unknown) => void;
  onPaymentAction: (paymentId: number, action: string) => void;
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
  onCreateCashMovement: (payload: unknown) => void;
  onAcceptStaffPayment: (requestId: number) => void;
  onRejectStaffPayment: (requestId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedStudentId, setSelectedStudentId] = useState<number | null>(data.students[0]?.id ?? null);
  const [paymentForm, setPaymentForm] = useState({
    charge: "",
    method: "cash",
    channel: "cash_confirmation",
    amount: "",
  });

  const selectedStudent = data.students.find((student) => student.id === selectedStudentId) ?? null;
  const filteredStudents = data.students.filter((student) =>
    `${student.full_name} ${student.guardian_name ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const openCharges = data.charges.filter(
    (charge) => charge.student === selectedStudentId && (charge.status === "pending" || charge.status === "partial"),
  );
  const recentPayments = data.payments.filter((payment) => payment.student === selectedStudentId).slice(0, 5);
  const todayTotal = data.payments.filter((payment) => payment.status === "registered" || payment.status === "reconciled").reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const primarySiteId = user.primary_site ?? data.sites[0]?.id ?? null;
  const cashSnapshot = calculateCashBySite(data, primarySiteId ? [primarySiteId] : []);
  const currentCash = cashSnapshot[0]?.cashInBox ?? 0;
  const [cashMovementForm, setCashMovementForm] = useState({
    amount: "",
    reason: "Retiro a resguardo por exceso de efectivo",
    notes: "",
  });
  function changePaymentMethod(method: string) {
    const nextChannel =
      method === "transfer" ? "transfer_clabe" : method === "card" ? "card_terminal" : method === "cash" ? "cash_confirmation" : "courtesy";
    setPaymentForm({ ...paymentForm, method, channel: nextChannel });
  }

  useEffect(() => {
    if (!selectedStudentId && data.students[0]) setSelectedStudentId(data.students[0].id);
  }, [data.students, selectedStudentId]);

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

  function selectCharge(chargeId: string) {
    const charge = openCharges.find((item) => item.id === Number(chargeId));
    setPaymentForm({
      ...paymentForm,
      charge: chargeId,
      amount: charge ? charge.balance : "",
    });
  }

  function submitCashMovement(event: FormEvent) {
    event.preventDefault();
    if (!primarySiteId) return;
    onCreateCashMovement({
      site: primarySiteId,
      movement_type: "vault_transfer",
      amount: cashMovementForm.amount,
      movement_date: new Date().toISOString().slice(0, 10),
      reason: cashMovementForm.reason,
      responsible: user.id,
      notes: cashMovementForm.notes,
    });
    setCashMovementForm({ ...cashMovementForm, amount: "", notes: "" });
  }

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950" data-testid="cashier-portal">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Ventanilla</p>
            <h1 className="text-xl font-semibold">{user.primary_site_name || "Caja"}</h1>
          </div>
          <div className="flex gap-2">
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white" onClick={onRefresh} title="Actualizar">
              <RefreshCw size={16} />
            </button>
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white" onClick={onLogout} title="Salir">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-6">
        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Alumnos en sede" value={data.students.length} />
          <Metric label="Cobros pendientes" value={`$${money(data.charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0))}`} />
          <Metric label="Pagos registrados" value={`$${money(todayTotal)}`} />
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
          <StaffPaymentInbox
            requests={data.staffPaymentRequests}
            currentUser={user}
            onAccept={onAcceptStaffPayment}
            onReject={onRejectStaffPayment}
          />
          <form onSubmit={submitCashMovement} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Retiro a resguardo</h2>
            <p className="mt-1 text-sm text-zinc-500">Efectivo estimado en caja: ${money(currentCash)}</p>
            <div className="mt-4 grid gap-3">
              <TextInput label="Monto a retirar" type="number" min="0" step="0.01" required value={cashMovementForm.amount} onChange={(event) => setCashMovementForm({ ...cashMovementForm, amount: event.target.value })} />
              <TextInput label="Motivo" required value={cashMovementForm.reason} onChange={(event) => setCashMovementForm({ ...cashMovementForm, reason: event.target.value })} />
              <TextInput label="Notas" value={cashMovementForm.notes} onChange={(event) => setCashMovementForm({ ...cashMovementForm, notes: event.target.value })} />
              <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                Este retiro solo baja el efectivo fisico de la caja de sede; no duplica gasto ni resta la caja general.
              </p>
              <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">Registrar retiro</button>
            </div>
          </form>
        </section>

        <section className="mt-6">
          <SportsPanel data={data} canEditMatches onUpdateMatch={onUpdateMatch} canEditAssessments={false} onSaveAssessment={async () => undefined} />
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[360px_1fr]">
          <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <h2 className="text-base font-semibold">Buscar alumno</h2>
            <TextInput label="Nombre o tutor" value={query} onChange={(event) => setQuery(event.target.value)} className="mt-4" />
            <div className="mt-4 grid max-h-[520px] gap-2 overflow-auto">
              {filteredStudents.map((student) => (
                <button
                  key={student.id}
                  className={`rounded-md border px-3 py-2 text-left text-sm ${
                    selectedStudentId === student.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white"
                  }`}
                  onClick={() => setSelectedStudentId(student.id)}
                >
                  <span className="block font-medium">{student.full_name}</span>
                  <span className={selectedStudentId === student.id ? "text-zinc-200" : "text-zinc-500"}>
                    {student.guardian_name} - {student.group_name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-200 px-4 py-3">
                <h2 className="font-semibold">{selectedStudent?.full_name || "Selecciona un alumno"}</h2>
                {selectedStudent && (
                  <p className="mt-1 text-sm text-zinc-500">
                    {selectedStudent.guardian_name} - {selectedStudent.group_name} - {selectedStudent.status}
                  </p>
                )}
              </div>
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <Metric label="Saldo" value={`$${money(openCharges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0))}`} />
                <Metric label="Cobros abiertos" value={openCharges.length} />
              </div>
            </div>

            <form onSubmit={submitPayment} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <CreditCard size={16} /> Cobrar semana / torneo
              </h2>
              <div className="mt-4 grid gap-3">
                <SelectInput label="Cobro programado" required value={paymentForm.charge} onChange={(event) => selectCharge(event.target.value)}>
                  <option value="">{openCharges.length ? "Seleccionar mensualidad, jornada o torneo" : "No hay cobros programados pendientes"}</option>
                  {openCharges.map((charge) => (
                    <option key={charge.id} value={charge.id}>
                      {chargeLabel(charge)} - ${money(charge.balance)}
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
                  El monto se llena con el saldo del cobro seleccionado. Puedes bajarlo si el cliente hace un pago parcial.
                </p>
                {openCharges.some((charge) => charge.concept.toLowerCase().includes("jornada") || charge.concept.toLowerCase().includes("torneo") || charge.concept.toLowerCase().includes("liguilla")) && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    Para torneo/liguilla, este cobro corresponde a la semana o partido programado. Si no queda pagado o autorizado, no deberia jugar.
                  </p>
                )}
                {paymentForm.method === "transfer" && (
                  <p className="rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
                    El cliente transfiere a su CLABE unica. El pago queda en proceso y se confirma con webhook SPEI simulado.
                  </p>
                )}
                {paymentForm.method === "cash" && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Se manda una solicitud al portal del representante para aceptar que entrego efectivo.
                  </p>
                )}
                <button className="flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white" data-testid="cashier-create-payment">
                  <CreditCard size={16} /> Crear solicitud
                </button>
              </div>
            </form>

            <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
              <TableHeader title="Pagos del alumno" count={recentPayments.length} />
              <div className="divide-y divide-zinc-100">
                {recentPayments.map((payment) => (
                  <div key={payment.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">${money(payment.amount)} - {paymentMethodLabel(payment.method)}</p>
                      <StatusPill label={paymentStatusLabel(payment.status)} />
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">{payment.reference || payment.tracking_key || payment.payment_url || "Sin referencia"}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {payment.status === "processing" && payment.method === "transfer" && (
                        <button className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white" onClick={() => onPaymentAction(payment.id, "simulate-webhook")}>
                          Simular llegada SPEI
                        </button>
                      )}
                      {payment.status === "processing" && payment.channel === "card_link" && (
                        <button className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white" onClick={() => onPaymentAction(payment.id, "simulate-webhook")}>
                          Simular pago de link
                        </button>
                      )}
                      {(payment.status === "processing" || payment.status === "awaiting_confirmation") && (
                        <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium" onClick={() => onPaymentAction(payment.id, "expire")}>
                          Expirar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {recentPayments.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin pagos registrados.</p>}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
