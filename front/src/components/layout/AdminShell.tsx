import React, { useEffect, useRef, useState } from "react";
import {
  LogOut,
  Menu,
  RefreshCw,
  X,
} from "lucide-react";
import { roleLabels } from "../../appState";
import type {
  AppData,
  AttendanceRecord,
  AttendanceSession,
  FaceRecognitionResponse,
  PlayerAttendanceRecord,
  Role,
  TabKey,
  ThemeMode,
  User,
} from "../../types";
import { defaultSectionsByRole, fullWidthTabs, tabItems } from "./adminNavigation";
import {
  AdultLeagueDashboardPanel,
  AttendancePanel,
  BillingPanel,
  BillingCollectionPanel,
  CoachDashboardPanel,
  CoachesConsolidatedPanel,
  DailyOperationPanel,
  DashboardPanel,
  DebtsPanel,
  ExpensesPanel,
  GuardiansPanel,
  HistoricalDiscrepanciesPanel,
  HistoricalImportsPanel,
  IncomeStatementPanel,
  InvoicesPanel,
  RefereesConsolidatedPanel,
  SalesEstimationPanel,
  SitesPanel,
  SportsPanel,
  StudentsPanel,
  ThemeToggle,
  TournamentsPanel,
  UniformsPanel,
  UsersPanel,
  ValuesPanel,
} from "../FutsiViews";

type AdminShellProps = {
  user: User;
  data: AppData;
  theme: ThemeMode;
  loading: boolean;
  message: string;
  error: string;
  onToggleTheme: () => void;
  onRefresh: () => void;
  onLogout: () => void;
  onCreateRecord: (path: string, payload: unknown, success: string) => Promise<void>;
  onUpdateRecord: (path: string, payload: unknown, success: string) => Promise<void>;
  onCreateAndReturn: <T>(path: string, payload: unknown) => Promise<T>;
  onUploadHistoricalImport: (formData: FormData) => Promise<unknown>;
  onCommitHistoricalImport: (importId: number, payload: unknown) => Promise<unknown>;
  onCloseAttendanceSession: (sessionId: number) => Promise<void>;
  onPostAction: (path: string, success: string) => Promise<void>;
  onDownloadFile: (path: string, filename: string) => Promise<void>;
  onUpdateMatchScore: (matchId: number, payload: unknown) => Promise<void>;
  onSaveStudentAssessment: (payload: unknown) => Promise<void>;
  onSaveStudentValueAssessment: (payload: unknown) => Promise<void>;
  onMarkAdultPlayer: (payload: unknown) => Promise<void>;
};

