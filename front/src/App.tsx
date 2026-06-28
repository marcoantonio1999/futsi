import { lazy, Suspense } from "react";
import { LogOut, RefreshCw } from "lucide-react";
import { roleLabels } from "./appState";
import {
  AccountingPortal,
  AdultLeagueDashboardPanel,
  GuardianPortal,
  ThemeToggle,
} from "./components/FutsiViews";
import { AdminShell } from "./components/layout/AdminShell";
import { AppSkeleton } from "./components/loading/AppSkeleton";
import { useFutsiData } from "./hooks/useFutsiData";
import { useThemeMode } from "./hooks/useThemeMode";
import type { AttendanceRecord, AttendanceSession, FaceRecognitionResponse } from "./types";

const FutsiLanding = lazy(() => import("./components/landing/FutsiLanding").then((module) => ({ default: module.FutsiLanding })));

export default function App() {
  const { theme, toggleTheme } = useThemeMode();
  const {
    token,
    currentUser,
    data,
    loading,
    sectionLoading,
    loadedSections,
    hasLoadedData,
    message,
    error,
    actionLoadingMessage,
    loadData,
    loadSection,
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

  if (token && loading && !hasLoadedData && !error) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <AppSkeleton />
      </>
    );
  }

  if (!token || !currentUser) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <Suspense fallback={<LandingFallback />}>
          <FutsiLanding onLogin={handleLogin} />
        </Suspense>
      </>
    );
  }

  const hasCustomSectionPermissions = Boolean(currentUser.section_permissions?.length);

  if (currentUser.role === "guardian") {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <ActionLoadingOverlay message={actionLoadingMessage} />
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
        <ActionLoadingOverlay message={actionLoadingMessage} />
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

  if (currentUser.role === "accounting" && !hasCustomSectionPermissions) {
    return (
      <>
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <ActionLoadingOverlay message={actionLoadingMessage} />
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
    <>
      <ActionLoadingOverlay message={actionLoadingMessage} />
      <AdminShell
        token={token}
        user={currentUser}
        data={data}
        theme={theme}
        loading={loading}
        sectionLoading={sectionLoading}
        loadedSections={loadedSections}
        message={message}
        error={error}
        onToggleTheme={toggleTheme}
        onLoadSection={loadSection}
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
    </>
  );
}

function LandingFallback() {
  return (
    <main className="grid min-h-screen place-items-center bg-zinc-950 px-4 text-white">
      <div className="size-10 animate-spin rounded-full border-4 border-emerald-100/20 border-t-emerald-300" />
    </main>
  );
}

function ActionLoadingOverlay({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="fixed inset-0 z-[1300] grid place-items-center bg-zinc-950/25 px-4 backdrop-blur-[1px]">
      <div className="grid min-w-[240px] place-items-center rounded-md border border-zinc-200 bg-white px-6 py-5 text-center shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="size-9 animate-spin rounded-full border-4 border-zinc-200 border-t-emerald-700" />
        <p className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{message}</p>
      </div>
    </div>
  );
}
