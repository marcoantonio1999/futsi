import { CheckCircle2, GitMerge, Images, ShieldCheck, X } from "lucide-react";
import { Button } from "./components";
import { compactNumber } from "./format";
import { useEscape } from "./hooks";
import type { UnknownAttendance } from "./types";

export function UnknownMergeModal({
  rows,
  targetId,
  saving,
  onTargetChange,
  onClose,
  onConfirm,
}: {
  rows: UnknownAttendance[];
  targetId: string;
  saving: boolean;
  onTargetChange: (subjectId: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const target = rows.find((row) => row.subject_id === targetId);
  useEscape(() => {
    if (!saving) onClose();
  });

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-emerald-950/80 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}
      role="presentation"
    >
      <section
        className="my-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-white/20 bg-zinc-50 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unknown-merge-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4">
          <div>
            <p className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-widest text-emerald-700">
              <GitMerge size={14} /> Revisión de identidad
            </p>
            <h2 id="unknown-merge-title" className="mt-1 text-lg font-bold tracking-tight text-zinc-900">
              Unir {rows.length} grupos como una persona
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
              Elige la identidad principal. Su nombre se conservará y recibirá todos los recortes,
              asistencias y referencias faciales de los demás grupos.
            </p>
          </div>
          <button
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
            disabled={saving}
            onClick={onClose}
            type="button"
            aria-label="Cerrar"
          >
            <X size={17} />
          </button>
        </header>

        <div className="p-4 sm:p-5">
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((row) => {
              const selected = row.subject_id === targetId;
              return (
                <label
                  key={row.subject_id}
                  className={`grid cursor-pointer grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border p-2.5 transition ${
                    selected
                      ? "border-emerald-400 bg-emerald-50 shadow-sm"
                      : "border-zinc-200 bg-white hover:border-emerald-200"
                  }`}
                >
                  <input
                    className="sr-only"
                    checked={selected}
                    disabled={saving}
                    name="merge-target"
                    onChange={() => onTargetChange(row.subject_id)}
                    type="radio"
                  />
                  <img
                    className="size-16 rounded-lg border border-zinc-200 bg-zinc-100 object-cover"
                    src={`/api/images/unknown/${encodeURIComponent(row.subject_id)}?v=${encodeURIComponent(row.last_seen_at)}`}
                    alt={row.temporary_name}
                  />
                  <span className="min-w-0">
                    <strong className="block truncate text-xs text-zinc-800">{row.temporary_name}</strong>
                    <span className="mt-1 block text-[9px] text-zinc-500">
                      {compactNumber(row.detection_count)} detecciones · calidad{" "}
                      {Math.round(Number(row.best_quality || 0) * 100)}%
                    </span>
                  </span>
                  {selected ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-1 text-[8px] font-extrabold text-white">
                      <CheckCircle2 size={11} /> Principal
                    </span>
                  ) : (
                    <span className="rounded-md bg-zinc-100 px-2 py-1 text-[8px] font-bold text-zinc-500">
                      Se unirá
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <div className="mt-4 grid gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[10px] leading-4 text-emerald-950 sm:grid-cols-2">
            <span className="flex items-start gap-2">
              <Images className="mt-0.5 shrink-0 text-emerald-700" size={14} />
              Los recortes originales se conservan y aparecerán juntos en el historial.
            </span>
            <span className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 shrink-0 text-emerald-700" size={14} />
              Los grupos secundarios quedan archivados y redirigen nuevas detecciones al principal.
            </span>
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-zinc-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] text-zinc-500">
            Se conservará <strong className="text-zinc-700">{target?.temporary_name || "la identidad seleccionada"}</strong>.
          </p>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={onClose} type="button">Cancelar</Button>
            <Button disabled={!target || saving} onClick={onConfirm} tone="primary" type="button">
              <GitMerge size={13} /> {saving ? "Uniendo grupos..." : "Confirmar unión"}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}
