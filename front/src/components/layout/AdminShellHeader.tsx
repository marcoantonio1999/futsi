import { LogOut, Menu, RefreshCw } from "lucide-react";
import { roleLabels } from "../../appState";
import type { User } from "../../types";
import type { BusinessScope, SidebarTab } from "./adminShellModel";

type AdminShellHeaderProps = {
  user: User;
  businessScope: BusinessScope;
  canToggleAdultDashboard: boolean;
  headerScrolled: boolean;
  effectiveActiveTabMeta: SidebarTab | undefined;
  onOpenMobileMenu: () => void;
  onRefresh: () => void;
  onSwitchScope: (scope: BusinessScope) => void;
  onLogout: () => void;
};

export function AdminShellHeader({
  user,
  businessScope,
  canToggleAdultDashboard,
  headerScrolled,
  effectiveActiveTabMeta,
  onOpenMobileMenu,
  onRefresh,
  onSwitchScope,
  onLogout,
}: AdminShellHeaderProps) {
  return (
    <header
      className={`app-header fixed left-2 right-2 top-2 z-[900] rounded-[18px] border px-3 py-2 shadow-sm transition-colors duration-200 sm:left-3 sm:right-3 sm:top-3 sm:rounded-[24px] sm:px-4 sm:py-3 lg:sticky lg:left-auto lg:right-auto lg:top-4 ${
        headerScrolled
          ? "border-white/45 bg-white/70 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/65"
          : "border-white/80 bg-white/95 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/95"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <button
            data-testid="section-menu-open"
            className="grid size-10 shrink-0 place-items-center rounded-md border border-zinc-200 bg-white/90 lg:hidden"
            onClick={onOpenMobileMenu}
            type="button"
            aria-label="Abrir secciones"
          >
            <Menu size={18} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold sm:text-xl">{effectiveActiveTabMeta?.label || (businessScope === "adult" ? "Liga adultos" : "Operacion base")}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {canToggleAdultDashboard && (
            <button
              className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                businessScope === "adult"
                  ? "border-blue-700 bg-blue-700 text-white"
                  : "border-blue-700 bg-white text-blue-800 hover:bg-blue-50 dark:bg-zinc-950 dark:text-white dark:hover:bg-zinc-900"
              }`}
              onClick={() => onSwitchScope(businessScope === "adult" ? "academy" : "adult")}
              type="button"
            >
              <span className="sm:hidden">{businessScope === "adult" ? "Acad." : "Adultos"}</span>
              <span className="hidden sm:inline">{businessScope === "adult" ? "Academia" : "Liga adultos"}</span>
            </button>
          )}
          <button className="grid size-10 place-items-center rounded-md border border-zinc-200 bg-white/90 hover:bg-zinc-50" onClick={onRefresh} title="Actualizar" type="button">
            <RefreshCw size={16} />
          </button>
          <div className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 sm:flex">
            <span className="grid size-8 place-items-center rounded-full bg-rose-400 text-sm font-semibold text-white">{user.username.slice(0, 1).toUpperCase()}</span>
            <div className="text-sm leading-tight">
              <p className="font-medium">{user.username}</p>
              <p className="text-xs text-zinc-500">{roleLabels[user.role]}</p>
            </div>
          </div>
          <button className="hidden size-10 place-items-center rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 sm:grid" onClick={onLogout} title="Salir" type="button">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
