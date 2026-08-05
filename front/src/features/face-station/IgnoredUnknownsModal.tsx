import { useCallback, useEffect, useState } from "react";
import { EyeOff, LoaderCircle, RotateCcw, Search, ShieldCheck, X } from "lucide-react";
import { stationApi, toQuery } from "./api";
import { Button, EmptyState, LoadingState } from "./components";
import { compactNumber, localTime } from "./format";
import { useDebouncedValue, useEscape } from "./hooks";
import type { IgnoredUnknownsResponse, UnknownAttendance } from "./types";

const PAGE_SIZE = 48;

export function IgnoredUnknownsModal({
  onClose,
  onRestore,
}: {
  onClose: () => void;
  onRestore: (row: UnknownAttendance) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query);
  const [rows, setRows] = useState<UnknownAttendance[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [restoringId, setRestoringId] = useState("");
  useEscape(onClose, !restoringId);

  const load = useCallback(async (offset = 0) => {
    if (offset) setLoadingMore(true);
    else setLoading(true);
    try {
      const result = await stationApi<IgnoredUnknownsResponse>(
        `/api/unknowns/ignored?${toQuery({ q: debouncedQuery, offset, limit: PAGE_SIZE })}`,
      );
      setRows((current) => offset ? [...current, ...result.items] : result.items);
      setTotal(result.total);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar las personas excluidas.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [debouncedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(row: UnknownAttendance) {
    setRestoringId(row.subject_id);
    try {
      await onRestore(row);
      setRows((current) => current.filter((item) => item.subject_id !== row.subject_id));
      setTotal((current) => Math.max(0, current - 1));
    } finally {
      setRestoringId("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-emerald-950/80 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && !restoringId && onClose()}
      role="presentation"
    >
      <section
        aria-labelledby="ignored-unknowns-title"
        aria-modal="true"
        className="my-auto flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-zinc-50 shadow-2xl"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4">
          <div>
            <p className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-widest text-amber-700">
              <EyeOff size={14} /> Exclusiones automáticas
            </p>
            <h2 id="ignored-unknowns-title" className="mt-1 text-lg font-bold tracking-tight text-zinc-900">
              Personas fuera de la lista
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-zinc-500">
              Se reconocen para descartarlas, pero no generan asistencia, tarjetas recientes ni nuevos recortes.
            </p>
          </div>
          <button
            aria-label="Cerrar"
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
            disabled={Boolean(restoringId)}
            onClick={onClose}
            type="button"
          >
            <X size={17} />
          </button>
        </header>

        <div className="flex flex-col gap-3 border-b border-zinc-200 bg-white px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="relative block w-full sm:max-w-sm">
            <Search className="absolute left-3 top-2.5 text-zinc-400" size={14} />
            <input
              autoFocus
              className="min-h-9 w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 text-[10px] font-medium outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por número o nombre..."
              type="search"
              value={query}
            />
          </label>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[9px] font-bold text-amber-800">
            <ShieldCheck size={12} /> {compactNumber(total)} identidades protegidas
          </span>
        </div>

        <div className="station-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? <LoadingState label="Cargando personas excluidas..." /> : error ? (
            <EmptyState
              action={<Button onClick={() => void load()}>Reintentar</Button>}
              detail={error}
              error
              title="No se pudo abrir la lista"
            />
          ) : !rows.length ? (
            <EmptyState
              detail={debouncedQuery ? "Prueba con otro número o limpia la búsqueda." : "Cuando excluyas una identidad podrás administrarla desde aquí."}
              title={debouncedQuery ? "No hay coincidencias" : "No hay personas excluidas"}
            />
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((row) => (
                <article className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm" key={row.subject_id}>
                  <img
                    alt={row.temporary_name}
                    className="size-[72px] rounded-lg border border-zinc-200 bg-zinc-100 object-cover"
                    loading="lazy"
                    src={`/api/images/unknown/${encodeURIComponent(row.subject_id)}?v=${encodeURIComponent(row.last_seen_at)}`}
                  />
                  <div className="min-w-0">
                    <strong className="block truncate text-[11px] text-zinc-800">{row.temporary_name}</strong>
                    <p className="mt-1 text-[9px] leading-4 text-zinc-500">
                      {compactNumber(row.detection_count)} detecciones · última vez {localTime(row.last_seen_at)}
                    </p>
                    <Button
                      className="mt-2 min-h-8 w-full px-2 text-[10px]"
                      disabled={Boolean(restoringId)}
                      onClick={() => void restore(row)}
                      type="button"
                    >
                      {restoringId === row.subject_id
                        ? <><LoaderCircle className="animate-spin" size={12} /> Restaurando...</>
                        : <><RotateCcw size={12} /> Restaurar a la lista</>}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {!loading && rows.length < total ? (
            <Button
              className="mt-4 w-full"
              disabled={loadingMore}
              onClick={() => void load(rows.length)}
              type="button"
            >
              {loadingMore ? <LoaderCircle className="animate-spin" size={13} /> : null}
              {loadingMore ? "Cargando..." : `Cargar más · ${compactNumber(rows.length)} de ${compactNumber(total)}`}
            </Button>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-zinc-200 bg-white px-5 py-4">
          <p className="text-[10px] text-zinc-500">Restaurar vuelve a mostrar toda su asistencia conservada.</p>
          <Button disabled={Boolean(restoringId)} onClick={onClose} type="button">Cerrar</Button>
        </footer>
      </section>
    </div>
  );
}
