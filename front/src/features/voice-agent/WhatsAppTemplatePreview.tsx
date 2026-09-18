import "./bulk-templates.css";

export function WhatsAppTemplatePreview({
  channelLabel,
  text = "",
  templateName = "",
  meta = "",
  buttons = [],
  className = "",
}: {
  channelLabel: string;
  text?: string;
  templateName?: string;
  meta?: string;
  buttons?: string[];
  className?: string;
}) {
  return <aside className={`bulk-preview ${className}`.trim()} aria-label="Vista previa del mensaje de WhatsApp">
    <header><div><strong>Vista previa</strong><span>WhatsApp</span></div><small>Así lo verá el destinatario</small></header>
    <div className="bulk-phone">
      <div className="bulk-phone-bar"><span aria-hidden="true">{channelLabel.charAt(0).toUpperCase()}</span><div><strong>{channelLabel}</strong><small>cuenta de empresa</small></div></div>
      <div className="bulk-phone-chat">
        {templateName ? <div className="bulk-phone-message"><div className="bulk-phone-bubble"><p>{text || "Plantilla sin contenido de texto."}</p><time>12:45 <span aria-label="Entregado">✓✓</span></time></div>{buttons.map((button, index) => <span className="bulk-phone-button" key={`${button}:${index}`}>{button}</span>)}</div> : <div className="bulk-phone-empty"><strong>Selecciona una plantilla</strong><span>El mensaje aparecerá aquí con datos de ejemplo.</span></div>}
      </div>
    </div>
    <footer><strong>{templateName || "Sin plantilla seleccionada"}</strong>{templateName && meta && <span>{meta}</span>}</footer>
  </aside>;
}
