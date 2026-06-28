import { RefreshSkeletonBar, SectionSkeleton } from "../loading/AppSkeleton";
import type {
  AppData,
  AttendanceRecord,
  AttendanceSession,
  FaceRecognitionResponse,
  TabKey,
  User,
} from "../../types";
import { fullWidthTabs } from "./adminNavigation";
import type { AttendanceSubsection, BusinessScope } from "./adminShellModel";
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
  TournamentsPanel,
  UniformsPanel,
  UsersPanel,
  UnknownAttendanceDetailPanel,
  UnknownAttendancePanel,
  VideoOccupancyPanel,
} from "../FutsiViews";

type AdminShellContentProps = {
  token: string;
  user: User;
  data: AppData;
  scopedData: AppData;
  businessScope: BusinessScope;
  isAdmin: boolean;
  effectiveActiveTab: TabKey;
  loading: boolean;
  sectionLoading: TabKey | null;
  isFirstSectionLoad: boolean;
  message: string;
  error: string;
  attendanceSubsection: AttendanceSubsection;
  unknownDetailDate: string;
  unknownDetailReport: unknown;
  onSelectAttendanceSubsection: (section: AttendanceSubsection) => void;
  onOpenUnknownDetail: (date: string, report: unknown) => void;
  onCloseUnknownDetail: () => void;
  onRefreshActiveSection: () => void;
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

export function AdminShellContent(props: AdminShellContentProps) {
  const { effectiveActiveTab, isFirstSectionLoad, loading, sectionLoading, message, error } = props;

  return (
    <div className="px-1 py-5">
      {message && <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {(loading || (sectionLoading === effectiveActiveTab && !isFirstSectionLoad)) && <RefreshSkeletonBar />}
      <section className={`${effectiveActiveTab !== "dashboard" && effectiveActiveTab !== "adult-dashboard" ? "mt-6" : "mt-0"} grid min-w-0 gap-5 pb-20 sm:pb-0 ${fullWidthTabs.has(effectiveActiveTab) ? "grid-cols-1" : "lg:grid-cols-[360px_1fr]"}`}>
        {isFirstSectionLoad ? <SectionSkeleton /> : <ActivePanel {...props} />}
      </section>
    </div>
  );
}

function ActivePanel(props: AdminShellContentProps) {
  const {
    token,
    user,
    data,
    scopedData,
    businessScope,
    isAdmin,
    effectiveActiveTab,
    attendanceSubsection,
    unknownDetailDate,
    unknownDetailReport,
    onSelectAttendanceSubsection,
    onOpenUnknownDetail,
    onCloseUnknownDetail,
    onRefreshActiveSection,
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
  } = props;

  return (
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
      {effectiveActiveTab === "sports" && <SportsPanel data={scopedData} canEditMatches canEditAssessments onUpdateMatch={onUpdateMatchScore} onSaveAssessment={onSaveStudentAssessment} />}
      {effectiveActiveTab === "tournaments" && (
        <TournamentsPanel
          data={scopedData}
          user={user}
          readOnly={user.role === "coach"}
          onCreateTournament={(payload) => onCreateAndReturn("/tournaments/", payload)}
          onCreateTeam={(payload) => onCreateAndReturn("/teams/", payload)}
          onRegisterStudent={(payload) => onCreateAndReturn("/student-tournament-registrations/", payload)}
          onCreateMatch={(payload) => onCreateAndReturn("/matches/", payload)}
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
        <AttendanceContent
          token={token}
          user={user}
          data={data}
          scopedData={scopedData}
          businessScope={businessScope}
          attendanceSubsection={attendanceSubsection}
          unknownDetailDate={unknownDetailDate}
          unknownDetailReport={unknownDetailReport}
          onSelectAttendanceSubsection={onSelectAttendanceSubsection}
          onOpenUnknownDetail={onOpenUnknownDetail}
          onCloseUnknownDetail={onCloseUnknownDetail}
          onRefreshActiveSection={onRefreshActiveSection}
          onCreateRecord={onCreateRecord}
          onCreateAndReturn={onCreateAndReturn}
          onCloseAttendanceSession={onCloseAttendanceSession}
          onPostAction={onPostAction}
          onMarkAdultPlayer={onMarkAdultPlayer}
        />
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
          <BillingCollectionPanel data={scopedData} compact onCreatePayment={(payload) => onCreateRecord("/payments/", payload, "Solicitud de pago creada.")} onCreateDiscount={(payload) => onCreateRecord("/discounts/", payload, "Descuento registrado.")} discountActionLabel="Solicitar descuento" />
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
      {effectiveActiveTab === "students" && <StudentsPanel data={scopedData} onCreate={(payload) => onCreateRecord("/students/", payload, "Alumno creado.")} onUpdate={(studentId, payload) => onUpdateRecord(`/students/${studentId}/`, payload, "Alumno actualizado.")} />}
      {effectiveActiveTab === "guardians" && <GuardiansPanel guardians={scopedData.guardians} onCreate={(payload) => onCreateRecord("/guardians/", payload, "Representante creado.")} />}
      {effectiveActiveTab === "sites" && <SitesPanel sites={data.sites} onCreate={(payload) => onCreateRecord("/sites/", payload, "Sede creada.")} />}
      {effectiveActiveTab === "users" && isAdmin && <UsersPanel data={scopedData} onCreate={(payload) => onCreateRecord("/users/", payload, "Usuario creado.")} onUpdate={(userId, payload) => onUpdateRecord(`/users/${userId}/`, payload, "Permisos actualizados.")} />}
      {effectiveActiveTab === "invoices" && <InvoicesPanel data={scopedData} onCreateInvoice={(payload) => onCreateRecord("/invoices/simulate/", payload, "Factura simulada generada.")} onDownloadFile={onDownloadFile} />}
      {effectiveActiveTab === "historical" && <HistoricalImportsPanel data={scopedData} onUpload={onUploadHistoricalImport} onCommit={onCommitHistoricalImport} />}
      {effectiveActiveTab === "discrepancies" && isAdmin && <HistoricalDiscrepanciesPanel report={scopedData.historicalDiscrepancies} sites={scopedData.sites} />}
    </>
  );
}

type AttendanceContentProps = Pick<
  AdminShellContentProps,
  | "token"
  | "user"
  | "data"
  | "scopedData"
  | "businessScope"
  | "attendanceSubsection"
  | "unknownDetailDate"
  | "unknownDetailReport"
  | "onSelectAttendanceSubsection"
  | "onOpenUnknownDetail"
  | "onCloseUnknownDetail"
  | "onRefreshActiveSection"
  | "onCreateRecord"
  | "onCreateAndReturn"
  | "onCloseAttendanceSession"
  | "onPostAction"
  | "onMarkAdultPlayer"
>;

function AttendanceContent({
  token,
  user,
  data,
  scopedData,
  businessScope,
  attendanceSubsection,
  unknownDetailDate,
  unknownDetailReport,
  onSelectAttendanceSubsection,
  onOpenUnknownDetail,
  onCloseUnknownDetail,
  onRefreshActiveSection,
  onCreateRecord,
  onCreateAndReturn,
  onCloseAttendanceSession,
  onPostAction,
  onMarkAdultPlayer,
}: AttendanceContentProps) {
  const items: Array<{ key: AttendanceSubsection; label: string }> = [
    { key: "report", label: "Reporte automatico" },
    { key: "automatic", label: "Pase automatico" },
    { key: "unknown", label: "Desconocidos" },
    ...(attendanceSubsection === "unknown-detail" ? [{ key: "unknown-detail" as const, label: "Detalle desconocidos" }] : []),
    ...(businessScope === "adult" ? [] : [{ key: "occupancy" as const, label: "Aforo en video" }]),
    { key: "manual", label: businessScope === "adult" ? "Pase adultos" : "Pase manual" },
  ];

  return (
    <div className="grid gap-5">
      <div className="rounded-md border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          {items.map((item) => (
            <button
              key={item.key}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition ${attendanceSubsection === item.key ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950" : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"}`}
              onClick={() => onSelectAttendanceSubsection(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {attendanceSubsection === "manual" && (
        businessScope === "adult" ? (
          <AdultLeagueDashboardPanel
            data={scopedData}
            onCreateSession={(payload) => onCreateAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
            onMarkPlayer={onMarkAdultPlayer}
            onCreatePayment={(payload) => onCreateRecord("/payments/", payload, "Pago adulto registrado.")}
            onPaymentAction={(paymentId, action) => onPostAction(`/payments/${paymentId}/${action}/`, "Pago actualizado.")}
          />
        ) : (
          <AttendancePanel
            data={scopedData}
            user={user}
            onCreateSession={(payload) => onCreateAndReturn<AttendanceSession>("/attendance-sessions/", payload)}
            onMark={(payload) => onCreateAndReturn<AttendanceRecord>("/attendance-records/", payload)}
            onClose={onCloseAttendanceSession}
            onFaceAttendance={(payload) => onCreateAndReturn<FaceRecognitionResponse>("/face-attendance/recognize/", payload)}
          />
        )
      )}
      {attendanceSubsection === "automatic" && <AutomaticAttendancePanel token={token} data={scopedData} onRefreshData={onRefreshActiveSection} mode="process" />}
      {attendanceSubsection === "report" && <AutomaticAttendancePanel token={token} data={scopedData} onRefreshData={onRefreshActiveSection} mode="report" />}
      {attendanceSubsection === "unknown" && <UnknownAttendancePanel token={token} data={data} onOpenDetail={onOpenUnknownDetail} />}
      {attendanceSubsection === "unknown-detail" && unknownDetailDate && (
        <UnknownAttendanceDetailPanel token={token} data={data} date={unknownDetailDate} initialReport={unknownDetailReport} onBack={onCloseUnknownDetail} />
      )}
      {attendanceSubsection === "occupancy" && <VideoOccupancyPanel token={token} data={scopedData} />}
    </div>
  );
}
