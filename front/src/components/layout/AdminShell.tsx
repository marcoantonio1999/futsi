import React, { useEffect, useRef, useState } from "react";
import {
  LogOut,
  Menu,
  RefreshCw,
  X,
} from "lucide-react";
import { roleLabels } from "../../appState";
import { RefreshSkeletonBar, SectionSkeleton } from "../loading/AppSkeleton";
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
  AutomaticAttendancePanel,
  AttendancePanel,
  BillingPanel,
  BillingCollectionPanel,
  CalendarPanel,
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
  VideoOccupancyPanel,
} from "../FutsiViews";

type AttendanceSubsection = "manual" | "automatic" | "report" | "occupancy";
type BusinessScope = "academy" | "adult";

const adultHiddenTabs = new Set<TabKey>(["adult-dashboard", "attendance", "coaches", "guardians", "students", "uniforms"]);

function adultLeagueData(data: AppData): AppData {
  const adultTeamIds = new Set(data.teams.map((team) => team.id));
  const adultTournamentIds = new Set(data.teams.map((team) => team.tournament));
  const adultChargeIds = new Set(data.charges.filter((charge) => charge.team && adultTeamIds.has(charge.team)).map((charge) => charge.id));
  const adultPaymentIds = new Set(data.payments.filter((payment) => payment.charge && adultChargeIds.has(payment.charge)).map((payment) => payment.id));
  const adultSessionIds = new Set(data.attendanceSessions.filter((session) => session.team && adultTeamIds.has(session.team)).map((session) => session.id));
  const adultStaffPaymentIds = new Set(data.staffPaymentRequests.filter((request) => request.kind === "referee_payroll").map((request) => request.id));

  return {
    ...data,
    users: data.users.filter((item) => item.role === "adult_player" || item.role === "adult_representative"),
    guardians: [],
    students: [],
    attendanceSessions: data.attendanceSessions.filter((session) => adultSessionIds.has(session.id)),
    attendanceRecords: [],
    charges: data.charges.filter((charge) => adultChargeIds.has(charge.id)),
    payments: data.payments.filter((payment) => adultPaymentIds.has(payment.id)),
    discounts: data.discounts.filter((discount) => Boolean(discount.charge && adultChargeIds.has(discount.charge))),
    expenses: data.expenses.filter((expense) => {
      const category = expense.category.toLowerCase();
      const description = expense.description.toLowerCase();
      return category.includes("arbit") || description.includes("arbit") || category.includes("referee") || description.includes("referee");
    }),
    staffPaymentRequests: data.staffPaymentRequests.filter((request) => adultStaffPaymentIds.has(request.id)),
    cashMovements: data.cashMovements.filter((movement) => Boolean(movement.staff_payment_request && adultStaffPaymentIds.has(movement.staff_payment_request))),
    coachWorkLogs: [],
    tournaments: data.tournaments.filter((tournament) => adultTournamentIds.has(tournament.id)),
    teams: data.teams.filter((team) => adultTeamIds.has(team.id)),
    studentTournamentRegistrations: [],
    players: data.players.filter((player) => adultTeamIds.has(player.team)),
    matches: data.matches.filter((match) => adultTournamentIds.has(match.tournament)),
    standings: data.standings.filter((row) => adultTournamentIds.has(row.tournament)),
    playerAttendanceRecords: data.playerAttendanceRecords.filter((record) => adultSessionIds.has(record.session)),
    studentAssessments: [],
    studentValueAssessments: [],
    invoices: data.invoices.filter((invoice) => {
      if (invoice.charge && adultChargeIds.has(invoice.charge)) return true;
      if (invoice.payment && adultPaymentIds.has(invoice.payment)) return true;
      return false;
    }),
  };
}