export function AdminShell({
  user,
  data,
  theme,
  loading,
  message,
  error,
  onToggleTheme,
  onRefresh,
  onLogout,
  onCreateRecord,
  onUpdateRecord,
  onCreateAndReturn,
  onUploadHistoricalImport,
  onCommitHistoricalImport,
  onCloseAttendanceSession,
  onPostAction,
  onDownloadFile,
  onUpdateMatchScore,
  onSaveStudentAssessment,
  onSaveStudentValueAssessment,
  onMarkAdultPlayer,
}: AdminShellProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => (user.role === "cashier" ? "billing" : "dashboard"));
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileSwipeStartX = useRef<number | null>(null);
  const isAdmin = user.role === "admin" || user.role === "owner" || user.role === "dev";
  const tabs = tabItems();
  const allowedSections = new Set<TabKey>([
    ...(defaultSectionsByRole(tabs)[user.role] || ["dashboard"]),
    ...((user.section_permissions || []) as TabKey[]),
  ]);
  const visibleTabs = tabs.filter((tab) => isAdmin || allowedSections.has(tab.key));
  const sidebarTabs = visibleTabs.filter((tab) => tab.key !== "adult-dashboard");
  const activeTabMeta = visibleTabs.find((tab) => tab.key === activeTab);
  const effectiveActiveTab = activeTabMeta ? activeTab : visibleTabs[0]?.key ?? "dashboard";
  const effectiveActiveTabMeta = visibleTabs.find((tab) => tab.key === effectiveActiveTab);
  const canSeeAdultDashboard = visibleTabs.some((tab) => tab.key === "adult-dashboard");

  useEffect(() => {
    setActiveTab(user.role === "cashier" ? "billing" : "dashboard");
  }, [user.id, user.role]);

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
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[1001] bg-zinc-950/35 lg:hidden" onClick={() => setMobileMenuOpen(false)}>
          <aside
            className="flex h-dvh max-h-dvh w-[min(86vw,300px)] flex-col overflow-hidden rounded-r-[20px] bg-white p-4 shadow-xl"
            data-testid="section-menu-dropdown"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between">
              <div className="flex items-center gap-2">
                <img className="h-10 w-10 rounded-full object-cover" src="./favicon.png" alt="Futsi" />
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
                    effectiveActiveTab === tab.key ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-50"
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
            <button className="mt-3 flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50" onClick={onLogout} type="button">
              <LogOut size={16} />
              Cerrar sesion
            </button>
          </aside>
        </div>
      )}

      <div className="mx-auto flex min-h-screen max-w-[1540px] gap-5 p-4">
        <aside className="fixed top-4 z-[910] hidden h-[calc(100vh-2rem)] min-h-0 w-64 shrink-0 flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white p-4 shadow-sm lg:left-[max(1rem,calc((100vw-1540px)/2+1rem))] lg:flex">
          <div className="shrink-0 px-2 py-2">
            <img className="h-auto w-44 object-contain" src="./logo-futsi.png" alt="Futsi Mini ERP" />
            <p className="mt-2 text-xs font-medium text-zinc-500">Mini ERP operativo</p>
          </div>
          <nav className="mt-6 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase text-zinc-400">Principal</p>
            {sidebarTabs.slice(0, 10).map((tab) => (
              <button
                key={tab.key}
                data-testid={`menu-tab-${tab.key}`}
                className={`relative flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium ${
                  effectiveActiveTab === tab.key ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-50"
                }`}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                {effectiveActiveTab === tab.key && <span className="absolute -left-4 h-7 w-1 rounded-r-full bg-emerald-700" />}
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
                  effectiveActiveTab === tab.key ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-50"
                }`}
                onClick={() => setActiveTab(tab.key)}
                type="button"
              >
                {effectiveActiveTab === tab.key && <span className="absolute -left-4 h-7 w-1 rounded-r-full bg-emerald-700" />}
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="mt-3 shrink-0 rounded-[18px] bg-zinc-950 p-3 text-white">
            <p className="text-xs text-zinc-300">Modo demo</p>
            <p className="mt-1 text-sm font-semibold">Datos operativos vivos</p>
            <button className="mt-3 w-full rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold" onClick={onRefresh} type="button">
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
                  <div className="flex min-w-0 items-center gap-3">
                    <img className="hidden h-7 w-auto object-contain sm:block" src="./logo-futsi.png" alt="Futsi" />
                    <h1 className="truncate text-xl font-semibold">{effectiveActiveTabMeta?.label || "Operacion base"}</h1>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canSeeAdultDashboard && (
                  <button
                    className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                      effectiveActiveTab === "adult-dashboard"
                        ? "border-blue-700 bg-blue-700 text-white"
                        : "border-blue-700 bg-white text-blue-800 hover:bg-blue-50 dark:bg-zinc-950 dark:text-white dark:hover:bg-zinc-900"
                    }`}
                    onClick={() => setActiveTab(effectiveActiveTab === "adult-dashboard" ? "dashboard" : "adult-dashboard")}
                    type="button"
                  >
                    {effectiveActiveTab === "adult-dashboard" ? "Academia" : "Liga adultos"}
                  </button>
                )}
                <button className="grid size-10 place-items-center rounded-md border border-zinc-200 bg-white hover:bg-zinc-50" onClick={onRefresh} title="Actualizar" type="button">
                  <RefreshCw size={16} />
                </button>
                <div className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 sm:flex">
                  <span className="grid size-8 place-items-center rounded-full bg-rose-400 text-sm font-semibold text-white">{user.username.slice(0, 1).toUpperCase()}</span>
                  <div className="text-sm leading-tight">
                    <p className="font-medium">{user.username}</p>
                    <p className="text-xs text-zinc-500">{roleLabels[user.role]}</p>
                  </div>
                </div>
                <button className="hidden size-10 place-items-center rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 sm:grid" onClick={onLogout} title="Salir" type="button">
                  <LogOut size={16} />
                </button>
              </div>
            </div>
          </header>

          <div className="px-1 py-5">
            {message && <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
            {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {loading && <p className="mt-4 text-sm text-zinc-500">Cargando informacion...</p>}

            <section className={`${effectiveActiveTab !== "dashboard" && effectiveActiveTab !== "adult-dashboard" ? "mt-6" : "mt-0"} grid min-w-0 gap-5 pb-20 sm:pb-0 ${fullWidthTabs.has(effectiveActiveTab) ? "grid-cols-1" : "lg:grid-cols-[360px_1fr]"}`}>
              {effectiveActiveTab === "dashboard" && (
                user.role === "coach" ? (
                  <CoachDashboardPanel
                    user={user}
                    data={data}
                    onCreateWorkLog={(payload) => onCreateRecord("/coach-work-logs/", payload, "Horas registradas.")}
                    onOpenAdults={() => setActiveTab("adult-dashboard")}
                    onAcceptStaffPayment={(requestId) => onPostAction(`/staff-payment-requests/${requestId}/accept/`, "Pago aceptado.")}
                    onRejectStaffPayment={(requestId) => onPostAction(`/staff-payment-requests/${requestId}/reject/`, "Pago rechazado.")}
                    onDownloadFile={onDownloadFile}
                  />
                ) : (
                  <DashboardPanel data={data} />
                )
              )}
              {effectiveActiveTab === "adult-dashboard" && (
                <AdultLeagueDashboardPanel
                  data={data}
                  collectionOnly={user.role === "cashier"}
                  onCreateSession={(payload) => onCreateAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
                  onMarkPlayer={onMarkAdultPlayer}
                  onCreatePayment={(payload) => onCreateRecord("/payments/", payload, "Pago adulto registrado.")}
                  onPaymentAction={(paymentId, action) => onPostAction(`/payments/${paymentId}/${action}/`, "Pago actualizado.")}
                />
              )}
              {effectiveActiveTab === "sports" && (
                <SportsPanel data={data} canEditMatches canEditAssessments onUpdateMatch={onUpdateMatchScore} onSaveAssessment={onSaveStudentAssessment} />
              )}
              {effectiveActiveTab === "values" && <ValuesPanel data={data} onSaveAssessment={onSaveStudentValueAssessment} />}
              {effectiveActiveTab === "tournaments" && (
                <TournamentsPanel
                  data={data}
                  user={user}
                  readOnly={user.role === "coach"}
                  onCreateTournament={(payload) => onCreateRecord("/tournaments/", payload, "Torneo creado.")}
                  onCreateTeam={(payload) => onCreateRecord("/teams/", payload, "Equipo creado.")}
                  onRegisterStudent={(payload) => onCreateRecord("/student-tournament-registrations/", payload, "Alumno inscrito al torneo.")}
                  onCreateMatch={(payload) => onCreateRecord("/matches/", payload, "Partido creado.")}
                  onUpdateMatch={onUpdateMatchScore}
                />
              )}
              {effectiveActiveTab === "coaches" && <CoachesConsolidatedPanel data={data} />}
              {effectiveActiveTab === "referees" && <RefereesConsolidatedPanel data={data} />}
              {effectiveActiveTab === "uniforms" && <UniformsPanel data={data} />}
              {effectiveActiveTab === "sales-estimate" && <SalesEstimationPanel data={data} />}
              {effectiveActiveTab === "income-statement" && <IncomeStatementPanel data={data} />}
              {effectiveActiveTab === "daily-operation" && <DailyOperationPanel data={data} />}
              {effectiveActiveTab === "debts" && <DebtsPanel data={data} />}
              {effectiveActiveTab === "attendance" && (
                <AttendancePanel
                  data={data}
                  user={user}
                  onCreateSession={(payload) => onCreateAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
                  onMark={(payload) => onCreateAndReturn<AttendanceRecord>("/attendance-records/", payload)}
                  onClose={onCloseAttendanceSession}
                  onFaceAttendance={(payload) => onCreateAndReturn<FaceRecognitionResponse>("/face-attendance/recognize/", payload)}
                />
              )}
              {effectiveActiveTab === "billing" && (
                user.role === "cashier" ? (
                  <BillingCollectionPanel
                    data={data}
                    compact
                    onCreatePayment={(payload) => onCreateRecord("/payments/", payload, "Solicitud de pago creada.")}
                    onCreateDiscount={(payload) => onCreateRecord("/discounts/", payload, "Descuento registrado.")}
                    discountActionLabel="Solicitar descuento"
                  />
                ) : (
                  <BillingPanel
                    data={data}
                    onCreateCharge={(payload) => onCreateRecord("/charges/", payload, "Cargo creado.")}
                    onCreatePayment={(payload) => onCreateRecord("/payments/", payload, "Pago registrado.")}
                    onCreateDiscount={(payload) => onCreateRecord("/discounts/", payload, "Descuento solicitado.")}
                    onApproveDiscount={(discountId) => onPostAction(`/discounts/${discountId}/approve/`, "Descuento aprobado.")}
                    onRejectDiscount={(discountId) => onPostAction(`/discounts/${discountId}/reject/`, "Descuento rechazado.")}
                  />
                )
              )}
              {effectiveActiveTab === "expenses" && (
                <ExpensesPanel
                  data={data}
                  onCreateExpense={(payload) => onCreateRecord("/expenses/", payload, "Gasto capturado.")}
                  onApproveExpense={(expenseId) => onPostAction(`/expenses/${expenseId}/approve/`, "Gasto aprobado.")}
                  onRejectExpense={(expenseId) => onPostAction(`/expenses/${expenseId}/reject/`, "Gasto rechazado.")}
                  onCreateInvoice={(payload) => onCreateRecord("/invoices/simulate/", payload, "Factura simulada generada.")}
                  onCreateStaffPayment={(payload) => onCreateRecord("/staff-payment-requests/", payload, "Solicitud de pago enviada.")}
                  onAcceptStaffPayment={(requestId) => onPostAction(`/staff-payment-requests/${requestId}/accept/`, "Pago aceptado.")}
                  onRejectStaffPayment={(requestId) => onPostAction(`/staff-payment-requests/${requestId}/reject/`, "Pago rechazado.")}
                  onCreateCashMovement={(payload) => onCreateRecord("/cash-movements/", payload, "Movimiento de caja registrado.")}
                />
              )}
              {effectiveActiveTab === "students" && (
                <StudentsPanel
                  data={data}
                  onCreate={(payload) => onCreateRecord("/students/", payload, "Alumno creado.")}
                  onUpdate={(studentId, payload) => onUpdateRecord(`/students/${studentId}/`, payload, "Alumno actualizado.")}
                />
              )}
              {effectiveActiveTab === "guardians" && <GuardiansPanel guardians={data.guardians} onCreate={(payload) => onCreateRecord("/guardians/", payload, "Representante creado.")} />}
              {effectiveActiveTab === "sites" && <SitesPanel sites={data.sites} onCreate={(payload) => onCreateRecord("/sites/", payload, "Sede creada.")} />}
              {effectiveActiveTab === "users" && isAdmin && (
                <UsersPanel
                  data={data}
                  onCreate={(payload) => onCreateRecord("/users/", payload, "Usuario creado.")}
                  onUpdate={(userId, payload) => onUpdateRecord(`/users/${userId}/`, payload, "Permisos actualizados.")}
                />
              )}
              {effectiveActiveTab === "invoices" && <InvoicesPanel invoices={data.invoices} onDownloadFile={onDownloadFile} />}
              {effectiveActiveTab === "historical" && <HistoricalImportsPanel data={data} onUpload={onUploadHistoricalImport} onCommit={onCommitHistoricalImport} />}
              {effectiveActiveTab === "discrepancies" && isAdmin && <HistoricalDiscrepanciesPanel report={data.historicalDiscrepancies} sites={data.sites} />}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
