import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { apiRequest } from "../../api";
import { type ContactAudit } from "./contactAudit";
import type { AuditRange } from "./auditPeriods";

type Audit = ContactAudit;
const categories = [["prospect", "Prospectos", "green"], ["current_client", "Clientes actuales", "blue"],
  ["ambiguous", "Por confirmar", "yellow"], ["unclassified", "Sin clasificar", "red"], ["other", "Otras clasificaciones", "neutral"]];

export function ContactClassificationPanel({ token, scopeQuery, range, compact = false }: { token: string; scopeQuery: string; range?: AuditRange; compact?: boolean }) {
  const [result, setResult] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const detail = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError("");
    apiRequest<Audit>(`/whatsapp-conversations/contact-audit/?${scopeQuery}${range ? `&range=${range}` : ''}`, token, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo consultar la clasificación."); });
    return () => controller.abort();
  }, [token, scopeQuery, range]);
  const table = result && <div className="comm-table-wrap"><table className="comm-table"><thead><tr><th>Clasificación original</th><th>Contactos</th></tr></thead><tbody>{result.relationships.map(row => <tr key={row.label}><td>{row.label}</td><td>{row.count.toLocaleString("es-MX")}</td></tr>)}</tbody></table></div>;
  return <section className={`comm-panel comm-contact-classification${compact ? " comm-classification-compact" : ""}`}>
    <header className="comm-section-heading"><div><h3>Clasificación de contactos</h3>{range && <p>Contactos activos en el periodo</p>}</div>{compact && result && <button type="button" className="comm-link comm-classification-open" onClick={() => detail.current?.showModal()}>Ver detalle</button>}</header>
    {error ? <p className="comm-error comm-stats-body" role="alert">No se pudo consultar la base de contactos analizados. {error}</p> : result ? <div className="comm-stats-body">
      <div className="comm-classification-grid">{categories.map(([key, label, color]) => <article className={`comm-classification-card ${color}`} key={key}><span>{label}</span><strong>{result.categories[key].toLocaleString("es-MX")}</strong></article>)}</div>
      {!compact && <details open className="comm-classification-detail"><summary>Todas las clasificaciones</summary>{table}</details>}
    </div> : <p className="comm-muted comm-stats-body" role="status">Consultando contactos analizados…</p>}
    {compact && <dialog ref={detail} className="comm-template-modal comm-classification-modal" aria-labelledby="classification-detail-title">
      <header className="comm-template-modal-heading"><h3 id="classification-detail-title">Todas las clasificaciones</h3><button type="button" className="comm-template-modal-close" aria-label="Cerrar detalle de clasificaciones" onClick={() => detail.current?.close()}><X size={20} /></button></header>
      <div className="comm-template-modal-body">{table}</div>
    </dialog>}
  </section>;
}
