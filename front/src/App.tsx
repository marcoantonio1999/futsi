import { LogOut, RefreshCw } from "lucide-react";
import { roleLabels } from "./appState";
import {
  AccountingPortal,
  AdultLeagueDashboardPanel,
  CoachPortal,
  GuardianPortal,
  LoginScreen,
  ThemeToggle,
} from "./components/FutsiViews";
import { AdminShell } from "./components/layout/AdminShell";
import { useFutsiData } from "./hooks/useFutsiData";
import { useThemeMode } from "./hooks/useThemeMode";
import type { AttendanceRecord, AttendanceSession, FaceRecognitionResponse } from "./types";

export default function App() {
  const { theme, toggleTheme } = useThemeMode();
  const {
    token,
    currentUser,
    data,
    loading,
    message,
    error,
    loadData,
    handleLogin,
    logout,
    createRecord,
    updateRecord,
    createAndReturn,
    uploadHistoricalImport,
    commitHistoricalImport,
    closeAttendanceSession,
    postAction,
    updateProfile,
    updateMatchScore,
    saveStudentAssessment,
    markAdultPlayer,
    downloadFile,
  } = useFutsiData();

  if (!token || !currentUser) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <LoginScreen onLogin={handleLogin} />
      </>
    );
  }

  const hasCustomSectionPermissions = Boolean(currentUser.section_permissions?.length);

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

  if (currentUser.role === "coach" && !hasCustomSectionPermissions) {
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

  if (currentUser.role === "accounting" && !hasCustomSectionPermissions) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <AccountingPortal
          user={currentUser}
          data={data}
          onRefresh={() => loadData()}
          onLogout={logout}
          onDownloadAccounting={() => downloadFile("/reports/accounting.xlsx", "reporte-contable-futsi.xlsx")}
          onCreateInvoice={(payload) => createRecord("/invoices/simulate/", payload, "Factura simulada generada.")}
          onDownloadFile={downloadFile}
          onUploadHistoricalImport={uploadHistoricalImport}
          onCommitHistoricalImport={commitHistoricalImport}
          onUpdateMatch={updateMatchScore}
        />
      </>
    );
  }

  return (
    <AdminShell
      user={currentUser}
      data={data}
      theme={theme}
      loading={loading}
      message={message}
      error={error}
      onToggleTheme={toggleTheme}
      onRefresh={() => loadData()}
      onLogout={logout}
      onCreateRecord={createRecord}
      onUpdateRecord={updateRecord}
      onCreateAndReturn={createAndReturn}
      onUploadHistoricalImport={uploadHistoricalImport}
      onCommitHistoricalImport={commitHistoricalImport}
      onCloseAttendanceSession={closeAttendanceSession}
      onPostAction={postAction}
      onDownloadFile={downloadFile}
      onUpdateMatchScore={updateMatchScore}
      onSaveStudentAssessment={saveStudentAssessment}
      onMarkAdultPlayer={markAdultPlayer}
    />
  );
}
