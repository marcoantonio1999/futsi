import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarDays,
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
import { ApiError, apiFormRequest, apiRequest, downloadApiFile } from "./api";
import { emptyData, roleLabels } from "./appState";
import type { Role, StudentStatus, ThemeMode, User, Site, Guardian, Student, AttendanceSession, AttendanceRecord, Tournament, Team, Player, PlayerAttendanceRecord, Match, StandingRow, StudentAssessment, ChargeStatus, PaymentMethod, PaymentStatus, DiscountStatus, Charge, Payment, Discount, ExpenseStatus, Expense, StaffPaymentKind, StaffPaymentStatus, StaffPaymentRequest, CashMovementType, CashMovement, CoachWorkLog, Invoice, FaceRecognitionResponse, HistoricalImportRow, HistoricalImport, HistoricalDiscrepancyItem, HistoricalDiscrepancySummary, HistoricalDiscrepancyReport, AppData, TabKey, AccountingSiteRow } from "./types";
import {
  AccountingPortal,
  AdultLeagueDashboardPanel,
  AttendancePanel,
  BillingPanel,
  CashierPortal,
  CoachPortal,
  DashboardPanel,
  DailyOperationPanel,
  DebtsPanel,
  ExpensesPanel,
  CoachesConsolidatedPanel,
  GuardiansPanel,
  GuardianPortal,
  HistoricalDiscrepanciesPanel,
  HistoricalImportsPanel,
  IncomeStatementPanel,
  InvoicesPanel,
  LoginScreen,
  SalesEstimationPanel,
  SitesPanel,
  SportsPanel,
  RefereesConsolidatedPanel,
  StudentsPanel,
  ThemeToggle,
  UniformsPanel,
  UsersPanel,
} from "./components/FutsiViews";

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("futsi_token") ?? "");
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("futsi_theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileSwipeStartX = useRef<number | null>(null);
  const [data, setData] = useState<AppData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "owner" || currentUser?.role === "dev";

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("futsi_theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  async function loadData(authToken = token) {
    if (!authToken) return;
    setLoading(true);
    setError("");
    try {
      const me = await apiRequest<User>("/auth/me/", authToken);
      await apiRequest("/charges/generate-scheduled/", authToken, { method: "POST" }).catch(() => undefined);
      if (me.role === "guardian") {
        const [students, attendanceRecords, charges, payments, discounts, invoices, tournaments, matches, standings, studentAssessments] = await Promise.all([
          apiRequest<Student[]>("/students/", authToken),
          apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
          apiRequest<Charge[]>("/charges/", authToken),
          apiRequest<Payment[]>("/payments/", authToken),
          apiRequest<Discount[]>("/discounts/", authToken),
          apiRequest<Invoice[]>("/invoices/", authToken),
          apiRequest<Tournament[]>("/tournaments/", authToken),
          apiRequest<Match[]>("/matches/", authToken),
          apiRequest<StandingRow[]>("/matches/standings/", authToken),
          apiRequest<StudentAssessment[]>("/student-assessments/", authToken),
        ]);
        setCurrentUser(me);
        setData({
          ...emptyData,
          students,
          attendanceRecords,
          charges,
          payments,
          discounts,
          invoices,
          tournaments,
          matches,
          standings,
          studentAssessments,
        });
        return;
      }
      if (me.role === "cashier") {
        const [sites, students, attendanceSessions, charges, payments, tournaments, teams, players, matches, standings, playerAttendanceRecords, staffPaymentRequests, cashMovements] = await Promise.all([
          apiRequest<Site[]>("/sites/", authToken),
          apiRequest<Student[]>("/students/", authToken),
          apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
          apiRequest<Charge[]>("/charges/", authToken),
          apiRequest<Payment[]>("/payments/", authToken),
          apiRequest<Tournament[]>("/tournaments/", authToken),
          apiRequest<Team[]>("/teams/", authToken),
          apiRequest<Player[]>("/players/", authToken),
          apiRequest<Match[]>("/matches/", authToken),
          apiRequest<StandingRow[]>("/matches/standings/", authToken),
          apiRequest<PlayerAttendanceRecord[]>("/player-attendance-records/", authToken),
          apiRequest<StaffPaymentRequest[]>("/staff-payment-requests/?mine=1", authToken),
          apiRequest<CashMovement[]>("/cash-movements/", authToken),
        ]);
        setCurrentUser(me);
        setData({
          ...emptyData,
          sites,
          students,
          attendanceSessions,
          charges,
          payments,
          tournaments,
          teams,
          players,
          matches,
          standings,
          playerAttendanceRecords,
          staffPaymentRequests,
          cashMovements,
        });
        return;
      }
      if (me.role === "adult_representative" || me.role === "adult_player") {
        const [sites, attendanceSessions, charges, payments, tournaments, teams, players, matches, standings, playerAttendanceRecords] = await Promise.all([
          apiRequest<Site[]>("/sites/", authToken),
          apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
          apiRequest<Charge[]>("/charges/", authToken),
          apiRequest<Payment[]>("/payments/", authToken),
          apiRequest<Tournament[]>("/tournaments/", authToken),
          apiRequest<Team[]>("/teams/", authToken),
          apiRequest<Player[]>("/players/", authToken),
          apiRequest<Match[]>("/matches/", authToken),
          apiRequest<StandingRow[]>("/matches/standings/", authToken),
          apiRequest<PlayerAttendanceRecord[]>("/player-attendance-records/", authToken),
        ]);
        setCurrentUser(me);
        setData({
          ...emptyData,
          sites,
          attendanceSessions,
          charges,
          payments,
          tournaments,
          teams,
          players,
          matches,
          standings,
          playerAttendanceRecords,
        });
        return;
      }
      if (me.role === "coach") {
        const [sites, students, attendanceSessions, attendanceRecords, coachWorkLogs, invoices, tournaments, matches, standings, studentAssessments, staffPaymentRequests] = await Promise.all([
          apiRequest<Site[]>("/sites/", authToken),
          apiRequest<Student[]>("/students/", authToken),
          apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
          apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
          apiRequest<CoachWorkLog[]>("/coach-work-logs/", authToken),
          apiRequest<Invoice[]>("/invoices/", authToken),
          apiRequest<Tournament[]>("/tournaments/", authToken),
          apiRequest<Match[]>("/matches/", authToken),
          apiRequest<StandingRow[]>("/matches/standings/", authToken),
          apiRequest<StudentAssessment[]>("/student-assessments/", authToken),
          apiRequest<StaffPaymentRequest[]>("/staff-payment-requests/?mine=1", authToken),
        ]);
        setCurrentUser(me);
        setData({
          ...emptyData,
          sites,
          students,
          attendanceSessions,
          attendanceRecords,
          coachWorkLogs,
          invoices,
          tournaments,
          matches,
          standings,
          studentAssessments,
          staffPaymentRequests,
        });
        return;
      }

      const [sites, guardians, students, attendanceSessions, attendanceRecords, charges, payments, discounts, expenses, staffPaymentRequests, cashMovements, coachWorkLogs, users, invoices, historicalImports, historicalDiscrepancies, tournaments, teams, players, matches, standings, playerAttendanceRecords, studentAssessments] = await Promise.all([
        apiRequest<Site[]>("/sites/", authToken),
        apiRequest<Guardian[]>("/guardians/", authToken),
        apiRequest<Student[]>("/students/", authToken),
        apiRequest<AttendanceSession[]>("/attendance-sessions/", authToken),
        apiRequest<AttendanceRecord[]>("/attendance-records/", authToken),
        apiRequest<Charge[]>("/charges/", authToken),
        apiRequest<Payment[]>("/payments/", authToken),
        apiRequest<Discount[]>("/discounts/", authToken),
        apiRequest<Expense[]>("/expenses/", authToken),
        apiRequest<StaffPaymentRequest[]>("/staff-payment-requests/", authToken),
        apiRequest<CashMovement[]>("/cash-movements/", authToken),
        apiRequest<CoachWorkLog[]>("/coach-work-logs/", authToken).catch(() => []),
        me.role === "admin" || me.role === "owner" || me.role === "dev" ? apiRequest<User[]>("/users/", authToken) : Promise.resolve([]),
        apiRequest<Invoice[]>("/invoices/", authToken),
        me.role === "admin" || me.role === "owner" || me.role === "dev" || me.role === "accounting" ? apiRequest<HistoricalImport[]>("/historical-imports/", authToken) : Promise.resolve([]),
        me.role === "admin" || me.role === "owner" || me.role === "dev" || me.role === "accounting" ? apiRequest<HistoricalDiscrepancyReport>("/historical-imports/discrepancies/", authToken) : Promise.resolve(null),
        apiRequest<Tournament[]>("/tournaments/", authToken),
        apiRequest<Team[]>("/teams/", authToken),
        apiRequest<Player[]>("/players/", authToken),
        apiRequest<Match[]>("/matches/", authToken),
        apiRequest<StandingRow[]>("/matches/standings/", authToken),
        apiRequest<PlayerAttendanceRecord[]>("/player-attendance-records/", authToken),
        apiRequest<StudentAssessment[]>("/student-assessments/", authToken),
      ]);
      setCurrentUser(me);
      setData({ sites, guardians, students, attendanceSessions, attendanceRecords, charges, payments, discounts, expenses, staffPaymentRequests, cashMovements, users, coachWorkLogs, tournaments, teams, players, matches, standings, playerAttendanceRecords, studentAssessments, invoices, historicalImports, historicalDiscrepancies });
    } catch (err) {
      const shouldLogout = err instanceof ApiError && err.status === 401 && err.path === "/auth/me/";
      setError(err instanceof Error ? err.message : "No se pudo cargar informacion.");
      if (shouldLogout) {
        localStorage.removeItem("futsi_token");
        setToken("");
        setCurrentUser(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) loadData(token);
  }, [token]);

  useEffect(() => {
    if (!token || !currentUser) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadData(token);
      }
    }, 12000);
    return () => window.clearInterval(interval);
  }, [token, currentUser?.id]);

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

  async function uploadHistoricalImport(formData: FormData) {
    setMessage("");
    setError("");
    try {
      const result = await apiFormRequest<HistoricalImport>("/historical-imports/preview/", token, formData);
      setData((current) => ({
        ...current,
        historicalImports: [result, ...current.historicalImports.filter((item) => item.id !== result.id)],
      }));
      const discrepancyReport = await apiRequest<HistoricalDiscrepancyReport>("/historical-imports/discrepancies/", token).catch(() => null);
      if (discrepancyReport) {
        setData((current) => ({ ...current, historicalDiscrepancies: discrepancyReport }));
      }
      setMessage("Excel analizado. Revisa el preview antes de firmar.");
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo analizar el Excel.");
      throw err;
    }
  }

  async function commitHistoricalImport(importId: number, payload: unknown) {
    setMessage("");
    setError("");
    try {
      const result = await apiRequest<HistoricalImport>(`/historical-imports/${importId}/commit/`, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setMessage("Historico firmado y cargado a la base.");
      await loadData();
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar el historico.");
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

  async function updateMatchScore(matchId: number, payload: unknown) {
    await updateRecord(`/matches/${matchId}/`, payload, "Marcador actualizado.");
  }

  async function saveStudentAssessment(payload: unknown) {
    await createRecord("/student-assessments/", payload, "Evaluacion deportiva guardada.");
  }

  async function markAdultPlayer(payload: unknown) {
    await createAndReturn<PlayerAttendanceRecord>("/player-attendance-records/", payload);
  }

  async function downloadFile(path: string, filename: string) {
    setMessage("");
    setError("");
    try {
      await downloadApiFile(path, token, filename);
      setMessage("Archivo generado correctamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descargar el archivo.");
    }
  }

  const studentsByStatus = useMemo(() => {
    return data.students.reduce<Record<string, number>>((acc, student) => {
      acc[student.status] = (acc[student.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [data.students]);

  if (!token || !currentUser) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <LoginScreen onLogin={handleLogin} />
      </>
    );
  }

  if (currentUser.role === "guardian") {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <GuardianPortal
          user={currentUser}
          data={data}
          onRefresh={() => loadData()}
          onLogout={logout}
          onPaymentAction={(paymentId, action) => postAction(`/payments/${paymentId}/${action}/`, "Pago actualizado.")}
          onUpdateProfile={updateProfile}
          onDownloadFile={downloadFile}
          onSaveAssessment={saveStudentAssessment}
        />
      </>
    );
  }

  if (currentUser.role === "cashier") {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <CashierPortal
          user={currentUser}
          data={data}
          onRefresh={() => loadData()}
          onLogout={logout}
          onCreatePayment={(payload) => createRecord("/payments/", payload, "Solicitud de pago creada.")}
          onPaymentAction={(paymentId, action) => postAction(`/payments/${paymentId}/${action}/`, "Pago actualizado.")}
          onUpdateMatch={updateMatchScore}
          onCreateCashMovement={(payload) => createRecord("/cash-movements/", payload, "Movimiento de caja registrado.")}
          onAcceptStaffPayment={(requestId) => postAction(`/staff-payment-requests/${requestId}/accept/`, "Pago aceptado.")}
          onRejectStaffPayment={(requestId) => postAction(`/staff-payment-requests/${requestId}/reject/`, "Pago rechazado.")}
        />
      </>
    );
  }

  if (currentUser.role === "adult_representative" || currentUser.role === "adult_player") {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <main className="min-h-screen bg-blue-50/40 text-zinc-950" data-testid="adult-portal">
          <header className="border-b border-blue-200 bg-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-blue-700">Portal liga adultos</p>
                <h1 className="text-xl font-semibold">{currentUser.first_name || currentUser.username}</h1>
                <p className="mt-1 text-sm text-zinc-500">{roleLabels[currentUser.role]}</p>
              </div>
              <div className="flex gap-2">
                <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white" onClick={() => loadData()} title="Actualizar">
                  <RefreshCw size={16} />
                </button>
                <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white" onClick={logout} title="Salir">
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </header>
          <div className="mx-auto max-w-7xl px-5 py-6">
            <AdultLeagueDashboardPanel
              data={data}
              readOnly
              onCreateSession={async () => data.attendanceSessions[0]}
              onMarkPlayer={async () => undefined}
              onCreatePayment={() => undefined}
              onPaymentAction={() => undefined}
            />
          </div>
        </main>
      </>
    );
  }

  if (currentUser.role === "coach") {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <CoachPortal
          user={currentUser}
          data={data}
          onRefresh={() => loadData()}
          onLogout={logout}
          onCreateSession={(payload) => createAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
          onMark={(payload) => createAndReturn<AttendanceRecord>("/attendance-records/", payload)}
          onClose={closeAttendanceSession}
          onCreateWorkLog={(payload) => createRecord("/coach-work-logs/", payload, "Horas registradas.")}
          onFaceAttendance={(payload) => createAndReturn<FaceRecognitionResponse>("/face-attendance/recognize/", payload)}
          onDownloadFile={downloadFile}
          onUpdateMatch={updateMatchScore}
          onSaveAssessment={saveStudentAssessment}
          onAcceptStaffPayment={(requestId) => postAction(`/staff-payment-requests/${requestId}/accept/`, "Pago aceptado.")}
          onRejectStaffPayment={(requestId) => postAction(`/staff-payment-requests/${requestId}/reject/`, "Pago rechazado.")}
        />
      </>
    );
  }

  if (currentUser.role === "accounting") {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <AccountingPortal
          user={currentUser}
          data={data}
          onRefresh={() => loadData()}
          onLogout={logout}
          onDownloadAccounting={() => downloadFile("/reports/accounting.xlsx", `reporte-contable-futsi.xlsx`)}
          onCreateInvoice={(payload) => createRecord("/invoices/simulate/", payload, "Factura simulada generada.")}
          onDownloadFile={downloadFile}
          onUploadHistoricalImport={uploadHistoricalImport}
          onCommitHistoricalImport={commitHistoricalImport}
          onUpdateMatch={updateMatchScore}
        />
      </>
    );
  }

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode; adminOnly?: boolean }> = [
    { key: "dashboard", label: "Dashboard", icon: <BarChart3 size={16} /> },
    { key: "adult-dashboard", label: "Liga adultos", icon: <UsersRound size={16} /> },
    { key: "sports", label: "Deportivo", icon: <BarChart3 size={16} /> },
    { key: "coaches", label: "Coaches", icon: <UserRound size={16} /> },
    { key: "referees", label: "Arbitros", icon: <Shield size={16} /> },
    { key: "uniforms", label: "Uniformes", icon: <FileText size={16} /> },
    { key: "sales-estimate", label: "Estimacion ventas", icon: <BarChart3 size={16} /> },
    { key: "income-statement", label: "Estado resultados", icon: <FileText size={16} /> },
    { key: "daily-operation", label: "Operacion diaria", icon: <CalendarDays size={16} /> },
    { key: "attendance", label: "Asistencia", icon: <ClipboardCheck size={16} /> },
    { key: "billing", label: "Cobranza", icon: <CreditCard size={16} /> },
    { key: "debts", label: "Adeudos", icon: <AlertTriangle size={16} /> },
    { key: "expenses", label: "Gastos", icon: <FileText size={16} /> },
    { key: "students", label: "Alumnos", icon: <UsersRound size={16} /> },
    { key: "guardians", label: "Representantes", icon: <UserRound size={16} /> },
    { key: "sites", label: "Sedes", icon: <Building2 size={16} /> },
    { key: "users", label: "Usuarios", icon: <Shield size={16} />, adminOnly: true },
    { key: "invoices", label: "Facturas", icon: <FileText size={16} /> },
    { key: "historical", label: "Historico", icon: <Upload size={16} /> },
    { key: "discrepancies", label: "Discrepancias", icon: <AlertTriangle size={16} />, adminOnly: true },
  ];
  const visibleTabs = tabs.filter((tab) => !tab.adminOnly || isAdmin);
  const sidebarTabs = visibleTabs.filter((tab) => tab.key !== "adult-dashboard");
  const activeTabMeta = visibleTabs.find((tab) => tab.key === activeTab);

  function handleMobileTouchStart(event: React.TouchEvent<HTMLElement>) {
    mobileSwipeStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleMobileTouchEnd(event: React.TouchEvent<HTMLElement>) {
    const startX = mobileSwipeStartX.current;
    const endX = event.changedTouches[0]?.clientX ?? null;
    mobileSwipeStartX.current = null;
    if (startX === null || endX === null) return;

    const screenWidth = window.innerWidth;
    const deltaX = endX - startX;
    if (!mobileMenuOpen && startX > screenWidth - 28 && deltaX < -50) {
      setMobileMenuOpen(true);
    }
    if (mobileMenuOpen && deltaX > 50) {
      setMobileMenuOpen(false);
    }
  }

  return (
    <main
      className="min-h-screen bg-stone-50 text-zinc-950"
      onTouchStart={handleMobileTouchStart}
      onTouchEnd={handleMobileTouchEnd}
      data-testid="admin-portal"
    >
      <ThemeToggle theme={theme} onToggle={toggleTheme} />
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[1001] bg-zinc-950/35 lg:hidden" onClick={() => setMobileMenuOpen(false)}>
          <aside
            className="flex h-dvh max-h-dvh w-[min(86vw,300px)] flex-col overflow-hidden rounded-r-[20px] bg-white p-4 shadow-xl"
            data-testid="section-menu-dropdown"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="grid size-9 place-items-center rounded-full bg-emerald-700 text-sm font-bold text-white">F</span>
                <div>
                  <p className="font-semibold">Futsi</p>
                  <p className="text-xs text-zinc-500">Mini ERP</p>
                </div>
              </div>
              <button className="grid size-9 place-items-center rounded-md border border-zinc-200" onClick={() => setMobileMenuOpen(false)} type="button">
                <X size={16} />
              </button>
            </div>
            <nav className="mt-5 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.key}
                  data-testid={`menu-tab-${tab.key}`}
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium ${
                    activeTab === tab.key ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-50"
                  }`}
                  onClick={() => {
                    setActiveTab(tab.key);
                    setMobileMenuOpen(false);
                  }}
                  type="button"
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>
            <button className="mt-3 flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50" onClick={logout} type="button">
              <LogOut size={16} />
              Cerrar sesion
            </button>
          </aside>
        </div>
      )}

      <div className="mx-auto flex min-h-screen max-w-[1540px] gap-5 p-4">
        <aside className="fixed top-4 z-[910] hidden h-[calc(100vh-2rem)] min-h-0 w-64 shrink-0 flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white p-4 shadow-sm lg:left-[max(1rem,calc((100vw-1540px)/2+1rem))] lg:flex">
          <div className="flex shrink-0 items-center gap-3 px-2 py-2">
            <span className="grid size-10 place-items-center rounded-full bg-emerald-700 text-sm font-bold text-white">F</span>
            <div>
              <p className="font-semibold">Futsi</p>
              <p className="text-xs text-zinc-500">Mini ERP operativo</p>
            </div>
          </div>
          <nav className="mt-6 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase text-zinc-400">Principal</p>
            {sidebarTabs.slice(0, 10).map((tab) => (
              <button
                key={tab.key}
                data-testid={`menu-tab-${tab.key}`}
                className={`relative flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium ${
                  activeTab === tab.key ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-50"
                }`}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                {activeTab === tab.key && <span className="absolute -left-4 h-7 w-1 rounded-r-full bg-emerald-700" />}
                {tab.icon}
                {tab.label}
              </button>
            ))}
            <p className="mt-5 px-3 pb-1 text-[11px] font-semibold uppercase text-zinc-400">General</p>
            {sidebarTabs.slice(10).map((tab) => (
              <button
                key={tab.key}
                data-testid={`menu-tab-${tab.key}`}
                className={`relative flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium ${
                  activeTab === tab.key ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-50"
                }`}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                {activeTab === tab.key && <span className="absolute -left-4 h-7 w-1 rounded-r-full bg-emerald-700" />}
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="mt-3 shrink-0 rounded-[18px] bg-zinc-950 p-3 text-white">
            <p className="text-xs text-zinc-300">Modo demo</p>
            <p className="mt-1 text-sm font-semibold">Datos operativos vivos</p>
            <button className="mt-3 w-full rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold" onClick={() => loadData()} type="button">
              Actualizar
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 pt-20 lg:ml-[17rem] lg:pt-0">
          <header className="fixed left-3 right-3 top-3 z-[900] rounded-[24px] border border-white/70 bg-white px-4 py-3 shadow-sm lg:sticky lg:left-auto lg:right-auto lg:top-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  data-testid="section-menu-open"
                  className="grid size-10 place-items-center rounded-md border border-zinc-200 bg-white lg:hidden"
                  onClick={() => setMobileMenuOpen(true)}
                  type="button"
                  aria-label="Abrir secciones"
                >
                  <Menu size={18} />
                </button>
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase text-emerald-700">Sprint 1 / Dia 6</p>
                  <h1 className="truncate text-xl font-semibold">{activeTabMeta?.label || "Operacion base"}</h1>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                    activeTab === "adult-dashboard"
                      ? "border-blue-700 bg-blue-700 text-white"
                      : "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
                  }`}
                  onClick={() => setActiveTab(activeTab === "adult-dashboard" ? "dashboard" : "adult-dashboard")}
                  type="button"
                >
                  {activeTab === "adult-dashboard" ? "Academia" : "Liga adultos"}
                </button>
                <button className="grid size-10 place-items-center rounded-md border border-zinc-200 bg-white hover:bg-zinc-50" onClick={() => loadData()} title="Actualizar" type="button">
                  <RefreshCw size={16} />
                </button>
                <div className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 sm:flex">
                  <span className="grid size-8 place-items-center rounded-full bg-rose-400 text-sm font-semibold text-white">{currentUser.username.slice(0, 1).toUpperCase()}</span>
                  <div className="text-sm leading-tight">
                    <p className="font-medium">{currentUser.username}</p>
                    <p className="text-xs text-zinc-500">{roleLabels[currentUser.role]}</p>
                  </div>
                </div>
                <button className="hidden size-10 place-items-center rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 sm:grid" onClick={logout} title="Salir" type="button">
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </header>

      <div className="px-1 py-5">
        {message && <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="mt-4 text-sm text-zinc-500">Cargando informacion...</p>}

        <section className={`${activeTab !== "dashboard" && activeTab !== "adult-dashboard" ? "mt-6" : "mt-0"} grid min-w-0 gap-5 pb-20 sm:pb-0 ${activeTab === "dashboard" || activeTab === "adult-dashboard" || activeTab === "sports" || activeTab === "coaches" || activeTab === "referees" || activeTab === "uniforms" || activeTab === "debts" || activeTab === "sales-estimate" || activeTab === "income-statement" || activeTab === "daily-operation" || activeTab === "expenses" || activeTab === "students" || activeTab === "invoices" || activeTab === "historical" || activeTab === "discrepancies" ? "grid-cols-1" : "lg:grid-cols-[360px_1fr]"}`}>
          {activeTab === "dashboard" && <DashboardPanel data={data} />}
          {activeTab === "adult-dashboard" && (
            <AdultLeagueDashboardPanel
              data={data}
              onCreateSession={(payload) => createAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
              onMarkPlayer={markAdultPlayer}
              onCreatePayment={(payload) => createRecord("/payments/", payload, "Pago adulto registrado.")}
              onPaymentAction={(paymentId, action) => postAction(`/payments/${paymentId}/${action}/`, "Pago actualizado.")}
            />
          )}
          {activeTab === "sports" && (
            <SportsPanel
              data={data}
              canEditMatches
              canEditAssessments
              onUpdateMatch={updateMatchScore}
              onSaveAssessment={saveStudentAssessment}
            />
          )}
          {activeTab === "coaches" && <CoachesConsolidatedPanel data={data} />}
          {activeTab === "referees" && <RefereesConsolidatedPanel data={data} />}
          {activeTab === "uniforms" && <UniformsPanel data={data} />}
          {activeTab === "sales-estimate" && <SalesEstimationPanel data={data} />}
          {activeTab === "income-statement" && <IncomeStatementPanel data={data} />}
          {activeTab === "daily-operation" && <DailyOperationPanel data={data} />}
          {activeTab === "debts" && <DebtsPanel data={data} />}
          {activeTab === "attendance" && (
            <AttendancePanel
              data={data}
              onCreateSession={(payload) => createAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
              onMark={(payload) => createAndReturn<AttendanceRecord>("/attendance-records/", payload)}
              onClose={closeAttendanceSession}
              onFaceAttendance={(payload) => createAndReturn<FaceRecognitionResponse>("/face-attendance/recognize/", payload)}
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
              onCreateInvoice={(payload) => createRecord("/invoices/simulate/", payload, "Factura simulada generada.")}
              onCreateStaffPayment={(payload) => createRecord("/staff-payment-requests/", payload, "Solicitud de pago enviada.")}
              onAcceptStaffPayment={(requestId) => postAction(`/staff-payment-requests/${requestId}/accept/`, "Pago aceptado.")}
              onRejectStaffPayment={(requestId) => postAction(`/staff-payment-requests/${requestId}/reject/`, "Pago rechazado.")}
              onCreateCashMovement={(payload) => createRecord("/cash-movements/", payload, "Movimiento de caja registrado.")}
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
          {activeTab === "invoices" && (
            <InvoicesPanel invoices={data.invoices} onDownloadFile={downloadFile} />
          )}
          {activeTab === "historical" && (
            <HistoricalImportsPanel
              data={data}
              onUpload={uploadHistoricalImport}
              onCommit={commitHistoricalImport}
            />
          )}
          {activeTab === "discrepancies" && isAdmin && (
            <HistoricalDiscrepanciesPanel report={data.historicalDiscrepancies} sites={data.sites} />
          )}
        </section>
      </div>
        </div>
      </div>
    </main>
  );
}

