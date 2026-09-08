import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function TournamentDialog({ title, description, submitLabel, onSubmit, onClose, children, danger = false }: {
  title: string; description?: string; submitLabel: string; danger?: boolean; children: ReactNode;
  onSubmit: (form: FormData) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (saving.current) return;
    const form = new FormData(event.currentTarget);
    saving.current = true; setBusy(true); setError("");
    try { await onSubmit(form); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar. Revisa los datos e inténtalo otra vez."); }
    finally { saving.current = false; setBusy(false); }
  }
  return createPortal(<dialog ref={dialog} className="tournament-ui tournament-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!saving.current) onClose(); }}>
    <header><div><h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="tournament-icon-button" aria-label="Cerrar formulario" disabled={busy} onClick={onClose}><X size={18} /></button></header>
    <form onSubmit={submit}><fieldset disabled={busy}><legend className="sr-only">{title}</legend><div className="tournament-dialog-body">{children}{error && <p className="tournament-feedback error" role="alert">{error}</p>}</div><footer><button autoFocus type="button" className="tournament-button secondary" onClick={onClose}>Cancelar</button><button className={`tournament-button ${danger ? "danger" : "primary"}`} disabled={busy}>{busy ? "Guardando…" : submitLabel}</button></footer></fieldset></form>
  </dialog>, document.body);
}
