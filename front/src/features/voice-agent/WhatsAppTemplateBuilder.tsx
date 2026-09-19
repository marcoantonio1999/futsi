import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "../../api";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "./model";
import { WhatsAppTemplatePreview } from "./WhatsAppTemplatePreview";

type TemplateChannel = { business_address: string; label: string };
type CreatedTemplate = { business_address: string; id: string; name: string; language: string; category: string; status: string };
type FormState = { name: string; language: string; category: string; header: string; body: string; footer: string; buttons: string[] };

const initialForm: FormState = { name: "", language: "es_MX", category: "MARKETING", header: "", body: "", footer: "", buttons: [""] };

function normalizeName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 512);
}

function positions(text: string) {
  return [...new Set([...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(match => Number(match[1])))].sort((a, b) => a - b);
}

function replaceExamples(text: string, prefix: string, examples: Record<string, string>) {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, value: string) => examples[`${prefix}:${value}`]?.trim() || `Ejemplo ${value}`);
}

export function WhatsAppTemplateBuilder({ token, channels }: { token: string; channels: TemplateChannel[] }) {
  const [channel, setChannel] = useState(channels.length === 1 ? channels[0].business_address : "");
  const [form, setForm] = useState<FormState>(initialForm);
  const [examples, setExamples] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<CreatedTemplate | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const confirmDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (channels.length === 1) setChannel(channels[0].business_address);
    else if (channel && !channels.some(item => item.business_address === channel)) setChannel("");
  }, [channels, channel]);

  const selectedChannel = channels.find(item => item.business_address === channel);
  const headerPositions = useMemo(() => positions(form.header), [form.header]);
  const bodyPositions = useMemo(() => positions(form.body), [form.body]);
  const previewText = [
    replaceExamples(form.header, "header", examples),
    replaceExamples(form.body, "body", examples),
    form.footer,
  ].filter(Boolean).join("\n\n");
  const previewButtons = form.buttons.map(value => value.trim()).filter(Boolean);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm(current => ({ ...current, [key]: value }));
    setCreated(null); setError("");
  }

  function validate() {
    if (!channel) return "Selecciona el número que será propietario de la plantilla.";
    if (!/^[a-z][a-z0-9_]{0,511}$/.test(form.name)) return "Escribe un nombre válido para la plantilla.";
    if (!form.body.trim()) return "Escribe el mensaje de la plantilla.";
    const expected = (values: number[]) => !values.length || values.every((value, index) => value === index + 1);
    if (!expected(headerPositions) || !expected(bodyPositions)) return "Las variables deben ser consecutivas desde {{1}} en cada sección.";
    if (headerPositions.length > 1) return "El encabezado admite como máximo una variable.";
    const requiredExamples = [...headerPositions.map(position => `header:${position}`), ...bodyPositions.map(position => `body:${position}`)];
    if (requiredExamples.some(key => !examples[key]?.trim())) return "Completa un ejemplo para cada variable.";
    return "";
  }

  function prepareCreate(event: React.FormEvent) {
    event.preventDefault();
    const message = validate();
    if (message) { setError(message); return; }
    confirmDialog.current?.showModal();
  }

  async function createTemplate() {
    setBusy(true); setError(""); confirmDialog.current?.close();
    try {
      const result = await apiRequest<CreatedTemplate>("/whatsapp-conversations/templates/", token, {
        method: "POST",
        body: JSON.stringify({ business_address: channel, template: { ...form, examples, buttons: previewButtons } }),
      });
      setCreated(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo crear la plantilla.");
    } finally { setBusy(false); }
  }

  async function deleteTemplate() {
    if (!created || deleteName !== created.name) return;
    setBusy(true); setError(""); deleteDialog.current?.close();
    try {
      await apiRequest("/whatsapp-conversations/templates/", token, {
        method: "DELETE",
        body: JSON.stringify({ business_address: created.business_address, name: created.name }),
      });
      setCreated(null); setDeleteName(""); setForm(initialForm); setExamples({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo eliminar la plantilla.");
    } finally { setBusy(false); }
  }

  if (!channels.length) return <section className="comm-panel p-5"><h3>Sin números configurados</h3><p className="mt-2 text-sm">Conecta un número de WhatsApp para crear plantillas.</p></section>;

  return <><div className="template-builder-workspace">
    <form className="comm-panel template-builder-form" onSubmit={prepareCreate}>
      <header className="comm-section-heading"><div><h3>Nueva plantilla</h3><p>Completa el mensaje que Meta revisará. Su aprobación no es inmediata.</p></div></header>
      <div className="template-builder-fields">
        <label>Número propietario<select className={inputClass} value={channel} disabled={busy} onChange={event => setChannel(event.target.value)}><option value="">Selecciona un número</option>{channels.map(item => <option key={item.business_address} value={item.business_address}>{item.label} · {item.business_address.replace("whatsapp:", "").replace("meta:", "ID ")}</option>)}</select></label>
        <label>Nombre interno<input className={inputClass} value={form.name} disabled={busy} placeholder="invitacion_nueva_temporada" onChange={event => update("name", normalizeName(event.target.value))} /><small>Minúsculas, números y guiones bajos. No se puede cambiar después.</small></label>
        <div className="template-builder-row"><label>Categoría<select className={inputClass} value={form.category} disabled={busy} onChange={event => update("category", event.target.value)}><option value="MARKETING">Difusión</option><option value="UTILITY">Servicio</option></select></label><label>Idioma<select className={inputClass} value={form.language} disabled={busy} onChange={event => update("language", event.target.value)}><option value="es_MX">Español (México)</option><option value="es">Español</option><option value="en_US">Inglés (EE. UU.)</option><option value="en">Inglés</option></select></label></div>
        <label>Encabezado <span>Opcional</span><input className={inputClass} maxLength={60} value={form.header} disabled={busy} placeholder="Una frase breve" onChange={event => update("header", event.target.value)} /><small>{form.header.length}/60 · admite una variable</small></label>
        <label>Mensaje<textarea className={inputClass} rows={7} maxLength={1024} value={form.body} disabled={busy} placeholder="Hola {{1}}, queremos invitarte…" onChange={event => update("body", event.target.value)} /><small>{form.body.length}/1024 · usa variables consecutivas: {"{{1}}"}, {"{{2}}"}</small></label>
        {(headerPositions.length > 0 || bodyPositions.length > 0) && <fieldset className="template-builder-examples"><legend>Ejemplos para revisión</legend><p>Meta los usa para entender las variables; no se envían como valores fijos.</p>{headerPositions.map(position => <label key={`header:${position}`}>Encabezado {`{{${position}}}`}<input className={inputClass} value={examples[`header:${position}`] || ""} disabled={busy} placeholder={position === 1 ? "Martha" : `Ejemplo ${position}`} onChange={event => setExamples(current => ({ ...current, [`header:${position}`]: event.target.value }))} /></label>)}{bodyPositions.map(position => <label key={`body:${position}`}>Mensaje {`{{${position}}}`}<input className={inputClass} value={examples[`body:${position}`] || ""} disabled={busy} placeholder={position === 1 ? "Martha" : `Ejemplo ${position}`} onChange={event => setExamples(current => ({ ...current, [`body:${position}`]: event.target.value }))} /></label>)}</fieldset>}
        <label>Pie del mensaje <span>Opcional</span><input className={inputClass} maxLength={60} value={form.footer} disabled={busy} placeholder="Responde BAJA para dejar de recibir mensajes." onChange={event => update("footer", event.target.value)} /><small>{form.footer.length}/60 · no admite variables</small></label>
        <fieldset className="template-builder-buttons"><legend>Respuestas rápidas <span>Opcional</span></legend>{form.buttons.map((button, index) => <div key={index}><input className={inputClass} maxLength={25} value={button} disabled={busy} placeholder={`Botón ${index + 1}`} onChange={event => update("buttons", form.buttons.map((value, position) => position === index ? event.target.value : value))} />{form.buttons.length > 1 && <button type="button" aria-label={`Quitar botón ${index + 1}`} onClick={() => update("buttons", form.buttons.filter((_value, position) => position !== index))}>×</button>}</div>)}{form.buttons.length < 3 && <button type="button" className={secondaryButtonClass} onClick={() => update("buttons", [...form.buttons, ""])}>Agregar respuesta rápida</button>}</fieldset>
        {error && <p role="alert" className="comm-error">{error}</p>}
        {created && <section className="template-builder-success" role="status"><div><strong>Plantilla enviada a revisión</strong><span>{created.name} · {created.status === "APPROVED" ? "Aprobada" : "En revisión"}</span></div><button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => deleteDialog.current?.showModal()}>Eliminar plantilla</button></section>}
        <footer className="template-builder-actions"><button type="submit" className={primaryButtonClass} disabled={busy}>{busy ? "Procesando…" : "Revisar y enviar a Meta"}</button></footer>
      </div>
    </form>
    <WhatsAppTemplatePreview className="template-builder-preview" channelLabel={selectedChannel?.label || "WhatsApp"} text={previewText} buttons={previewButtons} templateName={form.name || "borrador"} meta={`${form.category === "MARKETING" ? "Difusión" : "Servicio"} · ${form.language.replace("_", "-")}`} />
  </div>

  <dialog ref={confirmDialog} className="comm-template-modal" aria-labelledby="template-create-confirm-title"><article><header className="comm-template-modal-heading"><div><p className="comm-eyebrow">Confirmar envío</p><h3 id="template-create-confirm-title">Enviar “{form.name}” a revisión</h3></div><button type="button" className="comm-template-modal-close" aria-label="Cerrar" onClick={() => confirmDialog.current?.close()}>×</button></header><div className="comm-template-modal-body"><p>Se creará en <strong>{selectedChannel?.label}</strong>. Meta decidirá si la aprueba y puede ajustar su categoría.</p><dl className="template-builder-confirm"><div><dt>Categoría</dt><dd>{form.category === "MARKETING" ? "Difusión" : "Servicio"}</dd></div><div><dt>Idioma</dt><dd>{form.language}</dd></div><div><dt>Variables</dt><dd>{headerPositions.length + bodyPositions.length}</dd></div></dl></div><footer className="comm-template-modal-footer template-builder-dialog-actions"><button type="button" className={secondaryButtonClass} onClick={() => confirmDialog.current?.close()}>Volver</button><button type="button" className={primaryButtonClass} onClick={createTemplate}>Enviar a revisión</button></footer></article></dialog>

  <dialog ref={deleteDialog} className="comm-template-modal" aria-labelledby="template-delete-confirm-title"><article><header className="comm-template-modal-heading"><div><p className="comm-eyebrow">Acción permanente</p><h3 id="template-delete-confirm-title">Eliminar “{created?.name}”</h3></div><button type="button" className="comm-template-modal-close" aria-label="Cerrar" onClick={() => deleteDialog.current?.close()}>×</button></header><div className="comm-template-modal-body"><p>Dualhook y Meta eliminarán todas las traducciones que usen este nombre. Escribe el nombre exacto para continuar.</p><label>Nombre de la plantilla<input className={inputClass} value={deleteName} onChange={event => setDeleteName(event.target.value)} /></label></div><footer className="comm-template-modal-footer template-builder-dialog-actions"><button type="button" className={secondaryButtonClass} onClick={() => deleteDialog.current?.close()}>Cancelar</button><button type="button" className="template-builder-delete" disabled={!created || deleteName !== created.name || busy} onClick={deleteTemplate}>Eliminar definitivamente</button></footer></article></dialog>
  </>;
}
