import "./bulk-templates.css";

export function WhatsAppTemplatePreview({
  channelLabel,
  text = "",
  templateName = "",
  meta = "",
  buttons = [],
  className = "",
  loading = false,
}: {
  channelLabel: string;
  text?: string;
  templateName?: string;
  meta?: string;
  buttons?: string[];
  className?: string;
  loading?: boolean;
}) {
  return <aside className={`bulk-preview ${loading ? "is-loading" : ""} ${className}`.trim()} aria-label="Vista previa del mensaje de WhatsApp" aria-busy={loading}>
    <header><div><strong>Vista previa</strong><span>WhatsApp</span></div><small>Así lo verá el destinatario</small></header>
    <div className="bulk-phone">
      <div className="bulk-phone-bar">{loading ? <>
        <span className="bulk-skeleton bulk-skeleton-avatar" aria-hidden="true" />
        <div className="bulk-preview-loading-heading" aria-hidden="true"><i className="bulk-skeleton" /><i className="bulk-skeleton short" /></div>
      </> : <><span aria-hidden="true">{channelLabel.charAt(0).toUpperCase()}</span><div><strong>{channelLabel}</strong><small>cuenta de empresa</small></div></>}</div>
      <div className="bulk-phone-chat">
        {loading ? <div className="bulk-phone-loading" aria-hidden="true"><i className="bulk-skeleton" /><i className="bulk-skeleton" /><i className="bulk-skeleton medium" /><i className="bulk-skeleton short" /></div> : templateName ? <div className="bulk-phone-message"><div className="bulk-phone-bubble" aria-live="polite" aria-atomic="true"><p>{text || "Plantilla sin contenido de texto."}</p><time>12:45 <span aria-label="Entregado">✓✓</span></time></div>{buttons.map((button, index) => <span className="bulk-phone-button" key={`${button}:${index}`}>{button}</span>)}</div> : <div className="bulk-phone-empty"><strong>Selecciona una plantilla</strong><span>El mensaje aparecerá aquí con datos de ejemplo.</span></div>}
      </div>
    </div>
    <footer>{loading ? <><i className="bulk-skeleton" aria-hidden="true" /><i className="bulk-skeleton short" aria-hidden="true" /><span className="bulk-visually-hidden" role="status">Cargando vista previa de la plantilla…</span></> : <><strong>{templateName || "Sin plantilla seleccionada"}</strong>{templateName && meta && <span>{meta}</span>}</>}</footer>
  </aside>;
}
