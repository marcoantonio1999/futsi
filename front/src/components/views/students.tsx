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

export function StudentsPanel({
  data,
  onCreate,
  onUpdate,
}: {
  data: AppData;
  onCreate: (payload: unknown) => void;
  onUpdate: (studentId: number, payload: unknown) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const editingStudent = data.students.find((student) => student.id === editingId) ?? null;
  const [editForm, setEditForm] = useState({
    photo_url: "",
    waiver_url: "",
    medical_notes: "",
    emergency_contact: "",
    emergency_phone: "",
    uniform_status: "pending",
    pause_start: "",
    pause_end: "",
    pause_reason: "",
  });
  const [filters, setFilters] = useState({
    query: "",
    site: "",
    group: "",
    status: "",
    uniform: "",
    waiver: "",
    payment: "",
    medical: "",
  });
  const [form, setForm] = useState({
    full_name: "",
    site: "",
    guardian: "",
    birth_date: "",
    category: "Sub-10",
    group_name: "",
    status: "trial",
    photo_url: "",
    waiver_url: "",
    medical_notes: "",
    emergency_contact: "",
    emergency_phone: "",
    uniform_status: "pending",
    pause_start: "",
    pause_end: "",
    pause_reason: "",
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      ...form,
      site: Number(form.site),
      guardian: Number(form.guardian),
      birth_date: form.birth_date || null,
      pause_start: form.pause_start || null,
      pause_end: form.pause_end || null,
    });
    setForm({ ...form, full_name: "", group_name: "", birth_date: "" });
  }

  function startEdit(student: Student) {
    setEditingId(student.id);
    setEditForm({
      photo_url: student.photo_url || "",
      waiver_url: student.waiver_url || "",
      medical_notes: student.medical_notes || "",
      emergency_contact: student.emergency_contact || "",
      emergency_phone: student.emergency_phone || "",
      uniform_status: student.uniform_status || "pending",
      pause_start: student.pause_start || "",
      pause_end: student.pause_end || "",
      pause_reason: student.pause_reason || "",
    });
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    onUpdate(editingId, {
      ...editForm,
      pause_start: editForm.pause_start || null,
      pause_end: editForm.pause_end || null,
    });
    setEditingId(null);
  }

  const groups = useMemo(() => {
    return Array.from(new Set(data.students.map((student) => student.group_name).filter(Boolean))).sort();
  }, [data.students]);

  const filteredStudents = useMemo(() => {
    return data.students.filter((student) => {
      const text = `${student.full_name} ${student.guardian_name ?? ""} ${student.group_name} ${student.category}`.toLowerCase();
      const queryMatches = !filters.query || text.includes(filters.query.toLowerCase());
      const siteMatches = !filters.site || student.site === Number(filters.site);
      const groupMatches = !filters.group || student.group_name === filters.group;
      const statusMatches = !filters.status || student.status === filters.status;
      const uniformMatches = !filters.uniform || student.uniform_status === filters.uniform;
      const waiverMatches = !filters.waiver || (filters.waiver === "yes" ? Boolean(student.waiver_url) : !student.waiver_url);
      const paymentMatches =
        !filters.payment ||
        (filters.payment === "pending" ? student.open_charge_count > 0 : student.open_charge_count === 0);
      const medicalMatches =
        !filters.medical ||
        (filters.medical === "yes" ? Boolean(student.medical_notes) : !student.medical_notes);
      return queryMatches && siteMatches && groupMatches && statusMatches && uniformMatches && waiverMatches && paymentMatches && medicalMatches;
    });
  }, [data.students, filters]);

  const filterSummary = {
    pendingPayment: filteredStudents.filter((student) => student.open_charge_count > 0).length,
    missingWaiver: filteredStudents.filter((student) => !student.waiver_url).length,
    medical: filteredStudents.filter((student) => student.medical_notes).length,
  };

  function clearFilters() {
    setFilters({ query: "", site: "", group: "", status: "", uniform: "", waiver: "", payment: "", medical: "" });
  }

  return (
    <>
      <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plus size={16} /> Nuevo alumno
        </h2>
        <div className="mt-4 grid gap-3">
          <TextInput label="Nombre completo" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <SelectInput label="Sede" required value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })}>
            <option value="">Seleccionar</option>
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            label="Representante"
            required
            value={form.guardian}
            onChange={(e) => setForm({ ...form, guardian: e.target.value })}
          >
            <option value="">Seleccionar</option>
            {data.guardians.map((guardian) => (
              <option key={guardian.id} value={guardian.id}>
                {guardian.full_name}
              </option>
            ))}
          </SelectInput>
          <TextInput label="Fecha nacimiento" type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Categoria" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            <TextInput label="Grupo" value={form.group_name} onChange={(e) => setForm({ ...form, group_name: e.target.value })} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Foto URL" value={form.photo_url} onChange={(e) => setForm({ ...form, photo_url: e.target.value })} />
            <TextInput label="Responsiva URL" value={form.waiver_url} onChange={(e) => setForm({ ...form, waiver_url: e.target.value })} />
          </div>
          <SelectInput label="Estado" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
          <SelectInput label="Uniforme" value={form.uniform_status} onChange={(e) => setForm({ ...form, uniform_status: e.target.value })}>
            <option value="pending">Pendiente</option>
            <option value="paid">Pagado</option>
            <option value="delivered">Entregado</option>
          </SelectInput>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Inicio pausa" type="date" value={form.pause_start} onChange={(e) => setForm({ ...form, pause_start: e.target.value })} />
            <TextInput label="Fin pausa" type="date" value={form.pause_end} onChange={(e) => setForm({ ...form, pause_end: e.target.value })} />
          </div>
          <TextInput label="Motivo pausa" value={form.pause_reason} onChange={(e) => setForm({ ...form, pause_reason: e.target.value })} />
          <TextInput label="Contacto emergencia" value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} />
          <TextInput label="Telefono emergencia" value={form.emergency_phone} onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })} />
          <TextInput label="Informacion medica" value={form.medical_notes} onChange={(e) => setForm({ ...form, medical_notes: e.target.value })} />
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            <Plus size={16} /> Guardar alumno
          </button>
        </div>
      </form>
      <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Alumnos registrados</h2>
            <p className="mt-1 text-sm text-zinc-500">{filteredStudents.length} de {data.students.length} alumnos visibles</p>
          </div>
          <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium" onClick={clearFilters}>
            Limpiar filtros
          </button>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          <TextInput label="Buscar" placeholder="Alumno, tutor, grupo" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} />
          <SelectInput label="Sede" value={filters.site} onChange={(e) => setFilters({ ...filters, site: e.target.value })}>
            <option value="">Todas</option>
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </SelectInput>
          <SelectInput label="Grupo" value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })}>
            <option value="">Todos</option>
            {groups.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
          </SelectInput>
          <SelectInput label="Estado" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Todos</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SelectInput>
          <SelectInput label="Uniforme" value={filters.uniform} onChange={(e) => setFilters({ ...filters, uniform: e.target.value })}>
            <option value="">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="paid">Pagado</option>
            <option value="delivered">Entregado</option>
          </SelectInput>
          <SelectInput label="Responsiva" value={filters.waiver} onChange={(e) => setFilters({ ...filters, waiver: e.target.value })}>
            <option value="">Todas</option>
            <option value="yes">Registrada</option>
            <option value="no">Pendiente</option>
          </SelectInput>
          <SelectInput label="Cobranza" value={filters.payment} onChange={(e) => setFilters({ ...filters, payment: e.target.value })}>
            <option value="">Todos</option>
            <option value="pending">Con pago pendiente</option>
            <option value="clear">Sin pago pendiente</option>
          </SelectInput>
          <SelectInput label="Info medica" value={filters.medical} onChange={(e) => setFilters({ ...filters, medical: e.target.value })}>
            <option value="">Todos</option>
            <option value="yes">Con nota medica</option>
            <option value="no">Sin nota medica</option>
          </SelectInput>
        </div>
        <div className="grid gap-3 border-t border-zinc-100 px-4 py-3 sm:grid-cols-4">
          <Metric label="Filtrados" value={filteredStudents.length} />
          <Metric label="Pago pendiente" value={filterSummary.pendingPayment} />
          <Metric label="Responsiva pendiente" value={filterSummary.missingWaiver} />
          <Metric label="Con nota medica" value={filterSummary.medical} />
        </div>
        <div className="grid gap-3 border-t border-zinc-200 p-4 xl:grid-cols-2">
          {filteredStudents.map((student) => (
            <div key={student.id} className="rounded-md border border-zinc-200 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 gap-3">
                  <Avatar name={student.full_name} imageUrl={student.photo_url} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{student.full_name}</p>
                      <StatusPill label={statusLabels[student.status]} />
                      {student.open_charge_count > 0 && <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">Pago pendiente ${money(student.balance_due)}</span>}
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {student.site_name} - {student.group_name || student.category}
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {student.guardian_name} - {student.guardian_phone || "Sin telefono"}
                    </p>
                  </div>
                </div>

                <button className="self-start rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium" onClick={() => startEdit(student)}>
                  Editar control
                </button>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <InfoChip label="Uniforme" value={student.uniform_status === "delivered" ? "Entregado" : student.uniform_status === "paid" ? "Pagado" : "Pendiente"} tone={student.uniform_status === "delivered" ? "ok" : "warn"} />
                <InfoChip label="Responsiva" value={student.waiver_url ? "Registrada" : "Pendiente"} tone={student.waiver_url ? "ok" : "warn"} />
                <InfoChip label="Info medica" value={student.medical_notes ? "Con nota" : "Sin nota"} tone={student.medical_notes ? "danger" : "neutral"} />
                <InfoChip label="Descuentos" value={student.active_discounts.length ? `${student.active_discounts.length} activos` : "Sin descuentos"} tone={student.active_discounts.length ? "ok" : "neutral"} />
              </div>

              {(student.medical_notes || student.pause_start || student.pause_reason) && (
                <div className="mt-3 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  {student.medical_notes && <p className="text-red-700">Medico: {student.medical_notes}</p>}
                  {student.pause_start && <p className="text-amber-700">Pausa: {student.pause_start} - {student.pause_end || "abierta"}</p>}
                  {student.pause_reason && <p>Motivo: {student.pause_reason}</p>}
                </div>
              )}
            </div>
          ))}
          {filteredStudents.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay alumnos con estos filtros.</p>}
        </div>
      </section>
      {editingStudent && (
        <form onSubmit={submitEdit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold">Editar control de {editingStudent.full_name}</h2>
          <div className="mt-4 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Foto URL" value={editForm.photo_url} onChange={(e) => setEditForm({ ...editForm, photo_url: e.target.value })} />
              <TextInput label="Responsiva URL" value={editForm.waiver_url} onChange={(e) => setEditForm({ ...editForm, waiver_url: e.target.value })} />
            </div>
            <SelectInput label="Uniforme" value={editForm.uniform_status} onChange={(e) => setEditForm({ ...editForm, uniform_status: e.target.value })}>
              <option value="pending">Pendiente</option>
              <option value="paid">Pagado</option>
              <option value="delivered">Entregado</option>
            </SelectInput>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Inicio pausa" type="date" value={editForm.pause_start} onChange={(e) => setEditForm({ ...editForm, pause_start: e.target.value })} />
              <TextInput label="Fin pausa" type="date" value={editForm.pause_end} onChange={(e) => setEditForm({ ...editForm, pause_end: e.target.value })} />
            </div>
            <TextInput label="Motivo pausa" value={editForm.pause_reason} onChange={(e) => setEditForm({ ...editForm, pause_reason: e.target.value })} />
            <TextInput label="Contacto emergencia" value={editForm.emergency_contact} onChange={(e) => setEditForm({ ...editForm, emergency_contact: e.target.value })} />
            <TextInput label="Telefono emergencia" value={editForm.emergency_phone} onChange={(e) => setEditForm({ ...editForm, emergency_phone: e.target.value })} />
            <TextInput label="Informacion medica" value={editForm.medical_notes} onChange={(e) => setEditForm({ ...editForm, medical_notes: e.target.value })} />
            <div className="flex gap-2">
              <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">Guardar cambios</button>
              <button type="button" className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium" onClick={() => setEditingId(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </form>
      )}
    </>
  );
}