type AdminShellProps = {
  token: string;
  user: User;
  data: AppData;
  theme: ThemeMode;
  loading: boolean;
  sectionLoading: TabKey | null;
  loadedSections: TabKey[];
  message: string;
  error: string;
  onToggleTheme: () => void;
  onLoadSection: (section: TabKey, options?: { force?: boolean; silent?: boolean }) => Promise<void>;
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
  onMarkAdultPlayer: (payload: unknown) => Promise<void>;
};

export function AdminShell({
  token,
  user,
  data,
  theme,
  loading,
  sectionLoading,
  loadedSections,
  message,
  error,
  onToggleTheme,
  onLoadSection,
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
  onMarkAdultPlayer,
}: AdminShellProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(() => (user.role === "cashier" ? "billing" : "dashboard"));
  const [attendanceSubsection, setAttendanceSubsection] = useState<AttendanceSubsection>("manual");
  const [businessScope, setBusinessScope] = useState<BusinessScope>("academy");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileSwipeStartX = useRef<number | null>(null);
  const isAdmin = user.role === "admin" || user.role === "owner" || user.role === "dev";
  const tabs = tabItems();
  const allowedSections = new Set<TabKey>([
    ...(defaultSectionsByRole(tabs)[user.role] || ["dashboard"]),
    ...((user.section_permissions || []) as TabKey[]),
  ]);
  const visibleTabs = tabs.filter((tab) => isAdmin || allowedSections.has(tab.key));
  const sidebarTabs = visibleTabs.filter((tab) => tab.key !== "adult-dashboard" && (businessScope === "academy" || !adultHiddenTabs.has(tab.key)));
  const activeTabMeta = visibleTabs.find((tab) => tab.key === activeTab);
  const effectiveActiveTab = activeTabMeta ? activeTab : visibleTabs[0]?.key ?? "dashboard";
  const effectiveActiveTabMeta = visibleTabs.find((tab) => tab.key === effectiveActiveTab);
  const scopedData = businessScope === "adult" ? adultLeagueData(data) : data;
  const canSeeAdultDashboard = visibleTabs.some((tab) => tab.key === "adult-dashboard");
  const canToggleAdultDashboard = canSeeAdultDashboard && user.role !== "adult_representative" && user.role !== "adult_player";
  const isFirstSectionLoad = sectionLoading === effectiveActiveTab && !loadedSections.includes(effectiveActiveTab);

  useEffect(() => {
    onLoadSection(effectiveActiveTab);
  }, [effectiveActiveTab, user.id]);

  function refreshActiveSection() {
    void onLoadSection(effectiveActiveTab, { force: true });
  }

  useEffect(() => {
    if (user.role === "adult_representative" || user.role === "adult_player") {
      setActiveTab("adult-dashboard");
      setBusinessScope("adult");
      return;
    }
    setActiveTab(user.role === "cashier" ? "billing" : "dashboard");
    setBusinessScope("academy");
  }, [user.id, user.role]);

  function selectTab(tab: TabKey) {
    if (tab === "adult-dashboard") setBusinessScope("adult");
    if (tab === "dashboard") setBusinessScope("academy");
    setActiveTab(tab);
  }

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
              {sidebarTabs.map((tab) => (
                <button
                  key={tab.key}
                  data-testid={`menu-tab-${tab.key}`}
                  className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium ${
                    effectiveActiveTab === tab.key ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-50"
                  }`}
                  onClick={() => {
                    selectTab(tab.key);
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
                onClick={() => selectTab(tab.key)}
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
                onClick={() => selectTab(tab.key)}
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
            <button className="mt-3 w-full rounded-md bg-emerald-600 px-3 py-2 text-xs font-semibold" onClick={refreshActiveSection} type="button">
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
                {canToggleAdultDashboard && (
                  <button
                    className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                      businessScope === "adult"
                        ? "border-blue-700 bg-blue-700 text-white"
                        : "border-blue-700 bg-white text-blue-800 hover:bg-blue-50 dark:bg-zinc-950 dark:text-white dark:hover:bg-zinc-900"
                    }`}
                    onClick={() => {
                      if (businessScope === "adult") {
                        setBusinessScope("academy");
                        setActiveTab("dashboard");
                        return;
                      }
                      setBusinessScope("adult");
                      setActiveTab("adult-dashboard");
                    }}
                    type="button"
                  >
                    {businessScope === "adult" ? "Academia" : "Liga adultos"}
                  </button>
                )}
                <button className="grid size-10 place-items-center rounded-md border border-zinc-200 bg-white hover:bg-zinc-50" onClick={refreshActiveSection} title="Actualizar" type="button">
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
            {(loading || (sectionLoading === effectiveActiveTab && !isFirstSectionLoad)) && <RefreshSkeletonBar />}

            <section className={`${effectiveActiveTab !== "dashboard" && effectiveActiveTab !== "adult-dashboard" ? "mt-6" : "mt-0"} grid min-w-0 gap-5 pb-20 sm:pb-0 ${fullWidthTabs.has(effectiveActiveTab) ? "grid-cols-1" : "lg:grid-cols-[360px_1fr]"}`}>
              {isFirstSectionLoad ? (
                <SectionSkeleton />
              ) : (
                <>
              {effectiveActiveTab === "dashboard" && (
                user.role === "coach" ? (
                  <CoachDashboardPanel
                    user={user}
                    data={data}
                    onCreateWorkLog={(payload) => onCreateRecord("/coach-work-logs/", payload, "Horas registradas.")}
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
                  data={scopedData}
                  collectionOnly={user.role === "cashier"}
                  onCreateSession={(payload) => onCreateAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
                  onMarkPlayer={onMarkAdultPlayer}
                  onCreatePayment={(payload) => onCreateRecord("/payments/", payload, "Pago adulto registrado.")}
                  onPaymentAction={(paymentId, action) => onPostAction(`/payments/${paymentId}/${action}/`, "Pago actualizado.")}
                />
              )}
              {effectiveActiveTab === "calendar" && <CalendarPanel data={scopedData} />}
              {effectiveActiveTab === "sports" && (
                <SportsPanel data={scopedData} canEditMatches canEditAssessments onUpdateMatch={onUpdateMatchScore} onSaveAssessment={onSaveStudentAssessment} />
              )}
              {effectiveActiveTab === "tournaments" && (
                <TournamentsPanel
                  data={scopedData}
                  user={user}
                  readOnly={user.role === "coach"}
                  onCreateTournament={(payload) => onCreateRecord("/tournaments/", payload, "Torneo creado.")}
                  onCreateTeam={(payload) => onCreateRecord("/teams/", payload, "Equipo creado.")}
                  onRegisterStudent={(payload) => onCreateRecord("/student-tournament-registrations/", payload, "Alumno inscrito al torneo.")}
                  onCreateMatch={(payload) => onCreateRecord("/matches/", payload, "Partido creado.")}
                  onUpdateMatch={onUpdateMatchScore}
                />
              )}
              {effectiveActiveTab === "coaches" && <CoachesConsolidatedPanel data={scopedData} />}
              {effectiveActiveTab === "referees" && <RefereesConsolidatedPanel data={scopedData} />}
              {effectiveActiveTab === "uniforms" && <UniformsPanel data={scopedData} />}
              {effectiveActiveTab === "sales-estimate" && <SalesEstimationPanel data={scopedData} />}
              {effectiveActiveTab === "income-statement" && <IncomeStatementPanel data={scopedData} />}
              {effectiveActiveTab === "daily-operation" && <DailyOperationPanel data={scopedData} />}
              {effectiveActiveTab === "debts" && <DebtsPanel data={scopedData} />}
              {effectiveActiveTab === "attendance" && (
                <div className="grid gap-5">
                  <div className="rounded-md border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      {[
                        { key: "manual", label: "Pase manual" },
                        { key: "automatic", label: "Pase automatico" },
                        { key: "report", label: "Reporte automatico" },
                        { key: "occupancy", label: "Aforo en video" },
                      ].map((item) => (
                        <button
                          key={item.key}
                          className={`rounded-md px-3 py-2 text-sm font-semibold transition ${attendanceSubsection === item.key ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950" : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"}`}
                          onClick={() => setAttendanceSubsection(item.key as AttendanceSubsection)}
                          type="button"
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {attendanceSubsection === "manual" && (
                    <AttendancePanel
                      data={scopedData}
                      user={user}
                      onCreateSession={(payload) => onCreateAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
                      onMark={(payload) => onCreateAndReturn<AttendanceRecord>("/attendance-records/", payload)}
                      onClose={onCloseAttendanceSession}
                      onFaceAttendance={(payload) => onCreateAndReturn<FaceRecognitionResponse>("/face-attendance/recognize/", payload)}
                    />
                  )}
                  {attendanceSubsection === "automatic" && <AutomaticAttendancePanel token={token} data={scopedData} onRefreshData={refreshActiveSection} mode="process" />}
                  {attendanceSubsection === "report" && <AutomaticAttendancePanel token={token} data={scopedData} onRefreshData={refreshActiveSection} mode="report" />}
                  {attendanceSubsection === "occupancy" && <VideoOccupancyPanel token={token} data={scopedData} />}
                </div>
              )}
              {effectiveActiveTab === "billing" && (
                businessScope === "adult" ? (
                  <AdultLeagueDashboardPanel
                    data={scopedData}
                    collectionOnly
                    onCreateSession={(payload) => onCreateAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
                    onMarkPlayer={onMarkAdultPlayer}
                    onCreatePayment={(payload) => onCreateRecord("/payments/", payload, "Pago adulto registrado.")}
                    onPaymentAction={(paymentId, action) => onPostAction(`/payments/${paymentId}/${action}/`, "Pago actualizado.")}
                  />
                ) : user.role === "cashier" ? (
                  <BillingCollectionPanel
                    data={scopedData}
                    compact
                    onCreatePayment={(payload) => onCreateRecord("/payments/", payload, "Solicitud de pago creada.")}
                    onCreateDiscount={(payload) => onCreateRecord("/discounts/", payload, "Descuento registrado.")}
                    discountActionLabel="Solicitar descuento"
                  />
                ) : (
                  <BillingPanel
                    data={scopedData}
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
                  data={scopedData}
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
                  data={scopedData}
                  onCreate={(payload) => onCreateRecord("/students/", payload, "Alumno creado.")}
                  onUpdate={(studentId, payload) => onUpdateRecord(`/students/${studentId}/`, payload, "Alumno actualizado.")}
                />
              )}
              {effectiveActiveTab === "guardians" && <GuardiansPanel guardians={scopedData.guardians} onCreate={(payload) => onCreateRecord("/guardians/", payload, "Representante creado.")} />}
              {effectiveActiveTab === "sites" && <SitesPanel sites={data.sites} onCreate={(payload) => onCreateRecord("/sites/", payload, "Sede creada.")} />}
              {effectiveActiveTab === "users" && isAdmin && (
                <UsersPanel
                  data={scopedData}
                  onCreate={(payload) => onCreateRecord("/users/", payload, "Usuario creado.")}
                  onUpdate={(userId, payload) => onUpdateRecord(`/users/${userId}/`, payload, "Permisos actualizados.")}
                />
              )}
              {effectiveActiveTab === "invoices" && <InvoicesPanel invoices={scopedData.invoices} onDownloadFile={onDownloadFile} />}
              {effectiveActiveTab === "historical" && <HistoricalImportsPanel data={scopedData} onUpload={onUploadHistoricalImport} onCommit={onCommitHistoricalImport} />}
              {effectiveActiveTab === "discrepancies" && isAdmin && <HistoricalDiscrepanciesPanel report={scopedData.historicalDiscrepancies} sites={scopedData.sites} />}
                </>
              )}
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
