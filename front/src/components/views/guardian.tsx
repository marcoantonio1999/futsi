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

export function GuardianPortal({
  user,
  data,
  onRefresh,
  onLogout,
  onPaymentAction,
  onUpdateProfile,
  onDownloadFile,
  onSaveAssessment,
}: {
  user: User;
  data: AppData;
  onRefresh: () => void;
  onLogout: () => void;
  onPaymentAction: (paymentId: number, action: string) => void;
  onUpdateProfile: (payload: unknown) => void;
  onDownloadFile: (path: string, filename: string) => void;
  onSaveAssessment: (payload: unknown) => Promise<void>;
}) {
  const totalBalance = data.charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
  const openCharges = data.charges
    .filter((charge) => charge.status === "pending" || charge.status === "partial")
    .sort((a, b) => (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31"));
  const attentionCharges = openCharges.filter((charge) => charge.due_bucket === "overdue" || charge.due_bucket === "due_soon");
  const actionablePayments = data.payments.filter((payment) => payment.status === "awaiting_confirmation" || payment.channel === "card_link");
  const presentCount = data.attendanceRecords.filter((record) => record.status === "present").length;

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950" data-testid="guardian-portal">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Portal familiar</p>
            <h1 className="text-xl font-semibold">{user.guardian_name || user.username}</h1>
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
        <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
          <ProfilePanel user={user} onSave={onUpdateProfile} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Alumnos vinculados" value={data.students.length} />
            <Metric label="Saldo pendiente" value={`$${money(totalBalance)}`} />
            <Metric label="Pagos por confirmar" value={actionablePayments.length} />
            <Metric label="Asistencias" value={presentCount} />
          </div>
        </section>

        <section className="mt-6 rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase text-zinc-500">Cuenta para transferencias</p>
          <p className="mt-1 font-mono text-xl font-semibold">{user.guardian_virtual_clabe || "Pendiente"}</p>
          <p className="mt-1 text-sm text-zinc-500">Esta CLABE es unica para tu familia. Cuando el banco confirme el SPEI, el pago se marca automaticamente en el sistema.</p>
        </section>

        <section className="mt-6">
          <SportsPanel data={data} canEditMatches={false} canEditAssessments={false} onUpdateMatch={async () => undefined} onSaveAssessment={onSaveAssessment} />
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <TableHeader title="Mis alumnos" count={data.students.length} />
            <div className="divide-y divide-zinc-100">
              {data.students.map((student) => {
                const charges = data.charges.filter((charge) => charge.student === student.id);
                const attendance = data.attendanceRecords.filter((record) => record.student === student.id);
                return (
                  <div key={student.id} className="px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{student.full_name}</p>
                      <StatusPill label={statusLabels[student.status]} />
                      {student.open_charge_count > 0 && (
                        <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                          Pago pendiente ${money(student.balance_due)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {student.site_name} - {student.group_name || student.category}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md border border-zinc-200 px-3 py-2">
                        <p className="text-xs uppercase text-zinc-500">Cargos</p>
                        <p className="mt-1 text-sm font-medium">{charges.length} registrados</p>
                      </div>
                      <div className="rounded-md border border-zinc-200 px-3 py-2">
                        <p className="text-xs uppercase text-zinc-500">Asistencia</p>
                        <p className="mt-1 text-sm font-medium">{attendance.length} registros</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
              <TableHeader title="Pagos por atender" count={attentionCharges.length} />
              <div className="divide-y divide-zinc-100">
                {attentionCharges.slice(0, 6).map((charge) => (
                  <div key={charge.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{charge.student_name} - ${money(charge.balance)}</p>
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${charge.due_bucket === "overdue" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
                        {charge.due_bucket === "overdue" ? "Vencido" : "Por vencer"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">{charge.customer_notice || `${charge.concept} vence ${charge.due_date || "sin fecha"}`}</p>
                    <p className="mt-1 text-xs text-zinc-400">Aviso simulado enviado al telefono registrado.</p>
                  </div>
                ))}
                {attentionCharges.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin pagos vencidos o por vencer en 2 dias.</p>}
              </div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
              <TableHeader title="Notificaciones de pago" count={actionablePayments.length} />
              <div className="divide-y divide-zinc-100">
                {actionablePayments.map((payment) => (
                  <div key={payment.id} className="px-4 py-3">
                    <p className="font-medium">{payment.student_name} - ${money(payment.amount)}</p>
                    <p className="mt-1 text-sm text-zinc-500">{paymentStatusLabel(payment.status)} - {payment.reference}</p>
                    {payment.status === "awaiting_confirmation" && (
                      <button className="mt-3 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white" onClick={() => onPaymentAction(payment.id, "confirm-cash")}>
                        Aceptar efectivo recibido
                      </button>
                    )}
                    {payment.channel === "card_link" && payment.status === "processing" && (
                      <button className="mt-3 rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white" onClick={() => onPaymentAction(payment.id, "simulate-webhook")}>
                        Pagar link simulado
                      </button>
                    )}
                  </div>
                ))}
                {actionablePayments.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin pagos por confirmar.</p>}
              </div>
            </div>
            <SimpleList
              title="Mis cobros abiertos"
              count={openCharges.length}
              rows={openCharges.slice(0, 10).map((charge) => ({
                id: charge.id,
                title: `${charge.student_name} - ${charge.concept}`,
                subtitle: `Saldo $${money(charge.balance)} - vence ${charge.due_date || "sin fecha"} - ${chargeStatusLabel(charge.status)}`,
              }))}
            />
            <SimpleList
              title="Pagos"
              count={data.payments.length}
              rows={data.payments.map((payment) => ({
                id: payment.id,
                title: `${payment.student_name} - $${money(payment.amount)}`,
                subtitle: `${paymentMethodLabel(payment.method)} - ${paymentStatusLabel(payment.status)} - ${payment.reference || payment.tracking_key || "sin referencia"}`,
              }))}
            />
            <SimpleList
              title="Asistencia reciente"
              count={data.attendanceRecords.length}
              rows={data.attendanceRecords.slice(0, 8).map((record) => ({
                id: record.id,
                title: record.student_name || "Alumno",
                subtitle: record.status === "present" ? "Asistio" : record.status === "absent" ? "Falto" : "Justificada",
              }))}
            />
            <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
              <TableHeader title="Mis facturas" count={data.invoices.length} />
              <InvoiceRows invoices={data.invoices} onDownloadFile={onDownloadFile} />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export function ProfilePanel({ user, onSave }: { user: User; onSave: (payload: unknown) => void }) {
  const [form, setForm] = useState({
    guardian_full_name: user.guardian_name || `${user.first_name} ${user.last_name}`.trim() || user.username,
    guardian_email: user.email || "",
    guardian_phone: user.phone || "",
    first_name: user.first_name || "",
    last_name: user.last_name || "",
    email: user.email || "",
    phone: user.phone || "",
    avatar_url: user.avatar_url || "",
  });

  useEffect(() => {
    setForm({
      guardian_full_name: user.guardian_name || `${user.first_name} ${user.last_name}`.trim() || user.username,
      guardian_email: user.email || "",
      guardian_phone: user.phone || "",
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email || "",
      phone: user.phone || "",
      avatar_url: user.avatar_url || "",
    });
  }, [user]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({
      ...form,
      email: form.guardian_email,
      phone: form.guardian_phone,
    });
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <Avatar name={form.guardian_full_name} imageUrl={form.avatar_url} />
        <div>
          <p className="text-xs font-medium uppercase text-zinc-500">Perfil</p>
          <h2 className="font-semibold">{form.guardian_full_name}</h2>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        <TextInput label="Foto URL" placeholder="https://..." value={form.avatar_url} onChange={(event) => setForm({ ...form, avatar_url: event.target.value })} />
        <TextInput label="Nombre del representante" required value={form.guardian_full_name} onChange={(event) => setForm({ ...form, guardian_full_name: event.target.value })} />
        <TextInput label="Correo" type="email" value={form.guardian_email} onChange={(event) => setForm({ ...form, guardian_email: event.target.value })} />
        <TextInput label="Telefono" value={form.guardian_phone} onChange={(event) => setForm({ ...form, guardian_phone: event.target.value })} />
        <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">Guardar perfil</button>
      </div>
    </form>
  );
}
