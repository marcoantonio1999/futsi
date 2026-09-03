import { type FormEvent, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Clock3,
  MessageSquareText,
  Phone,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import type { CallOutcome, TrialBooking, VoiceCall, VoiceCallTechnicalStatus } from "../../types";
import {
  formatDateTime,
  formatDuration,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  type CallActions,
} from "./model";

const outcomeLabels: Record<CallOutcome, string> = {
  pending: "Pendiente",
  successful: "Exitosa",
  unsuccessful: "No exitosa",
};

const technicalStatusLabels: Record<VoiceCallTechnicalStatus, string> = {
  queued: "En cola",
  ringing: "Sonando",
  "in-progress": "En curso",
  completed: "Completada",
  busy: "Ocupado",
  failed: "Fallida",
  "no-answer": "Sin respuesta",
  canceled: "Cancelada",
};

export function VoiceCallsPanel({
  calls,
  bookings,
  onReviewCall,
}: {
  calls: VoiceCall[];
  bookings: TrialBooking[];
} & CallActions) {
  const [query, setQuery] = useState("");
  const [outcome, setOutcome] = useState<"all" | CallOutcome>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [failureCall, setFailureCall] = useState<VoiceCall | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const bookingById = useMemo(() => new Map(bookings.map((booking) => [booking.id, booking])), [bookings]);
  const filteredCalls = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es-MX");
    return [...calls]
      .filter((call) => outcome === "all" || call.review_outcome === outcome)
      .filter((call) => {
        if (!needle) return true;
        const booking = call.booking ? bookingById.get(call.booking) : null;
        return [
          call.from_number,
          call.call_sid,
          call.summary,
          call.booking_child_first_name ?? "",
          booking?.responsible_name ?? "",
          booking?.child_first_name ?? "",
        ].some((value) => value.toLocaleLowerCase("es-MX").includes(needle));
      })
      .sort((left, right) => {
        const leftDate = left.started_at ?? left.created_at;
        const rightDate = right.started_at ?? right.created_at;
        return new Date(rightDate).getTime() - new Date(leftDate).getTime();
      });
  }, [bookingById, calls, outcome, query]);

  const pending = calls.filter((call) => call.review_outcome === "pending").length;
  const successful = calls.filter((call) => call.review_outcome === "successful").length;
  const unsuccessful = calls.filter((call) => call.review_outcome === "unsuccessful").length;

  async function markSuccessful(call: VoiceCall) {
    setSavingId(call.id);
    try {
      await onReviewCall(call, { review_outcome: "successful" });
    } finally {
      setSavingId(null);
    }
  }

  async function markUnsuccessful(call: VoiceCall, failureReason: string) {
    setSavingId(call.id);
    try {
      await onReviewCall(call, { review_outcome: "unsuccessful", failure_reason: failureReason });
      setFailureCall(null);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <CallMetric icon={CircleDashed} label="Pendientes de revisión" tone="amber" value={pending} />
        <CallMetric icon={CheckCircle2} label="Llamadas exitosas" tone="emerald" value={successful} />
        <CallMetric icon={XCircle} label="Llamadas no exitosas" tone="red" value={unsuccessful} />
      </div>

      <section className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_210px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={17} />
            <input
              className={`${inputClass} pl-9`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar número, persona o llamada"
              type="search"
              value={query}
            />
          </label>
          <select className={inputClass} onChange={(event) => setOutcome(event.target.value as typeof outcome)} value={outcome}>
            <option value="all">Todos los resultados</option>
            {Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
      </section>

      <div className="grid gap-3">
        {filteredCalls.map((call) => {
          const booking = call.booking ? bookingById.get(call.booking) : null;
          const expanded = expandedId === call.id;
          const isSaving = savingId === call.id;
          return (
            <article className="motion-card overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950" key={call.id}>
              <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <a className="inline-flex items-center gap-2 font-semibold text-zinc-950 hover:text-emerald-700 dark:text-zinc-50 dark:hover:text-emerald-300" href={`tel:${call.from_number}`}>
                      <Phone size={16} /> {call.from_number}
                    </a>
                    <TechnicalStatus status={call.technical_status} />
                    <OutcomeStatus label="IA" outcome={call.ai_outcome} />
                    <OutcomeStatus label="Revisión" outcome={call.review_outcome} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500 dark:text-zinc-400">
                    <span className="inline-flex items-center gap-1"><Clock3 size={14} /> {formatDateTime(call.started_at ?? call.created_at)}</span>
                    <span>Duración {formatDuration(call.duration_seconds)}</span>
                    {call.token_usage?.total_tokens != null ? (
                      <span title={`Entrada ${call.token_usage.input_tokens ?? 0} · salida ${call.token_usage.output_tokens ?? 0}`}>
                        OpenAI {call.token_usage.total_tokens.toLocaleString("es-MX")} tokens
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck
                        size={14}
                        className={
                          call.consent_withdrawn_at
                            ? "text-amber-600"
                            : call.consent_granted
                              ? "text-emerald-600"
                              : "text-zinc-400"
                        }
                      />
                      {call.consent_withdrawn_at
                        ? "Consentimiento retirado"
                        : call.consent_granted
                          ? "Consentimiento otorgado"
                          : "Sin consentimiento"}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-zinc-700 dark:text-zinc-200">
                    {call.summary || "La llamada todavía no tiene un resumen generado."}
                  </p>
                  {booking || call.booking_child_first_name ? (
                    <p className="mt-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                      Prueba vinculada: <strong>{booking?.child_first_name ?? call.booking_child_first_name}</strong>
                      {booking ? ` · responsable ${booking.responsible_name} · ${booking.site_name}` : ""}
                    </p>
                  ) : null}
                  {call.review_outcome === "unsuccessful" && call.failure_reason ? (
                    <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
                      <strong>Motivo:</strong> {call.failure_reason}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 xl:max-w-[390px] xl:justify-end">
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={isSaving}
                    onClick={() => void markSuccessful(call)}
                    type="button"
                  >
                    <CheckCircle2 size={15} /> Marcar exitosa
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-55 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
                    disabled={isSaving}
                    onClick={() => setFailureCall(call)}
                    type="button"
                  >
                    <XCircle size={15} /> No exitosa
                  </button>
                  <button
                    className={secondaryButtonClass}
                    onClick={() => setExpandedId(expanded ? null : call.id)}
                    type="button"
                  >
                    <MessageSquareText size={15} /> Transcripción
                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                </div>
              </div>

              {expanded ? <Transcript call={call} /> : null}
            </article>
          );
        })}

        {!filteredCalls.length ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
            <MessageSquareText className="mx-auto text-zinc-400" size={28} />
            <p className="mt-3 font-semibold text-zinc-800 dark:text-zinc-100">
              {calls.length ? "No hay llamadas con este filtro" : "Aún no hay llamadas registradas"}
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Las llamadas atendidas por el agente aparecerán aquí para revisión.
            </p>
          </div>
        ) : null}
      </div>

      {failureCall ? (
        <FailureReasonModal
          call={failureCall}
          saving={savingId === failureCall.id}
          onClose={() => setFailureCall(null)}
          onSave={(reason) => markUnsuccessful(failureCall, reason)}
        />
      ) : null}
    </div>
  );
}

function Transcript({ call }: { call: VoiceCall }) {
  return (
    <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-zinc-950 dark:text-zinc-50">Transcripción de la llamada</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Referencia {call.call_sid.slice(-10)}</p>
        </div>
        <span className="rounded-md bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {call.transcript_segments.length} segmentos
        </span>
      </div>
      <div className="grid max-h-[520px] gap-3 overflow-y-auto pr-1">
        {call.transcript_segments.map((segment) => {
          const isCaller = segment.speaker === "caller";
          const isSystem = segment.speaker === "system";
          return (
            <div className={`flex ${isCaller ? "justify-start" : "justify-end"}`} key={segment.id}>
              <div
                className={`max-w-[92%] rounded-md px-3 py-2 text-sm leading-6 sm:max-w-[78%] ${
                  isSystem
                    ? "border border-zinc-300 bg-white text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
                    : isCaller
                      ? "bg-white text-zinc-800 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-800"
                      : "bg-emerald-700 text-white"
                }`}
              >
                <p className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${segment.speaker === "assistant" ? "text-emerald-100" : "text-zinc-500"}`}>
                  {segment.speaker === "caller" ? "Persona que llama" : segment.speaker === "assistant" ? "Agente FUTSI" : "Sistema"}
                </p>
                <p className="whitespace-pre-wrap break-words">{segment.text}</p>
              </div>
            </div>
          );
        })}
        {!call.transcript_segments.length ? (
          <p className="rounded-md border border-dashed border-zinc-300 px-3 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No hay segmentos de transcripción para esta llamada.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function FailureReasonModal({
  call,
  saving,
  onClose,
  onSave,
}: {
  call: VoiceCall;
  saving: boolean;
  onClose: () => void;
  onSave: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(call.failure_reason);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await onSave(reason.trim());
  }

  return createPortal(
    <div className="fixed inset-0 z-[1300] grid place-items-center overflow-y-auto bg-zinc-950/55 px-3 py-6">
      <form className="motion-card w-full max-w-lg overflow-hidden rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950" onSubmit={submit}>
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">Resultado de llamada</p>
            <h3 className="mt-1 text-lg font-semibold text-zinc-950 dark:text-zinc-50">Marcar como no exitosa</h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{call.from_number}</p>
          </div>
          <button aria-label="Cerrar" className={secondaryButtonClass} onClick={onClose} type="button"><X size={16} /></button>
        </div>
        <div className="grid gap-4 p-4">
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">Motivo *</span>
            <textarea
              autoFocus
              className={`${inputClass} min-h-28 resize-y`}
              maxLength={2000}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ej. La persona no confirmó horarios, llamada interrumpida o datos incompletos."
              required
              value={reason}
            />
          </label>
          <div className="flex flex-col-reverse gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800 sm:flex-row sm:justify-end">
            <button className={secondaryButtonClass} disabled={saving} onClick={onClose} type="button">Cancelar</button>
            <button className={primaryButtonClass} disabled={saving || !reason.trim()} type="submit">
              {saving ? "Guardando..." : "Guardar resultado"}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function OutcomeStatus({ label, outcome }: { label: string; outcome: CallOutcome }) {
  const styles: Record<CallOutcome, string> = {
    pending: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
    successful: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
    unsuccessful: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-200",
  };
  return <span className={`rounded-md px-2 py-1 text-xs font-semibold ${styles[outcome]}`}>{label}: {outcomeLabels[outcome]}</span>;
}

function TechnicalStatus({ status }: { status: VoiceCallTechnicalStatus }) {
  return (
    <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-200">
      {technicalStatusLabels[status] ?? status}
    </span>
  );
}

function CallMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof CircleDashed;
  label: string;
  value: number;
  tone: "amber" | "emerald" | "red";
}) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-50",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/25 dark:text-emerald-50",
    red: "border-red-200 bg-red-50 text-red-950 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-50",
  };
  return (
    <article className={`flex items-center gap-3 rounded-md border p-4 ${tones[tone]}`}>
      <span className="grid size-9 place-items-center rounded-md bg-white/65 dark:bg-zinc-950/25"><Icon size={18} /></span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">{label}</p>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
      </div>
    </article>
  );
}
