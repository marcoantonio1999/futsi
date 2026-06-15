import { useEffect, useState } from "react";
import type { ThemeMode } from "../types";

export function useThemeMode() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("futsi_theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("futsi_theme", theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  return { theme, toggleTheme };
}
