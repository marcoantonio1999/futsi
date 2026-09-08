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
import type { AccountingSiteRow, AppData, AttendanceRecord, AttendanceSession, CashMovementType, Charge, ChargeStatus, Discount, Expense, ExpenseStatus, FaceRecognitionResponse, Guardian, HistoricalDiscrepancyReport, HistoricalImport, Invoice, Match, Payment, PaymentMethod, PaymentStatus, Player, PlayerAttendanceRecord, Role, Site, StaffPaymentKind, StaffPaymentRequest, StaffPaymentStatus, StandingRow, Student, StudentAssessment, TabKey, Team, ThemeMode, User } from "../../types";

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
export { SitesPanel } from "./catalogSites";
import { UserPermissionRow, sectionPermissionOptions, toggleSection } from "./catalogUserPermissions";

export { GuardiansPanel } from "./guardians";

export function UsersPanel({ data, onCreate, onUpdate }: { data: AppData; onCreate: (payload: unknown) => void; onUpdate: (userId: number, payload: unknown) => void }) {
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
    section_permissions: [] as string[],
    password: "demo12345",
    is_active: true,
  });
  const [filters, setFilters] = useState({ query: "", role: "", site: "", status: "" });
  const [page, setPage] = useState(0);
  const usersPerPage = 8;

  const filteredUsers = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return data.users.filter((user) => {
      const text = `${user.username} ${user.email} ${user.first_name} ${user.last_name} ${user.primary_site_name ?? ""} ${user.coach_group_name ?? ""}`.toLowerCase();
      const matchesQuery = !query || text.includes(query);
      const matchesRole = !filters.role || user.role === filters.role;
      const matchesSite = !filters.site || (filters.site === "none" ? !user.primary_site : String(user.primary_site ?? "") === filters.site);
      const matchesStatus = !filters.status || (filters.status === "active" ? user.is_active : !user.is_active);
      return matchesQuery && matchesRole && matchesSite && matchesStatus;
    });
  }, [data.users, filters]);
  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / usersPerPage));
  const visibleUsers = filteredUsers.slice(page * usersPerPage, (page + 1) * usersPerPage);

  useEffect(() => {
    setPage(0);
  }, [filters]);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  function clearFilters() {
    setFilters({ query: "", role: "", site: "", status: "" });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({
      ...form,
      primary_site: form.primary_site ? Number(form.primary_site) : null,
    });
    setForm({ ...form, username: "", email: "", first_name: "", last_name: "", phone: "", coach_group_name: "", coach_hourly_rate: "0", section_permissions: [], password: "demo12345" });
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
          <details className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <summary className="cursor-pointer text-sm font-semibold">Permisos extra de visualizacion</summary>
            <p className="mt-2 text-xs text-zinc-500">Los defaults del rol se mantienen. Marca secciones adicionales para abrirlas en el menu del usuario.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {sectionPermissionOptions.map((option) => (
                <label key={option.key} className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.section_permissions.includes(option.key)}
                    onChange={() => setForm({ ...form, section_permissions: toggleSection(form.section_permissions, option.key) })}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </details>
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            <Plus size={16} /> Guardar usuario
          </button>
        </div>
      </form>
      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Usuarios</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {filteredUsers.length} de {data.users.length} usuarios filtrados · mostrando {visibleUsers.length} por pagina
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={page === 0}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
              type="button"
              aria-label="Usuarios anteriores"
            >
              ‹
            </button>
            <span className="min-w-16 text-center text-sm font-semibold text-zinc-700">
              {page + 1}/{pageCount}
            </span>
            <button
              className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              type="button"
              aria-label="Mas usuarios"
            >
              ›
            </button>
            <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium" onClick={clearFilters} type="button">
              Limpiar filtros
            </button>
          </div>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          <TextInput
            label="Buscar"
            placeholder="Usuario, correo, nombre, sede o grupo"
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          />
          <SelectInput label="Rol" value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}>
            <option value="">Todos</option>
            {Object.entries(roleLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SelectInput>
          <SelectInput label="Sede" value={filters.site} onChange={(event) => setFilters({ ...filters, site: event.target.value })}>
            <option value="">Todas</option>
            <option value="none">Sin sede</option>
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </SelectInput>
          <SelectInput label="Estatus" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">Todos</option>
            <option value="active">Activos</option>
            <option value="inactive">Inactivos</option>
          </SelectInput>
        </div>
        <div className="divide-y divide-zinc-100">
          {visibleUsers.map((user) => (
            <UserPermissionRow key={user.id} user={user} onUpdate={onUpdate} />
          ))}
          {filteredUsers.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay usuarios con estos filtros.</p>}
        </div>
      </div>
    </>
  );
}
