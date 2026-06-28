import { LogOut, X } from "lucide-react";
import type { TabKey } from "../../types";
import type { ShellTone, SidebarTab } from "./adminShellModel";

type AdminShellMobileMenuProps = {
  isOpen: boolean;
  sidebarTabs: SidebarTab[];
  effectiveActiveTab: TabKey;
  shellTone: ShellTone;
  onClose: () => void;
  onLogout: () => void;
  onSelectTab: (tab: TabKey) => void;
};

export function AdminShellMobileMenu({
  isOpen,
  sidebarTabs,
  effectiveActiveTab,
  shellTone,
  onClose,
  onLogout,
  onSelectTab,
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
            <button
              key={tab.key}
              data-testid={`menu-tab-${tab.key}`}
              className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium ${
                effectiveActiveTab === tab.key ? shellTone.activeClass : `text-zinc-600 ${shellTone.hoverClass}`
              }`}
              onClick={() => onSelectTab(tab.key)}
              type="button"
            >
              {tab.icon}
              {tab.label}
            </button>
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
