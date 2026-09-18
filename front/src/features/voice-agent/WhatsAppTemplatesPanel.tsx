import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api";
import { formatDateTime, inputClass, secondaryButtonClass } from "./model";
import { reportedTemplateReason } from "./templateReason";

export type Template = {
  id: string; name: string; language: string; status: string; category: string; rejected_reason: string;
  components: Array<{ type: string; format: string; text: string; buttons: Array<{ type: string; text: string }> }>;
};
type Catalog = { business_address: string; waba_id: string; fetched_at: string; templates: Template[]; next_cursor: string };
type TemplateChannel = { business_address: string; label: string };

const statuses: Record<string, string> = {
  APPROVED: "Aprobada", PENDING: "En revisión", REJECTED: "Rechazada", PAUSED: "Pausada",
  DISABLED: "Deshabilitada", IN_APPEAL: "En apelación", DELETED: "Eliminada", PENDING_DELETION: "Pendiente de eliminación",
};
const categories: Record<string, string> = { MARKETING: "Difusión", UTILITY: "Servicio", AUTHENTICATION: "Verificación" };
const componentTypes: Record<string, string> = { HEADER: "Encabezado", BODY: "Mensaje", FOOTER: "Pie de mensaje", BUTTONS: "Botones" };

function templateStatus(template: Template) {
  const status = template.status.toUpperCase();
  return statuses[status] || template.status || "Estado desconocido";
}

function templateCategory(template: Template) {
  return categories[template.category.toUpperCase()] || template.category || "Sin categoría";
}

