import { useEffect, useState } from "react";
import { apiRequest } from "../../api";
import { formatDateTime, inputClass, secondaryButtonClass } from "./model";
import { reportedTemplateReason } from "./templateReason";

export type Template = {
  id: string; name: string; language: string; status: string; category: string; rejected_reason: string;
  components: Array<{ type: string; format: string; text: string; buttons: Array<{ type: string; text: string }> }>;
};
type Catalog = { business_address: string; waba_id: string; fetched_at: string; templates: Template[]; next_cursor: string };
const statuses: Record<string, string> = { APPROVED: "Aprobada", PENDING: "En revisión", REJECTED: "Rechazada", PAUSED: "Pausada", DISABLED: "Deshabilitada", IN_APPEAL: "En apelación", DELETED: "Eliminada", PENDING_DELETION: "Pendiente de eliminación" };

export function WhatsAppTemplatesPanel({ token, address }: { token: string; address: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (address === "all") return;
    const controller = new AbortController();
    setLoading(true); setError("");
    apiRequest<Catalog>(`/whatsapp-conversations/templates/?${new URLSearchParams({ business_address: address, after: cursor })}`, token, { signal: controller.signal })
      .then(next => {
        if (controller.signal.aborted) return;
        setCatalog(previous => ({ ...next, next_cursor: next.next_cursor === cursor ? "" : next.next_cursor,
          templates: cursor && previous ? [...new Map([...previous.templates, ...next.templates].map(t => [`${t.id}:${t.name}:${t.language}`, t])).values()] : next.templates }));
      })
      .catch(err => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "No se pudo consultar el catálogo."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, address, cursor, retry]);
  if (address === "all") return <section className="comm-panel p-5"><h3>Plantillas de WhatsApp</h3><p className="mt-2 text-sm">Selecciona un número en el filtro superior para consultar las plantillas de su cuenta de WhatsApp.</p></section>;
  const templates = catalog?.templates ?? [];
  const approved = templates.filter(t => t.status.toUpperCase() === "APPROVED").length;
  const needle = search.trim().toLocaleLowerCase("es-MX");
  const visible = templates.filter(t => (filter === "all" || (filter === "approved") === (t.status.toUpperCase() === "APPROVED")) &&
    [t.name, t.language, t.category, ...t.components.map(c => c.text)].some(value => value.toLocaleLowerCase("es-MX").includes(needle)));
  return <div className="grid gap-4">
    <section className="comm-panel"><header className="comm-section-heading"><div><h3>Plantillas de WhatsApp</h3><p>{address.replace("whatsapp:", "")} · Plantillas disponibles</p></div><button disabled={loading} className={secondaryButtonClass} onClick={() => { setCursor(""); setCatalog(null); setRetry(n => n + 1); }}>Actualizar catálogo</button></header>
      {catalog && <div className="p-4 text-sm"><p className="comm-muted">Actualizado: {formatDateTime(catalog.fetched_at)} · {templates.length} {templates.length === 1 ? "plantilla cargada" : "plantillas cargadas"}{catalog.next_cursor ? " · Hay más por cargar" : ""}</p></div>}
    </section>
    {error && <div role="alert" className="comm-error">{error} <button className={secondaryButtonClass} disabled={loading} onClick={() => setRetry(n => n + 1)}>Reintentar</button></div>}
    {loading && <p role="status">Consultando plantillas…</p>}
    {catalog && <>
      <div className="comm-toolbar"><select className={inputClass} aria-label="Estado de plantilla" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas las cargadas ({templates.length})</option><option value="approved">Aprobadas ({approved})</option><option value="other">No aprobadas / no disponibles ({templates.length - approved})</option></select><input type="search" className={inputClass} aria-label="Buscar plantilla" placeholder="Buscar por nombre, texto o idioma" value={search} onChange={e => setSearch(e.target.value)} /></div>
      {visible.map(t => {
        const rejectionReason = reportedTemplateReason(t.rejected_reason);
        return <article key={`${t.id}:${t.name}:${t.language}`} className="comm-panel"><header className="comm-section-heading"><div><h3>{t.name}</h3><p>{t.language} · {t.category}</p></div><span className={`comm-badge ${t.status.toUpperCase() === "APPROVED" ? "green" : "amber"}`}>{statuses[t.status.toUpperCase()] || t.status || "Estado desconocido"}</span></header>
          <div className="p-4 grid gap-3">{t.components.map((component, i) => <div key={i}><small className="comm-muted">{component.type}{component.format ? ` · ${component.format}` : ""}</small>{component.text && <p className="whitespace-pre-wrap break-words text-sm">{component.text}</p>}{component.buttons.map((button, j) => <span key={j} className="inline-block rounded-md border border-zinc-300 px-3 py-2 text-sm mr-2">{button.text || button.type}</span>)}</div>)}{rejectionReason && <p className="comm-error">Motivo reportado: {rejectionReason}</p>}<p className="comm-muted">Vista de la plantilla; las variables se completan al enviar. Este catálogo no envía mensajes.</p></div>
        </article>;
      })}
      {!visible.length && <p className="comm-empty">{templates.length ? "No hay plantillas cargadas que coincidan con estos filtros." : "El proveedor no devolvió plantillas en esta cuenta."}</p>}
      {catalog.next_cursor && <button className={secondaryButtonClass} disabled={loading} onClick={() => setCursor(catalog.next_cursor)}>Cargar más plantillas</button>}
    </>}
  </div>;
}
