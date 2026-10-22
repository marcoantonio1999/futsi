import { useEffect, useId, useRef, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';

export function ExamFiltersModal({ title, open, onOpenChange, busy, active, error, children }: {
  title: string; open: boolean; onOpenChange: (value: boolean) => void;
  busy: boolean; active: boolean; error?: string; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    if (!open) { if (modal.open) modal.close(); return; }
    if (!modal.open) modal.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);
  const close = () => { if (!busy) onOpenChange(false); };
  return <section className="exam-filter-controls">
    <div className="exam-actions"><button type="button" disabled={busy} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(true)}><SlidersHorizontal size={18} aria-hidden="true"/>Filtros</button>{active && <span className="exam-tag">Filtros aplicados</span>}</div>
    <dialog ref={dialog} id={id} className="exam-filter-modal" aria-labelledby={`${id}-title`} aria-busy={busy} onClose={() => onOpenChange(false)} onCancel={event => { event.preventDefault(); close(); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }}>
      <header className="exam-filter-modal-heading"><h2 id={`${id}-title`}>{title}</h2><button type="button" disabled={busy} onClick={close}>Cerrar</button></header>
      <div className="exam-filter-modal-content">{error && <p role="alert" className="exam-error">{error}</p>}{children}</div>
    </dialog>
  </section>;
}
