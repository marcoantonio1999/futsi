import { Moon, Sun } from "lucide-react";
import type { ThemeMode } from "../../types";

export function ThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  const isDark = theme === "dark";
  return (
    <button
      data-testid="theme-toggle"
      className="theme-toggle fixed bottom-4 right-4 z-[1200] grid size-11 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-800 shadow-lg transition hover:bg-zinc-50"
      onClick={onToggle}
      type="button"
      title={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
