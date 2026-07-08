import { useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { Bell, LogOut, Menu, RefreshCw, UserPlus } from "lucide-react";
import { roleLabels } from "../../appState";
import type { User } from "../../types";
import type { UnknownSubject } from "../../features/unknown-attendance";
import type { BusinessScope, SidebarTab } from "./adminShellModel";

type AdminShellHeaderProps = {
  user: User;
  businessScope: BusinessScope;
  canToggleAdultDashboard: boolean;
  headerScrolled: boolean;
  effectiveActiveTabMeta: SidebarTab | undefined;
  unknownSubjectCount: number;
  primaryUnknownSubject: UnknownSubject | null;
  onOpenMobileMenu: () => void;
  onRefresh: () => void;
  onSwitchScope: (scope: BusinessScope) => void;
  onOpenUnknownSubject: (subjectId: string) => void;
  onLogout: () => void;
};

const notificationButtonVariants: Variants = {
  idle: { scale: 1 },
  active: { scale: 1, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } },
  pulse: {
    scale: [1, 1.08, 1],
    transition: { duration: 0.42, ease: [0.16, 1, 0.3, 1] },
  },
};

const notificationBadgeVariants: Variants = {
  hidden: { opacity: 0, scale: 0.6, y: 2 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, scale: 0.6, y: 2, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } },
};

const notificationMenuVariants: Variants = {
  hidden: { opacity: 0, y: -8, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1], staggerChildren: 0.05 },
  },
  exit: { opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } },
};

const notificationItemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } },
};

export function AdminShellHeader({
  user,
  businessScope,
  canToggleAdultDashboard,
  headerScrolled,
  effectiveActiveTabMeta,
  unknownSubjectCount,
  primaryUnknownSubject,
  onOpenMobileMenu,
  onRefresh,
  onSwitchScope,
  onOpenUnknownSubject,
  onLogout,
}: AdminShellHeaderProps) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  function openPrimaryUnknownSubject() {
    if (!primaryUnknownSubject) return;
    setNotificationsOpen(false);
    onOpenUnknownSubject(primaryUnknownSubject.id);
  }

  return (
    <header
      className={`app-header fixed left-2 right-2 top-2 z-[900] rounded-md border px-3 py-2 shadow-sm transition-colors duration-200 sm:left-3 sm:right-3 sm:top-3 sm:px-4 sm:py-3 lg:sticky lg:left-auto lg:right-auto lg:top-4 ${
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
          <button className="grid size-10 place-items-center rounded-md border border-zinc-200 bg-white/90 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800" onClick={onRefresh} title="Actualizar" type="button">
            <RefreshCw size={16} />
          </button>
          <div className="relative">
            <motion.button
              className={`relative grid size-10 place-items-center rounded-md border border-zinc-200 bg-white/90 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 ${unknownSubjectCount > 0 ? "text-amber-700 dark:text-amber-300" : "text-zinc-700 dark:text-zinc-100"}`}
              variants={notificationButtonVariants}
              initial="idle"
              animate={unknownSubjectCount > 0 ? "pulse" : "idle"}
              whileTap="active"
              onClick={() => setNotificationsOpen((value) => !value)}
              title="Notificaciones"
              type="button"
            >
              <Bell size={16} />
              <AnimatePresence>
                {unknownSubjectCount > 0 && (
                  <motion.span
                    className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-amber-600 px-1 text-[11px] font-bold leading-5 text-white"
                    variants={notificationBadgeVariants}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                  >
                    {unknownSubjectCount > 9 ? "9+" : unknownSubjectCount}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
            <AnimatePresence>
              {notificationsOpen && (
                <motion.div
                  className="absolute right-0 top-12 z-[930] w-[min(340px,calc(100vw-2rem))] rounded-md border border-zinc-200 bg-white p-3 text-left shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
                  variants={notificationMenuVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <motion.p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50" variants={notificationItemVariants}>
                    Notificaciones
                  </motion.p>
                  {primaryUnknownSubject ? (
                    <motion.button className="mt-3 w-full rounded-md border border-amber-200 bg-amber-50 p-3 text-left hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/30" variants={notificationItemVariants} onClick={openPrimaryUnknownSubject} type="button">
                      <span className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
                        <UserPlus size={15} /> Desconocido por registrar
                      </span>
                      <span className="mt-1 block text-sm text-amber-800 dark:text-amber-200">
                        {primaryUnknownSubject.temporary_name || "Rostro desconocido"} esta listo para pedir nombre y agregarlo.
                      </span>
                    </motion.button>
                  ) : (
                    <motion.p className="mt-3 rounded-md border border-dashed border-zinc-200 px-3 py-5 text-sm text-zinc-500 dark:border-zinc-800" variants={notificationItemVariants}>
                      No hay notificaciones pendientes.
                    </motion.p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
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
