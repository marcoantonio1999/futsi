import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, MessageSquareText, UsersRound } from "lucide-react";
import { downloadApiFile } from "../../api";
import type { WhatsAppConversation } from "../../types";
import { primaryButtonClass } from "./model";

export function ChatExportPanel({ token, scopeQuery, conversations }: {
  token: string;
  scopeQuery: string;
  conversations: WhatsAppConversation[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contactCount = useMemo(() => new Set(conversations.map(conversation =>
    `${conversation.business_address || ""}|${conversation.contact_phone}`,
  )).size, [conversations]);
  const messageCount = useMemo(() => conversations.reduce((total, conversation) => total + conversation.messages.length, 0), [conversations]);

  async function download() {
    setBusy(true);
    setError("");
    try {
      await downloadApiFile(
        `/whatsapp-conversations/export/?${scopeQuery}`,
        token,
        `chats-whatsapp-futsi-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo generar el Excel.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="comm-panel chat-export-panel">
    <header className="comm-section-heading"><div><h3>Exportar contactos e historial de WhatsApp</h3><p>Descarga el directorio completo y los mensajes disponibles de la sede y el número seleccionados arriba.</p></div><FileSpreadsheet size={22} aria-hidden="true" /></header>
    <div className="chat-export-body">
      <div className="chat-export-copy">
        <h4>El Excel incluye dos pestañas</h4>
        <ul>
          <li><strong>Conversaciones:</strong> todos los contactos guardados en FUTSI, con número de atención, sede, teléfono, nombre y cantidades de mensajes recibidos y enviados.</li>
          <li><strong>Mensajes:</strong> los mensajes almacenados individualmente en FUTSI, una fila por mensaje, con fecha, dirección, texto y estado.</li>
        </ul>
        <p>Si eliges “Todas las sedes” y “Todos los números”, se exportará todo el historial disponible.</p>
      </div>
      <aside className="chat-export-summary" aria-label="Resumen de la exportación">
        <div><UsersRound size={18} aria-hidden="true" /><span>Chats visibles ahora</span><strong>{contactCount.toLocaleString("es-MX")}</strong></div>
        <div><MessageSquareText size={18} aria-hidden="true" /><span>Mensajes visibles ahora</span><strong>{messageCount.toLocaleString("es-MX")}</strong></div>
        <p>El Excel también incorpora los contactos históricos del directorio, aunque no aparezcan en la bandeja actual.</p>
        <button type="button" className={primaryButtonClass} disabled={busy} onClick={download}><Download size={17} aria-hidden="true" />{busy ? "Generando Excel…" : "Descargar Excel"}</button>
        {error && <p role="alert" className="comm-error">{error}</p>}
      </aside>
    </div>
  </section>;
}
