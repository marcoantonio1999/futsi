import { LogOut, X } from "lucide-react";
import type { TabKey } from "../../types";
import type { TournamentSection } from "../../features/tournaments";
import type { BillingSubsection, ShellTone, SidebarTab, StudentsSubsection } from "./adminShellModel";

type AdminShellMobileMenuProps = {
  isOpen: boolean;
  sidebarTabs: SidebarTab[];
  effectiveActiveTab: TabKey;
  billingSection: BillingSubsection;
  studentsSection: StudentsSubsection;
  canProgramBilling: boolean;
  showBillingSubsections: boolean;
  tournamentSection: TournamentSection;
  shellTone: ShellTone;
  onClose: () => void;
  onLogout: () => void;
  onSelectTab: (tab: TabKey) => void;
  onSelectBillingSection: (section: BillingSubsection) => void;
  onSelectStudentsSection: (section: StudentsSubsection) => void;
  onSelectTournamentSection: (section: TournamentSection) => void;
};

export function AdminShellMobileMenu({
  isOpen,
  sidebarTabs,
  effectiveActiveTab,
  billingSection,
  studentsSection,
  canProgramBilling,
  showBillingSubsections,
  tournamentSection,
  shellTone,
  onClose,
  onLogout,
  onSelectTab,
  onSelectBillingSection,
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
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium ${
                  effectiveActiveTab === tab.key ? shellTone.activeClass : `text-zinc-600 ${shellTone.hoverClass}`
                }`}
                onClick={() => tab.key === "tournaments" ? onSelectTournamentSection("overview") : tab.key === "billing" && showBillingSubsections ? onSelectBillingSection("scheduled") : tab.key === "students" ? onSelectStudentsSection("registered") : onSelectTab(tab.key)}
                type="button"
              >
                {tab.icon}
                {tab.label}
              </button>
              {showBillingSubsections && tab.key === "billing" && effectiveActiveTab === "billing" && (
                <div className="ml-9 mt-1 grid gap-1">
                  {canProgramBilling && <BillingMobileSubButton active={billingSection === "program"} label="Programar cobro" onClick={() => onSelectBillingSection("program")} />}
                  <BillingMobileSubButton active={billingSection === "scheduled"} label="Cobranza programada" onClick={() => onSelectBillingSection("scheduled")} />
                </div>
              )}
              {tab.key === "tournaments" && effectiveActiveTab === "tournaments" && (
                <div className="ml-9 mt-1 grid gap-1">
                  <TournamentMobileSubButton active={tournamentSection === "overview"} label="Resumen" onClick={() => onSelectTournamentSection("overview")} />
                  <TournamentMobileSubButton active={tournamentSection === "teams"} label="Crear equipos" onClick={() => onSelectTournamentSection("teams")} />
                  <TournamentMobileSubButton active={tournamentSection === "registrations"} label="Inscribir alumnos" onClick={() => onSelectTournamentSection("registrations")} />
                  <TournamentMobileSubButton active={tournamentSection === "schedule"} label="Agendar partido" onClick={() => onSelectTournamentSection("schedule")} />
                </div>
              )}
              {tab.key === "students" && effectiveActiveTab === "students" && (
                <div className="ml-9 mt-1 grid gap-1">
                  <StudentsMobileSubButton active={studentsSection === "create"} label="Crear alumno" onClick={() => onSelectStudentsSection("create")} />
                  <StudentsMobileSubButton active={studentsSection === "registered"} label="Alumnos registrados" onClick={() => onSelectStudentsSection("registered")} />
                </div>
              )}
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
