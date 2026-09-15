import { useState } from "react";
import type { WhatsAppAutomationSettings } from "../../types";

export function WhatsAppBotSwitch({ value, disabled, onSave }: {
  value: WhatsAppAutomationSettings;
  disabled: boolean;
  onSave: (enabled: boolean) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const known = typeof value.bot_enabled === "boolean";
  const enabled = value.bot_enabled === true;
  return <section className="rounded-md border border-zinc-300 bg-white p-5 text-zinc-900 dark:bg-zinc-900 dark:text-white">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h3 className="text-lg font-semibold">Chatbot {known ? (enabled ? "encendido" : "apagado") : "sin estado confirmado"}</h3>
        <p className="mt-1 text-sm">Número: {value.business_address.replace("whatsapp:", "")}</p>
      </div>
      <button type="button" role="switch" aria-checked={enabled} aria-label="Respuestas automáticas del chatbot"
        disabled={disabled || saving || !known || !value.id}
        className="rounded-md bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-50"
        onClick={async () => {
          if (enabled === false && !window.confirm("¿Encender el chatbot para este número? Responderá a los próximos mensajes según su configuración.")) return;
          setSaving(true); setError("");
          try { await onSave(!enabled); }
          catch (err) { setError(err instanceof Error ? err.message : "No se pudo cambiar el estado. Intenta de nuevo."); }
          finally { setSaving(false); }
        }}>{saving ? "Guardando…" : enabled ? "Apagar chatbot" : "Encender chatbot"}</button>
    </div>
    <p className="mt-3 text-sm">Apagado: no envía respuestas automáticas, dentro ni fuera de horario. Puedes seguir recibiendo mensajes y enviar plantillas o respuestas manuales.</p>
    <p className="mt-2 text-sm">Este botón guarda inmediatamente. Al encenderlo no se recuperan respuestas pendientes ni se reactivan chats tomados por una persona. Un envío que ya esté en curso no se puede retirar.</p>
    {disabled && <p className="mt-2 text-sm">Guarda o descarta los cambios del formulario antes de usar este botón.</p>}
    {!known && <p role="alert">El servidor aún no confirma el interruptor. Actualiza después del despliegue.</p>}
    {!value.id && <p>Guarda primero la configuración de este número.</p>}
    {error && <p role="alert" className="mt-3 font-semibold text-red-700">{error}</p>}
  </section>;
}
