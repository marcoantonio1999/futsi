import { SitesSubmenu } from "../views/sitesNavigation";
import { coachSections, type CoachesSection } from "../../features/coach/coachWorkspaceModel";
import { CommunicationsNav } from "../../features/voice-agent/CommunicationsNav";
import { ChevronDown, LogOut, X } from "lucide-react";
import type { TabKey } from "../../types";
import type { TournamentSection } from "../../features/tournaments";
import type { BillingSubsection, CommunicationsSubsection, ShellTone, SidebarTab, StudentsSubsection, GuardiansSubsection } from "./adminShellModel";

type AdminShellMobileMenuProps = {
  isOpen: boolean;
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
  onClose: () => void;
  onLogout: () => void;
  onSelectTab: (tab: TabKey) => void;
  onSelectBillingSection: (section: BillingSubsection) => void;
  onSelectCommunicationsSection: (section: CommunicationsSubsection) => void;
  onSelectStudentsSection: (section: StudentsSubsection) => void;
  onSelectTournamentSection: (section: TournamentSection) => void;
};

export function AdminShellMobileMenu({
  isOpen,
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
  onClose,
  onLogout,
  onSelectTab,
  onSelectBillingSection,
  onSelectCommunicationsSection,
  onSelectStudentsSection,
  onSelectTournamentSection,
}: AdminShellMobileMenuProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[1001] bg-zinc-950/35 lg:hidden" onClick={onClose}>
      <aside
        className="flex h-dvh max-h-dvh w-[min(86vw,300px)] flex-col overflow-hidden rounded-r-[20px] bg-white p-4 shadow-xl"
        data-testid="section-menu-dropdown"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between">
          <div className="flex items-center gap-2">
            <img className="h-10 w-10 rounded-full object-cover" src="./favicon.png" alt="Futsi" />
            <div>
              <p className="font-semibold">{shellTone.appName}</p>
              <p className="text-xs text-zinc-500">{shellTone.subtitle}</p>
            </div>
          </div>
          <button className="grid size-9 place-items-center rounded-md border border-zinc-200" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </div>
        <nav className="mt-5 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1">
          {sidebarTabs.map((tab) => (
            <div key={tab.key}>
              <button
                data-testid={`menu-tab-${tab.key}`}
                aria-expanded={tab.key === "coaches" ? effectiveActiveTab === "coaches" && coachesMenuExpanded : tab.key === "tournaments" ? effectiveActiveTab === "tournaments" && tournamentsMenuExpanded : tab.key === "students" ? effectiveActiveTab === "students" && studentsMenuExpanded : tab.key === "guardians" ? effectiveActiveTab === "guardians" && guardiansMenuExpanded : tab.key === "communications" ? effectiveActiveTab === "communications" && communicationsMenuExpanded : undefined}
                aria-controls={tab.key === "coaches" ? "coaches-mobile-submenu" : tab.key === "tournaments" ? "tournaments-mobile-submenu" : tab.key === "students" ? "students-mobile-submenu" : tab.key === "guardians" ? "guardians-mobile-submenu" : tab.key === "communications" ? "communications-mobile-submenu" : undefined}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium ${
                  effectiveActiveTab === tab.key ? shellTone.activeClass : `text-zinc-600 ${shellTone.hoverClass}`
                }`}
                onClick={() => tab.key === "coaches" ? onToggleCoachesMenu() : tab.key === "guardians" ? onToggleGuardiansMenu() : tab.key === "communications" ? onToggleCommunicationsMenu() : tab.key === "tournaments" ? onToggleTournamentsMenu() : tab.key === "billing" && showBillingSubsections ? onSelectBillingSection("scheduled") : tab.key === "students" ? onToggleStudentsMenu() : onSelectTab(tab.key)}
                type="button"
              >
                {tab.icon}
                <span>{tab.label}</span>
                {tab.key === "sites" && <ChevronDown size={15} className={`ml-auto ${effectiveActiveTab === "sites" ? "" : "-rotate-90"}`} />}
                {tab.key === "coaches" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "coaches" && coachesMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
          {tab.key === "communications" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "communications" && communicationsMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
{tab.key === "guardians" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "guardians" && guardiansMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
          {tab.key === "students" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "students" && studentsMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
          {tab.key === "tournaments" && <ChevronDown aria-hidden="true" size={15} className={`ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none ${effectiveActiveTab === "tournaments" && tournamentsMenuExpanded ? "rotate-0" : "-rotate-90"}`} />}
              </button>
        {tab.key === "coaches" && <div id="coaches-mobile-submenu" hidden={effectiveActiveTab !== "coaches" || !coachesMenuExpanded}><div className="ml-8 mt-1 grid gap-1">
          {coachSections.filter(item => item.key !== "create" || canManageCoaches).map(item => <StudentsMobileSubButton key={item.key} active={coachesSection === item.key} label={item.label} onClick={() => onSelectCoachesSection(item.key)} />)}
        </div></div>}
        {tab.key === "sites" && effectiveActiveTab === "sites" && <SitesSubmenu onSelect={() => { onSelectTab("sites"); onClose(); }} />}
        {tab.key === "guardians" && <div id="guardians-mobile-submenu" hidden={effectiveActiveTab !== "guardians" || !guardiansMenuExpanded}><div className="ml-8 mt-1 grid gap-1">
          <StudentsMobileSubButton active={guardiansSection !== "create"} label="Gestionar tutores" onClick={() => onSelectGuardiansSection("registered")} />
          <StudentsMobileSubButton active={guardiansSection === "create"} label="Crear tutor" onClick={() => onSelectGuardiansSection("create")} />
        </div></div>}
        {tab.key === "communications" && <div id="communications-mobile-submenu" hidden={effectiveActiveTab !== "communications" || !communicationsMenuExpanded}><CommunicationsNav section={communicationsSection} canReview={canReviewCommunicationCalls} onSelect={onSelectCommunicationsSection} /></div>}
              {showBillingSubsections && tab.key === "billing" && effectiveActiveTab === "billing" && (
                <div className="ml-9 mt-1 grid gap-1">
                  {canProgramBilling && <BillingMobileSubButton active={billingSection === "program"} label="Programar cobro" onClick={() => onSelectBillingSection("program")} />}
                  <BillingMobileSubButton active={billingSection === "scheduled"} label="Cobranza programada" onClick={() => onSelectBillingSection("scheduled")} />
                </div>
              )}
              {tab.key === "tournaments" && <div id="tournaments-mobile-submenu" hidden={effectiveActiveTab !== "tournaments" || !tournamentsMenuExpanded}><div className="ml-8 mt-1 grid gap-1">
          <TournamentMobileSubButton active={tournamentSection === "overview" || tournamentSection === "detail"} label="Torneos activos" onClick={() => onSelectTournamentSection("overview")} />
          <TournamentMobileSubButton active={tournamentSection === "create"} label="Crear torneo" onClick={() => onSelectTournamentSection("create")} />
          <TournamentMobileSubButton active={tournamentSection === "teams"} label="Equipos" onClick={() => onSelectTournamentSection("teams")} />
          {showBillingSubsections && <TournamentMobileSubButton active={tournamentSection === "registrations"} label="Alumnos inscritos" onClick={() => onSelectTournamentSection("registrations")} />}
          <TournamentMobileSubButton active={tournamentSection === "schedule"} label="Partidos" onClick={() => onSelectTournamentSection("schedule")} />
        </div></div>}
              {tab.key === "students" && <div id="students-mobile-submenu" hidden={effectiveActiveTab !== "students" || !studentsMenuExpanded}><div className="ml-9 mt-1 grid gap-1">
                  <StudentsMobileSubButton active={studentsSection === "overview"} label="Resumen de alumnos" onClick={() => onSelectStudentsSection("overview")} />
                  <StudentsMobileSubButton active={studentsSection === "registered" || studentsSection === "edit"} label="Gestionar alumnos" onClick={() => onSelectStudentsSection("registered")} />
                  <StudentsMobileSubButton active={studentsSection === "create"} label="Crear alumno" onClick={() => onSelectStudentsSection("create")} />
                </div></div>}
            </div>
          ))}
        </nav>
        <button className="mt-3 flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50" onClick={onLogout} type="button">
          <LogOut size={16} />
          Cerrar sesion
        </button>
      </aside>
    </div>
  );
}

function BillingMobileSubButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`rounded-md px-3 py-2 text-left text-xs font-semibold ${active ? "bg-zinc-100 text-zinc-950" : "text-zinc-500 hover:bg-zinc-50"}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function TournamentMobileSubButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`rounded-md px-3 py-2 text-left text-xs font-semibold ${active ? "bg-zinc-100 text-zinc-950" : "text-zinc-500 hover:bg-zinc-50"}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}

function StudentsMobileSubButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={`rounded-md px-3 py-2 text-left text-xs font-semibold ${active ? "bg-zinc-100 text-zinc-950" : "text-zinc-500 hover:bg-zinc-50"}`} onClick={onClick} type="button">
      {label}
    </button>
  );
}
