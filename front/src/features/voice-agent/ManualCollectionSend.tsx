import { useEffect, useRef, useState } from "react";
import { apiRequest } from "../../api";
import type { Template } from "./WhatsAppTemplatesPanel";
import type { CollectionRow } from "./DebtCommunicationsPanel";
import { inputClass, secondaryButtonClass } from "./model";

type Preview = { confirmation: string; body: string; contact_phone: string; business_address: string; template_name: string; language: string; balance: string };
const supported = (t: Template) => t.status === "APPROVED" && t.components.length > 0 && t.components.every(c =>
  ["HEADER", "BODY", "FOOTER"].includes(c.type) && ["", "TEXT"].includes(c.format || "") &&
  [...c.text.matchAll(/\{\{([^{}]+)\}\}/g)].every(m => /^\d+$/.test(m[1])));

export function ManualCollectionSend({ token, row, stage, onClose, onSent }: {
  token: string; row: CollectionRow; stage: number; onClose: () => void; onSent: () => void;
}) {
  const [address, setAddress] = useState(row.channels.length === 1 ? row.channels[0] : "");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setTemplates([]); setSelected(""); setValues({}); setPreview(null); setError("");
    if (!address) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      let cursor = ""; const all: Template[] = []; const seen = new Set<string>();
      for (let page = 0; page < 20; page++) {
        const result = await apiRequest<{ templates: Template[]; next_cursor: string }>(`/whatsapp-conversations/templates/?${new URLSearchParams({ business_address: address, after: cursor })}`, token, { signal: controller.signal });
        all.push(...result.templates); cursor = result.next_cursor;
        if (!cursor || seen.has(cursor)) break;
        seen.add(cursor);
      }
      if (!controller.signal.aborted) setTemplates(all.filter(supported));
    })().catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo cargar el catálogo."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [address, token, retry]);
  const template = templates.find(t => `${t.name}:${t.language}` === selected);
  const fields = template?.components.flatMap(c => [...new Set([...c.text.matchAll(/\{\{(\d+)\}\}/g)].map(m => m[1]))].map(key => ({ key: `${c.type.toLowerCase()}.${key}`, label: `${c.type} {{${key}}}` }))) ?? [];
  async function submit(send: boolean) {
    if (inFlight.current || accepted) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await apiRequest<Preview>(`/charges/${row.id}/manual-whatsapp/`, token, { method: "POST", body: JSON.stringify(send ?
        { action: "send", confirmation: preview?.confirmation } :
        { action: "preview", business_address: address, stage, template_name: template?.name, language: template?.language, values }) });
      if (send) { setAccepted(true); setPreview(null); } else setPreview(result);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo completar la acción."); if (send) setPreview(null); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <section className="comm-panel border-2 border-emerald-600 p-4 grid gap-3" aria-label="Preparar recordatorio manual">
    <header className="flex justify-between gap-3"><h3>{stage === 7 ? "Primer recordatorio" : stage === 14 ? "Segundo recordatorio" : "Aviso de baja"} · Cargo #{row.id}</h3><button className={secondaryButtonClass} disabled={busy} onClick={accepted ? onSent : onClose}>Cerrar</button></header>
    {accepted ? <><p role="status">Mensaje aceptado por WhatsApp. Esto no confirma todavía su entrega.</p><button className={secondaryButtonClass} onClick={onSent}>Actualizar historial y saldos</button></> : <>
      <p>{row.payer_name} · {row.payer_phone} · {row.site_name} · Saldo ${row.balance}</p>
      <p className="comm-muted">Envío individual, no automático. Selecciona una plantilla de cobranza cuyo texto corresponda a esta etapa. Se volverán a comprobar el saldo, la sede y la aprobación antes de enviar.</p>
      {error && <p role="alert" className="comm-error">{error}</p>}
      {preview ? <>
        <p><strong>Confirmar destinatario:</strong> {preview.contact_phone} · Desde {preview.business_address.replace("whatsapp:", "")}</p>
        <p>Plantilla: {preview.template_name} · {preview.language}</p>
        <p className="whitespace-pre-wrap rounded-md border border-zinc-300 p-4">{preview.body}</p>
        <p className="comm-muted">El proveedor puede cobrar este mensaje. Confirma el número y el contenido. La vista previa vence en 5 minutos.</p>
        <div className="flex gap-2"><button className={secondaryButtonClass} disabled={busy} onClick={() => setPreview(null)}>Volver a editar</button><button className={secondaryButtonClass} disabled={busy} onClick={() => void submit(true)}>{busy ? "Enviando…" : "Confirmar y enviar por WhatsApp"}</button></div>
      </> : <>
        <label>Número de la sede<select className={inputClass} disabled={busy} value={address} onChange={e => setAddress(e.target.value)}><option value="">Seleccionar número</option>{row.channels.map(a => <option key={a} value={a}>{a.replace("whatsapp:", "")}</option>)}</select></label>
        {loading ? <p role="status">Consultando plantillas aprobadas…</p> : address && <>
          <label>Plantilla aprobada<select className={inputClass} disabled={busy} value={selected} onChange={e => { setSelected(e.target.value); setValues({}); }}><option value="">Seleccionar plantilla</option>{templates.map(t => <option key={`${t.name}:${t.language}`} value={`${t.name}:${t.language}`}>{t.name} · {t.language}</option>)}</select></label>
          {!templates.length && !error && <p className="comm-reference">No hay plantillas aprobadas de texto compatibles. Crea la plantilla en Dualhook y espera su aprobación. No se enviará texto libre como sustituto.</p>}
          <p className="comm-muted">Por ahora se admiten plantillas de texto con variables numéricas, sin botones ni archivos.</p>
          <button className={secondaryButtonClass} disabled={busy} onClick={() => setRetry(n => n + 1)}>Actualizar plantillas</button>
        </>}
        {template?.components.map((c, i) => <p className="whitespace-pre-wrap text-sm" key={i}>{c.text}</p>)}
        {fields.map(field => <label key={field.key}>{field.label}<input className={inputClass} disabled={busy} maxLength={1024} value={values[field.key] || ""} onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))} /></label>)}
        <button className={secondaryButtonClass} disabled={busy || loading || !template || fields.some(f => !values[f.key]?.trim())} onClick={() => void submit(false)}>{busy ? "Validando…" : "Revisar mensaje antes de enviar"}</button>
      </>}
    </>}
  </section>;
}
