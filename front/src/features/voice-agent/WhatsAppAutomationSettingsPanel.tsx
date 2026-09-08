import { useEffect, useState, type FormEvent } from "react";
import { Bot, Clock3, MessageCircle, Save, ShieldCheck } from "lucide-react";
import type { Site, WhatsAppAutomationSettings } from "../../types";
import { MessageBody } from "./MessageBody";
import { inputClass, primaryButtonClass } from "./model";

const weekdays = [
  { value: 0, short: "Lun", label: "Lunes" },
  { value: 1, short: "Mar", label: "Martes" },
  { value: 2, short: "Mié", label: "Miércoles" },
  { value: 3, short: "Jue", label: "Jueves" },
  { value: 4, short: "Vie", label: "Viernes" },
  { value: 5, short: "Sáb", label: "Sábado" },
  { value: 6, short: "Dom", label: "Domingo" },
];

export function WhatsAppAutomationSettingsPanel({
  value,
  onSave,
  sites,
  onDirtyChange,
}: {
  value: WhatsAppAutomationSettings | null;
  sites: Site[];
  onDirtyChange?: (dirty: boolean) => void;
  onSave: (payload: {
    site: number | null;
    openai_model: string;
    human_first_enabled: boolean;
    business_days: number[];
    business_hours_start: string;
    business_hours_end: string;
    human_response_delay_seconds: number;
    welcome_message: string;
    assistant_instructions: string;
    contact_classification_enabled: boolean;
    classification_confidence_threshold: number;
    out_of_hours_acknowledgement: string;
  }) => Promise<boolean>;
}) {
  const [siteId, setSiteId] = useState<number | null>(value?.site ?? null);
  const [model, setModel] = useState(value?.openai_model || value?.effective_model || "");
  const [enabled, setEnabled] = useState(value?.human_first_enabled ?? true);
  const [days, setDays] = useState<number[]>(value?.business_days ?? [0, 1, 2, 3, 4]);
  const [startsAt, setStartsAt] = useState(value?.business_hours_start ?? "09:00");
  const [endsAt, setEndsAt] = useState(value?.business_hours_end ?? "18:00");
  const [delayMinutes, setDelayMinutes] = useState(
    Math.max(1, Math.round((value?.human_response_delay_seconds ?? 600) / 60)),
  );
  const [welcomeMessage, setWelcomeMessage] = useState(value?.welcome_message ?? "");
  const [assistantInstructions, setAssistantInstructions] = useState(
    value?.assistant_instructions ?? "",
  );
  const [classificationEnabled, setClassificationEnabled] = useState(
    value?.contact_classification_enabled ?? true,
  );
  const [confidenceThreshold, setConfidenceThreshold] = useState(
    value?.classification_confidence_threshold ?? 80,
  );
  const [outOfHoursAcknowledgement, setOutOfHoursAcknowledgement] = useState(
    value?.out_of_hours_acknowledgement ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!value) return;
    setSiteId(value.site ?? null);
    setModel(value.openai_model || value.effective_model || "");
    setEnabled(value.human_first_enabled);
    setDays(value.business_days);
    setStartsAt(value.business_hours_start);
    setEndsAt(value.business_hours_end);
    setDelayMinutes(Math.max(1, Math.round(value.human_response_delay_seconds / 60)));
    setWelcomeMessage(value.welcome_message);
    setAssistantInstructions(value.assistant_instructions);
    setClassificationEnabled(value.contact_classification_enabled);
    setConfidenceThreshold(value.classification_confidence_threshold);
    setOutOfHoursAcknowledgement(value.out_of_hours_acknowledgement);
  }, [value]);

  function toggleDay(day: number) {
    setSaved(false);
    setDays((current) => (
      current.includes(day)
        ? current.filter((item) => item !== day)
        : [...current, day].sort((left, right) => left - right)
    ));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value || !days.length || startsAt >= endsAt || saving) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const didSave = await onSave({
        site: siteId,
        openai_model: model.trim(),
        human_first_enabled: enabled,
        business_days: days,
        business_hours_start: startsAt,
        business_hours_end: endsAt,
        human_response_delay_seconds: Math.max(1, Math.min(60, delayMinutes)) * 60,
        welcome_message: welcomeMessage.trim(),
        assistant_instructions: assistantInstructions.trim(),
        contact_classification_enabled: classificationEnabled,
        classification_confidence_threshold: Math.max(50, Math.min(100, confidenceThreshold)),
        out_of_hours_acknowledgement: outOfHoursAcknowledgement.trim(),
      });
      setSaved(didSave);
      if (!didSave) setError("No se guardaron los cambios. Intenta de nuevo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  const dirty = value ? siteId !== (value.site ?? null) || model !== (value.openai_model || value.effective_model || "")
    || enabled !== value.human_first_enabled || days.join() !== value.business_days.join()
    || startsAt.slice(0, 5) !== value.business_hours_start.slice(0, 5) || endsAt.slice(0, 5) !== value.business_hours_end.slice(0, 5)
    || delayMinutes !== Math.max(1, Math.round(value.human_response_delay_seconds / 60))
    || welcomeMessage !== value.welcome_message || assistantInstructions !== value.assistant_instructions
    || classificationEnabled !== value.contact_classification_enabled || confidenceThreshold !== value.classification_confidence_threshold
    || outOfHoursAcknowledgement !== value.out_of_hours_acknowledgement : false;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  if (!value) {
    return (
      <section className="rounded-md border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        <p className="font-semibold">No se encontró un número empresarial activo.</p>
        <p className="mt-1 text-sm">Recibe primero un mensaje en el número de la cancha y vuelve a actualizar esta sección.</p>
      </section>
    );
  }

  const invalidSchedule = (
    !siteId || !model.trim() || !days.length
    || startsAt >= endsAt
    || !Number.isFinite(delayMinutes)
    || delayMinutes < 1
    || delayMinutes > 60
    || !welcomeMessage.trim()
    || !assistantInstructions.trim()
    || confidenceThreshold < 50
    || confidenceThreshold > 100
    || !outOfHoursAcknowledgement.trim()
  );

  return (
    <form className="grid gap-4" onSubmit={submit} onInvalidCapture={event => { const section = (event.target as HTMLElement).closest("details"); if (section) section.open = true; }}>
      <div className="comm-reference comm-toolbar"><span>Número empresarial: <strong>{value.business_address}</strong></span><span>{dirty ? "Cambios sin guardar" : "Configuración guardada"}</span></div>
      <section className="comm-panel">
        <header className="comm-section-heading"><div><h3>Sede y modelo del asistente</h3><p>El mismo motor, con información independiente para cada número.</p></div></header>
        <div className="comm-stats-body grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">Sede de este número
            <select className={inputClass} required value={siteId ?? ""} disabled={Boolean(value.site)} onChange={e => { setSiteId(Number(e.target.value) || null); setSaved(false); }}>
              <option value="">Selecciona una sede</option>
              {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
            </select>
            <span className="text-xs font-normal">El bot no preguntará qué sede quiere el cliente. Un número vinculado no se reasigna aquí para proteger su historial.</span>
          </label>
          <label className="grid gap-1 text-sm font-semibold">Modelo de OpenAI
            <input className={inputClass} required maxLength={120} value={model} placeholder="Identificador del modelo" onChange={e => { setModel(e.target.value); setSaved(false); }} />
            <span className="text-xs font-normal">Guardado: {value.openai_model || "Heredado del servidor (aún no fijado por sede)"}. El modelo debe estar disponible en la cuenta de API; no ingreses la clave secreta.</span>
          </label>
          <p className="text-sm sm:col-span-2">Memoria: 24 mensajes recientes. El modelo elegido se usa para responder y clasificar contactos. Las credenciales y la conexión con Dualhook permanecen en el servidor.</p>
        </div>
      </section>
      <section className="comm-panel"><header className="comm-section-heading"><div><h3>Así verá los mensajes el contacto</h3><p>Vista previa del texto que estás editando.</p></div></header><div className="comm-stats-body comm-settings-preview"><div><h4>Saludo inicial</h4><MessageBody body={welcomeMessage || "Escribe un saludo inicial."} /></div><div><h4>Aviso fuera de horario</h4><MessageBody body={outOfHoursAcknowledgement || "Escribe un aviso fuera de horario."} /></div></div></section>
      <details className="comm-settings-advanced"><summary>Atención humana y asistente</summary>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-emerald-700 text-white">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Atención humana primero</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                Dentro del horario laboral, el bot espera para que una persona pueda responder. Fuera de ese horario responde inmediatamente.
              </p>
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            <input
              checked={enabled}
              className="size-4 accent-emerald-700"
              onChange={(event) => {
                setEnabled(event.target.checked);
                setSaved(false);
              }}
              type="checkbox"
            />
            {enabled ? "Activa" : "Desactivada"}
          </label>
        </div>

        <div className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Número configurado</p>
          <p className="mt-1 font-semibold text-zinc-950 dark:text-zinc-50">
            {value.business_address.replace(/^whatsapp:/, "")}
          </p>
        </div>
      </details>

      <details className="comm-settings-advanced"><summary>Clasificación de contactos</summary>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-sky-700 text-white">
              <Bot size={20} />
            </span>
            <div>
              <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Clasificación de contactos</h3>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                Revisa primero si el teléfono pertenece a un cliente y después combina el mensaje y el historial para distinguir prospectos, clientes actuales y casos ambiguos.
              </p>
            </div>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
            <input
              checked={classificationEnabled}
              className="size-4 accent-sky-700"
              onChange={(event) => {
                setClassificationEnabled(event.target.checked);
                setSaved(false);
              }}
              type="checkbox"
            />
            {classificationEnabled ? "Activa" : "Desactivada"}
          </label>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <label className="grid content-start gap-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Confianza mínima (%)
            <input
              className={inputClass}
              max={100}
              min={50}
              onChange={(event) => {
                setConfidenceThreshold(Number(event.target.value));
                setSaved(false);
              }}
              type="number"
              value={confidenceThreshold}
            />
            <span className="text-xs font-normal text-zinc-500">Con menor confianza, espera al equipo.</span>
          </label>
          <label className="grid gap-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Opción de atención humana fuera de horario
            <textarea
              className={`${inputClass} min-h-28 py-2`}
              maxLength={2000}
              onChange={(event) => {
                setOutOfHoursAcknowledgement(event.target.value);
                setSaved(false);
              }}
              value={outOfHoursAcknowledgement}
            />
            <span className="text-xs font-normal text-zinc-500">
              Se agrega después de la respuesta inmediata del asistente y acompaña la opción para pedir que una persona continúe el chat.
            </span>
          </label>
        </div>

        <div className="mt-4 grid gap-2 text-sm md:grid-cols-3">
          <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"><strong>Prospecto confiable:</strong> respuesta inmediata.</p>
          <p className="rounded-md border border-violet-200 bg-violet-50 p-3 text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100"><strong>Cliente confiable:</strong> atención humana.</p>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><strong>Ambiguo:</strong> aplica la espera configurada.</p>
        </div>
      </details>

      <details className="comm-settings-advanced" open><summary>Horario de atención</summary>
        <div className="flex items-center gap-2">
          <Clock3 className="text-emerald-700" size={20} />
          <div>
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Horario laboral</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Hora de Ciudad de México.</p>
          </div>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Días de atención</legend>
          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {weekdays.map((day) => {
              const selected = days.includes(day.value);
              return (
                <button
                  aria-pressed={selected}
                  className={`rounded-md border px-2 py-2 text-sm font-semibold transition ${
                    selected
                      ? "border-emerald-700 bg-emerald-700 text-white"
                      : "border-zinc-300 bg-white text-zinc-600 hover:border-emerald-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                  }`}
                  key={day.value}
                  data-testid={`whatsapp-business-day-${day.value}`}
                  onClick={() => toggleDay(day.value)}
                  title={day.label}
                  type="button"
                >
                  {day.short}
                </button>
              );
            })}
          </div>
          {!days.length ? <p className="mt-2 text-sm text-red-700">Selecciona al menos un día.</p> : null}
        </fieldset>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Hora de apertura
            <input
              className={inputClass}
              data-testid="whatsapp-business-hours-start"
              onChange={(event) => {
                setStartsAt(event.target.value);
                setSaved(false);
              }}
              type="time"
              value={startsAt}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Hora de cierre
            <input
              className={inputClass}
              data-testid="whatsapp-business-hours-end"
              onChange={(event) => {
                setEndsAt(event.target.value);
                setSaved(false);
              }}
              type="time"
              value={endsAt}
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Espera antes del bot (minutos)
            <input
              className={inputClass}
              data-testid="whatsapp-human-delay-minutes"
              max={60}
              min={1}
              onChange={(event) => {
                setDelayMinutes(Number(event.target.value));
                setSaved(false);
              }}
              type="number"
              value={delayMinutes}
            />
          </label>
        </div>
        {startsAt >= endsAt ? (
          <p className="mt-2 text-sm text-red-700">La hora de cierre debe ser posterior a la apertura.</p>
        ) : null}
      </details>

      <details className="comm-settings-advanced"><summary>Mensajes e instrucciones</summary>
        <div className="flex items-center gap-2">
          <MessageCircle className="text-emerald-700" size={20} />
          <div>
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Mensajes del asistente</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Estos cambios se aplican a los próximos mensajes sin volver a desplegar.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Saludo inicial
            <textarea
              className={`${inputClass} min-h-28 py-2`}
              maxLength={2000}
              onChange={(event) => {
                setWelcomeMessage(event.target.value);
                setSaved(false);
              }}
              value={welcomeMessage}
            />
            <span className="text-xs font-normal text-zinc-500">
              Se envía al primer saludo. Puedes usar *texto* para mostrar negritas en WhatsApp.
            </span>
          </label>

          <label className="grid gap-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Instrucciones y datos confirmados de esta sede
            <textarea
              className={`${inputClass} min-h-40 py-2 text-sm leading-6`}
              maxLength={12000}
              onChange={(event) => {
                setAssistantInstructions(event.target.value);
                setSaved(false);
              }}
              value={assistantInstructions}
            />
            <span className="text-xs font-normal text-zinc-500">
              Incluye nombre del negocio, precios, horarios, servicios, ubicación, tono y temas que debe evitar. Esta es la fuente de información de esta sede; no se agregan datos de otras sedes. No incluyas contraseñas ni claves de API.
            </span>
          </label>
        </div>
      </details>

      <section className="comm-settings-save">
        <div className="flex items-start gap-2 text-sm text-emerald-950 dark:text-emerald-100">
          <Bot className="mt-0.5 shrink-0" size={17} />
          <p>
            {error ? <span role="alert" className="comm-error">{error}</span> : dirty ? "Tienes cambios sin guardar. Se aplicarán a los próximos mensajes." : "Todos los cambios están guardados."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {saved ? <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">Guardado</span> : null}
          <button className={primaryButtonClass} data-testid="whatsapp-settings-save" disabled={invalidSchedule || saving || !dirty} type="submit">
            <Save size={15} /> {saving ? "Guardando…" : "Guardar configuración"}
          </button>
        </div>
      </section>
    </form>
  );
}
