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
      <div><h3 className="text-lg font-semibold">Respuestas automáticas del chatbot</h3>
        <p className="mt-1 text-sm">Número: {value.business_address.replace("whatsapp:", "")}</p>
      </div>
      <button type="button" role="switch" aria-checked={enabled} aria-label="Respuestas automáticas del chatbot"
        data-state={known ? (enabled ? "on" : "off") : "unknown"}
        disabled={disabled || saving || !known || !value.id}
        className={`relative inline-flex h-12 w-44 shrink-0 items-center rounded-full border-2 text-white shadow-sm transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${known ? enabled ? "border-emerald-800 bg-emerald-700" : "border-red-800 bg-red-600" : "border-zinc-500 bg-zinc-500"}`}
        onClick={async () => {
          if (enabled === false && !window.confirm("¿Encender el chatbot para este número? Responderá a los próximos mensajes según su configuración.")) return;
          setSaving(true); setError("");
          try { await onSave(!enabled); }
          catch (err) { setError(err instanceof Error ? err.message : "No se pudo cambiar el estado. Intenta de nuevo."); }
          finally { setSaving(false); }
        }}><span aria-hidden="true" className={`absolute left-1 top-1 h-9 w-9 rounded-full bg-white shadow-md transition-transform duration-200 ${enabled ? "translate-x-32" : "translate-x-0"}`} />
        <span className={`absolute text-sm font-bold uppercase tracking-wide ${enabled ? "left-4 right-14" : "left-14 right-4"}`}>{saving ? "Guardando…" : known ? enabled ? "Prendido" : "Apagado" : "Sin confirmar"}</span>
      </button>
    </div>
    <p className="mt-3 text-sm">Apagado: no envía respuestas automáticas, dentro ni fuera de horario. Puedes seguir recibiendo mensajes y enviar plantillas o respuestas manuales.</p>
    <p className="mt-2 text-sm">Este botón guarda inmediatamente. Al encenderlo no se recuperan respuestas pendientes ni se reactivan chats tomados por una persona. Un envío que ya esté en curso no se puede retirar.</p>
    {disabled && <p className="mt-2 text-sm">Guarda o descarta los cambios del formulario antes de usar este botón.</p>}
    {!known && <p role="alert">El servidor aún no confirma el interruptor. Actualiza después del despliegue.</p>}
    {!value.id && <p>Guarda primero la configuración de este número.</p>}
    {error && <p role="alert" className="mt-3 font-semibold text-red-700">{error}</p>}
  </section>;
}
