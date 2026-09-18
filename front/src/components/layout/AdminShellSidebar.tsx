import { SitesSubmenu } from "../views/sitesNavigation";
import { coachSections, type CoachesSection } from "../../features/coach/coachWorkspaceModel";
import { CommunicationsNav } from "../../features/voice-agent/CommunicationsNav";
import { ChevronDown, GraduationCap, Menu, UsersRound } from "lucide-react";
import type { RefObject } from "react";
import type { TabKey } from "../../types";
import type { TournamentSection } from "../../features/tournaments";
import type { BillingSubsection, BusinessScope, CommunicationsSubsection, ShellTone, SidebarTab, StudentsSubsection, GuardiansSubsection } from "./adminShellModel";

type AdminShellSidebarProps = {
  sidebarRef: RefObject<HTMLElement | null>;
  sidebarExpanded: boolean;
  canToggleAdultDashboard: boolean;
  businessScope: BusinessScope;
  sidebarTabs: SidebarTab[];
  effectiveActiveTab: TabKey;
  billingSection: BillingSubsection;
  communicationsSection: CommunicationsSubsection;
  communicationsMenuExpanded: boolean;
  onToggleCommunicationsMenu: () => void;
  coachesSection: CoachesSection;
  coachesMenuExpanded: boolean;
  canManageCoaches: boolean;
  onToggleCoachesMenu: () => void;
  onSelectCoachesSection: (section: CoachesSection) => void;
  guardiansSection: GuardiansSubsection;
  guardiansMenuExpanded: boolean;
  onToggleGuardiansMenu: () => void;
  onSelectGuardiansSection: (section: GuardiansSubsection) => void;
  studentsSection: StudentsSubsection;
  tournamentsMenuExpanded: boolean;
  onToggleTournamentsMenu: () => void;
  studentsMenuExpanded: boolean;
  onToggleStudentsMenu: () => void;
  canReviewCommunicationCalls: boolean;
  canProgramBilling: boolean;
  showBillingSubsections: boolean;
  tournamentSection: TournamentSection;
  shellTone: ShellTone;
  onToggleExpanded: () => void;
  onSwitchScope: (scope: BusinessScope) => void;
  onSelectTab: (tab: TabKey) => void;
  onSelectBillingSection: (section: BillingSubsection) => void;
  onSelectCommunicationsSection: (section: CommunicationsSubsection) => void;
  onSelectStudentsSection: (section: StudentsSubsection) => void;
  onSelectTournamentSection: (section: TournamentSection) => void;
};

