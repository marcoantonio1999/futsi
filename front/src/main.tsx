import React, { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  Check,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  Lock,
  LogOut,
  Plus,
  RefreshCw,
  Shield,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import "./styles.css";

const API_URL = (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000/api").replace(/\/$/, "");

type Role = "admin" | "accounting" | "owner" | "site_coordinator" | "cashier" | "coach" | "guardian";
type StudentStatus = "trial" | "active" | "paused" | "injured" | "dropped";

type User = {
  id: number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  primary_site: number | null;
  primary_site_name?: string;
  guardian_id?: number;
  guardian_name?: string;
  guardian_virtual_clabe?: string;
  phone: string;
  avatar_url: string;
  coach_group_name: string;
  coach_hourly_rate: string;
  is_active: boolean;
};

type Site = {
  id: number;
  name: string;
  code: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  is_active: boolean;
  close_editing_after_hours: number;
  student_count?: number;
};

type Guardian = {
  id: number;
  full_name: string;
  phone: string;
  email: string;
  tax_name: string;
  tax_id: string;
  virtual_clabe: string;
  notes: string;
};

type Student = {
  id: number;
  site: number;
  site_name?: string;
  guardian: number;
  guardian_name?: string;
  guardian_phone?: string;
  full_name: string;
  birth_date: string | null;
  category: string;
  group_name: string;
  status: StudentStatus;
  photo_url: string;
  waiver_url: string;
  medical_notes: string;
  emergency_contact: string;
  emergency_phone: string;
  uniform_status: string;
  pause_start: string | null;
  pause_end: string | null;
  pause_reason: string;
  open_charge_count: number;
  balance_due: string;
  active_discounts: Array<{ id: number; reason: string; amount: string; charge: number | null }>;
};

type AttendanceSession = {
  id: number;
  site: number;
  site_name?: string;
  session_type: "academy_class" | "tournament_match";
  date: string;
  starts_at: string | null;
  group_name: string;
  captured_by: number;
  captured_by_username?: string;
  closed_at: string | null;
  record_count?: number;
};

type AttendanceRecord = {
  id: number;
  session: number;
  student: number | null;
  student_name?: string;
  team: number | null;
  status: "present" | "absent" | "justified";
  had_debt_at_capture: boolean;
  override_reason: string;
};

type ChargeStatus = "pending" | "partial" | "paid" | "canceled";
type PaymentMethod = "cash" | "transfer" | "card" | "courtesy";
type PaymentStatus = "processing" | "awaiting_confirmation" | "registered" | "reconciled" | "canceled" | "expired";
type DiscountStatus = "requested" | "approved" | "rejected" | "canceled";

type Charge = {
  id: number;
  site: number;
  site_name?: string;
  student: number | null;
  student_name?: string;
  concept: string;
  description: string;
  amount: string;
  due_date: string | null;
  status: ChargeStatus;
  paid_amount: string;
  discount_amount: string;
  balance: string;
};

type Payment = {
  id: number;
  site?: number;
  site_name?: string;
  charge: number | null;
  student: number | null;
  student_name?: string;
  team_name?: string;
  charge_concept?: string;
  method: PaymentMethod;
  channel: string;
  status: PaymentStatus;
  amount: string;
  paid_at: string;
  confirmed_at: string | null;
  expires_at: string | null;
  reference: string;
  tracking_key: string;
  payment_url: string;
  notes: string;
  received_by_username?: string;
};

type Discount = {
  id: number;
  charge: number | null;
  student: number | null;
  student_name?: string;
  charge_concept?: string;
  reason: string;
  amount: string;
  status: DiscountStatus;
  requested_by_username?: string;
  approved_by_username?: string;
};

type ExpenseStatus = "pending" | "approved" | "rejected" | "canceled";

type Expense = {
  id: number;
  site: number;
  site_name?: string;
  category: string;
  description: string;
  amount: string;
  expense_date: string;
  provider_name: string;
  evidence_file: string;
  status: ExpenseStatus;
  captured_by_username?: string;
  approved_by_username?: string;
};

type CoachWorkLog = {
  id: number;
  coach: number;
  coach_username?: string;
  coach_name?: string;
  site: number;
  site_name?: string;
  group_name: string;
  work_date: string;
  hours: string;
  activity: string;
  notes: string;
  hourly_rate_snapshot: string;
  total_amount: string;
};

type AppData = {
  users: User[];
  sites: Site[];
  guardians: Guardian[];
  students: Student[];
  attendanceSessions: AttendanceSession[];
  attendanceRecords: AttendanceRecord[];
  charges: Charge[];
  payments: Payment[];
  discounts: Discount[];
  expenses: Expense[];
  coachWorkLogs: CoachWorkLog[];
};

type TabKey = "dashboard" | "attendance" | "billing" | "expenses" | "students" | "guardians" | "sites" | "users";

const roleLabels: Record<Role, string> = {
  admin: "Administrador",
  accounting: "Contador",
  owner: "Direccion",
  site_coordinator: "Coordinador",
  cashier: "Cajero",
  coach: "Coach",
  guardian: "Representante",
};

const statusLabels: Record<StudentStatus, string> = {
  active: "Activo",
  trial: "Prueba",
  paused: "Pausa",
  injured: "Lesion",
  dropped: "Baja",
};

const emptyData: AppData = {
  users: [],
  sites: [],
  guardians: [],
  students: [],
  attendanceSessions: [],
  attendanceRecords: [],
  charges: [],
  payments: [],
  discounts: [],
  expenses: [],
  coachWorkLogs: [],
};

function authHeaders(token: string) {
  return {
    Authorization: `Token ${token}`,
    "Content-Type": "application/json",
  };
}

async function apiRequest<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...authHeaders(token),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.detail ?? "No se pudo completar la accion.");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

function LoginScreen({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin12345");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/auth/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail ?? "No se pudo iniciar sesion.");
      onLogin(body.token, body.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-stone-50 px-5 text-zinc-950">
      <form onSubmit={submit} className="w-full max-w-sm rounded-md border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-emerald-700 text-white">
            <Shield size={20} />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-700">Futsi Mini ERP</p>
            <h1 className="text-xl font-semibold">Acceso operativo</h1>
          </div>
        </div>

        <label className="mt-6 block text-sm font-medium" htmlFor="username">
          Usuario
        </label>
        <input
          id="username"
          className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-emerald-700"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />

        <label className="mt-4 block text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="mt-2 w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-emerald-700"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
          disabled={loading}
        >
          <Shield size={16} />
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-medium uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function money(value: string | number) {
  return Number(value || 0).toLocaleString("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, className = "", ...inputProps } = props;
  return (
    <label className={`block text-sm ${className}`}>
      <span className="font-medium text-zinc-700">{label}</span>
      <input
        {...inputProps}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
      />
    </label>
  );
}

function SelectInput(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const { label, children, className = "", ...selectProps } = props;
  return (
    <label className={`block text-sm ${className}`}>
      <span className="font-medium text-zinc-700">{label}</span>
      <select
        {...selectProps}
        className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-emerald-700"
      >
        {children}
      </select>
    </label>
  );
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem("futsi_token") ?? "");
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "owner";

  async function loadData(authToken = token) {
    if (!authToken) return;
    setLoading(true);
    setError("");
    try {
      const me = await apiRequest<User>("/auth/me/", authToken);
      if (me.role === "guardian") {
        const [students, attendanceRecords, charges, payments, discounts] = await Promise.all([
          apiRequest<Student[]>("/students/", authToken),
          apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
          apiRequest<Charge[]>("/charges/", authToken),
          apiRequest<Payment[]>("/payments/", authToken),
          apiRequest<Discount[]>("/discounts/", authToken),
        ]);
        setCurrentUser(me);
        setData({
          ...emptyData,
          students,
          attendanceRecords,
          charges,
          payments,
          discounts,
        });
        return;
      }
      if (me.role === "cashier") {
        const [sites, students, charges, payments] = await Promise.all([
          apiRequest<Site[]>("/sites/", authToken),
          apiRequest<Student[]>("/students/", authToken),
          apiRequest<Charge[]>("/charges/", authToken),
          apiRequest<Payment[]>("/payments/", authToken),
        ]);
        setCurrentUser(me);
        setData({
          ...emptyData,
          sites,
          students,
          charges,
          payments,
        });
        return;
      }
      if (me.role === "coach") {
        const [sites, students, attendanceSessions, attendanceRecords, coachWorkLogs] = await Promise.all([
          apiRequest<Site[]>("/sites/", authToken),
          apiRequest<Student[]>("/students/", authToken),
          apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
          apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
          apiRequest<CoachWorkLog[]>("/coach-work-logs/", authToken),
        ]);
        setCurrentUser(me);
        setData({
          ...emptyData,
          sites,
          students,
          attendanceSessions,
          attendanceRecords,
          coachWorkLogs,
        });
        return;
      }

      const [sites, guardians, students, attendanceSessions, attendanceRecords, charges, payments, discounts, expenses, users] = await Promise.all([
        apiRequest<Site[]>("/sites/", authToken),
        apiRequest<Guardian[]>("/guardians/", authToken),
        apiRequest<Student[]>("/students/", authToken),
        apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
        apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
        apiRequest<Charge[]>("/charges/", authToken),
        apiRequest<Payment[]>("/payments/", authToken),
        apiRequest<Discount[]>("/discounts/", authToken),
        apiRequest<Expense[]>("/expenses/", authToken),
        me.role === "admin" || me.role === "owner" ? apiRequest<User[]>("/users/", authToken) : Promise.resolve([]),
      ]);
      setCurrentUser(me);
      setData({ sites, guardians, students, attendanceSessions, attendanceRecords, charges, payments, discounts, expenses, users, coachWorkLogs: [] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar informacion.");
      localStorage.removeItem("futsi_token");
      setToken("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) loadData(token);
  }, [token]);

  function handleLogin(nextToken: string, user: User) {
    localStorage.setItem("futsi_token", nextToken);
    setToken(nextToken);
    setCurrentUser(user);
  }

  async function logout() {
    if (token) {
      await apiRequest<void>("/auth/logout/", token, { method: "POST" }).catch(() => undefined);
    }
    localStorage.removeItem("futsi_token");
    setToken("");
    setCurrentUser(null);
    setData(emptyData);
  }

  async function createRecord(path: string, payload: unknown, success: string) {
    setMessage("");
    setError("");
    try {
      await apiRequest(path, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessage(success);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    }
  }

  async function updateRecord(path: string, payload: unknown, success: string) {
    setMessage("");
    setError("");
    try {
      await apiRequest(path, token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setMessage(success);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar.");
    }
  }

  async function createAndReturn<T>(path: string, payload: unknown): Promise<T> {
    setMessage("");
    setError("");
    try {
      const result = await apiRequest<T>(path, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadData();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
      throw err;
    }
  }

  async function closeAttendanceSession(sessionId: number) {
    setMessage("");
    setError("");
    try {
      await apiRequest(`/attendance-sessions/${sessionId}/close/`, token, { method: "POST" });
      setMessage("Asistencia cerrada.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar la asistencia.");
    }
  }

  async function postAction(path: string, success: string) {
    setMessage("");
    setError("");
    try {
      await apiRequest(path, token, { method: "POST" });
      setMessage(success);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar la accion.");
    }
  }

  async function updateProfile(payload: unknown) {
    setMessage("");
    setError("");
    try {
      const updatedUser = await apiRequest<User>("/auth/me/", token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setCurrentUser(updatedUser);
      setMessage("Perfil actualizado.");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el perfil.");
    }
  }

  const studentsByStatus = useMemo(() => {
    return data.students.reduce<Record<string, number>>((acc, student) => {
      acc[student.status] = (acc[student.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [data.students]);

  if (!token || !currentUser) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (currentUser.role === "guardian") {
    return (
      <GuardianPortal
        user={currentUser}
        data={data}
        onRefresh={() => loadData()}
        onLogout={logout}
        onPaymentAction={(paymentId, action) => postAction(`/payments/${paymentId}/${action}/`, "Pago actualizado.")}
        onUpdateProfile={updateProfile}
      />
    );
  }

  if (currentUser.role === "cashier") {
    return (
      <CashierPortal
        user={currentUser}
        data={data}
        onRefresh={() => loadData()}
        onLogout={logout}
        onCreatePayment={(payload) => createRecord("/payments/", payload, "Solicitud de pago creada.")}
        onPaymentAction={(paymentId, action) => postAction(`/payments/${paymentId}/${action}/`, "Pago actualizado.")}
      />
    );
  }

  if (currentUser.role === "coach") {
    return (
      <CoachPortal
        user={currentUser}
        data={data}
        onRefresh={() => loadData()}
        onLogout={logout}
        onCreateSession={(payload) => createAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
        onMark={(payload) => createAndReturn<AttendanceRecord>("/attendance-records/", payload)}
        onClose={closeAttendanceSession}
        onCreateWorkLog={(payload) => createRecord("/coach-work-logs/", payload, "Horas registradas.")}
      />
    );
  }

  if (currentUser.role === "accounting") {
    return (
      <AccountingPortal
        user={currentUser}
        data={data}
        onRefresh={() => loadData()}
        onLogout={logout}
      />
    );
  }

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode; adminOnly?: boolean }> = [
    { key: "dashboard", label: "Dashboard", icon: <BarChart3 size={16} /> },
    { key: "attendance", label: "Asistencia", icon: <ClipboardCheck size={16} /> },
    { key: "billing", label: "Cobranza", icon: <CreditCard size={16} /> },
    { key: "expenses", label: "Gastos", icon: <FileText size={16} /> },
    { key: "students", label: "Alumnos", icon: <UsersRound size={16} /> },
    { key: "guardians", label: "Representantes", icon: <UserRound size={16} /> },
    { key: "sites", label: "Sedes", icon: <Building2 size={16} /> },
    { key: "users", label: "Usuarios", icon: <Shield size={16} />, adminOnly: true },
  ];

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Sprint 1 / Dia 6</p>
            <h1 className="text-xl font-semibold">Operacion base</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right text-sm sm:block">
              <p className="font-medium">{currentUser.username}</p>
              <p className="text-zinc-500">{roleLabels[currentUser.role]}</p>
            </div>
            <button
              className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50"
              onClick={() => loadData()}
              title="Actualizar"
            >
              <RefreshCw size={16} />
            </button>
            <button
              className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50"
              onClick={logout}
              title="Salir"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Sedes activas" value={data.sites.filter((site) => site.is_active).length} />
          <Metric label="Alumnos" value={data.students.length} />
          <Metric label="Gastos pendientes" value={`$${money(data.expenses.filter((expense) => expense.status === "pending").reduce((sum, expense) => sum + Number(expense.amount || 0), 0))}`} />
          <Metric label="Cobros pendientes" value={`$${money(data.charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0))}`} />
        </section>

        <nav className="mt-6 flex flex-wrap gap-2">
          {tabs
            .filter((tab) => !tab.adminOnly || isAdmin)
            .map((tab) => (
              <button
                key={tab.key}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                  activeTab === tab.key
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
        </nav>

        {message && <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="mt-4 text-sm text-zinc-500">Cargando informacion...</p>}

        <section className={`mt-6 grid gap-5 ${activeTab === "students" ? "grid-cols-1" : "lg:grid-cols-[360px_1fr]"}`}>
          {activeTab === "dashboard" && <DashboardPanel data={data} />}
          {activeTab === "attendance" && (
            <AttendancePanel
              data={data}
              onCreateSession={(payload) => createAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
              onMark={(payload) => createAndReturn<AttendanceRecord>("/attendance-records/", payload)}
              onClose={closeAttendanceSession}
            />
          )}
          {activeTab === "billing" && (
            <BillingPanel
              data={data}
              onCreateCharge={(payload) => createRecord("/charges/", payload, "Cargo creado.")}
              onCreatePayment={(payload) => createRecord("/payments/", payload, "Pago registrado.")}
              onCreateDiscount={(payload) => createRecord("/discounts/", payload, "Descuento solicitado.")}
              onApproveDiscount={(discountId) => postAction(`/discounts/${discountId}/approve/`, "Descuento aprobado.")}
              onRejectDiscount={(discountId) => postAction(`/discounts/${discountId}/reject/`, "Descuento rechazado.")}
            />
          )}
          {activeTab === "expenses" && (
            <ExpensesPanel
              data={data}
              onCreateExpense={(payload) => createRecord("/expenses/", payload, "Gasto capturado.")}
              onApproveExpense={(expenseId) => postAction(`/expenses/${expenseId}/approve/`, "Gasto aprobado.")}
              onRejectExpense={(expenseId) => postAction(`/expenses/${expenseId}/reject/`, "Gasto rechazado.")}
            />
          )}
          {activeTab === "students" && (
            <StudentsPanel
              data={data}
              onCreate={(payload) => createRecord("/students/", payload, "Alumno creado.")}
              onUpdate={(studentId, payload) => updateRecord(`/students/${studentId}/`, payload, "Alumno actualizado.")}
            />
          )}
          {activeTab === "guardians" && (
            <GuardiansPanel
              guardians={data.guardians}
              onCreate={(payload) => createRecord("/guardians/", payload, "Representante creado.")}
            />
          )}
          {activeTab === "sites" && (
            <SitesPanel sites={data.sites} onCreate={(payload) => createRecord("/sites/", payload, "Sede creada.")} />
          )}
          {activeTab === "users" && isAdmin && (
            <UsersPanel data={data} onCreate={(payload) => createRecord("/users/", payload, "Usuario creado.")} />
          )}
        </section>
      </div>
    </main>
  );
}

function CoachPortal({
  user,
  data,
  onRefresh,
  onLogout,
  onCreateSession,
  onMark,
  onClose,
  onCreateWorkLog,
}: {
  user: User;
  data: AppData;
  onRefresh: () => void;
  onLogout: () => void;
  onCreateSession: (payload: unknown) => Promise<AttendanceSession>;
  onMark: (payload: unknown) => Promise<AttendanceRecord>;
  onClose: (sessionId: number) => Promise<void>;
  onCreateWorkLog: (payload: unknown) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const groupName = user.coach_group_name || data.students[0]?.group_name || "";
  const site = data.sites.find((item) => item.id === user.primary_site) ?? data.sites[0];
  const [date, setDate] = useState(today);
  const [startsAt, setStartsAt] = useState("17:00");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(data.attendanceSessions[0]?.id ?? null);
  const [savingStudentId, setSavingStudentId] = useState<number | null>(null);
  const [workForm, setWorkForm] = useState({ work_date: today, hours: "2", activity: "Entrenamiento", notes: "" });

  const activeSession = data.attendanceSessions.find((session) => session.id === activeSessionId) ?? null;
  const recordsByStudent = useMemo(() => {
    const map = new Map<number, AttendanceRecord>();
    data.attendanceRecords
      .filter((record) => record.session === activeSessionId && record.student)
      .forEach((record) => map.set(record.student as number, record));
    return map;
  }, [activeSessionId, data.attendanceRecords]);
  const presentCount = Array.from(recordsByStudent.values()).filter((record) => record.status === "present").length;
  const absentCount = Array.from(recordsByStudent.values()).filter((record) => record.status === "absent").length;
  const medicalAlerts = data.students.filter((student) => student.medical_notes);
  const debtAlerts = data.students.filter((student) => student.open_charge_count > 0);
  const totalHours = data.coachWorkLogs.reduce((sum, log) => sum + Number(log.hours || 0), 0);
  const estimatedPay = data.coachWorkLogs.reduce((sum, log) => sum + Number(log.total_amount || 0), 0);

  useEffect(() => {
    setActiveSessionId(data.attendanceSessions[0]?.id ?? null);
  }, [data.attendanceSessions]);

  async function startSession(event: FormEvent) {
    event.preventDefault();
    if (!site) return;
    const session = await onCreateSession({
      site: site.id,
      session_type: "academy_class",
      date,
      starts_at: startsAt || null,
      group_name: groupName,
    });
    setActiveSessionId(session.id);
  }

  async function mark(student: Student, status: AttendanceRecord["status"]) {
    if (!activeSession || activeSession.closed_at) return;
    setSavingStudentId(student.id);
    try {
      await onMark({
        session: activeSession.id,
        student: student.id,
        status,
        override_reason: student.open_charge_count > 0 && status === "present" ? "Coach marco asistencia con pago pendiente visible" : "",
      });
    } finally {
      setSavingStudentId(null);
    }
  }

  function submitWorkLog(event: FormEvent) {
    event.preventDefault();
    onCreateWorkLog({
      work_date: workForm.work_date,
      hours: workForm.hours,
      activity: workForm.activity,
      notes: workForm.notes,
    });
    setWorkForm({ ...workForm, notes: "" });
  }

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Portal coach</p>
            <h1 className="text-xl font-semibold">{groupName || "Equipo asignado"}</h1>
            <p className="mt-1 text-sm text-zinc-500">{site?.name || "Sin sede"} - {user.first_name || user.username}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50" onClick={onRefresh} title="Actualizar">
              <RefreshCw size={16} />
            </button>
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50" onClick={onLogout} title="Salir">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Alumnos del grupo" value={data.students.length} />
          <Metric label="Alertas medicas" value={medicalAlerts.length} />
          <Metric label="Pagos pendientes" value={debtAlerts.length} />
          <Metric label="Horas registradas" value={totalHours.toFixed(1)} />
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <FormationBoard students={data.students} groupName={groupName} />
          <div className="grid gap-5">
            <form onSubmit={startSession} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <ClipboardCheck size={16} /> Pase de lista
              </h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <TextInput label="Fecha" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                <TextInput label="Hora" type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
              </div>
              <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
                <Plus size={16} /> Crear sesion
              </button>
              <div className="mt-4 grid gap-2">
                {data.attendanceSessions.slice(0, 4).map((session) => (
                  <button
                    type="button"
                    key={session.id}
                    className={`rounded-md border px-3 py-2 text-left text-sm ${activeSessionId === session.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white"}`}
                    onClick={() => setActiveSessionId(session.id)}
                  >
                    <span className="font-medium">{session.date}</span>
                    <span className={activeSessionId === session.id ? "ml-2 text-zinc-200" : "ml-2 text-zinc-500"}>
                      {session.starts_at?.slice(0, 5) || "sin hora"} {session.closed_at ? "- Cerrada" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </form>

            <form onSubmit={submitWorkLog} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">Horas y nomina estimada</h2>
              <p className="mt-1 text-sm text-zinc-500">${money(user.coach_hourly_rate || 0)} por hora - estimado ${money(estimatedPay)}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <TextInput label="Fecha" type="date" value={workForm.work_date} onChange={(event) => setWorkForm({ ...workForm, work_date: event.target.value })} />
                <TextInput label="Horas" type="number" min="0" step="0.25" value={workForm.hours} onChange={(event) => setWorkForm({ ...workForm, hours: event.target.value })} />
              </div>
              <TextInput className="mt-3" label="Actividad" value={workForm.activity} onChange={(event) => setWorkForm({ ...workForm, activity: event.target.value })} />
              <TextInput className="mt-3" label="Notas" value={workForm.notes} onChange={(event) => setWorkForm({ ...workForm, notes: event.target.value })} />
              <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
                <Plus size={16} /> Registrar horas
              </button>
            </form>
          </div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">{activeSession ? "Lista del equipo" : "Crea una sesion para pasar lista"}</h2>
                <p className="mt-1 text-sm text-zinc-500">{presentCount} asisten - {absentCount} faltan</p>
              </div>
              {activeSession && (
                <button
                  className="flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
                  disabled={Boolean(activeSession.closed_at)}
                  onClick={() => onClose(activeSession.id)}
                >
                  <Lock size={16} /> {activeSession.closed_at ? "Cerrada" : "Cerrar"}
                </button>
              )}
            </div>
            <div className="divide-y divide-zinc-100">
              {data.students.map((student) => {
                const record = recordsByStudent.get(student.id);
                const locked = !activeSession || Boolean(activeSession.closed_at);
                return (
                  <div key={student.id} className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="flex gap-3">
                      <Avatar name={student.full_name} imageUrl={student.photo_url} />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{student.full_name}</p>
                          <StatusPill label={statusLabels[student.status]} />
                          {student.open_charge_count > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                              <AlertTriangle size={12} /> Debe ${money(student.balance_due)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-zinc-500">{student.category} - {student.guardian_name} - {student.guardian_phone}</p>
                        {student.medical_notes && <p className="mt-1 text-xs text-red-700">Medico: {student.medical_notes}</p>}
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <AttendanceButton active={record?.status === "present"} disabled={locked || savingStudentId === student.id} label="Asiste" icon={<Check size={16} />} onClick={() => mark(student, "present")} />
                      <AttendanceButton active={record?.status === "absent"} disabled={locked || savingStudentId === student.id} label="Falta" icon={<X size={16} />} onClick={() => mark(student, "absent")} />
                      <AttendanceButton active={record?.status === "justified"} disabled={locked || savingStudentId === student.id} label="Justif." icon={<ClipboardCheck size={16} />} onClick={() => mark(student, "justified")} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-5">
            <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
              <TableHeader title="Alertas del coach" count={medicalAlerts.length + debtAlerts.length} />
              <div className="divide-y divide-zinc-100">
                {[...medicalAlerts, ...debtAlerts.filter((student) => !medicalAlerts.some((medical) => medical.id === student.id))].map((student) => (
                  <div key={student.id} className="px-4 py-3">
                    <p className="font-medium">{student.full_name}</p>
                    {student.medical_notes && <p className="mt-1 text-sm text-red-700">{student.medical_notes}</p>}
                    {student.open_charge_count > 0 && <p className="mt-1 text-sm text-amber-700">Pago pendiente: ${money(student.balance_due)}</p>}
                  </div>
                ))}
                {medicalAlerts.length + debtAlerts.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin alertas para este grupo.</p>}
              </div>
            </div>
            <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
              <TableHeader title="Horas recientes" count={data.coachWorkLogs.length} />
              <div className="divide-y divide-zinc-100">
                {data.coachWorkLogs.map((log) => (
                  <div key={log.id} className="px-4 py-3 text-sm">
                    <p className="font-medium">{log.work_date} - {log.activity}</p>
                    <p className="mt-1 text-zinc-500">{Number(log.hours).toFixed(1)} h - ${money(log.total_amount)}</p>
                    {log.notes && <p className="mt-1 text-zinc-500">{log.notes}</p>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function FormationBoard({ students, groupName }: { students: Student[]; groupName: string }) {
  const starters = students.slice(0, 11);
  const bench = students.slice(11);
  const slots = [
    { label: "POR", x: 8, y: 50 },
    { label: "LI", x: 26, y: 18 },
    { label: "DFC", x: 24, y: 39 },
    { label: "DFC", x: 24, y: 61 },
    { label: "LD", x: 26, y: 82 },
    { label: "MC", x: 49, y: 28 },
    { label: "MC", x: 45, y: 50 },
    { label: "MC", x: 49, y: 72 },
    { label: "EI", x: 73, y: 22 },
    { label: "DC", x: 80, y: 50 },
    { label: "ED", x: 73, y: 78 },
  ];

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="font-semibold">Formacion 4-3-3</h2>
        <p className="mt-1 text-sm text-zinc-500">{groupName} - 11 titulares y banca</p>
      </div>
      <div className="p-4">
        <div className="relative min-h-[460px] overflow-hidden rounded-md border border-emerald-900 bg-emerald-700">
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/60" />
          <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" />
          <div className="absolute left-0 top-1/2 h-44 w-20 -translate-y-1/2 border-y border-r border-white/60" />
          <div className="absolute right-0 top-1/2 h-44 w-20 -translate-y-1/2 border-y border-l border-white/60" />
          {slots.map((slot, index) => {
            const student = starters[index];
            return (
              <div
                key={slot.label + index}
                className="absolute w-24 -translate-x-1/2 -translate-y-1/2 text-center"
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
              >
                <div className="mx-auto grid size-11 place-items-center rounded-full border-2 border-white bg-zinc-950 text-xs font-semibold text-white shadow-sm">
                  {slot.label}
                </div>
                <p className="mt-1 rounded-md bg-white/95 px-2 py-1 text-xs font-medium leading-tight text-zinc-950 shadow-sm">
                  {student?.full_name ?? "Pendiente"}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-4">
          <p className="text-sm font-semibold">Banca / repuesto</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {bench.map((student) => (
              <span key={student.id} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
                {student.full_name}
              </span>
            ))}
            {bench.length === 0 && <span className="text-sm text-zinc-500">Sin banca cargada.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

function AccountingPortal({
  user,
  data,
  onRefresh,
  onLogout,
}: {
  user: User;
  data: AppData;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const confirmedPayments = data.payments.filter((payment) => payment.status === "registered" || payment.status === "reconciled");
  const income = confirmedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const approvedExpenses = data.expenses.filter((expense) => expense.status === "approved");
  const expenseTotal = approvedExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const pendingExpenseTotal = data.expenses
    .filter((expense) => expense.status === "pending")
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const openBalance = data.charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
  const pendingPayments = data.payments.filter((payment) => payment.status === "processing" || payment.status === "awaiting_confirmation");
  const attendanceWithDebt = data.attendanceRecords.filter((record) => record.status === "present" && record.had_debt_at_capture);

  const siteRows = data.sites.map((site) => {
    const siteCharges = data.charges.filter((charge) => charge.site === site.id);
    const siteChargeIds = new Set(siteCharges.map((charge) => charge.id));
    const siteIncome = confirmedPayments
      .filter((payment) => payment.charge && siteChargeIds.has(payment.charge))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const siteExpenses = approvedExpenses
      .filter((expense) => expense.site === site.id)
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const siteBalance = siteCharges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
    return {
      id: site.id,
      label: site.name,
      ingresos: siteIncome,
      egresos: siteExpenses,
      utilidad: siteIncome - siteExpenses,
      pendiente: siteBalance,
    };
  });

  const methodRows = [
    { label: "Efectivo", value: confirmedPayments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Transferencia", value: confirmedPayments.filter((payment) => payment.method === "transfer").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Tarjeta", value: confirmedPayments.filter((payment) => payment.method === "card").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
  ];

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-700">Portal contador</p>
            <h1 className="text-xl font-semibold">Reporte contable operativo</h1>
            <p className="mt-1 text-sm text-zinc-500">{user.first_name || user.username} - ingresos, egresos, utilidad y saldos.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium hover:bg-zinc-50"
              onClick={() => exportAccountingWorkbook(data)}
            >
              <Download size={16} /> Exportar Excel
            </button>
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50" onClick={onRefresh} title="Actualizar">
              <RefreshCw size={16} />
            </button>
            <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white hover:bg-zinc-50" onClick={onLogout} title="Salir">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-6">
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Ingresos confirmados" value={`$${money(income)}`} />
          <Metric label="Egresos aprobados" value={`$${money(expenseTotal)}`} />
          <Metric label="Utilidad operativa" value={`$${money(income - expenseTotal)}`} />
          <Metric label="Saldo por cobrar" value={`$${money(openBalance)}`} />
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
          <FinancialAxisChart rows={siteRows} />
          <div className="grid gap-5">
            <HorizontalBars title="Ingresos por metodo" rows={methodRows} format="money" />
            <SimpleList
              title="Pendientes criticos"
              count={pendingPayments.length + attendanceWithDebt.length}
              rows={[
                ...pendingPayments.slice(0, 4).map((payment) => ({
                  id: payment.id,
                  title: `${payment.student_name || "Cliente"} - ${paymentMethodLabel(payment.method)}`,
                  subtitle: `${paymentStatusLabel(payment.status)} - $${money(payment.amount)}${payment.expires_at ? ` - vence ${payment.expires_at.slice(0, 10)}` : ""}`,
                })),
                ...attendanceWithDebt.slice(0, 4).map((record) => ({
                  id: 10000 + record.id,
                  title: `${record.student_name} asistio con adeudo`,
                  subtitle: record.override_reason || "Cruce asistencia vs cobranza",
                })),
              ]}
            />
          </div>
        </section>

        <section className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <TableHeader title="Estado de resultados por sede" count={siteRows.length} />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Sede</th>
                    <th className="px-4 py-3">Ingresos</th>
                    <th className="px-4 py-3">Egresos</th>
                    <th className="px-4 py-3">Utilidad</th>
                    <th className="px-4 py-3">Por cobrar</th>
                  </tr>
                </thead>
                <tbody>
                  {siteRows.map((row) => (
                    <tr key={row.id} className="border-b border-zinc-100">
                      <td className="px-4 py-3 font-medium">{row.label}</td>
                      <td className="px-4 py-3">${money(row.ingresos)}</td>
                      <td className="px-4 py-3">${money(row.egresos)}</td>
                      <td className={`px-4 py-3 font-semibold ${row.utilidad >= 0 ? "text-emerald-700" : "text-red-700"}`}>${money(row.utilidad)}</td>
                      <td className="px-4 py-3">${money(row.pendiente)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <TableHeader title="Gastos pendientes de aprobacion" count={data.expenses.filter((expense) => expense.status === "pending").length} />
            <div className="divide-y divide-zinc-100">
              {data.expenses.filter((expense) => expense.status === "pending").map((expense) => (
                <div key={expense.id} className="px-4 py-3">
                  <p className="font-medium">{expense.site_name} - {expense.category} - ${money(expense.amount)}</p>
                  <p className="mt-1 text-sm text-zinc-500">{expense.expense_date} - {expense.provider_name || "Sin proveedor"} - {expense.description}</p>
                </div>
              ))}
              <div className="px-4 py-3 text-sm font-semibold">Total pendiente: ${money(pendingExpenseTotal)}</div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function FinancialAxisChart({ rows }: { rows: Array<{ label: string; ingresos: number; egresos: number; utilidad: number }> }) {
  const width = 860;
  const height = 360;
  const margin = { top: 28, right: 24, bottom: 64, left: 82 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.ingresos, row.egresos, Math.max(0, row.utilidad)]));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxValue * ratio));
  const groupWidth = innerWidth / Math.max(1, rows.length);
  const barWidth = Math.min(36, groupWidth / 5);
  const scaleY = (value: number) => margin.top + innerHeight - (Math.max(0, value) / maxValue) * innerHeight;

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="font-semibold">Ingresos vs egresos vs utilidad</h2>
        <p className="mt-1 text-sm text-zinc-500">Grafica con eje X por sede y eje Y en pesos.</p>
      </div>
      <div className="overflow-x-auto p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[720px]">
          <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerHeight} stroke="#a1a1aa" />
          <line x1={margin.left} y1={margin.top + innerHeight} x2={margin.left + innerWidth} y2={margin.top + innerHeight} stroke="#a1a1aa" />
          {ticks.map((tick) => {
            const y = scaleY(tick);
            return (
              <g key={tick}>
                <line x1={margin.left} y1={y} x2={margin.left + innerWidth} y2={y} stroke="#e4e4e7" />
                <text x={margin.left - 10} y={y + 4} textAnchor="end" className="fill-zinc-500 text-[11px]">
                  ${money(tick)}
                </text>
              </g>
            );
          })}
          {rows.map((row, index) => {
            const center = margin.left + groupWidth * index + groupWidth / 2;
            const bars = [
              { key: "ingresos", value: row.ingresos, fill: "#047857", offset: -barWidth - 4 },
              { key: "egresos", value: row.egresos, fill: "#dc2626", offset: 0 },
              { key: "utilidad", value: Math.max(0, row.utilidad), fill: "#27272a", offset: barWidth + 4 },
            ];
            return (
              <g key={row.label}>
                {bars.map((bar) => {
                  const y = scaleY(bar.value);
                  return (
                    <rect
                      key={bar.key}
                      x={center + bar.offset - barWidth / 2}
                      y={y}
                      width={barWidth}
                      height={margin.top + innerHeight - y}
                      rx={4}
                      fill={bar.fill}
                    />
                  );
                })}
                <text x={center} y={margin.top + innerHeight + 24} textAnchor="middle" className="fill-zinc-600 text-[12px]">
                  {row.label}
                </text>
              </g>
            );
          })}
          <text x={margin.left + innerWidth / 2} y={height - 12} textAnchor="middle" className="fill-zinc-500 text-[12px]">Sedes</text>
          <text x={20} y={margin.top + innerHeight / 2} textAnchor="middle" transform={`rotate(-90 20 ${margin.top + innerHeight / 2})`} className="fill-zinc-500 text-[12px]">Pesos MXN</text>
          <g transform={`translate(${margin.left + innerWidth - 270} 8)`}>
            <rect x="0" y="0" width="12" height="12" fill="#047857" rx="2" /><text x="18" y="11" className="fill-zinc-600 text-[12px]">Ingresos</text>
            <rect x="86" y="0" width="12" height="12" fill="#dc2626" rx="2" /><text x="104" y="11" className="fill-zinc-600 text-[12px]">Egresos</text>
            <rect x="172" y="0" width="12" height="12" fill="#27272a" rx="2" /><text x="190" y="11" className="fill-zinc-600 text-[12px]">Utilidad</text>
          </g>
        </svg>
      </div>
    </section>
  );
}

function DashboardPanel({ data }: { data: AppData }) {
  const confirmedPayments = data.payments.filter((payment) => payment.status === "registered" || payment.status === "reconciled");
  const pendingPayments = data.payments.filter((payment) => payment.status === "processing" || payment.status === "awaiting_confirmation");
  const totalIncome = confirmedPayments
    .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const approvedExpenses = data.expenses
    .filter((expense) => expense.status === "approved")
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const pendingExpenses = data.expenses
    .filter((expense) => expense.status === "pending")
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const openBalance = data.charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
  const studentsWithDebt = data.students.filter((student) => student.open_charge_count > 0);
  const attendanceWithDebt = data.attendanceRecords.filter(
    (record) => record.status === "present" && record.had_debt_at_capture,
  );
  const requestedDiscounts = data.discounts.filter((discount) => discount.status === "requested");

  const siteRows = data.sites.map((site) => {
    const payments = confirmedPayments
      .filter((payment) => data.charges.find((charge) => charge.id === payment.charge)?.site === site.id)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const expenses = data.expenses
      .filter((expense) => expense.site === site.id && expense.status === "approved")
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const balance = data.charges
      .filter((charge) => charge.site === site.id)
      .reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
    const students = data.students.filter((student) => student.site === site.id).length;
    const attendance = data.attendanceRecords.filter((record) => {
      const student = data.students.find((item) => item.id === record.student);
      return student?.site === site.id && record.status === "present";
    }).length;
    return {
      id: site.id,
      name: site.name,
      students,
      payments,
      expenses,
      balance,
      attendance,
      utility: payments - expenses,
    };
  });

  const methodRows: Array<{ label: string; value: number }> = [
    { label: "Efectivo", value: confirmedPayments.filter((payment) => payment.method === "cash").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Transferencia", value: confirmedPayments.filter((payment) => payment.method === "transfer").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Tarjeta", value: confirmedPayments.filter((payment) => payment.method === "card").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
    { label: "Cortesia", value: confirmedPayments.filter((payment) => payment.method === "courtesy").reduce((sum, payment) => sum + Number(payment.amount || 0), 0) },
  ];
  const financialRows = siteRows.map((site) => ({
    label: site.name,
    ingresos: site.payments,
    egresos: site.expenses,
    utilidad: site.utility,
  }));
  const pendingPaymentTotal = pendingPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const studentStatusRows = Object.entries(statusLabels).map(([status, label]) => ({
    label,
    value: data.students.filter((student) => student.status === status).length,
  }));
  const paymentStatusRows = [
    { label: "Confirmados", value: totalIncome },
    { label: "En proceso", value: pendingPaymentTotal },
    { label: "Cobros pendientes", value: openBalance },
  ];

  return (
    <>
      <div className="grid gap-3">
        <Metric label="Ingresos registrados" value={`$${money(totalIncome)}`} />
        <Metric label="Gastos aprobados" value={`$${money(approvedExpenses)}`} />
        <Metric label="Utilidad estimada" value={`$${money(totalIncome - approvedExpenses)}`} />
        <Metric label="Gastos pendientes" value={`$${money(pendingExpenses)}`} />
      </div>

      <div className="grid gap-5">
        <section className="grid gap-3 sm:grid-cols-3">
          <Metric label="Cobros pendientes" value={`$${money(openBalance)}`} />
          <Metric label="Alumnos con cobro pendiente" value={studentsWithDebt.length} />
          <Metric label="Asistieron con pago pendiente" value={attendanceWithDebt.length} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <FinancialBarChart title="Ingresos, egresos y utilidad por sede" rows={financialRows} />
          <div className="grid gap-5">
            <HorizontalBars title="Ingresos confirmados por metodo" rows={methodRows} format="money" />
            <HorizontalBars title="Embudo de cobranza" rows={paymentStatusRows} format="money" />
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <HorizontalBars title="Cobros pendientes por sede" rows={siteRows.map((site) => ({ label: site.name, value: site.balance }))} format="money" />
          <HorizontalBars title="Estado de alumnos" rows={studentStatusRows} />
        </section>

        <SitesMap sites={data.sites} siteRows={siteRows} />

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Operacion por sede" count={siteRows.length} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Sede</th>
                  <th className="px-4 py-3">Alumnos</th>
                  <th className="px-4 py-3">Asistencias</th>
                  <th className="px-4 py-3">Ingresos</th>
                  <th className="px-4 py-3">Gastos</th>
                  <th className="px-4 py-3">Utilidad</th>
                  <th className="px-4 py-3">Saldo pendiente</th>
                </tr>
              </thead>
              <tbody>
                {siteRows.map((site) => (
                  <tr key={site.id} className="border-b border-zinc-100">
                    <td className="px-4 py-3 font-medium">{site.name}</td>
                    <td className="px-4 py-3">{site.students}</td>
                    <td className="px-4 py-3">{site.attendance}</td>
                    <td className="px-4 py-3">${money(site.payments)}</td>
                    <td className="px-4 py-3">${money(site.expenses)}</td>
                    <td className="px-4 py-3 font-semibold">${money(site.utility)}</td>
                    <td className="px-4 py-3">${money(site.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <section className="grid gap-5 lg:grid-cols-2">
          <SimpleList
            title="Ingresos por metodo"
            count={methodRows.length}
            rows={methodRows.map((row, index) => ({
              id: index,
              title: row.label,
              subtitle: `$${money(row.value)}`,
            }))}
          />
          <SimpleList
            title="Alertas operativas"
            count={studentsWithDebt.length + requestedDiscounts.length + attendanceWithDebt.length}
            rows={[
              ...studentsWithDebt.slice(0, 5).map((student) => ({
                id: student.id,
                title: `${student.full_name} tiene cobro pendiente`,
                subtitle: `${student.site_name} - saldo $${money(student.balance_due)}`,
              })),
              ...requestedDiscounts.slice(0, 5).map((discount) => ({
                id: 10000 + discount.id,
                title: `Descuento pendiente: ${discount.student_name}`,
                subtitle: `${discount.reason} - $${money(discount.amount)}`,
              })),
              ...attendanceWithDebt.slice(0, 5).map((record) => ({
                id: 20000 + record.id,
                title: `${record.student_name} asistio con pago pendiente`,
                subtitle: record.override_reason || "Autorizacion registrada en cancha",
              })),
            ]}
          />
        </section>
      </div>
    </>
  );
}

function FinancialBarChart({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; ingresos: number; egresos: number; utilidad: number }>;
}) {
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.ingresos, row.egresos, Math.abs(row.utilidad)]));

  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-zinc-500">Comparativo para revisar rentabilidad operativa por sede.</p>
      </div>
      <div className="grid gap-4 p-4">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{row.label}</span>
              <span className={row.utilidad >= 0 ? "text-emerald-700" : "text-red-700"}>Utilidad ${money(row.utilidad)}</span>
            </div>
            <div className="grid gap-2">
              <ChartBar label="Ingresos" value={row.ingresos} max={maxValue} tone="emerald" />
              <ChartBar label="Egresos" value={row.egresos} max={maxValue} tone="red" />
              <ChartBar label="Utilidad" value={Math.abs(row.utilidad)} max={maxValue} tone={row.utilidad >= 0 ? "zinc" : "amber"} displayValue={row.utilidad} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HorizontalBars({
  title,
  rows,
  format = "number",
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
  format?: "money" | "number";
}) {
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title={title} count={rows.length} />
      <div className="grid gap-3 p-4">
        {rows.map((row) => (
          <ChartBar key={row.label} label={row.label} value={row.value} max={maxValue} tone="emerald" valueFormat={format} />
        ))}
      </div>
    </div>
  );
}

function ChartBar({
  label,
  value,
  max,
  tone,
  displayValue,
  valueFormat = "money",
}: {
  label: string;
  value: number;
  max: number;
  tone: "emerald" | "red" | "amber" | "zinc";
  displayValue?: number;
  valueFormat?: "money" | "number";
}) {
  const percent = Math.max(2, Math.min(100, (value / max) * 100));
  const colors = {
    emerald: "bg-emerald-700",
    red: "bg-red-600",
    amber: "bg-amber-500",
    zinc: "bg-zinc-800",
  };
  const shownValue = displayValue ?? value;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-zinc-600">{label}</span>
        <span className="text-zinc-500">{valueFormat === "money" ? `$${money(shownValue)}` : shownValue}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-md bg-zinc-100">
        <div className={`h-full rounded-md ${colors[tone]}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function SitesMap({
  sites,
  siteRows,
}: {
  sites: Site[];
  siteRows: Array<{ id: number; name: string; students: number; balance: number; utility: number }>;
}) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const points = sites
    .filter((site) => site.latitude && site.longitude)
    .map((site) => ({
      site,
      row: siteRows.find((item) => item.id === site.id),
      lat: Number(site.latitude),
      lng: Number(site.longitude),
    }));

  useEffect(() => {
    if (!mapNode.current || points.length === 0) return;

    const map = L.map(mapNode.current, {
      zoomControl: true,
      scrollWheelZoom: false,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const bounds = L.latLngBounds([]);
    points.forEach((point) => {
      const hasRisk = (point.row?.balance ?? 0) > 0;
      const marker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div class="grid size-9 place-items-center rounded-full border-2 ${hasRisk ? "border-red-200 bg-red-600" : "border-emerald-200 bg-emerald-700"} text-xs font-semibold text-white shadow-sm">${point.site.name.slice(0, 2).toUpperCase()}</div>`,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      }).addTo(map);
      marker.bindPopup(`
        <strong>${point.site.name}</strong><br/>
        ${point.site.address || "Sin direccion"}<br/>
        ${point.row?.students ?? 0} alumnos<br/>
        Saldo: $${money(point.row?.balance ?? 0)}
      `);
      bounds.extend([point.lat, point.lng]);
    });

    map.fitBounds(bounds.pad(0.25));
    setTimeout(() => map.invalidateSize(), 0);

    return () => {
      map.remove();
    };
  }, [sites, siteRows]);

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div>
          <h2 className="font-semibold">Mapa de sedes</h2>
          <p className="mt-1 text-sm text-zinc-500">Mapa real con OpenStreetMap para direccion y control operativo.</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{points.length}</span>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
        <div className="min-h-[360px] overflow-hidden rounded-md border border-zinc-200">
          {points.length > 0 ? (
            <div ref={mapNode} className="h-[360px] w-full" />
          ) : (
            <div className="grid h-[360px] place-items-center text-sm text-zinc-500">No hay sedes con coordenadas.</div>
          )}
        </div>
        <div className="grid gap-2">
          {points.map((point) => (
            <div key={point.site.id} className="rounded-md border border-zinc-200 px-3 py-2 text-sm">
              <p className="font-medium">{point.site.name}</p>
              <p className="mt-1 text-zinc-500">{point.site.address}</p>
              <p className="mt-1 font-mono text-xs text-zinc-500">{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</p>
            </div>
          ))}
          {points.length === 0 && <p className="rounded-md border border-zinc-200 px-3 py-6 text-sm text-zinc-500">No hay sedes con coordenadas.</p>}
        </div>
      </div>
    </section>
  );
}

function GuardianPortal({
  user,
  data,
  onRefresh,
  onLogout,
  onPaymentAction,
  onUpdateProfile,
}: {
  user: User;
  data: AppData;
  onRefresh: () => void;
  onLogout: () => void;
  onPaymentAction: (paymentId: number, action: string) => void;
  onUpdateProfile: (payload: unknown) => void;
}) {
  const totalBalance = data.charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
  const actionablePayments = data.payments.filter((payment) => payment.status === "awaiting_confirmation" || payment.channel === "card_link");
  const presentCount = data.attendanceRecords.filter((record) => record.status === "present").length;

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
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
              title="Cobros programados"
              count={data.charges.length}
              rows={data.charges.map((charge) => ({
                id: charge.id,
                title: `${charge.student_name} - ${charge.concept}`,
                subtitle: `Saldo $${money(charge.balance)} - ${chargeStatusLabel(charge.status)}`,
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
          </div>
        </section>
      </div>
    </main>
  );
}

function ProfilePanel({ user, onSave }: { user: User; onSave: (payload: unknown) => void }) {
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

function Avatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return imageUrl ? (
    <img className="size-16 rounded-md object-cover" src={imageUrl} alt={name} />
  ) : (
    <div className="grid size-16 place-items-center rounded-md bg-emerald-700 text-lg font-semibold text-white">{initials || "U"}</div>
  );
}

function CashierPortal({
  user,
  data,
  onRefresh,
  onLogout,
  onCreatePayment,
  onPaymentAction,
}: {
  user: User;
  data: AppData;
  onRefresh: () => void;
  onLogout: () => void;
  onCreatePayment: (payload: unknown) => void;
  onPaymentAction: (paymentId: number, action: string) => void;
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

  return (
    <main className="min-h-screen bg-stone-50 text-zinc-950">
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
                <button className="flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
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

function BillingPanel({
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
      <div className="grid gap-5">
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

      <div className="grid gap-5">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Cobros programados" count={data.charges.length} />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-3">Alumno</th>
                  <th className="px-4 py-3">Concepto</th>
                  <th className="px-4 py-3">Monto</th>
                  <th className="px-4 py-3">Pagado</th>
                  <th className="px-4 py-3">Saldo</th>
                  <th className="px-4 py-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {data.charges.map((charge) => (
                  <tr key={charge.id} className="border-b border-zinc-100">
                    <td className="px-4 py-3 font-medium">{charge.student_name}</td>
                    <td className="px-4 py-3">{chargeLabel(charge)}</td>
                    <td className="px-4 py-3">${money(charge.amount)}</td>
                    <td className="px-4 py-3">${money(charge.paid_amount)}</td>
                    <td className="px-4 py-3 font-semibold">${money(charge.balance)}</td>
                    <td className="px-4 py-3"><StatusPill label={chargeStatusLabel(charge.status)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

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

function ExpensesPanel({
  data,
  onCreateExpense,
  onApproveExpense,
  onRejectExpense,
}: {
  data: AppData;
  onCreateExpense: (payload: unknown) => void;
  onApproveExpense: (expenseId: number) => void;
  onRejectExpense: (expenseId: number) => void;
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

  const pendingExpenses = data.expenses.filter((expense) => expense.status === "pending");
  const approvedTotal = data.expenses
    .filter((expense) => expense.status === "approved")
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const pendingTotal = pendingExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);

  useEffect(() => {
    if (!form.site && data.sites[0]) setForm((current) => ({ ...current, site: String(data.sites[0].id) }));
  }, [data.sites, form.site]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onCreateExpense({
      ...form,
      site: Number(form.site),
      amount: form.amount,
    });
    setForm({ ...form, description: "", amount: "", provider_name: "" });
  }

  return (
    <>
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

      <div className="grid gap-5">
        <section className="grid gap-3 sm:grid-cols-2">
          <Metric label="Pendiente aprobar" value={`$${money(pendingTotal)}`} />
          <Metric label="Aprobado" value={`$${money(approvedTotal)}`} />
        </section>

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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function AttendancePanel({
  data,
  onCreateSession,
  onMark,
  onClose,
}: {
  data: AppData;
  onCreateSession: (payload: unknown) => Promise<AttendanceSession>;
  onMark: (payload: unknown) => Promise<AttendanceRecord>;
  onClose: (sessionId: number) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [siteId, setSiteId] = useState(data.sites[0]?.id ? String(data.sites[0].id) : "");
  const [groupName, setGroupName] = useState("");
  const [date, setDate] = useState(today);
  const [startsAt, setStartsAt] = useState("17:00");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(data.attendanceSessions[0]?.id ?? null);
  const [savingStudentId, setSavingStudentId] = useState<number | null>(null);

  const groups = useMemo(() => {
    const names = data.students
      .filter((student) => !siteId || student.site === Number(siteId))
      .map((student) => student.group_name)
      .filter(Boolean);
    return Array.from(new Set(names)).sort();
  }, [data.students, siteId]);

  const activeSession = data.attendanceSessions.find((session) => session.id === activeSessionId) ?? null;

  const roster = useMemo(() => {
    return data.students.filter((student) => {
      const siteMatches = activeSession ? student.site === activeSession.site : !siteId || student.site === Number(siteId);
      const groupFilter = activeSession?.group_name || groupName;
      const groupMatches = !groupFilter || student.group_name === groupFilter;
      return siteMatches && groupMatches && student.status !== "dropped";
    });
  }, [activeSession, data.students, groupName, siteId]);

  const recordsByStudent = useMemo(() => {
    const map = new Map<number, AttendanceRecord>();
    data.attendanceRecords
      .filter((record) => record.session === activeSessionId && record.student)
      .forEach((record) => map.set(record.student as number, record));
    return map;
  }, [activeSessionId, data.attendanceRecords]);

  const sessionSummary = useMemo(() => {
    const records = Array.from(recordsByStudent.values());
    return {
      present: records.filter((record) => record.status === "present").length,
      absent: records.filter((record) => record.status === "absent").length,
      justified: records.filter((record) => record.status === "justified").length,
    };
  }, [recordsByStudent]);

  useEffect(() => {
    if (!siteId && data.sites[0]) setSiteId(String(data.sites[0].id));
  }, [data.sites, siteId]);

  async function startSession(event: FormEvent) {
    event.preventDefault();
    const session = await onCreateSession({
      site: Number(siteId),
      session_type: "academy_class",
      date,
      starts_at: startsAt || null,
      group_name: groupName,
    });
    setActiveSessionId(session.id);
  }

  async function mark(student: Student, status: AttendanceRecord["status"]) {
    if (!activeSession || activeSession.closed_at) return;
    setSavingStudentId(student.id);
    try {
      await onMark({
        session: activeSession.id,
        student: student.id,
        status,
        override_reason: student.open_charge_count > 0 && status === "present" ? "Alumno con pago pendiente autorizado en cancha" : "",
      });
    } finally {
      setSavingStudentId(null);
    }
  }

  return (
    <>
      <form onSubmit={startSession} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <ClipboardCheck size={16} /> Pase de lista
        </h2>
        <div className="mt-4 grid gap-3">
          <SelectInput label="Sede" required value={siteId} onChange={(event) => setSiteId(event.target.value)}>
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </SelectInput>
          <SelectInput label="Grupo" value={groupName} onChange={(event) => setGroupName(event.target.value)}>
            <option value="">Todos los grupos</option>
            {groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </SelectInput>
          <TextInput label="Fecha" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
          <TextInput label="Hora" type="time" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          <button className="flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            <Plus size={16} /> Crear sesion
          </button>
        </div>

        <div className="mt-5 border-t border-zinc-200 pt-4">
          <p className="text-sm font-medium text-zinc-700">Sesiones recientes</p>
          <div className="mt-2 grid gap-2">
            {data.attendanceSessions.slice(0, 6).map((session) => (
              <button
                type="button"
                key={session.id}
                className={`rounded-md border px-3 py-2 text-left text-sm ${
                  activeSessionId === session.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white"
                }`}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span className="block font-medium">{session.site_name}</span>
                <span className={activeSessionId === session.id ? "text-zinc-200" : "text-zinc-500"}>
                  {session.date} {session.group_name || "Todos"} {session.closed_at ? "- Cerrada" : ""}
                </span>
              </button>
            ))}
            {data.attendanceSessions.length === 0 && <p className="text-sm text-zinc-500">Todavia no hay sesiones.</p>}
          </div>
        </div>
      </form>

      <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">{activeSession ? "Lista de asistencia" : "Selecciona o crea una sesion"}</h2>
            {activeSession && (
              <p className="mt-1 text-sm text-zinc-500">
                {activeSession.site_name} - {activeSession.date} - {activeSession.group_name || "Todos los grupos"}
              </p>
            )}
          </div>
          {activeSession && (
            <button
              className="flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
              disabled={Boolean(activeSession.closed_at)}
              onClick={() => onClose(activeSession.id)}
            >
              <Lock size={16} /> {activeSession.closed_at ? "Cerrada" : "Cerrar"}
            </button>
          )}
        </div>

        {activeSession && (
          <div className="grid grid-cols-3 border-b border-zinc-200 text-center text-sm">
            <div className="px-3 py-3">
              <p className="text-xs uppercase text-zinc-500">Asisten</p>
              <p className="text-xl font-semibold">{sessionSummary.present}</p>
            </div>
            <div className="border-x border-zinc-200 px-3 py-3">
              <p className="text-xs uppercase text-zinc-500">Faltan</p>
              <p className="text-xl font-semibold">{sessionSummary.absent}</p>
            </div>
            <div className="px-3 py-3">
              <p className="text-xs uppercase text-zinc-500">Justif.</p>
              <p className="text-xl font-semibold">{sessionSummary.justified}</p>
            </div>
          </div>
        )}

        <div className="divide-y divide-zinc-100">
          {!activeSession && <p className="px-4 py-8 text-sm text-zinc-500">Crea una sesion para empezar el pase de lista.</p>}
          {activeSession &&
            roster.map((student) => {
              const record = recordsByStudent.get(student.id);
              const locked = Boolean(activeSession.closed_at);
              return (
                <div key={student.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_auto] md:items-center">
                  <div className="flex gap-3">
                    <Avatar name={student.full_name} imageUrl={student.photo_url} />
                    <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{student.full_name}</p>
                      <StatusPill label={statusLabels[student.status]} />
                      <StatusPill label={student.uniform_status === "delivered" ? "Uniforme entregado" : "Uniforme pendiente"} />
                      {student.open_charge_count > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
                          <AlertTriangle size={12} /> Pago pendiente ${student.balance_due}
                        </span>
                      )}
                      {student.pause_start && (
                        <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                          Pausa {student.pause_start} a {student.pause_end || "abierta"}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-zinc-500">
                      {student.group_name || student.category} - {student.guardian_name} - {student.guardian_phone}
                    </p>
                    {student.medical_notes && <p className="mt-1 text-xs text-red-700">Medico: {student.medical_notes}</p>}
                    {student.active_discounts.length > 0 && (
                      <p className="mt-1 text-xs text-emerald-700">
                        Descuentos activos: {student.active_discounts.map((discount) => `${discount.reason} $${money(discount.amount)}`).join(", ")}
                      </p>
                    )}
                    {student.waiver_url && <p className="mt-1 text-xs text-zinc-500">Responsiva registrada</p>}
                    {record?.override_reason && <p className="mt-1 text-xs text-amber-700">{record.override_reason}</p>}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <AttendanceButton
                      active={record?.status === "present"}
                      disabled={locked || savingStudentId === student.id}
                      label="Asiste"
                      icon={<Check size={16} />}
                      onClick={() => mark(student, "present")}
                    />
                    <AttendanceButton
                      active={record?.status === "absent"}
                      disabled={locked || savingStudentId === student.id}
                      label="Falta"
                      icon={<X size={16} />}
                      onClick={() => mark(student, "absent")}
                    />
                    <AttendanceButton
                      active={record?.status === "justified"}
                      disabled={locked || savingStudentId === student.id}
                      label="Justif."
                      icon={<ClipboardCheck size={16} />}
                      onClick={() => mark(student, "justified")}
                    />
                  </div>
                </div>
              );
            })}
          {activeSession && roster.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay alumnos para este filtro.</p>}
        </div>
      </div>
    </>
  );
}

function AttendanceButton({
  active,
  disabled,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  disabled: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex min-h-10 items-center justify-center gap-1 rounded-md border px-2 text-xs font-medium disabled:opacity-50 ${
        active ? "border-emerald-700 bg-emerald-700 text-white" : "border-zinc-300 bg-white text-zinc-700"
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function StudentsPanel({
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

function GuardiansPanel({ guardians, onCreate }: { guardians: Guardian[]; onCreate: (payload: unknown) => void }) {
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

function SitesPanel({ sites, onCreate }: { sites: Site[]; onCreate: (payload: unknown) => void }) {
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

function UsersPanel({ data, onCreate }: { data: AppData; onCreate: (payload: unknown) => void }) {
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

function TableHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
      <h2 className="font-semibold">{title}</h2>
      <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{count}</span>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">{label}</span>;
}

function InfoChip({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "danger" | "neutral" }) {
  const styles = {
    ok: "bg-emerald-50 text-emerald-800",
    warn: "bg-amber-50 text-amber-800",
    danger: "bg-red-50 text-red-700",
    neutral: "bg-zinc-100 text-zinc-600",
  };
  return (
    <div className={`rounded-md px-3 py-2 text-xs ${styles[tone]}`}>
      <p className="font-medium">{label}</p>
      <p className="mt-0.5">{value}</p>
    </div>
  );
}

function exportAccountingWorkbook(data: AppData) {
  const xmlEscape = (value: string | number | null | undefined) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const cell = (value: string | number | null | undefined, type: "String" | "Number" = "String") =>
    `<Cell><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`;
  const row = (values: Array<string | number | null | undefined>, numericColumns: number[] = []) =>
    `<Row>${values.map((value, index) => cell(value, numericColumns.includes(index) ? "Number" : "String")).join("")}</Row>`;
  const sheet = (name: string, headers: string[], rows: Array<Array<string | number | null | undefined>>, numericColumns: number[] = []) => `
    <Worksheet ss:Name="${xmlEscape(name).slice(0, 31)}">
      <Table>
        ${row(headers)}
        ${rows.map((values) => row(values, numericColumns)).join("")}
      </Table>
    </Worksheet>`;

  const confirmedPayments = data.payments.filter((payment) => payment.status === "registered" || payment.status === "reconciled");
  const siteSummary = data.sites.map((site) => {
    const charges = data.charges.filter((charge) => charge.site === site.id);
    const chargeIds = new Set(charges.map((charge) => charge.id));
    const ingresos = confirmedPayments
      .filter((payment) => payment.charge && chargeIds.has(payment.charge))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const egresos = data.expenses
      .filter((expense) => expense.site === site.id && expense.status === "approved")
      .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const pendiente = charges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
    return [site.name, ingresos, egresos, ingresos - egresos, pendiente, charges.length];
  });

  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
  </Styles>
  ${sheet("Resumen", ["Sede", "Ingresos", "Egresos", "Utilidad", "Por cobrar", "Cargos"], siteSummary, [1, 2, 3, 4, 5])}
  ${sheet("Pagos", ["ID", "Cliente", "Concepto", "Metodo", "Canal", "Estado", "Monto", "Pagado", "Confirmado", "Referencia"], data.payments.map((payment) => [
    payment.id,
    payment.student_name || payment.team_name || "",
    payment.charge_concept || "",
    paymentMethodLabel(payment.method),
    payment.channel,
    paymentStatusLabel(payment.status),
    Number(payment.amount || 0),
    payment.paid_at,
    payment.confirmed_at || "",
    payment.reference,
  ]), [0, 6])}
  ${sheet("Cargos", ["ID", "Sede", "Cliente", "Concepto", "Descripcion", "Monto", "Pagado", "Descuento", "Saldo", "Vencimiento", "Estado"], data.charges.map((charge) => [
    charge.id,
    charge.site_name || "",
    charge.student_name || charge.team_name || "",
    charge.concept,
    charge.description,
    Number(charge.amount || 0),
    Number(charge.paid_amount || 0),
    Number(charge.discount_amount || 0),
    Number(charge.balance || 0),
    charge.due_date || "",
    chargeStatusLabel(charge.status),
  ]), [0, 5, 6, 7, 8])}
  ${sheet("Gastos", ["ID", "Sede", "Categoria", "Descripcion", "Proveedor", "Monto", "Fecha", "Estado", "Capturo", "Aprobo"], data.expenses.map((expense) => [
    expense.id,
    expense.site_name || "",
    expense.category,
    expense.description,
    expense.provider_name,
    Number(expense.amount || 0),
    expense.expense_date,
    expenseStatusLabel(expense.status),
    expense.captured_by_username || "",
    expense.approved_by_username || "",
  ]), [0, 5])}
  ${sheet("Descuentos", ["ID", "Cliente", "Cargo", "Motivo", "Monto", "Estado", "Solicito", "Aprobo"], data.discounts.map((discount) => [
    discount.id,
    discount.student_name || "",
    discount.charge_concept || "",
    discount.reason,
    Number(discount.amount || 0),
    discount.status,
    discount.requested_by_username || "",
    discount.approved_by_username || "",
  ]), [0, 4])}
  ${sheet("Asistencia con adeudo", ["ID", "Alumno", "Estado", "Adeudo al capturar", "Motivo"], data.attendanceRecords.filter((record) => record.had_debt_at_capture).map((record) => [
    record.id,
    record.student_name || "",
    record.status,
    record.had_debt_at_capture ? "Si" : "No",
    record.override_reason,
  ]), [0])}
</Workbook>`;

  const blob = new Blob([workbook], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `reporte-contable-futsi-${new Date().toISOString().slice(0, 10)}.xls`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function chargeStatusLabel(status: ChargeStatus) {
  const labels: Record<ChargeStatus, string> = {
    pending: "Pendiente",
    partial: "Parcial",
    paid: "Pagado",
    canceled: "Cancelado",
  };
  return labels[status];
}

function chargeLabel(charge: Charge) {
  return charge.description ? `${charge.concept} - ${charge.description}` : charge.concept;
}

function paymentMethodLabel(method: PaymentMethod) {
  const labels: Record<PaymentMethod, string> = {
    cash: "Efectivo",
    transfer: "Transferencia",
    card: "Tarjeta",
    courtesy: "Cortesia",
  };
  return labels[method];
}

function paymentStatusLabel(status: PaymentStatus) {
  const labels: Record<PaymentStatus, string> = {
    processing: "En proceso",
    awaiting_confirmation: "Pendiente de aceptacion",
    registered: "Registrado",
    reconciled: "Conciliado",
    canceled: "Cancelado",
    expired: "Expirado",
  };
  return labels[status];
}

function expenseStatusLabel(status: ExpenseStatus) {
  const labels: Record<ExpenseStatus, string> = {
    pending: "Pendiente",
    approved: "Aprobado",
    rejected: "Rechazado",
    canceled: "Cancelado",
  };
  return labels[status];
}

function SimpleList({ title, count, rows }: { title: string; count: number; rows: Array<{ id: number; title: string; subtitle: string }> }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
      <TableHeader title={title} count={count} />
      <div className="divide-y divide-zinc-100">
        {rows.map((row) => (
          <div key={row.id} className="px-4 py-3">
            <p className="font-medium">{row.title}</p>
            <p className="mt-1 text-sm text-zinc-500">{row.subtitle}</p>
          </div>
        ))}
        {rows.length === 0 && <p className="px-4 py-6 text-sm text-zinc-500">Sin registros.</p>}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
