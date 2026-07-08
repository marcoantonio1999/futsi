import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import {
  BarChart3,
  Building2,
  Camera,
  Check,
  ClipboardCheck,
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
import { Metric } from "../../components/cards/Metric";
import { CollectionFunnel } from "../../components/charts/CollectionFunnel";
import { FinancialAxisChart } from "../../components/charts/FinancialAxisChart";
import { FinancialComboChart } from "../../components/charts/FinancialComboChart";
import { PaymentMethodDonut } from "../../components/charts/PaymentMethodDonut";
import { PendingBySiteChart } from "../../components/charts/PendingBySiteChart";
import { StudentStatusDonut } from "../../components/charts/StudentStatusDonut";
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
} from "../../components/views/shared";
import { BillingCollectionPanel } from "./BillingCollectionPanel";

export type BillingSection = "program" | "scheduled";

export function BillingPanel({
  data,
  section = "scheduled",
  onCreateCharge,
  onCreatePayment,
  onCreateDiscount,
  onApproveDiscount,
  onRejectDiscount,
}: {
  data: AppData;
  section?: BillingSection;
  onCreateCharge: (payload: unknown) => void;
  onCreatePayment: (payload: unknown) => void;
  onCreateDiscount: (payload: unknown) => void;
  onApproveDiscount: (discountId: number) => void;
  onRejectDiscount: (discountId: number) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const requestedDiscounts = data.discounts.filter((discount) => discount.status === "requested");
  const [chargeForm, setChargeForm] = useState({
    student: "",
    concept: "Mensualidad",
    description: "",
    amount: "",
    due_date: today,
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

  const chargeFormPanel = (
    <div className="grid gap-5">
      <form onSubmit={submitCharge} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plus size={16} /> Programar cobro
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white xl:self-end">
            <Plus size={16} /> Guardar cobro
          </button>
        </div>
      </form>
    </div>
  );

  if (section === "program") {
    return chargeFormPanel;
  }

  return (
    <>
      <div className="order-1 grid min-w-0 gap-5 lg:order-none">
        <BillingCollectionPanel data={data} onCreatePayment={onCreatePayment} onCreateDiscount={onCreateDiscount} />

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
