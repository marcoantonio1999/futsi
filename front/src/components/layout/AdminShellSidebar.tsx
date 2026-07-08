import { GraduationCap, LogOut, Menu, RefreshCw, UsersRound } from "lucide-react";
import type { RefObject } from "react";
import type { TabKey } from "../../types";
import type { TournamentSection } from "../../features/tournaments";
import type { BillingSubsection, BusinessScope, ShellTone, SidebarTab, StudentsSubsection } from "./adminShellModel";

type AdminShellSidebarProps = {
  sidebarRef: RefObject<HTMLElement | null>;
  sidebarExpanded: boolean;
  canToggleAdultDashboard: boolean;
  businessScope: BusinessScope;
  sidebarTabs: SidebarTab[];
  effectiveActiveTab: TabKey;
  billingSection: BillingSubsection;
  studentsSection: StudentsSubsection;
  canProgramBilling: boolean;
  showBillingSubsections: boolean;
  tournamentSection: TournamentSection;
  shellTone: ShellTone;
  onToggleExpanded: () => void;
  onSwitchScope: (scope: BusinessScope) => void;
  onSelectTab: (tab: TabKey) => void;
  onSelectBillingSection: (section: BillingSubsection) => void;
  onSelectStudentsSection: (section: StudentsSubsection) => void;
  onSelectTournamentSection: (section: TournamentSection) => void;
  onRefresh: () => void;
  onLogout: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

export function AdminShellSidebar({
  sidebarRef,
  sidebarExpanded,
  canToggleAdultDashboard,
  businessScope,
  sidebarTabs,
  effectiveActiveTab,
  billingSection,
  studentsSection,
  canProgramBilling,
  showBillingSubsections,
  tournamentSection,
  shellTone,
  onToggleExpanded,
  onSwitchScope,
  onSelectTab,
  onSelectBillingSection,
  onSelectStudentsSection,
  onSelectTournamentSection,
  onRefresh,
  onLogout,
  onMouseEnter,
  onMouseLeave,
}: AdminShellSidebarProps) {
  return (
    <aside
      ref={sidebarRef}
      className={`fixed top-4 z-[910] hidden h-[calc(100vh-2rem)] min-h-0 shrink-0 flex-col overflow-hidden border border-white/70 bg-white shadow-sm transition-[width,padding,border-radius] duration-200 lg:left-[max(1rem,calc((100vw-1540px)/2+1rem))] lg:flex ${
        sidebarExpanded ? "w-64 rounded-md p-4" : "w-20 rounded-md p-3"
      }`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className={`shrink-0 py-2 ${sidebarExpanded ? "px-2" : "px-0"}`}>
        <div className={`flex items-center ${sidebarExpanded ? "justify-between gap-3" : "justify-center"}`}>
          {sidebarExpanded && <img className="h-auto w-36 object-contain" src="./logo-futsi.png" alt="Futsi Mini ERP" />}
          <button
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
        <SidebarTabButtons tabs={sidebarTabs.slice(0, 10)} sidebarExpanded={sidebarExpanded} effectiveActiveTab={effectiveActiveTab} billingSection={billingSection} studentsSection={studentsSection} canProgramBilling={canProgramBilling} showBillingSubsections={showBillingSubsections} tournamentSection={tournamentSection} shellTone={shellTone} onSelectTab={onSelectTab} onSelectBillingSection={onSelectBillingSection} onSelectStudentsSection={onSelectStudentsSection} onSelectTournamentSection={onSelectTournamentSection} />
        {sidebarExpanded ? <p className="mt-5 px-3 pb-1 text-[11px] font-semibold uppercase text-zinc-400">General</p> : <div className="my-3 h-px bg-zinc-200" />}
        <SidebarTabButtons tabs={sidebarTabs.slice(10)} sidebarExpanded={sidebarExpanded} effectiveActiveTab={effectiveActiveTab} billingSection={billingSection} studentsSection={studentsSection} canProgramBilling={canProgramBilling} showBillingSubsections={showBillingSubsections} tournamentSection={tournamentSection} shellTone={shellTone} onSelectTab={onSelectTab} onSelectBillingSection={onSelectBillingSection} onSelectStudentsSection={onSelectStudentsSection} onSelectTournamentSection={onSelectTournamentSection} />
      </nav>
      <div className={`mt-3 shrink-0 ${sidebarExpanded ? "grid gap-2" : "grid gap-2"}`}>
        {sidebarExpanded ? (
          <>
            <button className={`w-full rounded-md px-3 py-2 text-xs font-semibold ${shellTone.refreshButton}`} onClick={onRefresh} type="button">
              Actualizar
            </button>
            <button className="flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50" onClick={onLogout} type="button">
              <LogOut size={14} />
              Salir
            </button>
          </>
        ) : (
          <>
            <button className={`grid size-11 place-items-center rounded-md ${shellTone.refreshButton}`} onClick={onRefresh} type="button" title="Actualizar">
              <RefreshCw size={16} />
            </button>
            <button className="grid size-11 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50" onClick={onLogout} title="Salir" type="button">
              <LogOut size={16} />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

type SidebarTabButtonsProps = {
  tabs: SidebarTab[];
  sidebarExpanded: boolean;
  effectiveActiveTab: TabKey;
  billingSection: BillingSubsection;
  studentsSection: StudentsSubsection;
  canProgramBilling: boolean;
  showBillingSubsections: boolean;
  tournamentSection: TournamentSection;
  shellTone: ShellTone;
  onSelectTab: (tab: TabKey) => void;
  onSelectBillingSection: (section: BillingSubsection) => void;
  onSelectStudentsSection: (section: StudentsSubsection) => void;
  onSelectTournamentSection: (section: TournamentSection) => void;
};

function SidebarTabButtons({ tabs, sidebarExpanded, effectiveActiveTab, billingSection, studentsSection, canProgramBilling, showBillingSubsections, tournamentSection, shellTone, onSelectTab, onSelectBillingSection, onSelectStudentsSection, onSelectTournamentSection }: SidebarTabButtonsProps) {
  return (
    <>
      {tabs.map((tab) => (
        <div key={tab.key}>
        <button
          data-testid={`menu-tab-${tab.key}`}
          className={`relative flex items-center rounded-md py-2.5 text-sm font-medium transition ${sidebarExpanded ? "gap-3 px-3 text-left" : "justify-center px-0"} ${
            effectiveActiveTab === tab.key ? shellTone.activeClass : `text-zinc-600 ${shellTone.hoverClass}`
          }`}
          onClick={() => tab.key === "tournaments" ? onSelectTournamentSection("overview") : tab.key === "billing" && showBillingSubsections ? onSelectBillingSection("scheduled") : tab.key === "students" ? onSelectStudentsSection("registered") : onSelectTab(tab.key)}
          type="button"
          title={tab.label}
        >
          {effectiveActiveTab === tab.key && <span className={`absolute h-7 w-1 rounded-r-full ${sidebarExpanded ? "-left-4" : "-left-3"} ${shellTone.indicatorClass}`} />}
          <span className="grid size-5 shrink-0 place-items-center">{tab.icon}</span>
          {sidebarExpanded && <span className="truncate">{tab.label}</span>}
        </button>
        {sidebarExpanded && showBillingSubsections && tab.key === "billing" && effectiveActiveTab === "billing" && (
          <div className="ml-8 mt-1 grid gap-1">
            {canProgramBilling && <BillingSubButton active={billingSection === "program"} label="Programar cobro" onClick={() => onSelectBillingSection("program")} />}
            <BillingSubButton active={billingSection === "scheduled"} label="Cobranza programada" onClick={() => onSelectBillingSection("scheduled")} />
          </div>
        )}
        {sidebarExpanded && tab.key === "tournaments" && effectiveActiveTab === "tournaments" && (
          <div className="ml-8 mt-1 grid gap-1">
            <TournamentSubButton active={tournamentSection === "overview"} label="Resumen" onClick={() => onSelectTournamentSection("overview")} />
            <TournamentSubButton active={tournamentSection === "teams"} label="Crear equipos" onClick={() => onSelectTournamentSection("teams")} />
            <TournamentSubButton active={tournamentSection === "registrations"} label="Inscribir alumnos" onClick={() => onSelectTournamentSection("registrations")} />
            <TournamentSubButton active={tournamentSection === "schedule"} label="Agendar partido" onClick={() => onSelectTournamentSection("schedule")} />
          </div>
        )}
        {sidebarExpanded && tab.key === "students" && effectiveActiveTab === "students" && (
          <div className="ml-8 mt-1 grid gap-1">
            <StudentsSubButton active={studentsSection === "create"} label="Crear alumno" onClick={() => onSelectStudentsSection("create")} />
            <StudentsSubButton active={studentsSection === "registered"} label="Alumnos registrados" onClick={() => onSelectStudentsSection("registered")} />
          </div>
        )}
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