export function AdminShellSidebar({
  sidebarRef,
  sidebarExpanded,
  canToggleAdultDashboard,
  businessScope,
  sidebarTabs,
  effectiveActiveTab,
  billingSection,
  communicationsSection,
  communicationsMenuExpanded,
  onToggleCommunicationsMenu,
  coachesSection, coachesMenuExpanded, canManageCoaches, onToggleCoachesMenu, onSelectCoachesSection, guardiansSection, guardiansMenuExpanded, onToggleGuardiansMenu, onSelectGuardiansSection,
  tournamentsMenuExpanded, onToggleTournamentsMenu, studentsSection, studentsMenuExpanded, onToggleStudentsMenu,
  canReviewCommunicationCalls,
  canProgramBilling,
  showBillingSubsections,
  tournamentSection,
  shellTone,
  onToggleExpanded,
  onSwitchScope,
  onSelectTab,
  onSelectBillingSection,
  onSelectCommunicationsSection,
  onSelectStudentsSection,
  onSelectTournamentSection,
}: AdminShellSidebarProps) {
  return (
    <aside
      ref={sidebarRef}
      className={`fixed top-4 z-[910] hidden h-[calc(100vh-2rem)] min-h-0 shrink-0 flex-col overflow-hidden border border-white/70 bg-white shadow-sm transition-[width,padding,border-radius] duration-200 lg:left-[max(1rem,calc((100vw-1540px)/2+1rem))] lg:flex ${
        sidebarExpanded ? "w-64 rounded-md p-4" : "w-20 rounded-md p-3"
      }`}
    >
      <div className={`shrink-0 py-2 ${sidebarExpanded ? "px-2" : "px-0"}`}>
        <div className={`flex items-center ${sidebarExpanded ? "justify-between gap-3" : "justify-center"}`}>
          {sidebarExpanded && <img className="h-auto w-36 object-contain" src="./logo-futsi.png" alt="Futsi Mini ERP" />}
          <button
            data-testid="sidebar-toggle"
            className="grid size-10 shrink-0 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50"
            onClick={onToggleExpanded}
            type="button"
            aria-label={sidebarExpanded ? "Contraer menu" : "Expandir menu"}
            aria-expanded={sidebarExpanded}
            title={sidebarExpanded ? "Contraer menu" : "Expandir menu"}
          >
            <Menu size={18} />
          </button>
        </div>
        {sidebarExpanded && <p className="mt-2 text-xs font-medium text-zinc-500">{shellTone.subtitle}</p>}
        {canToggleAdultDashboard && (
          <div className={`mt-4 grid gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-1 ${sidebarExpanded ? "grid-cols-2" : "grid-cols-1"}`}>
            <button
              className={`rounded-md px-2 py-2 text-xs font-semibold transition ${businessScope === "academy" ? "bg-white text-emerald-800 shadow-sm" : "text-zinc-500 hover:bg-white"}`}
              onClick={() => onSwitchScope("academy")}
              type="button"
              title="Academia"
            >
              {sidebarExpanded ? "Academia" : <GraduationCap size={14} />}
            </button>
            <button
              className={`rounded-md px-2 py-2 text-xs font-semibold transition ${businessScope === "adult" ? "bg-white text-blue-800 shadow-sm" : "text-zinc-500 hover:bg-white"}`}
              onClick={() => onSwitchScope("adult")}
              type="button"
              title="Adultos"
            >
              {sidebarExpanded ? "Adultos" : <UsersRound size={14} />}
            </button>
          </div>
        )}
      </div>
      <nav className={`mt-6 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto ${sidebarExpanded ? "pr-1" : "pr-0"}`}>
        {sidebarExpanded && <p className="px-3 pb-1 text-[11px] font-semibold uppercase text-zinc-400">{shellTone.menuTitle}</p>}
        <SidebarTabButtons tabs={sidebarTabs.slice(0, businessScope === "academy" ? 11 : 10)} sidebarExpanded={sidebarExpanded} effectiveActiveTab={effectiveActiveTab} billingSection={billingSection} communicationsSection={communicationsSection} communicationsMenuExpanded={communicationsMenuExpanded} onToggleCommunicationsMenu={onToggleCommunicationsMenu} coachesSection={coachesSection} coachesMenuExpanded={coachesMenuExpanded} canManageCoaches={canManageCoaches} onToggleCoachesMenu={onToggleCoachesMenu} onSelectCoachesSection={onSelectCoachesSection} guardiansSection={guardiansSection} guardiansMenuExpanded={guardiansMenuExpanded} onToggleGuardiansMenu={onToggleGuardiansMenu} onSelectGuardiansSection={onSelectGuardiansSection} studentsSection={studentsSection} tournamentsMenuExpanded={tournamentsMenuExpanded} onToggleTournamentsMenu={onToggleTournamentsMenu} studentsMenuExpanded={studentsMenuExpanded} onToggleStudentsMenu={onToggleStudentsMenu} canReviewCommunicationCalls={canReviewCommunicationCalls} canProgramBilling={canProgramBilling} showBillingSubsections={showBillingSubsections} tournamentSection={tournamentSection} shellTone={shellTone} onSelectTab={onSelectTab} onSelectBillingSection={onSelectBillingSection} onSelectCommunicationsSection={onSelectCommunicationsSection} onSelectStudentsSection={onSelectStudentsSection} onSelectTournamentSection={onSelectTournamentSection} />
        {sidebarExpanded ? <p className="mt-5 px-3 pb-1 text-[11px] font-semibold uppercase text-zinc-400">General</p> : <div className="my-3 h-px bg-zinc-200" />}
        <SidebarTabButtons tabs={sidebarTabs.slice(businessScope === "academy" ? 11 : 10)} sidebarExpanded={sidebarExpanded} effectiveActiveTab={effectiveActiveTab} billingSection={billingSection} communicationsSection={communicationsSection} communicationsMenuExpanded={communicationsMenuExpanded} onToggleCommunicationsMenu={onToggleCommunicationsMenu} coachesSection={coachesSection} coachesMenuExpanded={coachesMenuExpanded} canManageCoaches={canManageCoaches} onToggleCoachesMenu={onToggleCoachesMenu} onSelectCoachesSection={onSelectCoachesSection} guardiansSection={guardiansSection} guardiansMenuExpanded={guardiansMenuExpanded} onToggleGuardiansMenu={onToggleGuardiansMenu} onSelectGuardiansSection={onSelectGuardiansSection} studentsSection={studentsSection} tournamentsMenuExpanded={tournamentsMenuExpanded} onToggleTournamentsMenu={onToggleTournamentsMenu} studentsMenuExpanded={studentsMenuExpanded} onToggleStudentsMenu={onToggleStudentsMenu} canReviewCommunicationCalls={canReviewCommunicationCalls} canProgramBilling={canProgramBilling} showBillingSubsections={showBillingSubsections} tournamentSection={tournamentSection} shellTone={shellTone} onSelectTab={onSelectTab} onSelectBillingSection={onSelectBillingSection} onSelectCommunicationsSection={onSelectCommunicationsSection} onSelectStudentsSection={onSelectStudentsSection} onSelectTournamentSection={onSelectTournamentSection} />
      </nav>
    </aside>
  );
}

