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

export function GuardiansPanel({ guardians, onCreate }: { guardians: Guardian[]; onCreate: (payload: unknown) => void }) {
  const [form, setForm] = useState({ full_name: "", phone: "", email: "", tax_name: "", tax_id: "", notes: "" });

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate(form);
    setForm({ full_name: "", phone: "", email: "", tax_name: "", tax_id: "", notes: "" });
  }

  return (
    <>
      <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plus size={16} /> Nuevo representante
        </h2>
        <div className="mt-4 grid gap-3">
          <TextInput label="Nombre completo" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <TextInput label="Telefono" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <TextInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            <Plus size={16} /> Guardar representante
          </button>
        </div>
      </form>
      <SimpleList
        title="Representantes"
        count={guardians.length}
        rows={guardians.map((guardian) => ({
          id: guardian.id,
          title: guardian.full_name,
          subtitle: `${guardian.phone}${guardian.email ? ` - ${guardian.email}` : ""}`,
        }))}
      />
    </>
  );
}

export function SitesPanel({ sites, onCreate }: { sites: Site[]; onCreate: (payload: unknown) => void }) {
  const [form, setForm] = useState({ name: "", code: "", address: "", latitude: "", longitude: "", is_active: true, close_editing_after_hours: 24 });

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      ...form,
      latitude: form.latitude || null,
      longitude: form.longitude || null,
    });
    setForm({ name: "", code: "", address: "", latitude: "", longitude: "", is_active: true, close_editing_after_hours: 24 });
  }

  return (
    <>
      <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plus size={16} /> Nueva sede
        </h2>
        <div className="mt-4 grid gap-3">
          <TextInput label="Nombre" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextInput label="Codigo" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <TextInput label="Direccion" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Latitud" type="number" step="0.000001" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} />
            <TextInput label="Longitud" type="number" step="0.000001" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} />
          </div>
          <TextInput
            label="Horas para editar"
            type="number"
            min={1}
            value={form.close_editing_after_hours}
            onChange={(e) => setForm({ ...form, close_editing_after_hours: Number(e.target.value) })}
          />
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            <Plus size={16} /> Guardar sede
          </button>
        </div>
      </form>
      <SimpleList
        title="Sedes"
        count={sites.length}
        rows={sites.map((site) => ({
          id: site.id,
          title: site.name,
          subtitle: `${site.address || "Sin direccion"} - ${site.latitude ?? "sin lat"}, ${site.longitude ?? "sin lng"} - ${site.student_count ?? 0} alumnos`,
        }))}
      />
    </>
  );
}

export function UsersPanel({ data, onCreate }: { data: AppData; onCreate: (payload: unknown) => void }) {
  const [form, setForm] = useState({
    username: "",
    email: "",
    first_name: "",
    last_name: "",
    role: "site_coordinator",
    primary_site: "",
    phone: "",
    coach_group_name: "",
    coach_hourly_rate: "0",
    password: "demo12345",
    is_active: true,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      ...form,
      primary_site: form.primary_site ? Number(form.primary_site) : null,
    });
    setForm({ ...form, username: "", email: "", first_name: "", last_name: "", phone: "", coach_group_name: "", coach_hourly_rate: "0", password: "demo12345" });
  }

  return (
    <>
      <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Plus size={16} /> Nuevo usuario
        </h2>
        <div className="mt-4 grid gap-3">
          <TextInput label="Usuario" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <TextInput label="Password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <TextInput label="Nombre" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <TextInput label="Apellido" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <TextInput label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <SelectInput label="Rol" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </SelectInput>
          <SelectInput label="Sede principal" value={form.primary_site} onChange={(e) => setForm({ ...form, primary_site: e.target.value })}>
            <option value="">Sin sede</option>
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </SelectInput>
          {form.role === "coach" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Grupo asignado" value={form.coach_group_name} onChange={(e) => setForm({ ...form, coach_group_name: e.target.value })} />
              <TextInput label="Tarifa por hora" type="number" min="0" step="0.01" value={form.coach_hourly_rate} onChange={(e) => setForm({ ...form, coach_hourly_rate: e.target.value })} />
            </div>
          )}
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            <Plus size={16} /> Guardar usuario
          </button>
        </div>
      </form>
      <SimpleList
        title="Usuarios"
        count={data.users.length}
        rows={data.users.map((user) => ({
          id: user.id,
          title: user.username,
          subtitle: `${roleLabels[user.role]}${user.primary_site_name ? ` - ${user.primary_site_name}` : ""}${user.role === "coach" && user.coach_group_name ? ` - ${user.coach_group_name}` : ""}`,
        }))}
      />
    </>
  );
}
