import React, { useEffect, useMemo, useRef, useState } from "react";
import type { TabKey } from "../../types";
import { defaultSectionsByRole, tabItems } from "./adminNavigation";
import { AdminShellContent } from "./AdminShellContent";
import { AdminShellHeader } from "./AdminShellHeader";
import { AdminShellMobileMenu } from "./AdminShellMobileMenu";
import type { AdminShellProps } from "./AdminShellProps";
import { AdminShellSidebar } from "./AdminShellSidebar";
import { UnknownSubjectNotification } from "./UnknownSubjectNotification";
import { useUnknownSubjectAlert } from "./useUnknownSubjectAlert";
import type { TournamentSection } from "../../features/tournaments";
import {
  academyDefaultTab,
  academyData,
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
  type BillingSubsection,
  type BusinessScope,
  type StudentsSubsection,
} from "./adminShellModel";
import { ThemeToggle } from "./ThemeToggle";

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
  const [billingSection, setBillingSection] = useState<BillingSubsection>("scheduled");
  const [studentsSection, setStudentsSection] = useState<StudentsSubsection>("registered");
  const [tournamentSection, setTournamentSection] = useState<TournamentSection>("overview");
  const [unknownDetailDate, setUnknownDetailDate] = useState("");
  const [unknownDetailReport, setUnknownDetailReport] = useState<unknown>(null);
  const [unknownSubjectToRegister, setUnknownSubjectToRegister] = useState("");
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
  const scopedData = useMemo(() => (businessScope === "adult" ? adultLeagueData(data) : academyData(data)), [businessScope, data]);
  const canSeeAdultDashboard = visibleTabs.some((tab) => tab.key === "adult-dashboard");
  const canToggleAdultDashboard = canSeeAdultDashboard && user.role !== "adult_representative" && user.role !== "adult_player";
  const isFirstSectionLoad = sectionLoading === effectiveActiveTab && !loadedSections.includes(effectiveActiveTab);
  const shellTone = shellToneForScope(businessScope);
  const unknownSubjectAlert = useUnknownSubjectAlert(token);
  const showBillingSubsections = businessScope === "academy";
  const canProgramBilling = showBillingSubsections && user.role !== "cashier";

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
    if ((!showBillingSubsections || !canProgramBilling) && billingSection === "program") {
      setBillingSection("scheduled");
    }
  }, [billingSection, canProgramBilling, showBillingSubsections]);

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

  function openDesktopSidebarFromHover() {
    if (!isDesktopSidebarViewport()) return;
    setSidebarExpanded(true);
    clearDesktopSidebarCollapse();
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

  function selectTournamentSection(section: TournamentSection) {
    setTournamentSection(section);
    setActiveTab("tournaments");
    setMobileMenuOpen(false);
    scrollToTop();
  }

  function selectBillingSection(section: BillingSubsection) {
    setBillingSection(section);
    setActiveTab("billing");
    setMobileMenuOpen(false);
    scrollToTop();
  }

  function selectStudentsSection(section: StudentsSubsection) {
    setStudentsSection(section);
    setActiveTab("students");
    setMobileMenuOpen(false);
    scrollToTop();
  }

  function switchBusinessScope(nextScope: BusinessScope) {
    const targetMenuOrder = nextScope === "adult" ? adultMenuTabs : academyMenuTabs;
    const targetDefaultTab = nextScope === "adult" ? adultDefaultTab : academyDefaultTab;
    const canKeepCurrentTab = targetMenuOrder.includes(effectiveActiveTab) && visibleTabs.some((tab) => tab.key === effectiveActiveTab);
    const nextTab = canKeepCurrentTab ? effectiveActiveTab : targetDefaultTab;

    setBusinessScope(nextScope);
    setActiveTab(nextTab);
    if (nextTab === "attendance" && nextScope === "adult" && attendanceSubsection === "occupancy") {
      setAttendanceSubsection("report");
    }
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

  function openUnknownSubjectRegistration(subjectId: string) {
    setUnknownSubjectToRegister(subjectId);
    setActiveTab("unknowns");
    setMobileMenuOpen(false);
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
      className={`app-motion min-h-screen text-zinc-950 ${businessScope === "adult" ? "bg-blue-50/45" : "bg-stone-50"}`}
      onTouchStart={handleMobileTouchStart}
      onTouchEnd={handleMobileTouchEnd}
      data-testid="admin-portal"
    >
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      <UnknownSubjectNotification subject={unknownSubjectAlert.primarySubject} onOpenSubject={openUnknownSubjectRegistration} />
      <AdminShellMobileMenu
        isOpen={mobileMenuOpen}
        sidebarTabs={sidebarTabs}
        effectiveActiveTab={effectiveActiveTab}
        billingSection={billingSection}
        studentsSection={studentsSection}
        canProgramBilling={canProgramBilling}
        showBillingSubsections={showBillingSubsections}
        tournamentSection={tournamentSection}
        shellTone={shellTone}
        onClose={() => setMobileMenuOpen(false)}
        onLogout={onLogout}
        onSelectTab={(tab) => {
          selectTab(tab);
          setMobileMenuOpen(false);
        }}
        onSelectBillingSection={selectBillingSection}
        onSelectStudentsSection={selectStudentsSection}
        onSelectTournamentSection={selectTournamentSection}
      />
      <div className="mx-auto flex min-h-screen max-w-[1540px] gap-5 p-4">
        <AdminShellSidebar
          sidebarRef={desktopSidebarRef}
          sidebarExpanded={sidebarExpanded}
          canToggleAdultDashboard={canToggleAdultDashboard}
          businessScope={businessScope}
          sidebarTabs={sidebarTabs}
          effectiveActiveTab={effectiveActiveTab}
          billingSection={billingSection}
          studentsSection={studentsSection}
          canProgramBilling={canProgramBilling}
          showBillingSubsections={showBillingSubsections}
          tournamentSection={tournamentSection}
          shellTone={shellTone}
          onToggleExpanded={() => setSidebarExpanded((value) => !value)}
          onSwitchScope={switchBusinessScope}
          onSelectTab={selectTab}
          onSelectBillingSection={selectBillingSection}
          onSelectStudentsSection={selectStudentsSection}
          onSelectTournamentSection={selectTournamentSection}
          onRefresh={refreshActiveSection}
          onLogout={onLogout}
          onMouseEnter={openDesktopSidebarFromHover}
          onMouseLeave={startDesktopSidebarCollapse}
        />
        <div className={`min-w-0 flex-1 pt-[76px] transition-[margin] duration-200 sm:pt-20 lg:pt-0 ${sidebarExpanded ? "lg:ml-[17rem]" : "lg:ml-[5.75rem]"}`}>
          <AdminShellHeader
            user={user}
            businessScope={businessScope}
            canToggleAdultDashboard={canToggleAdultDashboard}
            headerScrolled={headerScrolled}
            effectiveActiveTabMeta={effectiveActiveTabMeta}
            unknownSubjectCount={unknownSubjectAlert.count}
            primaryUnknownSubject={unknownSubjectAlert.primarySubject}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onRefresh={refreshActiveSection}
            onSwitchScope={switchBusinessScope}
            onOpenUnknownSubject={openUnknownSubjectRegistration}
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
            billingSection={billingSection}
            studentsSection={studentsSection}
            tournamentSection={tournamentSection}
            unknownDetailDate={unknownDetailDate}
            unknownDetailReport={unknownDetailReport}
            unknownSubjectToRegister={unknownSubjectToRegister}
            onSelectAttendanceSubsection={selectAttendanceSubsection}
            onOpenUnknownDetail={openUnknownDetail}
            onCloseUnknownDetail={closeUnknownDetail}
            onUnknownSubjectRegistrationOpened={() => setUnknownSubjectToRegister("")}
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
