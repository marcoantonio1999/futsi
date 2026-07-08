import { useMemo, useState } from "react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { Bell, UserPlus, X } from "lucide-react";
import type { UnknownSubject } from "../../features/unknown-attendance";

const notificationVariants: Variants = {
  hidden: { opacity: 0, y: -14, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1], staggerChildren: 0.05 },
  },
  exit: { opacity: 0, y: -10, scale: 0.98, transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } },
};

export function UnknownSubjectNotification({ subject, onOpenSubject }: { subject: UnknownSubject | null; onOpenSubject: (subjectId: string) => void }) {
  const [dismissedId, setDismissedId] = useState("");

  const visibleSubject = useMemo(() => {
    if (!subject || subject.id === dismissedId) return null;
    return subject;
  }, [dismissedId, subject]);

  return (
    <AnimatePresence>
      {visibleSubject && (
        <motion.aside
          className="fixed right-4 top-[92px] z-[920] w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-md border border-amber-200 bg-white shadow-xl dark:border-amber-900/70 dark:bg-zinc-950 sm:top-[104px] lg:top-6"
          variants={notificationVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <motion.div className="flex items-start gap-3 p-3" variants={itemVariants}>
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              <Bell size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <motion.p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50" variants={itemVariants}>
                Desconocido consolidado
              </motion.p>
              <motion.p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400" variants={itemVariants}>
                {visibleSubject.temporary_name || "Rostro desconocido"} esta listo para preguntar su nombre y registrarlo.
              </motion.p>
              <motion.button
                className="mt-3 inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                variants={itemVariants}
                onClick={() => onOpenSubject(visibleSubject.id)}
                type="button"
              >
                <UserPlus size={15} /> Registrar ahora
              </motion.button>
            </div>
            <button className="grid size-8 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" onClick={() => setDismissedId(visibleSubject.id)} type="button" aria-label="Ocultar notificacion">
              <X size={16} />
            </button>
          </motion.div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
