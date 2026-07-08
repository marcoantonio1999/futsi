import type { UIEvent } from "react";
import { Bug } from "lucide-react";
import { EvidenceImage } from "../automatic-attendance";
import { appearanceTimeLabel, qualityRejectText, qualityText, type UnknownRejectedFaceDebug } from "./model";

export function UnknownRejectedFacesDebugSection({
  count,
  error,
  items,
  loading,
  nextOffset,
  onLoad,
  onScroll,
  open,
  token,
}: {
  count: number;
  error: string;
  items: UnknownRejectedFaceDebug[];
  loading: boolean;
  nextOffset?: number | null;
  onLoad: () => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  open: boolean;
  token: string;
}) {
  return (
    <section className="rounded-md border border-dashed border-amber-300 bg-amber-50/50 shadow-sm dark:border-amber-900/70 dark:bg-amber-950/10">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="inline-flex items-center gap-2 font-semibold text-amber-950 dark:text-amber-100">
            <Bug size={16} /> Debug de caras rechazadas
          </h3>
          <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">Solo para diagnostico: muestra caras detectadas que no pasaron calidad para desconocido consolidado.</p>
        </div>
        <button
          className="inline-flex items-center justify-center rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-zinc-950 dark:text-amber-100"
          disabled={loading}
          onClick={onLoad}
          type="button"
        >
          {open ? "Ocultar rechazos" : "Ver caras rechazadas"}
        </button>
      </div>
      {open ? (
        <div className="border-t border-amber-200 p-4 dark:border-amber-900/60">
          <div className="mb-3 flex flex-col gap-1 text-sm text-amber-900 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <p>{loading && !items.length ? "Cargando rechazos..." : `${items.length} de ${count} caras cargadas`}</p>
            {nextOffset != null ? <p className="text-xs text-amber-700 dark:text-amber-200">Desplazate al final para cargar mas.</p> : null}
          </div>
          {error ? <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <div className="max-h-[1280px] overflow-y-auto pr-1" onScroll={onScroll}>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {items.map((item, index) => (
                <article key={`${item.capture_id}-${item.face_index}-${index}`} className="rounded-md border border-amber-200 bg-white p-2 dark:border-amber-900/60 dark:bg-zinc-950">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase text-amber-700 dark:text-amber-300">Recorte</p>
                      <EvidenceImage url={item.image_url} token={token} fit="contain" ratio="square" />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase text-zinc-500">Captura</p>
                      <EvidenceImage url={item.capture_image_url} token={token} fit="cover" ratio="square" />
                    </div>
                  </div>
                  <div className="mt-2">
                    <p className="break-words text-xs font-semibold text-zinc-950 dark:text-zinc-50">{item.local_file_name || item.capture_id.slice(0, 8)}</p>
                    <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{item.captured_at ? appearanceTimeLabel(item.captured_at) : "Sin hora"} - cara {item.face_index}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">{qualityText(item.quality)}</p>
                    {qualityRejectText(item.quality) ? <p className="mt-1 text-[11px] font-semibold text-red-700">Rechazo: {qualityRejectText(item.quality)}</p> : null}
                    {item.error_message ? <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{item.error_message}</p> : null}
                  </div>
                </article>
              ))}
              {!loading && !items.length ? <p className="text-sm text-amber-900 dark:text-amber-100">No hay caras rechazadas con detalle para este dia.</p> : null}
            </div>
            {loading && items.length ? <p className="py-3 text-center text-xs font-semibold text-amber-700 dark:text-amber-200">Cargando mas caras...</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
