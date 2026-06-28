import React, { useEffect, useRef, useState } from "react";
import type { AppData, TabKey, ThemeMode, User } from "../../types";
import { defaultSectionsByRole, tabItems } from "./adminNavigation";
import { AdminShellContent } from "./AdminShellContent";
import { AdminShellHeader } from "./AdminShellHeader";
import { AdminShellMobileMenu } from "./AdminShellMobileMenu";
import { AdminShellSidebar } from "./AdminShellSidebar";
import {
  academyDefaultTab,
  academyMenuTabs,
  adultDefaultTab,
  adultLeagueData,
  adultMenuTabs,
  adultTabLabels,
  desktopSidebarAutoCollapseMs,
  desktopSidebarNearPx,
  desktopSidebarOpenEdgePx,
  shellToneForScope,
  type AttendanceSubsection,
  type BusinessScope,
} from "./adminShellModel";
import { ThemeToggle } from "../FutsiViews";

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
  const [attendanceSubsection, setAttendanceSubsection] = useState<AttendanceSubsection>("report");
  const [unknownDetailDate, setUnknownDetailDate] = useState("");
  const [unknownDetailReport, setUnknownDetailReport] = useState<unknown>(null);
  const [businessScope, setBusinessScope] = useState<BusinessScope>("academy");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const mobileSwipeStartX = useRef<number | null>(null);
  const desktopSidebarRef = useRef<HTMLElement | null>(null);
  const desktopSidebarCollapseTimer = useRef<number | null>(null);
  const latestPointerPosition = useRef<{ x: number; y: number } | null>(null);

  const isAdmin = user.role === "admin" || user.role === "owner" || user.role === "dev";
  const tabs = tabItems();
  const allowedSections = new Set<TabKey>([
    ...(defaultSectionsByRole(tabs)[user.role] || ["dashboard"]),
    ...((user.section_permissions || []) as TabKey[]),
  ]);
  const visibleTabs = tabs.filter((tab) => isAdmin || allowedSections.has(tab.key));
  const menuOrder = businessScope === "adult" ? adultMenuTabs : academyMenuTabs;
  const sidebarTabs = menuOrder
    .map((key) => visibleTabs.find((tab) => tab.key === key))
    .filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))
    .map((tab) => ({ ...tab, label: businessScope === "adult" ? adultTabLabels[tab.key] ?? tab.label : tab.label }));
  const activeTabMeta = sidebarTabs.find((tab) => tab.key === activeTab);
  const fallbackTab = sidebarTabs[0]?.key ?? (businessScope === "adult" ? adultDefaultTab : academyDefaultTab);
  const effectiveActiveTab = activeTabMeta ? activeTab : fallbackTab;
  const effectiveActiveTabMeta = sidebarTabs.find((tab) => tab.key === effectiveActiveTab) ?? visibleTabs.find((tab) => tab.key === effectiveActiveTab);
  const scopedData = businessScope === "adult" ? adultLeagueData(data) : data;
  const canSeeAdultDashboard = visibleTabs.some((tab) => tab.key === "adult-dashboard");
  const canToggleAdultDashboard = canSeeAdultDashboard && user.role !== "adult_representative" && user.role !== "adult_player";
  const isFirstSectionLoad = sectionLoading === effectiveActiveTab && !loadedSections.includes(effectiveActiveTab);
  const shellTone = shellToneForScope(businessScope);

  useEffect(() => {
    onLoadSection(effectiveActiveTab);
  }, [effectiveActiveTab, user.id]);

  useEffect(() => {
    if (!sidebarTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(fallbackTab);
    }
  }, [activeTab, fallbackTab, sidebarTabs]);

  useEffect(() => {
    if (user.role === "adult_representative" || user.role === "adult_player") {
      setActiveTab(adultDefaultTab);
      setBusinessScope("adult");
      return;
    }
    setActiveTab(user.role === "cashier" ? "billing" : academyDefaultTab);
    setBusinessScope("academy");
  }, [user.id, user.role]);

  useEffect(() => {
    const updateHeaderState = () => setHeaderScrolled(window.scrollY > 12);
    updateHeaderState();
    window.addEventListener("scroll", updateHeaderState, { passive: true });
    return () => window.removeEventListener("scroll", updateHeaderState);
  }, []);

  useEffect(() => {
    const handleDesktopPointerMove = (event: PointerEvent) => {
      if (!isDesktopSidebarViewport()) return;
      latestPointerPosition.current = { x: event.clientX, y: event.clientY };
      if (event.clientX <= desktopSidebarOpenEdgePx) {
        setSidebarExpanded(true);
        clearDesktopSidebarCollapse();
        return;
      }
      if (!sidebarExpanded) return;
      if (isPointerNearDesktopSidebar(event.clientX, event.clientY)) clearDesktopSidebarCollapse();
      else startDesktopSidebarCollapse();
    };

    window.addEventListener("pointermove", handleDesktopPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handleDesktopPointerMove);
  }, [sidebarExpanded]);

  useEffect(() => {
    if (!sidebarExpanded) {
      clearDesktopSidebarCollapse();
      return;
    }
    const pointer = latestPointerPosition.current;
    if (!pointer || !isPointerNearDesktopSidebar(pointer.x, pointer.y)) startDesktopSidebarCollapse();
  }, [sidebarExpanded]);

  useEffect(() => () => clearDesktopSidebarCollapse(), []);

  function refreshActiveSection() {
    void onLoadSection(effectiveActiveTab, { force: true });
  }

  function clearDesktopSidebarCollapse() {
    if (desktopSidebarCollapseTimer.current === null) return;
    window.clearTimeout(desktopSidebarCollapseTimer.current);
    desktopSidebarCollapseTimer.current = null;
  }

  function startDesktopSidebarCollapse() {
    if (!sidebarExpanded || desktopSidebarCollapseTimer.current !== null) return;
    desktopSidebarCollapseTimer.current = window.setTimeout(() => {
      setSidebarExpanded(false);
      desktopSidebarCollapseTimer.current = null;
    }, desktopSidebarAutoCollapseMs);
  }

  function isDesktopSidebarViewport() {
    return window.innerWidth >= 1024;
  }

  function isPointerNearDesktopSidebar(x: number, y: number) {
    const rect = desktopSidebarRef.current?.getBoundingClientRect();
    if (!rect) return x <= desktopSidebarOpenEdgePx;
    return x >= rect.left - desktopSidebarNearPx && x <= rect.right + desktopSidebarNearPx && y >= rect.top - desktopSidebarNearPx && y <= rect.bottom + desktopSidebarNearPx;
  }

  function scrollToTop() {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function selectTab(tab: TabKey) {
    setActiveTab(tab);
    scrollToTop();
  }

  function switchBusinessScope(nextScope: BusinessScope) {
    setBusinessScope(nextScope);
    setActiveTab(nextScope === "adult" ? adultDefaultTab : academyDefaultTab);
    setMobileMenuOpen(false);
    scrollToTop();
  }

  function selectAttendanceSubsection(section: AttendanceSubsection) {
    setAttendanceSubsection(section);
    if (section !== "unknown-detail") {
      setUnknownDetailDate("");
      setUnknownDetailReport(null);
    }
    scrollToTop();
  }

  function openUnknownDetail(date: string, report: unknown) {
    setUnknownDetailDate(date);
    setUnknownDetailReport(report);
    setAttendanceSubsection("unknown-detail");
    scrollToTop();
  }

  function closeUnknownDetail() {
    setUnknownDetailDate("");
    setUnknownDetailReport(null);
    setAttendanceSubsection("unknown");
    scrollToTop();
  }

  function handleMobileTouchStart(event: React.TouchEvent<HTMLElement>) {
    mobileSwipeStartX.current = event.touches[0]?.clientX ?? null;
  }

  function handleMobileTouchEnd(event: React.TouchEvent<HTMLElement>) {
    const startX = mobileSwipeStartX.current;
    const endX = event.changedTouches[0]?.clientX ?? null;
    mobileSwipeStartX.current = null;
    if (startX === null || endX === null) return;
    const deltaX = endX - startX;
    if (!mobileMenuOpen && startX > window.innerWidth - 28 && deltaX < -50) setMobileMenuOpen(true);
    if (mobileMenuOpen && deltaX > 50) setMobileMenuOpen(false);
  }

  return (
    <main
      className={`min-h-screen text-zinc-950 ${businessScope === "adult" ? "bg-blue-50/45" : "bg-stone-50"}`}
      onTouchStart={handleMobileTouchStart}
      onTouchEnd={handleMobileTouchEnd}
      data-testid="admin-portal"
    >
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      <AdminShellMobileMenu
        isOpen={mobileMenuOpen}
        sidebarTabs={sidebarTabs}
        effectiveActiveTab={effectiveActiveTab}
        shellTone={shellTone}
        onClose={() => setMobileMenuOpen(false)}
        onLogout={onLogout}
        onSelectTab={(tab) => {
          selectTab(tab);
          setMobileMenuOpen(false);
        }}
      />
      <div className="mx-auto flex min-h-screen max-w-[1540px] gap-5 p-4">
        <AdminShellSidebar
          sidebarRef={desktopSidebarRef}
          sidebarExpanded={sidebarExpanded}
          canToggleAdultDashboard={canToggleAdultDashboard}
          businessScope={businessScope}
          sidebarTabs={sidebarTabs}
          effectiveActiveTab={effectiveActiveTab}
          shellTone={shellTone}
          onToggleExpanded={() => setSidebarExpanded((value) => !value)}
          onSwitchScope={switchBusinessScope}
          onSelectTab={selectTab}
          onRefresh={refreshActiveSection}
          onLogout={onLogout}
          onMouseEnter={clearDesktopSidebarCollapse}
          onMouseLeave={startDesktopSidebarCollapse}
        />
        <div className={`min-w-0 flex-1 pt-[76px] transition-[margin] duration-200 sm:pt-20 lg:pt-0 ${sidebarExpanded ? "lg:ml-[17rem]" : "lg:ml-[5.75rem]"}`}>
          <AdminShellHeader
            user={user}
            businessScope={businessScope}
            canToggleAdultDashboard={canToggleAdultDashboard}
            headerScrolled={headerScrolled}
            effectiveActiveTabMeta={effectiveActiveTabMeta}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onRefresh={refreshActiveSection}
            onSwitchScope={switchBusinessScope}
            onLogout={onLogout}
          />
          <AdminShellContent
            token={token}
            user={user}
            data={data}
            scopedData={scopedData}
            businessScope={businessScope}
            isAdmin={isAdmin}
            effectiveActiveTab={effectiveActiveTab}
            loading={loading}
            sectionLoading={sectionLoading}
            isFirstSectionLoad={isFirstSectionLoad}
            message={message}
            error={error}
            attendanceSubsection={attendanceSubsection}
            unknownDetailDate={unknownDetailDate}
            unknownDetailReport={unknownDetailReport}
            onSelectAttendanceSubsection={selectAttendanceSubsection}
            onOpenUnknownDetail={openUnknownDetail}
            onCloseUnknownDetail={closeUnknownDetail}
            onRefreshActiveSection={refreshActiveSection}
            onCreateRecord={onCreateRecord}
            onUpdateRecord={onUpdateRecord}
            onCreateAndReturn={onCreateAndReturn}
            onUploadHistoricalImport={onUploadHistoricalImport}
            onCommitHistoricalImport={onCommitHistoricalImport}
            onCloseAttendanceSession={onCloseAttendanceSession}
            onPostAction={onPostAction}
            onDownloadFile={onDownloadFile}
            onUpdateMatchScore={onUpdateMatchScore}
            onSaveStudentAssessment={onSaveStudentAssessment}
            onMarkAdultPlayer={onMarkAdultPlayer}
          />
        </div>
      </div>
    </main>
  );
}
