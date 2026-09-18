import { useEffect, useState, type FormEvent } from "react";
import { Bot, Clock3, MessageCircle, Save, ShieldCheck } from "lucide-react";
import type { WhatsAppAutomationSettings } from "../../types";
import { EditableAssistantMessage } from "./EditableAssistantMessage";
import { OpenAIModelSelect } from "./OpenAIModelSelect";
import { inputClass, primaryButtonClass } from "./model";
import "./assistant-settings.css";

const weekdays = [
  { value: 0, short: "Lun", label: "Lunes" },
  { value: 1, short: "Mar", label: "Martes" },
  { value: 2, short: "Mié", label: "Miércoles" },
  { value: 3, short: "Jue", label: "Jueves" },
  { value: 4, short: "Vie", label: "Viernes" },
  { value: 5, short: "Sáb", label: "Sábado" },
  { value: 6, short: "Dom", label: "Domingo" },
];

const settingsSections = [
  { id: "general", label: "Modelo" },
  { id: "messages", label: "Saludos y avisos" },
  { id: "attention", label: "Horarios y atención" },
  { id: "classification", label: "Clasificación" },
  { id: "knowledge", label: "Conocimiento" },
] as const;
type SettingsSection = typeof settingsSections[number]["id"];

export function WhatsAppAutomationSettingsPanel({
  value,
  onSave,
  siteId,
  onDirtyChange,
  token,
}: {
  token?: string;
  value: WhatsAppAutomationSettings | null;
  siteId: number | null;
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
  const [section, setSection] = useState<SettingsSection>("messages");

  useEffect(() => {
    if (!value) return;
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
    if (!value || invalidSchedule || saving) return;
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
    || !Number.isFinite(confidenceThreshold)
    || !outOfHoursAcknowledgement.trim()
  );

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="comm-reference comm-toolbar"><span>Número empresarial: <strong>{value.business_address}</strong></span><span>{dirty ? "Cambios sin guardar" : "Configuración guardada"}</span></div>
      <nav className="comm-settings-nav" aria-label="Secciones de configuración del asistente">
        {settingsSections.map(item => <button key={item.id} type="button" aria-current={section === item.id ? "page" : undefined}
          aria-controls={`assistant-settings-${item.id}`} disabled={saving} onClick={() => setSection(item.id)}>{item.label}</button>)}
      </nav>
      {invalidSchedule && <p role="alert" className="comm-error text-sm">Revisa los campos antes de guardar:
        {!siteId && <span className="ml-2">Selecciona una sede específica en el filtro superior.</span>}
        {!model.trim() && <button type="button" className="ml-2 underline" onClick={() => setSection("general")}>Modelo</button>}
        {(!welcomeMessage.trim() || !outOfHoursAcknowledgement.trim()) && <button type="button" className="ml-2 underline" onClick={() => setSection("messages")}>Saludos y avisos</button>}
        {(!days.length || startsAt >= endsAt || !Number.isFinite(delayMinutes) || delayMinutes < 1 || delayMinutes > 60) && <button type="button" className="ml-2 underline" onClick={() => setSection("attention")}>Horarios y atención</button>}
        {(!Number.isFinite(confidenceThreshold) || confidenceThreshold < 50 || confidenceThreshold > 100) && <button type="button" className="ml-2 underline" onClick={() => setSection("classification")}>Clasificación</button>}
        {!assistantInstructions.trim() && <button type="button" className="ml-2 underline" onClick={() => setSection("knowledge")}>Conocimiento</button>}
      </p>}
      <section id="assistant-settings-general" hidden={section !== "general"} className="comm-panel comm-settings-section">
        <header className="comm-section-heading"><div><h3>Modelo del asistente</h3><p>Estos ajustes corresponden a la sede y al número seleccionados arriba.</p></div></header>
        <div className="comm-stats-body grid gap-4 sm:grid-cols-2">
          <OpenAIModelSelect token={token} value={model} savedModel={value.openai_model} disabled={saving}
            onChange={next => { setModel(next); setSaved(false); }} />
          <p className="text-sm sm:col-span-2">Memoria: 24 mensajes recientes. El modelo elegido se usa para responder y clasificar contactos. Las credenciales y la conexión con Dualhook permanecen en el servidor.</p>
        </div>
      </section>
      <section id="assistant-settings-messages" hidden={section !== "messages"} className="comm-panel comm-settings-section">
        <header className="comm-section-heading"><div><h3>Saludos y avisos</h3><p>Así verá los mensajes el contacto. Usa el lápiz para editar cada texto aquí mismo.</p></div></header>
        <div className="comm-stats-body comm-settings-preview">
          <EditableAssistantMessage title="Saludo inicial" hint="Se envía al primer saludo." value={welcomeMessage} savedValue={value.welcome_message} disabled={saving}
            onChange={next => { setWelcomeMessage(next); setSaved(false); }} />
          <EditableAssistantMessage title="Aviso fuera de horario" hint="Acompaña la respuesta inmediata del asistente y ofrece continuar con una persona." value={outOfHoursAcknowledgement} savedValue={value.out_of_hours_acknowledgement} disabled={saving}
            onChange={next => { setOutOfHoursAcknowledgement(next); setSaved(false); }} />
        </div>
      </section>
      <div id="assistant-settings-attention" hidden={section !== "attention"} className="comm-settings-section grid gap-4">
      <section className="comm-settings-advanced">
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
      </section>
      </div>

      <section id="assistant-settings-classification" hidden={section !== "classification"} className="comm-settings-advanced comm-settings-section">
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
        </div>

        <div className="mt-4 grid gap-2 text-sm md:grid-cols-3">
          <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"><strong>Prospecto confiable:</strong> respuesta inmediata.</p>
          <p className="rounded-md border border-violet-200 bg-violet-50 p-3 text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-100"><strong>Cliente confiable:</strong> atención humana.</p>
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><strong>Ambiguo:</strong> aplica la espera configurada.</p>
        </div>
      </section>

      <section hidden={section !== "attention"} className="comm-settings-advanced comm-settings-section">
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
      </section>

      <section id="assistant-settings-knowledge" hidden={section !== "knowledge"} className="comm-settings-advanced comm-settings-section">
        <div className="flex items-center gap-2">
          <MessageCircle className="text-emerald-700" size={20} />
          <div>
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Conocimiento e instrucciones</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Estos cambios se aplican a los próximos mensajes sin volver a desplegar.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4">
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
      </section>

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
