import { useEffect, useState } from "react";
import { apiRequest } from "../../api";
import { type ContactAudit } from "./contactAudit";

type Audit = ContactAudit;
const categories = [["prospect", "Prospectos", "green"], ["current_client", "Clientes actuales", "blue"],
  ["ambiguous", "Por confirmar", "yellow"], ["unclassified", "Sin clasificar", "red"], ["other", "Otras clasificaciones", "neutral"]];

export function ContactClassificationPanel({ token, scopeQuery }: { token: string; scopeQuery: string }) {
  const [result, setResult] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setResult(null); setError("");
    apiRequest<Audit>(`/whatsapp-conversations/contact-audit/?${scopeQuery}`, token, { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setResult(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "No se pudo consultar la clasificación."); });
    return () => controller.abort();
  }, [token, scopeQuery]);
  return <section className="comm-panel comm-contact-classification">
    <header className="comm-section-heading"><div><h3>Clasificación de contactos</h3></div></header>
    {error ? <p className="comm-error comm-stats-body" role="alert">No se pudo consultar la base de contactos analizados. {error}</p> : result ? <div className="comm-stats-body">
      <div className="comm-classification-grid">{categories.map(([key, label, color]) => <article className={`comm-classification-card ${color}`} key={key}><span>{label}</span><strong>{result.categories[key].toLocaleString("es-MX")}</strong></article>)}</div>
      <details open className="comm-classification-detail"><summary>Todas las clasificaciones</summary><div className="comm-table-wrap"><table className="comm-table"><thead><tr><th>Clasificación original</th><th>Contactos</th></tr></thead><tbody>{result.relationships.map(row => <tr key={row.label}><td>{row.label}</td><td>{row.count.toLocaleString("es-MX")}</td></tr>)}</tbody></table></div></details>
    </div> : <p className="comm-muted comm-stats-body" role="status">Consultando contactos analizados…</p>}
  </section>;
}