function WhatsAppTemplateCatalog({ token, channel }: { token: string; channel: TemplateChannel }) {
  const address = channel.business_address;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState("");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
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

  useEffect(() => {
    const dialog = detailDialog.current;
    if (!dialog) return;
    if (selectedTemplate && !dialog.open) dialog.showModal();
    if (!selectedTemplate && dialog.open) dialog.close();
  }, [selectedTemplate]);

  const templates = catalog?.templates ?? [];
  const approved = templates.filter(t => t.status.toUpperCase() === "APPROVED").length;
  const needle = search.trim().toLocaleLowerCase("es-MX");
  const visible = templates.filter(t => (filter === "all" || (filter === "approved") === (t.status.toUpperCase() === "APPROVED")) &&
    [t.name, t.language, t.category, ...t.components.map(c => c.text)].some(value => value.toLocaleLowerCase("es-MX").includes(needle)));
  const closeDetails = () => {
    detailDialog.current?.close();
    setSelectedTemplate(null);
  };

  return <div className="grid gap-4">
    <header className="comm-section-heading">
      <div><h3>{channel.label}</h3><p>{address.replace("whatsapp:", "").replace("meta:", "ID ")}</p></div>
    </header>
    <div className="comm-template-topbar">
      <p>{catalog ? <><strong>{templates.length}</strong> {templates.length === 1 ? "plantilla disponible" : "plantillas disponibles"}<span> · Actualizado {formatDateTime(catalog.fetched_at)}</span>{catalog.next_cursor && <span> · Hay más por cargar</span>}</> : "Consulta las plantillas disponibles para este número."}</p>
      <button disabled={loading} className={secondaryButtonClass} onClick={() => { setCursor(""); setCatalog(null); setRetry(n => n + 1); }}>Actualizar catálogo</button>
    </div>
    {error && <div role="alert" className="comm-error">{error} <button className={secondaryButtonClass} disabled={loading} onClick={() => setRetry(n => n + 1)}>Reintentar</button></div>}
    {loading && <p role="status">Consultando plantillas…</p>}
    {catalog && <>
      <div className="comm-toolbar"><select className={inputClass} aria-label="Estado de plantilla" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Todas las cargadas ({templates.length})</option><option value="approved">Aprobadas ({approved})</option><option value="other">No disponibles ({templates.length - approved})</option></select><input type="search" className={inputClass} aria-label="Buscar plantilla" placeholder="Buscar plantilla" value={search} onChange={e => setSearch(e.target.value)} /></div>
      {visible.length > 0 && <section className="comm-panel comm-template-list" aria-label="Plantillas disponibles">
        {visible.map(template => <article key={`${template.id}:${template.name}:${template.language}`} className="comm-template-row">
          <div className="comm-row-main"><strong>{template.name}</strong><span>{template.language.replace("_", "-")} · {templateCategory(template)}</span></div>
          <span className={`comm-badge ${template.status.toUpperCase() === "APPROVED" ? "green" : "amber"}`}>{templateStatus(template)}</span>
          <button type="button" className={`${secondaryButtonClass} comm-template-detail-button`} onClick={() => setSelectedTemplate(template)}>Ver detalles</button>
        </article>)}
      </section>}
      {!visible.length && <p className="comm-empty">{templates.length ? "No hay plantillas que coincidan con estos filtros." : "No hay plantillas disponibles para este número."}</p>}
      {catalog.next_cursor && <button className={secondaryButtonClass} disabled={loading} onClick={() => setCursor(catalog.next_cursor)}>Cargar más plantillas</button>}
    </>}

    <dialog ref={detailDialog} className="comm-template-modal" aria-labelledby="comm-template-detail-title" onCancel={event => { event.preventDefault(); closeDetails(); }} onClose={() => setSelectedTemplate(null)} onClick={event => { if (event.target === event.currentTarget) closeDetails(); }}>
      {selectedTemplate && <article>
        <header className="comm-template-modal-heading">
          <div><p className="comm-eyebrow">Detalle de la plantilla</p><h3 id="comm-template-detail-title">{selectedTemplate.name}</h3></div>
          <button type="button" className="comm-template-modal-close" aria-label="Cerrar detalle" onClick={closeDetails}>×</button>
        </header>
        <div className="comm-template-modal-summary">
          <span>{selectedTemplate.language.replace("_", "-")}</span><span>{templateCategory(selectedTemplate)}</span><span className={`comm-badge ${selectedTemplate.status.toUpperCase() === "APPROVED" ? "green" : "amber"}`}>{templateStatus(selectedTemplate)}</span>
        </div>
        <div className="comm-template-modal-body">
          {selectedTemplate.components.map((component, index) => <section key={index} className="comm-template-component">
            <small>{componentTypes[component.type.toUpperCase()] || component.type}{component.format ? ` · ${component.format}` : ""}</small>
            {component.text && <p>{component.text}</p>}
            {component.buttons.length > 0 && <div className="comm-template-buttons">{component.buttons.map((button, buttonIndex) => <span key={buttonIndex}>{button.text || button.type}</span>)}</div>}
          </section>)}
          {reportedTemplateReason(selectedTemplate.rejected_reason) && <p className="comm-error">Motivo reportado: {reportedTemplateReason(selectedTemplate.rejected_reason)}</p>}
        </div>
        <footer className="comm-template-modal-footer">Las variables se completan al momento de enviar el mensaje.</footer>
      </article>}
    </dialog>
  </div>;
}

export function WhatsAppTemplatesPanel({ token, channels }: { token: string; channels: TemplateChannel[] }) {
  if (!channels.length) return <section className="comm-panel p-5"><h3>Sin números configurados</h3><p className="mt-2 text-sm">Esta selección no tiene un número de atención vinculado para consultar plantillas.</p></section>;

  if (channels.length === 1) return <WhatsAppTemplateCatalog token={token} channel={channels[0]} />;

  return <div className="grid gap-4">
    <p className="comm-reference">Mostrando las plantillas de los {channels.length} números incluidos en esta selección.</p>
    {channels.map(channel => <section className="comm-panel p-5" key={channel.business_address}>
      <WhatsAppTemplateCatalog token={token} channel={channel} />
    </section>)}
  </div>;
}
