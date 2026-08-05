import { Ban, EyeOff, ScanFace, ShieldCheck, X } from "lucide-react";
import { Button } from "./components";
import { compactNumber, localTime } from "./format";
import { useEscape } from "./hooks";
import type { UnknownAttendance } from "./types";

export function UnknownIgnoreModal({
  rows,
  saving,
  onClose,
  onConfirm,
}: {
  rows: UnknownAttendance[];
  saving: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
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
        aria-labelledby="unknown-ignore-title"
        aria-modal="true"
        className="my-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-white/20 bg-zinc-50 shadow-2xl"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4">
          <div>
            <p className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-widest text-amber-700">
              <EyeOff size={14} /> Control de asistencia
            </p>
            <h2 id="unknown-ignore-title" className="mt-1 text-lg font-bold tracking-tight text-zinc-900">
              Excluir {rows.length === 1 ? "esta persona" : `${rows.length} personas`} de la lista
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
              FaceGuard seguirá reconociendo estas identidades para descartarlas automáticamente, pero ya no registrará su asistencia ni mostrará nuevas detecciones.
            </p>
          </div>
          <button
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <div className="p-4 sm:p-5">
          <div className="grid max-h-[42vh] gap-2 overflow-y-auto sm:grid-cols-2">
            {rows.map((row) => (
              <article
                className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2.5"
                key={row.subject_id}
              >
                <img
                  alt={row.temporary_name}
                  className="size-16 rounded-lg border border-zinc-200 bg-zinc-100 object-cover"
                  src={`/api/images/unknown/${encodeURIComponent(row.subject_id)}?v=${encodeURIComponent(row.last_seen_at)}`}
                />
                <div className="min-w-0">
                  <strong className="block truncate text-xs text-zinc-800">{row.temporary_name}</strong>
                  <span className="mt-1 block text-[9px] leading-4 text-zinc-500">
                    {compactNumber(row.detection_count)} detecciones · última vez {localTime(row.last_seen_at)}
                  </span>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Info icon={<ScanFace size={15} />} title="Sí se compara">
              La referencia facial permanece activa en la base local.
            </Info>
            <Info icon={<Ban size={15} />} title="No pasa lista">
              Sus apariciones futuras no crean asistencia ni recortes.
            </Info>
            <Info icon={<ShieldCheck size={15} />} title="Es reversible">
              La evidencia actual se conserva y podrás restaurarla.
            </Info>
          </div>
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-zinc-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] text-zinc-500">No se eliminarán fotografías ni asistencias históricas.</p>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={onClose} type="button">Cancelar</Button>
            <Button disabled={!rows.length || saving} onClick={onConfirm} tone="danger" type="button">
              <EyeOff size={13} /> {saving ? "Excluyendo..." : `Excluir ${rows.length}`}
            </Button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function Info({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-950">
      <strong className="flex items-center gap-2 text-[10px]">
        <span className="text-amber-700">{icon}</span> {title}
      </strong>
      <p className="mt-1 text-amber-900/80">{children}</p>
    </div>
  );
}
