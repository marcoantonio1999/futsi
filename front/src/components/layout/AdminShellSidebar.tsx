import { GraduationCap, LogOut, Menu, RefreshCw, UsersRound } from "lucide-react";
import type { RefObject } from "react";
import type { TabKey } from "../../types";
import type { BusinessScope, ShellTone, SidebarTab } from "./adminShellModel";

type AdminShellSidebarProps = {
  sidebarRef: RefObject<HTMLElement | null>;
  sidebarExpanded: boolean;
  canToggleAdultDashboard: boolean;
  businessScope: BusinessScope;
  sidebarTabs: SidebarTab[];
  effectiveActiveTab: TabKey;
  shellTone: ShellTone;
  onToggleExpanded: () => void;
  onSwitchScope: (scope: BusinessScope) => void;
  onSelectTab: (tab: TabKey) => void;
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
  shellTone,
  onToggleExpanded,
  onSwitchScope,
  onSelectTab,
  onRefresh,
  onLogout,
  onMouseEnter,
  onMouseLeave,
}: AdminShellSidebarProps) {
  return (
    <aside
      ref={sidebarRef}
      className={`fixed top-4 z-[910] hidden h-[calc(100vh-2rem)] min-h-0 shrink-0 flex-col overflow-hidden border border-white/70 bg-white shadow-sm transition-[width,padding,border-radius] duration-200 lg:left-[max(1rem,calc((100vw-1540px)/2+1rem))] lg:flex ${
        sidebarExpanded ? "w-64 rounded-[24px] p-4" : "w-20 rounded-[20px] p-3"
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
        <SidebarTabButtons tabs={sidebarTabs.slice(0, 10)} sidebarExpanded={sidebarExpanded} effectiveActiveTab={effectiveActiveTab} shellTone={shellTone} onSelectTab={onSelectTab} />
        {sidebarExpanded ? <p className="mt-5 px-3 pb-1 text-[11px] font-semibold uppercase text-zinc-400">General</p> : <div className="my-3 h-px bg-zinc-200" />}
        <SidebarTabButtons tabs={sidebarTabs.slice(10)} sidebarExpanded={sidebarExpanded} effectiveActiveTab={effectiveActiveTab} shellTone={shellTone} onSelectTab={onSelectTab} />
      </nav>
      <div className={`mt-3 shrink-0 ${sidebarExpanded ? `rounded-[18px] p-3 ${shellTone.demoCard}` : "grid gap-2"}`}>
        {sidebarExpanded ? (
          <>
            <p className="text-xs opacity-80">Modo {businessScope === "adult" ? "liga adultos" : "academia"}</p>
            <p className="mt-1 text-sm font-semibold">Datos operativos vivos</p>
            <button className={`mt-3 w-full rounded-md px-3 py-2 text-xs font-semibold ${shellTone.refreshButton}`} onClick={onRefresh} type="button">
              Actualizar
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
        {sidebarExpanded && (
          <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-600 hover:bg-zinc-50" onClick={onLogout} type="button">
            <LogOut size={14} />
            Salir
          </button>
        )}
      </div>
    </aside>
  );
}

type SidebarTabButtonsProps = {
  tabs: SidebarTab[];
  sidebarExpanded: boolean;
  effectiveActiveTab: TabKey;
  shellTone: ShellTone;
  onSelectTab: (tab: TabKey) => void;
};

function SidebarTabButtons({ tabs, sidebarExpanded, effectiveActiveTab, shellTone, onSelectTab }: SidebarTabButtonsProps) {
  return (
    <>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          data-testid={`menu-tab-${tab.key}`}
          className={`relative flex items-center rounded-md py-2.5 text-sm font-medium transition ${sidebarExpanded ? "gap-3 px-3 text-left" : "justify-center px-0"} ${
            effectiveActiveTab === tab.key ? shellTone.activeClass : `text-zinc-600 ${shellTone.hoverClass}`
          }`}
          onClick={() => onSelectTab(tab.key)}
          type="button"
          title={tab.label}
        >
          {effectiveActiveTab === tab.key && <span className={`absolute h-7 w-1 rounded-r-full ${sidebarExpanded ? "-left-4" : "-left-3"} ${shellTone.indicatorClass}`} />}
          <span className="grid size-5 shrink-0 place-items-center">{tab.icon}</span>
          {sidebarExpanded && <span className="truncate">{tab.label}</span>}
        </button>
      ))}
    </>
  );
}
