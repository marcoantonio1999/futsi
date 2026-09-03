import { type FormEvent, useMemo, useState } from "react";
import {
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  ClipboardPenLine,
  MessageCircle,
  Save,
  Search,
  UserRound,
  X,
} from "lucide-react";
import type {
  WhatsAppConversation,
  WhatsAppConversationStatus,
  WhatsAppFollowUpAssignee,
} from "../../types";
import { formatDateTime, inputClass, primaryButtonClass, secondaryButtonClass } from "./model";

const statusLabels: Record<WhatsAppConversationStatus, string> = {
  active: "En proceso",
  completed: "Finalizada",
  canceled: "Cancelada",
  failed: "Fallida",
};

const kindLabels: Record<string, string> = {
  menu: "Menú",
  faq: "Preguntas y respuestas",
  trial_booking: "Reservación",
  payment_reminder: "Cobranza",
};

const statusClasses: Record<WhatsAppConversationStatus, string> = {
  active: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200",
  canceled: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
};

export function WhatsAppConversationsPanel({
  assignees,
  conversations,
  onUpdateConversation,
}: {
  assignees: WhatsAppFollowUpAssignee[];
  conversations: WhatsAppConversation[];
  onUpdateConversation: (
    conversation: WhatsAppConversation,
    payload: {
      follow_up_required: boolean;
      follow_up_assigned_to: number | null;
      follow_up_notes: string;
    },
  ) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | WhatsAppConversationStatus>("all");
  const [followUp, setFollowUp] = useState<"all" | "required" | "clear">("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es-MX");
    return [...conversations]
      .filter((conversation) => status === "all" || conversation.status === status)
      .filter((conversation) => {
        if (followUp === "required") return conversation.follow_up_required;
        if (followUp === "clear") return !conversation.follow_up_required;
        return true;
      })
      .filter((conversation) => {
        if (!needle) return true;
        return [
          conversation.contact_phone,
          conversation.site_name ?? "",
          conversation.booking_child_first_name ?? "",
          conversation.booking_responsible_name ?? "",
          kindLabels[conversation.kind] ?? conversation.kind,
          ...conversation.messages.map((message) => message.body),
        ].some((value) => value.toLocaleLowerCase("es-MX").includes(needle));
      })
      .sort(
        (left, right) =>
          new Date(right.last_message_at ?? right.created_at).getTime() -
          new Date(left.last_message_at ?? left.created_at).getTime(),
      );
  }, [conversations, followUp, query, status]);

  const active = conversations.filter((item) => item.status === "active").length;
  const completed = conversations.filter((item) => item.status === "completed").length;
  const needsFollowUp = conversations.filter((item) => item.follow_up_required).length;

  return (
    <div className="grid min-w-0 gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <ConversationMetric icon={CircleDashed} label="En proceso" value={active} tone="amber" />
        <ConversationMetric icon={CheckCircle2} label="Finalizadas" value={completed} tone="emerald" />
        <ConversationMetric icon={ClipboardPenLine} label="Requieren seguimiento" value={needsFollowUp} tone="rose" />
      </div>

      <section className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="grid gap-2 md:grid-cols-[minmax(240px,1fr)_210px_210px]">
          <label className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 text-zinc-400" size={17} />
            <input
              className={`${inputClass} pl-9`}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar teléfono, responsable o alumno"
              type="search"
              value={query}
            />
          </label>
          <select
            className={inputClass}
            onChange={(event) => setStatus(event.target.value as typeof status)}
            value={status}
          >
            <option value="all">Todos los estados</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select
            className={inputClass}
            onChange={(event) => setFollowUp(event.target.value as typeof followUp)}
            value={followUp}
          >
            <option value="all">Todo el seguimiento</option>
            <option value="required">Requiere seguimiento</option>
            <option value="clear">Sin seguimiento pendiente</option>
          </select>
        </div>
      </section>

      <div className="grid gap-3">
        {filtered.map((conversation) => {
          const expanded = expandedId === conversation.id;
          const whatsappNumber = conversation.contact_phone.replace(/\D/g, "");
          return (
            <article
              className="motion-card overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
              key={conversation.id}
            >
              <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      className="inline-flex items-center gap-2 font-semibold text-zinc-950 hover:text-emerald-700 dark:text-zinc-50 dark:hover:text-emerald-300"
                      href={`https://wa.me/${whatsappNumber}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <MessageCircle size={17} className="text-emerald-600" />
                      {conversation.contact_phone}
                    </a>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusClasses[conversation.status]}`}>
                      {statusLabels[conversation.status]}
                    </span>
                    <span className="rounded-full bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">
                      {kindLabels[conversation.kind] ?? "WhatsApp"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                    Último mensaje {formatDateTime(conversation.last_message_at ?? conversation.created_at)}
                    {conversation.site_name ? ` · ${conversation.site_name}` : ""}
                  </p>
                  {conversation.booking ? (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
                      <span className="inline-flex items-center gap-1">
                        <CalendarCheck2 size={15} /> Reserva #{conversation.booking}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <UserRound size={15} /> {conversation.booking_child_first_name}
                        {conversation.booking_responsible_name ? ` · ${conversation.booking_responsible_name}` : ""}
                      </span>
                    </div>
                  ) : null}
                  {conversation.failure_reason ? (
                    <p className="mt-2 text-sm text-red-700 dark:text-red-300">{conversation.failure_reason}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    {conversation.follow_up_required ? (
                      <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                        Requiere seguimiento
                      </span>
                    ) : (
                      <span className="rounded-full bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        Sin seguimiento pendiente
                      </span>
                    )}
                    {conversation.follow_up_assigned_to_name ? (
                      <span className="inline-flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
                        <UserRound size={14} /> {conversation.follow_up_assigned_to_name}
                      </span>
                    ) : null}
                  </div>
                  {conversation.follow_up_notes ? (
                    <p className="mt-2 line-clamp-2 text-sm text-zinc-600 dark:text-zinc-300">
                      {conversation.follow_up_notes}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <button
                    className={secondaryButtonClass}
                    onClick={() => setEditingId(editingId === conversation.id ? null : conversation.id)}
                    type="button"
                  >
                    <ClipboardPenLine size={15} /> Seguimiento
                  </button>
                  <button
                    className={secondaryButtonClass}
                    onClick={() => setExpandedId(expanded ? null : conversation.id)}
                    type="button"
                  >
                    <MessageCircle size={15} /> {conversation.messages.length} mensajes
                    {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </button>
                </div>
              </div>

              {editingId === conversation.id ? (
                <FollowUpEditor
                  assignees={assignees}
                  conversation={conversation}
                  onCancel={() => setEditingId(null)}
                  onSave={async (payload) => {
                    await onUpdateConversation(conversation, payload);
                    setEditingId(null);
                  }}
                />
              ) : null}
              {expanded ? <ConversationMessages conversation={conversation} /> : null}
            </article>
          );
        })}

        {!filtered.length ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-white px-4 py-12 text-center dark:border-zinc-700 dark:bg-zinc-950">
            <MessageCircle className="mx-auto text-zinc-400" size={30} />
            <p className="mt-3 font-semibold text-zinc-800 dark:text-zinc-100">
              {conversations.length ? "No hay conversaciones con este filtro" : "Aún no hay mensajes de WhatsApp"}
            </p>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Las conversaciones del asistente aparecerán aquí automáticamente.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FollowUpEditor({
  assignees,
  conversation,
  onCancel,
  onSave,
}: {
  assignees: WhatsAppFollowUpAssignee[];
  conversation: WhatsAppConversation;
  onCancel: () => void;
  onSave: (payload: {
    follow_up_required: boolean;
    follow_up_assigned_to: number | null;
    follow_up_notes: string;
  }) => Promise<void>;
}) {
  const [required, setRequired] = useState(conversation.follow_up_required);
  const [assignedTo, setAssignedTo] = useState(
    conversation.follow_up_assigned_to ? String(conversation.follow_up_assigned_to) : "",
  );
  const [notes, setNotes] = useState(conversation.follow_up_notes);
  const [saving, setSaving] = useState(false);
  const eligibleAssignees = assignees.filter(
    (assignee) =>
      assignee.role !== "site_coordinator"
      || assignee.primary_site === conversation.site,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        follow_up_required: required,
        follow_up_assigned_to: assignedTo ? Number(assignedTo) : null,
        follow_up_notes: notes.trim(),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="grid gap-3 border-t border-zinc-200 bg-amber-50/60 p-4 dark:border-zinc-800 dark:bg-amber-950/10"
      onSubmit={submit}
    >
      <label className="flex items-center gap-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
        <input
          checked={required}
          className="size-4 accent-rose-700"
          onChange={(event) => setRequired(event.target.checked)}
          type="checkbox"
        />
        Esta conversación requiere seguimiento
      </label>
      <div className="grid gap-3 md:grid-cols-[280px_minmax(0,1fr)]">
        <label className="grid gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Responsable asignado
          <select
            className={inputClass}
            onChange={(event) => setAssignedTo(event.target.value)}
            value={assignedTo}
          >
            <option value="">Sin asignar</option>
            {eligibleAssignees.map((assignee) => (
              <option key={assignee.id} value={assignee.id}>
                {assignee.name}{assignee.primary_site_name ? ` · ${assignee.primary_site_name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Notas de seguimiento
          <textarea
            className={`${inputClass} min-h-24 resize-y`}
            maxLength={4000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Ej. Llamar mañana para confirmar documentación."
            value={notes}
          />
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button className={secondaryButtonClass} disabled={saving} onClick={onCancel} type="button">
          <X size={15} /> Cancelar
        </button>
        <button className={primaryButtonClass} disabled={saving} type="submit">
          <Save size={15} /> {saving ? "Guardando..." : "Guardar seguimiento"}
        </button>
      </div>
    </form>
  );
}

function ConversationMessages({ conversation }: { conversation: WhatsAppConversation }) {
  return (
    <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="mx-auto grid max-h-[560px] max-w-3xl gap-3 overflow-y-auto pr-1">
        {conversation.messages.map((message) => {
          const outbound = message.direction === "outbound";
          return (
            <div className={`flex ${outbound ? "justify-start" : "justify-end"}`} key={message.id}>
              <div
                className={`max-w-[86%] rounded-xl px-3 py-2 text-sm shadow-sm ${
                  outbound
                    ? "rounded-tl-sm border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    : "rounded-tr-sm bg-emerald-700 text-white"
                }`}
              >
                <p className="whitespace-pre-wrap leading-6">{message.body || "Mensaje sin texto"}</p>
                <p className={`mt-1 text-[11px] ${outbound ? "text-zinc-400" : "text-emerald-100"}`}>
                  {outbound ? "FUTSI" : "Contacto"} · {formatDateTime(message.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConversationMetric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof MessageCircle;
  label: string;
  value: number;
  tone: "amber" | "emerald" | "zinc" | "rose";
}) {
  const iconClass = {
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
    zinc: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    rose: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200",
  }[tone];
  return (
    <article className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-3">
        <span className={`grid size-9 place-items-center rounded-md ${iconClass}`}><Icon size={18} /></span>
        <div>
          <p className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
        </div>
      </div>
    </article>
  );
}
