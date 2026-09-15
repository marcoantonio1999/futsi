import type { CoachesSection } from "../../features/coach/coachWorkspaceModel";
import { VeronicaOnlyContext, isVeronicaSection } from '../../features/voice-agent/CommunicationsAccess';
import { VeronicaPanel } from '../../features/voice-agent/VeronicaPanel';
import { BulkTemplatesPanel } from '../../features/voice-agent/BulkTemplatesPanel';
import '../../features/voice-agent/communications.css';
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { TabKey } from "../../types";
import { defaultSectionsByRole, tabItems } from "./adminNavigation";
import { AdminShellContent } from "./AdminShellContent";
import { AdminShellHeader } from "./AdminShellHeader";
import { AdminShellMobileMenu } from "./AdminShellMobileMenu";
import type { AdminShellProps } from "./AdminShellProps";
import { AdminShellSidebar } from "./AdminShellSidebar";
import type { TournamentSection } from "../../features/tournaments";
import {
  academyDefaultTab,
  academyData,
  academyMenuTabs,
  adultDefaultTab,
  adultLeagueData,
  adultMenuTabs,
  adultTabLabels,
  shellToneForScope,
  type AttendanceSubsection,
  type BillingSubsection,
  type BusinessScope,
  type CommunicationsSubsection,
  type StudentsSubsection,
  type GuardiansSubsection,
} from "./adminShellModel";

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
  onDeleteStudent,
  onDeleteTournament,
  onDeleteGuardian,
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
  const veronicaOnly = user.section_permissions?.includes('veronica_only') ?? false;
  const [activeTab, setActiveTab] = useState<TabKey>(() => veronicaOnly ? 'communications' : (user.role === "cashier" ? "billing" : "dashboard"));
  const [attendanceSubsection, setAttendanceSubsection] = useState<AttendanceSubsection>("report");
  const [billingSection, setBillingSection] = useState<BillingSubsection>("scheduled");
  const [communicationsMenuExpanded, setCommunicationsMenuExpanded] = useState(veronicaOnly);
  const [communicationsSection, setCommunicationsSection] = useState<CommunicationsSubsection>(veronicaOnly ? 'veronica' : "summary");
  const [studentsMenuExpanded, setStudentsMenuExpanded] = useState(false);
  const [studentsSection, setStudentsSection] = useState<StudentsSubsection>("overview");
  const [coachesSection, setCoachesSection] = useState<CoachesSection>("overview");
  const [coachesMenuExpanded, setCoachesMenuExpanded] = useState(false);
  const [guardiansSection, setGuardiansSection] = useState<GuardiansSubsection>("registered");
  const [guardianToEdit, setGuardianToEdit] = useState<number | null>(null);
  const [guardiansMenuExpanded, setGuardiansMenuExpanded] = useState(false);
  const [studentToEdit, setStudentToEdit] = useState<number | null>(null);
  const [tournamentsMenuExpanded, setTournamentsMenuExpanded] = useState(false);
  const [tournamentSection, setTournamentSection] = useState<TournamentSection>("overview");
  const [unknownDetailDate, setUnknownDetailDate] = useState("");
  const [unknownDetailReport, setUnknownDetailReport] = useState<unknown>(null);
  const [unknownSubjectToRegister, setUnknownSubjectToRegister] = useState("");
  const [businessScope, setBusinessScope] = useState<BusinessScope>("academy");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    try { return localStorage.getItem("futsi_sidebar_expanded") !== "false"; } catch { return true; }
  });
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const mobileSwipeStartX = useRef<number | null>(null);
  const desktopSidebarRef = useRef<HTMLElement | null>(null);

  const isAdmin = user.role === "admin" || user.role === "owner" || user.role === "dev";
  const canManageCommunications = ["admin", "owner", "dev", "site_coordinator"].includes(user.role);
  const canReviewCommunicationCalls = isAdmin;
  const tabs = tabItems();
  const allowedSections = new Set<TabKey>([
    ...(defaultSectionsByRole(tabs)[user.role] || ["dashboard"]),
    ...((user.section_permissions || []) as TabKey[]),
  ]);
  const visibleTabs = tabs.filter(
    (tab) =>
      veronicaOnly ? tab.key === 'communications' : (isAdmin || allowedSections.has(tab.key))
      && (tab.key !== "communications" || canManageCommunications),
  );
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
  const showBillingSubsections = businessScope === "academy";
  const canProgramBilling = showBillingSubsections && user.role !== "cashier";

  useEffect(() => {
    if (veronicaOnly) return;
    onLoadSection(effectiveActiveTab);
  }, [effectiveActiveTab, user.id]);

  useEffect(() => {
    if (!sidebarTabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(fallbackTab);
    }
  }, [activeTab, fallbackTab, sidebarTabs]);

  useEffect(() => {
    if (veronicaOnly) {
      setActiveTab('communications'); setBusinessScope('academy');
      setCommunicationsSection('veronica'); setCommunicationsMenuExpanded(true);
      return;
    }
    if (user.role === "adult_representative" || user.role === "adult_player") {
      setActiveTab(adultDefaultTab);
      setBusinessScope("adult");
      return;
    }
    setActiveTab(user.role === "cashier" ? "billing" : academyDefaultTab);
    setBusinessScope("academy");
  }, [user.id, user.role, veronicaOnly]);

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
    try { localStorage.setItem("futsi_sidebar_expanded", String(sidebarExpanded)); } catch { /* Storage may be unavailable. */ }
  }, [sidebarExpanded]);

  function refreshActiveSection() {
    void onLoadSection(effectiveActiveTab, { force: true });
  }

  function scrollToTop() {
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function selectTab(tab: TabKey) {
    setActiveTab(tab);
    scrollToTop();
  }

  function toggleTournamentsMenu() {
    if (effectiveActiveTab !== "tournaments") {
      setActiveTab("tournaments"); setTournamentsMenuExpanded(true); scrollToTop(); return;
    }
    setTournamentsMenuExpanded(expanded => !expanded);
  }

  function selectTournamentSection(section: TournamentSection) {
    setTournamentsMenuExpanded(true);
    setTournamentSection(section);
    setActiveTab("tournaments");
    setMobileMenuOpen(false);
    scrollToTop();
  }

  function toggleCommunicationsMenu() {
    if (effectiveActiveTab !== "communications") {
      setActiveTab("communications");
      setCommunicationsMenuExpanded(true);
      scrollToTop();
      return;
    }
    setCommunicationsMenuExpanded(expanded => !expanded);
  }

  function selectCommunicationsSection(section: CommunicationsSubsection) {
    if (veronicaOnly && !isVeronicaSection(section)) return;
    if (effectiveActiveTab !== "communications") setCommunicationsMenuExpanded(true);
    setCommunicationsSection(section);
    setActiveTab("communications");
    setMobileMenuOpen(false);
    scrollToTop();
  }

  function selectBillingSection(section: BillingSubsection) {
    setBillingSection(section);
    setActiveTab("billing");
    setMobileMenuOpen(false);
    scrollToTop();
  }

  function toggleCoachesMenu() {
    if (effectiveActiveTab !== "coaches") {
      setActiveTab("coaches"); setCoachesMenuExpanded(true); scrollToTop(); return;
    }
    setCoachesMenuExpanded(expanded => !expanded);
  }

  function selectCoachesSection(section: CoachesSection) {
    setCoachesSection(section); setCoachesMenuExpanded(true); setActiveTab("coaches");
    setMobileMenuOpen(false); scrollToTop();
  }

  function toggleGuardiansMenu() {
    if (effectiveActiveTab !== "guardians") {
      setActiveTab("guardians"); setGuardiansMenuExpanded(true); scrollToTop(); return;
    }
    setGuardiansMenuExpanded(expanded => !expanded);
  }

  function selectGuardiansSection(section: GuardiansSubsection) {
    setGuardianToEdit(null); setGuardiansSection(section); setActiveTab("guardians");
    setGuardiansMenuExpanded(true); setMobileMenuOpen(false); scrollToTop();
  }

  function toggleStudentsMenu() {
    if (effectiveActiveTab !== "students") {
      setActiveTab("students"); setStudentsMenuExpanded(true); scrollToTop(); return;
    }
    setStudentsMenuExpanded(expanded => !expanded);
  }

  function selectStudentsSection(section: StudentsSubsection) {
    setStudentsMenuExpanded(true);
    setStudentToEdit(null);
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
    if (
      nextTab === "attendance"
      && nextScope === "adult"
      && (attendanceSubsection === "occupancy" || attendanceSubsection === "faceguard-monthly")
    ) {
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
    <VeronicaOnlyContext.Provider value={veronicaOnly}>
    <main
      className={`app-motion min-h-screen text-zinc-950 ${businessScope === "adult" ? "bg-blue-50/45" : "bg-stone-50"}`}
      onTouchStart={handleMobileTouchStart}
      onTouchEnd={handleMobileTouchEnd}
      data-testid="admin-portal"
    >
      <AdminShellMobileMenu
        isOpen={mobileMenuOpen}
        sidebarTabs={sidebarTabs}
        effectiveActiveTab={effectiveActiveTab}
        billingSection={billingSection}
        communicationsSection={communicationsSection}
        communicationsMenuExpanded={communicationsMenuExpanded}
        coachesSection={coachesSection}
        coachesMenuExpanded={coachesMenuExpanded}
        canManageCoaches={isAdmin}
        onSelectCoachesSection={selectCoachesSection}
        guardiansMenuExpanded={guardiansMenuExpanded}
        studentsMenuExpanded={studentsMenuExpanded}
        tournamentsMenuExpanded={tournamentsMenuExpanded}
        onSelectGuardiansSection={selectGuardiansSection}
        guardiansSection={guardiansSection}
        studentsSection={studentsSection}
        canReviewCommunicationCalls={canReviewCommunicationCalls}
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
        onToggleCommunicationsMenu={toggleCommunicationsMenu}
        onToggleCoachesMenu={toggleCoachesMenu}
        onToggleGuardiansMenu={toggleGuardiansMenu}
        onToggleStudentsMenu={toggleStudentsMenu}
        onToggleTournamentsMenu={toggleTournamentsMenu}
        onSelectCommunicationsSection={selectCommunicationsSection}
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
          communicationsSection={communicationsSection}
        communicationsMenuExpanded={communicationsMenuExpanded}
        coachesSection={coachesSection}
        coachesMenuExpanded={coachesMenuExpanded}
        canManageCoaches={isAdmin}
        onSelectCoachesSection={selectCoachesSection}
        guardiansMenuExpanded={guardiansMenuExpanded}
        studentsMenuExpanded={studentsMenuExpanded}
        tournamentsMenuExpanded={tournamentsMenuExpanded}
        onSelectGuardiansSection={selectGuardiansSection}
          guardiansSection={guardiansSection}
        studentsSection={studentsSection}
          canReviewCommunicationCalls={canReviewCommunicationCalls}
          canProgramBilling={canProgramBilling}
          showBillingSubsections={showBillingSubsections}
          tournamentSection={tournamentSection}
          shellTone={shellTone}
          onToggleExpanded={() => setSidebarExpanded((value) => !value)}
          onSwitchScope={switchBusinessScope}
          onSelectTab={selectTab}
          onSelectBillingSection={selectBillingSection}
          onToggleTournamentsMenu={() => {
            if (!sidebarExpanded) {
              setSidebarExpanded(true); setTournamentsMenuExpanded(true);
              if (effectiveActiveTab !== "tournaments") { setActiveTab("tournaments"); scrollToTop(); }
            } else toggleTournamentsMenu();
          }}
          onToggleStudentsMenu={() => {
            if (!sidebarExpanded) {
              setSidebarExpanded(true); setStudentsMenuExpanded(true);
              if (effectiveActiveTab !== "students") { setActiveTab("students"); scrollToTop(); }
            } else toggleStudentsMenu();
          }}
          onToggleCoachesMenu={() => {
            if (!sidebarExpanded) {
              setSidebarExpanded(true); setCoachesMenuExpanded(true);
              if (effectiveActiveTab !== "coaches") { setActiveTab("coaches"); scrollToTop(); }
            } else toggleCoachesMenu();
          }}
          onToggleGuardiansMenu={() => {
            if (!sidebarExpanded) {
              setSidebarExpanded(true); setGuardiansMenuExpanded(true);
              if (effectiveActiveTab !== "guardians") { setActiveTab("guardians"); scrollToTop(); }
            } else toggleGuardiansMenu();
          }}
          onToggleCommunicationsMenu={() => {
            if (!sidebarExpanded) {
              setSidebarExpanded(true);
              setCommunicationsMenuExpanded(true);
              if (effectiveActiveTab !== "communications") { setActiveTab("communications"); scrollToTop(); }
            } else toggleCommunicationsMenu();
          }}
          onSelectCommunicationsSection={selectCommunicationsSection}
          onSelectStudentsSection={selectStudentsSection}
          onSelectTournamentSection={selectTournamentSection}
          onRefresh={refreshActiveSection}
          onLogout={onLogout}
        />
        <div className={`min-w-0 flex-1 pt-[116px] transition-[margin] duration-200 sm:pt-[116px] lg:pt-0 ${sidebarExpanded ? "lg:ml-[17rem]" : "lg:ml-[5.75rem]"}`}>
          <AdminShellHeader
            theme={theme}
            onToggleTheme={onToggleTheme}
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
          {veronicaOnly ? <div className="communications"><div className="mt-5">
            {communicationsSection === 'bulk-veronica' ? <BulkTemplatesPanel token={token} kind="veronica" /> : <VeronicaPanel token={token} />}
          </div></div> : <AdminShellContent
            coachesSection={coachesSection}
            onSelectCoachesSection={selectCoachesSection}
            onSelectTournamentSection={selectTournamentSection}
            onSelectStudentsSection={selectStudentsSection}
            studentToEdit={studentToEdit}
            onEditStudent={(id) => { setStudentToEdit(id); setStudentsSection("edit"); scrollToTop(); }}
            onDeleteStudent={onDeleteStudent}
            onDeleteTournament={onDeleteTournament}
            onDeleteGuardian={onDeleteGuardian}
            onSelectGuardiansSection={selectGuardiansSection}
            guardianToEdit={guardianToEdit}
            onEditGuardian={(id) => { setGuardianToEdit(id); setGuardiansSection("edit"); scrollToTop(); }}
            onSelectCommunicationsSection={selectCommunicationsSection}
            onNavigateDashboard={(tab) => {
              if (tab === "billing") setBillingSection("scheduled");
              if (tab === "attendance") setAttendanceSubsection("general");
              selectTab(tab);
            }}
            dashboardSections={sidebarTabs.map(tab => tab.key)}
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
            communicationsSection={communicationsSection}
            guardiansSection={guardiansSection}
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
          />}
        </div>
      </div>
    </main>
    </VeronicaOnlyContext.Provider>
  );
}
