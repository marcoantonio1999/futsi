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

export function ExpensesPanel({
  data,
  onCreateExpense,
  onApproveExpense,
  onRejectExpense,
  onCreateInvoice,
  onCreateStaffPayment,
  onAcceptStaffPayment,
  onRejectStaffPayment,
  onCreateCashMovement,
}: {
  data: AppData;
  onCreateExpense: (payload: unknown) => void;
  onApproveExpense: (expenseId: number) => void;
  onRejectExpense: (expenseId: number) => void;
  onCreateInvoice: (payload: unknown) => void;
  onCreateStaffPayment: (payload: unknown) => void;
  onAcceptStaffPayment: (requestId: number) => void;
  onRejectStaffPayment: (requestId: number) => void;
  onCreateCashMovement: (payload: unknown) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    site: data.sites[0]?.id ? String(data.sites[0].id) : "",
    category: "Pago a coaches",
    description: "",
    amount: "",
    expense_date: today,
    provider_name: "",
  });
  const staffUsers = useMemo(() => data.users.filter((user) => ["coach", "cashier", "site_coordinator", "accounting"].includes(user.role)), [data.users]);
  const [staffPaymentForm, setStaffPaymentForm] = useState({
    site: data.sites[0]?.id ? String(data.sites[0].id) : "",
    recipient: staffUsers[0]?.id ? String(staffUsers[0].id) : "",
    kind: "coach_payroll" as StaffPaymentKind,
    amount: "",
    requested_payment_date: today,
    description: "",
    payment_method: "cash",
  });
  const [cashMovementForm, setCashMovementForm] = useState({
    site: data.sites[0]?.id ? String(data.sites[0].id) : "",
    movement_type: "vault_transfer" as CashMovementType,
    amount: "",
    movement_date: today,
    reason: "Retiro a resguardo por exceso de efectivo",
    responsible: staffUsers[0]?.id ? String(staffUsers[0].id) : "",
    notes: "",
  });

  const pendingExpenses = data.expenses.filter((expense) => expense.status === "pending");
  const pendingStaffPayments = data.staffPaymentRequests.filter((request) => request.status === "requested");
  const approvedTotal = data.expenses
    .filter((expense) => expense.status === "approved")
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const pendingTotal = pendingExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const pendingStaffTotal = pendingStaffPayments.reduce((sum, request) => sum + Number(request.amount || 0), 0);
  const cashBySite = calculateCashBySite(data);

  useEffect(() => {
    if (!form.site && data.sites[0]) setForm((current) => ({ ...current, site: String(data.sites[0].id) }));
    if (!staffPaymentForm.site && data.sites[0]) setStaffPaymentForm((current) => ({ ...current, site: String(data.sites[0].id) }));
    if (!staffPaymentForm.recipient && staffUsers[0]) setStaffPaymentForm((current) => ({ ...current, recipient: String(staffUsers[0].id) }));
    if (!cashMovementForm.site && data.sites[0]) setCashMovementForm((current) => ({ ...current, site: String(data.sites[0].id) }));
    if (!cashMovementForm.responsible && staffUsers[0]) setCashMovementForm((current) => ({ ...current, responsible: String(staffUsers[0].id) }));
  }, [data.sites, form.site, staffPaymentForm.site, staffPaymentForm.recipient, cashMovementForm.site, cashMovementForm.responsible, staffUsers]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreateExpense({
      ...form,
      site: Number(form.site),
      amount: form.amount,
    });
    setForm({ ...form, description: "", amount: "", provider_name: "" });
  }

  function submitStaffPayment(event: FormEvent) {
    event.preventDefault();
    onCreateStaffPayment({
      ...staffPaymentForm,
      site: Number(staffPaymentForm.site),
      recipient: Number(staffPaymentForm.recipient),
      amount: staffPaymentForm.amount,
    });
    setStaffPaymentForm({ ...staffPaymentForm, amount: "", description: "" });
  }

  function submitCashMovement(event: FormEvent) {
    event.preventDefault();
    onCreateCashMovement({
      ...cashMovementForm,
      site: Number(cashMovementForm.site),
      responsible: Number(cashMovementForm.responsible),
      amount: cashMovementForm.amount,
    });
    setCashMovementForm({ ...cashMovementForm, amount: "", notes: "" });
  }

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="grid content-start gap-5">
      <form onSubmit={submitStaffPayment} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileText size={16} /> Solicitud de pago a personal
        </h2>
        <p className="mt-1 text-sm text-zinc-500">Para nomina administrativa, coaches o arbitros. El receptor debe aceptar desde su usuario.</p>
        <div className="mt-4 grid gap-3">
          <SelectInput label="Sede" required value={staffPaymentForm.site} onChange={(event) => setStaffPaymentForm({ ...staffPaymentForm, site: event.target.value })}>
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </SelectInput>
          <SelectInput label="Persona que recibe" required value={staffPaymentForm.recipient} onChange={(event) => setStaffPaymentForm({ ...staffPaymentForm, recipient: event.target.value })}>
            {staffUsers.map((user) => (
              <option key={user.id} value={user.id}>{user.first_name || user.username} {user.last_name} - {roleLabels[user.role]}</option>
            ))}
          </SelectInput>
          <SelectInput label="Tipo" value={staffPaymentForm.kind} onChange={(event) => setStaffPaymentForm({ ...staffPaymentForm, kind: event.target.value as StaffPaymentKind })}>
            <option value="admin_payroll">Nomina administrativa</option>
            <option value="coach_payroll">Nomina coaches</option>
            <option value="referee_payroll">Nomina arbitros</option>
            <option value="other_staff_payment">Otro pago a personal</option>
          </SelectInput>
          <TextInput label="Monto" type="number" min="0" step="0.01" required value={staffPaymentForm.amount} onChange={(event) => setStaffPaymentForm({ ...staffPaymentForm, amount: event.target.value })} />
          <TextInput label="Fecha solicitada" type="date" required value={staffPaymentForm.requested_payment_date} onChange={(event) => setStaffPaymentForm({ ...staffPaymentForm, requested_payment_date: event.target.value })} />
          <TextInput label="Descripcion" required value={staffPaymentForm.description} onChange={(event) => setStaffPaymentForm({ ...staffPaymentForm, description: event.target.value })} />
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            <Plus size={16} /> Enviar solicitud
          </button>
        </div>
      </form>

      <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <FileText size={16} /> Nuevo gasto
        </h2>
        <div className="mt-4 grid gap-3">
          <SelectInput label="Sede" required value={form.site} onChange={(event) => setForm({ ...form, site: event.target.value })}>
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput label="Categoria" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
            <option value="Pago a coaches">Pago a coaches</option>
            <option value="Arbitraje">Arbitraje</option>
            <option value="Renta de cancha">Renta de cancha</option>
            <option value="Mantenimiento">Mantenimiento</option>
            <option value="Viaticos">Viaticos</option>
            <option value="Material deportivo">Material deportivo</option>
            <option value="Comisiones tarjeta">Comisiones tarjeta</option>
            <option value="Otros">Otros</option>
          </SelectInput>
          <TextInput label="Monto" type="number" min="0" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} />
          <TextInput label="Fecha" type="date" required value={form.expense_date} onChange={(event) => setForm({ ...form, expense_date: event.target.value })} />
          <TextInput label="Proveedor/persona" value={form.provider_name} onChange={(event) => setForm({ ...form, provider_name: event.target.value })} />
          <TextInput label="Descripcion" required value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            <Plus size={16} /> Capturar gasto
          </button>
        </div>
      </form>

      </aside>

      <div className="grid min-w-0 gap-5">
        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Pendiente aprobar" value={`$${money(pendingTotal)}`} />
          <Metric label="Pago personal pendiente" value={`$${money(pendingStaffTotal)}`} />
          <Metric label="Aprobado" value={`$${money(approvedTotal)}`} />
        </section>

        <StaffPaymentInbox
          requests={data.staffPaymentRequests}
          onAccept={onAcceptStaffPayment}
          onReject={onRejectStaffPayment}
        />

        <form onSubmit={submitCashMovement} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Control de efectivo en caja</h2>
          <p className="mt-1 text-sm text-zinc-500">Registra retiro a resguardo, salida de efectivo o ajuste por sede.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <SelectInput label="Sede" required value={cashMovementForm.site} onChange={(event) => setCashMovementForm({ ...cashMovementForm, site: event.target.value })}>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </SelectInput>
            <SelectInput label="Tipo de movimiento" value={cashMovementForm.movement_type} onChange={(event) => setCashMovementForm({ ...cashMovementForm, movement_type: event.target.value as CashMovementType })}>
              <option value="vault_transfer">Retiro a resguardo</option>
              <option value="cash_out">Salida de efectivo</option>
              <option value="cash_in">Entrada de efectivo</option>
              <option value="adjustment">Ajuste</option>
            </SelectInput>
            <TextInput label="Monto" type="number" min="0" step="0.01" required value={cashMovementForm.amount} onChange={(event) => setCashMovementForm({ ...cashMovementForm, amount: event.target.value })} />
            <TextInput label="Fecha" type="date" required value={cashMovementForm.movement_date} onChange={(event) => setCashMovementForm({ ...cashMovementForm, movement_date: event.target.value })} />
            <SelectInput label="Responsable" required value={cashMovementForm.responsible} onChange={(event) => setCashMovementForm({ ...cashMovementForm, responsible: event.target.value })}>
              {staffUsers.map((user) => (
                <option key={user.id} value={user.id}>{user.first_name || user.username} {user.last_name} - {roleLabels[user.role]}</option>
              ))}
            </SelectInput>
            <TextInput label="Motivo" required value={cashMovementForm.reason} onChange={(event) => setCashMovementForm({ ...cashMovementForm, reason: event.target.value })} />
            <TextInput className="md:col-span-2" label="Notas" value={cashMovementForm.notes} onChange={(event) => setCashMovementForm({ ...cashMovementForm, notes: event.target.value })} />
          </div>
          <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Retiro a resguardo no es gasto: solo cambia de caja fisica de sede a resguardo general.
          </p>
          <button className="mt-3 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">Registrar movimiento</button>
        </form>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Efectivo fisico por sede" count={cashBySite.length} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Sede</th>
                  <th className="px-4 py-3">Ingresos efectivo</th>
                  <th className="px-4 py-3">Retiros/salidas</th>
                  <th className="px-4 py-3">Caja fisica estimada</th>
                </tr>
              </thead>
              <tbody>
                {cashBySite.map((row) => (
                  <tr key={row.siteId} className="border-b border-zinc-100">
                    <td className="px-4 py-3 font-medium">{row.siteName}</td>
                    <td className="px-4 py-3">${money(row.cashPayments + row.cashIn)}</td>
                    <td className="px-4 py-3">${money(row.cashOut + row.vaultTransfer)}</td>
                    <td className="px-4 py-3 font-semibold">${money(row.cashInBox)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Movimientos de caja" count={data.cashMovements.length} />
          <div className="divide-y divide-zinc-100">
            {data.cashMovements.slice(0, 10).map((movement) => (
              <div key={movement.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{movement.site_name} - {cashMovementLabel(movement.movement_type)} - ${money(movement.amount)}</p>
                  {movement.movement_type === "vault_transfer" && <StatusPill label="No afecta utilidad" />}
                </div>
                <p className="mt-1 text-sm text-zinc-500">{movement.movement_date} - {movement.reason}</p>
                <p className="mt-1 text-xs text-zinc-400">Responsable: {movement.responsible_name || movement.responsible_username} - Capturo: {movement.created_by_username || "N/D"}</p>
              </div>
            ))}
            {data.cashMovements.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin movimientos de caja.</p>}
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Gastos pendientes" count={pendingExpenses.length} />
          <div className="divide-y divide-zinc-100">
            {pendingExpenses.map((expense) => (
              <div key={expense.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
                <div>
                  <p className="font-medium">
                    {expense.site_name} - {expense.category} - ${money(expense.amount)}
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {expense.expense_date} - {expense.provider_name || "Sin proveedor"} - {expense.description}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">Capturo: {expense.captured_by_username || "N/D"}</p>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white" onClick={() => onApproveExpense(expense.id)}>
                    Aprobar
                  </button>
                  <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium" onClick={() => onRejectExpense(expense.id)}>
                    Rechazar
                  </button>
                </div>
              </div>
            ))}
            {pendingExpenses.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin gastos pendientes.</p>}
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Gastos registrados" count={data.expenses.length} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Sede</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Monto</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Factura</th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map((expense) => (
                  <tr key={expense.id} className="border-b border-zinc-100">
                    <td className="px-4 py-3">{expense.expense_date}</td>
                    <td className="px-4 py-3 font-medium">{expense.site_name}</td>
                    <td className="px-4 py-3">{expense.category}</td>
                    <td className="px-4 py-3">${money(expense.amount)}</td>
                    <td className="px-4 py-3"><StatusPill label={expenseStatusLabel(expense.status)} /></td>
                    <td className="px-4 py-3">
                      <button
                        className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                        onClick={() => onCreateInvoice({ source_type: "expense", source_id: expense.id })}
                      >
                        Simular PAC
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
