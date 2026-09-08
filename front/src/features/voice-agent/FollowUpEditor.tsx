import { useState, type FormEvent } from "react";
import { X, Save } from "lucide-react";
import type { WhatsAppConversation, WhatsAppFollowUpAssignee } from "../../types";
import { inputClass, secondaryButtonClass, primaryButtonClass } from "./model";

export function FollowUpEditor({
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
  const [error, setError] = useState("");
  const eligibleAssignees = assignees.filter(
    (assignee) =>
      assignee.role !== "site_coordinator"
      || assignee.primary_site === conversation.site,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        follow_up_required: required,
        follow_up_assigned_to: assignedTo ? Number(assignedTo) : null,
        follow_up_notes: notes.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
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
      {error && <p role="alert" className="comm-error">{error}</p>}
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
