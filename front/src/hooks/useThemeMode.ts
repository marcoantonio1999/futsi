import { useEffect, useState } from "react";
import type { ThemeMode } from "../types";

const THEME_STORAGE_KEY = "futsi_theme_v2";
const LEGACY_THEME_STORAGE_KEY = "futsi_theme";

export function useThemeMode() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  return { theme, toggleTheme };
}
