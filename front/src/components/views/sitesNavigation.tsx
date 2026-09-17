import { createContext, useContext, useState, type ReactNode } from "react";

type Section = "overview" | "create";
const SitesContext = createContext<{ section: Section; revision: number; select: (section: Section) => void; canManage: boolean } | null>(null);

export function SitesProvider({ children, canManage }: { children: ReactNode; canManage: boolean }) {
  const [section, setSection] = useState<Section>("overview");
  const [revision, setRevision] = useState(0);
  function select(next: Section) { setSection(next); setRevision(value => value + 1); }
  return <SitesContext.Provider value={{ section, revision, select, canManage }}>{children}</SitesContext.Provider>;
}

export function useSitesNavigation() {
  const value = useContext(SitesContext);
  if (!value) throw new Error("Sedes requiere SitesProvider");
  return value;
}

export function SitesSubmenu({ onSelect }: { onSelect: () => void }) {
  const { section, select, canManage } = useSitesNavigation();
  return <div className="ml-8 mt-1 grid gap-1" aria-label="Subsecciones de Sedes">
    {([{ key: "overview", label: "Resumen" }, ...(canManage ? [{ key: "create", label: "Agregar nueva sede" }] : [])] as { key: Section; label: string }[]).map(item =>
      <button key={item.key} type="button" aria-current={section === item.key ? "page" : undefined} className={`rounded-md px-3 py-2 text-left text-xs font-semibold ${section === item.key ? "bg-emerald-50 text-emerald-800" : "text-zinc-600 hover:bg-zinc-50"}`} onClick={() => { select(item.key); onSelect(); }}>{item.label}</button>
    )}
  </div>;
}
