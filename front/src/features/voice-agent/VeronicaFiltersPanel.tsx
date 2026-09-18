import { useEffect, useState } from "react";
import { Plus, Tags } from "lucide-react";
import { apiRequest } from "../../api";
import { inputClass, primaryButtonClass } from "./model";

export type VeronicaFilterCatalog = { platforms: string[]; vacancy_types: string[] };

export function VeronicaFiltersPanel({ token }: { token: string }) {
  const [catalog, setCatalog] = useState<VeronicaFilterCatalog>({ platforms: [], vacancy_types: [] });
  const [platform, setPlatform] = useState("");
  const [vacancyType, setVacancyType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const result = await apiRequest<VeronicaFilterCatalog>("/veronica/filter-options/", token);
    setCatalog(result);
  }

  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : "No se pudieron cargar los filtros.")); }, [token]);

  async function add(dimension: "platform" | "vacancy_type", label: string) {
    if (!label.trim()) return;
    setBusy(true); setError("");
    try {
      await apiRequest("/veronica/filter-options/", token, { method: "POST", body: JSON.stringify({ dimension, label }) });
      if (dimension === "platform") setPlatform(""); else setVacancyType("");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo agregar el filtro."); }
    finally { setBusy(false); }
  }

  return <section className="comm-panel vero-filter-manager">
    <header className="comm-page-heading"><div><p className="comm-eyebrow">Comunicaciones / Verónica</p><h2>Filtros de reclutamiento</h2><p>Estas opciones aparecen en la bandeja y también se crean automáticamente al importar un Excel o CSV.</p></div></header>
    {error && <div role="alert" className="bulk-alert error">{error}</div>}
    <div className="vero-filter-grid">
      <FilterGroup title="Plataformas" items={catalog.platforms} value={platform} onChange={setPlatform} onAdd={() => void add("platform", platform)} busy={busy} placeholder="Ej. LinkedIn" />
      <FilterGroup title="Tipos de vacante" items={catalog.vacancy_types} value={vacancyType} onChange={setVacancyType} onAdd={() => void add("vacancy_type", vacancyType)} busy={busy} placeholder="Ej. Recepcionista" />
    </div>
  </section>;
}

function FilterGroup({ title, items, value, onChange, onAdd, busy, placeholder }: { title: string; items: string[]; value: string; onChange: (value: string) => void; onAdd: () => void; busy: boolean; placeholder: string }) {
  return <article className="vero-filter-card">
    <h3><Tags size={18} aria-hidden="true" />{title}</h3>
    <div className="vero-filter-chips">{items.map(item => <span key={item}>{item}</span>)}</div>
    <label>Agregar opción<input className={inputClass} maxLength={80} value={value} placeholder={placeholder} disabled={busy} onChange={e => onChange(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }} /></label>
    <button className={primaryButtonClass} disabled={busy || !value.trim()} onClick={onAdd}><Plus size={16} aria-hidden="true" />Agregar</button>
  </article>;
}
