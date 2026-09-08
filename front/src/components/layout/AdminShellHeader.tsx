import { LogOut, Menu, Moon, RefreshCw, Sun } from "lucide-react";
import { roleLabels } from "../../appState";
import type { ThemeMode, User } from "../../types";
import type { BusinessScope, SidebarTab } from "./adminShellModel";

type AdminShellHeaderProps = {
  user: User; businessScope: BusinessScope; canToggleAdultDashboard: boolean;
  headerScrolled: boolean; effectiveActiveTabMeta: SidebarTab | undefined;
  theme: ThemeMode; onToggleTheme: () => void;
  onOpenMobileMenu: () => void; onRefresh: () => void;
  onSwitchScope: (scope: BusinessScope) => void; onLogout: () => void;
};

export function AdminShellHeader({ user, businessScope, canToggleAdultDashboard, headerScrolled, effectiveActiveTabMeta, theme, onToggleTheme, onOpenMobileMenu, onRefresh, onSwitchScope, onLogout }: AdminShellHeaderProps) {
  const buttonClass = "grid size-9 shrink-0 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";
  return <header className={"app-header fixed left-2 right-2 top-2 z-[900] rounded-md border px-3 py-2 shadow-sm backdrop-blur-md transition-colors duration-200 sm:left-3 sm:right-3 lg:sticky lg:left-auto lg:right-auto lg:top-4 " + (headerScrolled ? "border-zinc-200 bg-white/80 dark:border-zinc-800 dark:bg-zinc-950/80" : "border-zinc-200 bg-white/95 dark:border-zinc-800 dark:bg-zinc-950/95")}>
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button data-testid="section-menu-open" className={buttonClass + " lg:hidden"} onClick={onOpenMobileMenu} type="button" aria-label="Abrir secciones"><Menu size={18} /></button>
        <h1 className="truncate text-base font-semibold sm:text-xl">{effectiveActiveTabMeta?.label || "Dashboard"}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button className={buttonClass} onClick={onRefresh} aria-label="Actualizar" title="Actualizar" type="button"><RefreshCw size={16} /></button>
        <button className={buttonClass} onClick={onToggleTheme} aria-label={theme === "light" ? "Cambiar a tema oscuro" : "Cambiar a tema claro"} type="button">{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
        <div className="hidden items-center gap-2 px-2 md:flex">
          <span className="grid size-8 place-items-center rounded-full bg-emerald-700 text-sm font-semibold text-white">{user.username.slice(0, 1).toUpperCase()}</span>
          <div className="text-sm leading-tight"><p className="font-medium">{user.username}</p><p className="text-xs text-zinc-500">{roleLabels[user.role]}</p></div>
        </div>
        <button className={buttonClass + " hidden sm:grid"} onClick={onLogout} aria-label="Salir" type="button"><LogOut size={16} /></button>
      </div>
      <label className="flex w-full items-center gap-2 border-t border-zinc-100 pt-2 text-xs text-zinc-500 lg:order-first lg:w-auto lg:border-0 lg:pr-3 lg:pt-0">
        Área
        {canToggleAdultDashboard ? <select aria-label="Área de trabajo" value={businessScope} onChange={event => onSwitchScope(event.target.value as BusinessScope)} className="min-h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
          <option value="academy">Academia</option><option value="adult">Liga adultos</option>
        </select> : <span className="font-semibold">{businessScope === "adult" ? "Liga adultos" : "Academia"}</span>}
      </label>
    </div>
  </header>;
}