type SidebarTabButtonsProps = {
  tabs: SidebarTab[];
  sidebarExpanded: boolean;
  effectiveActiveTab: TabKey;
  billingSection: BillingSubsection;
  communicationsSection: CommunicationsSubsection;
  communicationsMenuExpanded: boolean;
  onToggleCommunicationsMenu: () => void;
  coachesSection: CoachesSection;
  coachesMenuExpanded: boolean;
  canManageCoaches: boolean;
  onToggleCoachesMenu: () => void;
  onSelectCoachesSection: (section: CoachesSection) => void;
  guardiansSection: GuardiansSubsection;
  guardiansMenuExpanded: boolean;
  onToggleGuardiansMenu: () => void;
  onSelectGuardiansSection: (section: GuardiansSubsection) => void;
  studentsSection: StudentsSubsection;
  tournamentsMenuExpanded: boolean;
  onToggleTournamentsMenu: () => void;
  studentsMenuExpanded: boolean;
  onToggleStudentsMenu: () => void;
  canReviewCommunicationCalls: boolean;
  canProgramBilling: boolean;
  showBillingSubsections: boolean;
  tournamentSection: TournamentSection;
  shellTone: ShellTone;
  onSelectTab: (tab: TabKey) => void;
  onSelectBillingSection: (section: BillingSubsection) => void;
  onSelectCommunicationsSection: (section: CommunicationsSubsection) => void;
  onSelectStudentsSection: (section: StudentsSubsection) => void;
  onSelectTournamentSection: (section: TournamentSection) => void;
};

function SidebarTabButtons({ tabs, sidebarExpanded, effectiveActiveTab, billingSection, communicationsSection, communicationsMenuExpanded, onToggleCommunicationsMenu, coachesSection, coachesMenuExpanded, canManageCoaches, onToggleCoachesMenu, onSelectCoachesSection, guardiansSection, guardiansMenuExpanded, onToggleGuardiansMenu, onSelectGuardiansSection, tournamentsMenuExpanded, onToggleTournamentsMenu, studentsSection, studentsMenuExpanded, onToggleStudentsMenu, canReviewCommunicationCalls, canProgramBilling, showBillingSubsections, tournamentSection, shellTone, onSelectTab, onSelectBillingSection, onSelectCommunicationsSection, onSelectStudentsSection, onSelectTournamentSection }: SidebarTabButtonsProps) {
  return (
    <>
      {tabs.map((tab) => (
        <div key={tab.key}>
        <button
          data-testid={`menu-tab-${tab.key}`}
          className={`relative flex w-full items-center rounded-md py-2.5 text-sm font-medium transition ${sidebarExpanded ? "gap-3 px-3 text-left" : "justify-center px-0"} ${
            effectiveActiveTab === tab.key ? shellTone.activeClass : `text-zinc-600 ${shellTone.hoverClass}`
          }`}
          onClick={() => tab.key === "coaches" ? onToggleCoachesMenu() : tab.key === "guardians" ? onToggleGuardiansMenu() : tab.key === "communications" ? onToggleCommunicationsMenu() : tab.key === "tournaments" ? onToggleTournamentsMenu() : tab.key === "billing" && showBillingSubsections ? onSelectBillingSection("scheduled") : tab.key === "students" ? onToggleStudentsMenu() : onSelectTab(tab.key)}
          type="button"
          aria-expanded={tab.key === "coaches" ? sidebarExpanded && effectiveActiveTab === "coaches" && coachesMenuExpanded : tab.key === "tournaments" ? sidebarExpanded && effectiveActiveTab === "tournaments" && tournamentsMenuExpanded : tab.key === "students" ? sidebarExpanded && effectiveActiveTab === "students" && studentsMenuExpanded : tab.key === "guardians" ? sidebarExpanded && effectiveActiveTab === "guardians" && guardiansMenuExpanded : tab.key === "communications" ? sidebarExpanded && effectiveActiveTab === "communications" && communicationsMenuExpanded : undefined}
          aria-controls={tab.key === "coaches" ? "coaches-sidebar-submenu" : tab.key === "tournaments" ? "tournaments-sidebar-submenu" : tab.key === "students" ? "students-sidebar-submenu" : tab.key === "guardians" ? "guardians-sidebar-submenu" : tab.key === "communications" ? "communications-sidebar-submenu" : undefined}
          title={tab.key === "coaches" ? (sidebarExpanded && effectiveActiveTab === "coaches" && coachesMenuExpanded ? "Contraer Coaches" : "Desplegar Coaches") : tab.key === "tournaments" ? (sidebarExpanded && effectiveActiveTab === "tournaments" && tournamentsMenuExpanded ? "Contraer Torneos" : "Desplegar Torneos") : tab.key === "students" ? (sidebarExpanded && effectiveActiveTab === "students" && studentsMenuExpanded ? "Contraer Alumnos" : "Desplegar Alumnos") : tab.key === "guardians" ? (sidebarExpanded && effectiveActiveTab === "guardians" && guardiansMenuExpanded ? "Contraer Papás y tutores" : "Desplegar Papás y tutores") : tab.key === "communications" ? (sidebarExpanded && effectiveActiveTab === "communications" && communicationsMenuExpanded ? "Contraer Comunicaciones" : "Desplegar Comunicaciones") : tab.label}
        >
          {effectiveActiveTab === tab.key && <span className={`absolute h-7 w-1 rounded-r-full ${sidebarExpanded ? "-left-4" : "-left-3"} ${shellTone.indicatorClass}`} />}
          <span className="grid size-5 shrink-0 place-items-center">{tab.icon}</span>
          {sidebarExpanded && <span className="truncate">{tab.label}</span>}
          {sidebarExpanded && tab.key === "sites" && <ChevronDown size={15} className={`ml-auto ${effectiveActiveTab === "sites" ? "" : "-rotate-90"}`} />}
          {sidebarExpanded && tab.key === "coaches" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "coaches" && coachesMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
          {sidebarExpanded && tab.key === "communications" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "communications" && communicationsMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
{sidebarExpanded && tab.key === "guardians" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "guardians" && guardiansMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
          {sidebarExpanded && tab.key === "students" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "students" && studentsMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
          {sidebarExpanded && tab.key === "tournaments" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "tournaments" && tournamentsMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
        </button>
        {tab.key === "sites" && sidebarExpanded && effectiveActiveTab === "sites" && <SitesSubmenu onSelect={() => onSelectTab("sites")} />}
        {tab.key === "coaches" && <div id="coaches-sidebar-submenu" hidden={!sidebarExpanded || effectiveActiveTab !== "coaches" || !coachesMenuExpanded}><div className="ml-8 mt-1 grid gap-1">
          {coachSections.filter(item => item.key !== "create" || canManageCoaches).map(item => <StudentsSubButton key={item.key} active={coachesSection === item.key} label={item.label} onClick={() => onSelectCoachesSection(item.key)} />)}
        </div></div>}
        {tab.key === "guardians" && <div id="guardians-sidebar-submenu" hidden={!sidebarExpanded || effectiveActiveTab !== "guardians" || !guardiansMenuExpanded}><div className="ml-8 mt-1 grid gap-1">
          <StudentsSubButton active={guardiansSection !== "create"} label="Gestionar tutores" onClick={() => onSelectGuardiansSection("registered")} />
          <StudentsSubButton active={guardiansSection === "create"} label="Crear tutor" onClick={() => onSelectGuardiansSection("create")} />
        </div></div>}
        {tab.key === "communications" && <div id="communications-sidebar-submenu" hidden={!sidebarExpanded || effectiveActiveTab !== "communications" || !communicationsMenuExpanded}><CommunicationsNav section={communicationsSection} canReview={canReviewCommunicationCalls} onSelect={onSelectCommunicationsSection} /></div>}
        {sidebarExpanded && showBillingSubsections && tab.key === "billing" && effectiveActiveTab === "billing" && (
          <div className="ml-8 mt-1 grid gap-1">
            {canProgramBilling && <BillingSubButton active={billingSection === "program"} label="Programar cobro" onClick={() => onSelectBillingSection("program")} />}
            <BillingSubButton active={billingSection === "scheduled"} label="Cobranza programada" onClick={() => onSelectBillingSection("scheduled")} />
          </div>
        )}
        {tab.key === "tournaments" && <div id="tournaments-sidebar-submenu" hidden={!sidebarExpanded || effectiveActiveTab !== "tournaments" || !tournamentsMenuExpanded}><div className="ml-8 mt-1 grid gap-1">
          <TournamentSubButton active={tournamentSection === "overview" || tournamentSection === "detail"} label="Torneos activos" onClick={() => onSelectTournamentSection("overview")} />
          <TournamentSubButton active={tournamentSection === "create"} label="Crear torneo" onClick={() => onSelectTournamentSection("create")} />
          <TournamentSubButton active={tournamentSection === "teams"} label="Equipos" onClick={() => onSelectTournamentSection("teams")} />
          {showBillingSubsections && <TournamentSubButton active={tournamentSection === "registrations"} label="Alumnos inscritos" onClick={() => onSelectTournamentSection("registrations")} />}
          <TournamentSubButton active={tournamentSection === "schedule"} label="Partidos" onClick={() => onSelectTournamentSection("schedule")} />
        </div></div>}
        {tab.key === "students" && <div id="students-sidebar-submenu" hidden={!sidebarExpanded || effectiveActiveTab !== "students" || !studentsMenuExpanded}><div className="ml-8 mt-1 grid gap-1">
            <StudentsSubButton active={studentsSection === "overview"} label="Resumen de alumnos" onClick={() => onSelectStudentsSection("overview")} />
            <StudentsSubButton active={studentsSection === "registered" || studentsSection === "edit"} label="Gestionar alumnos" onClick={() => onSelectStudentsSection("registered")} />
                  <StudentsSubButton active={studentsSection === "create"} label="Crear alumno" onClick={() => onSelectStudentsSection("create")} />
          </div></div>}
        </div>
      ))}
    </>
  );
}

function BillingSubButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`rounded-md px-3 py-1.5 text-left text-xs font-semibold transition ${active ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:bg-zinc-50"}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function TournamentSubButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`rounded-md px-3 py-1.5 text-left text-xs font-semibold transition ${active ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:bg-zinc-50"}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function StudentsSubButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`rounded-md px-3 py-1.5 text-left text-xs font-semibold transition ${active ? "bg-white text-zinc-950 shadow-sm" : "text-zinc-500 hover:bg-zinc-50"}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}
