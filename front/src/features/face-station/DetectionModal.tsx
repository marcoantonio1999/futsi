import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ban, CalendarDays, Camera, Clock3, Images, LoaderCircle, ScanFace, ShieldAlert, X } from "lucide-react";
import { stationApi, toQuery } from "./api";
import { EmptyState, LoadingState, MetricCard } from "./components";
import { compactNumber, dateLabel, localTime, monthLabel } from "./format";
import { useEscape, useInfiniteTrigger } from "./hooks";
import type { CropEvidence, DetectionDaySummary, DetectionDetail, DetectionTarget } from "./types";

export type { DetectionTarget } from "./types";

const CROP_BATCH_SIZE = 36;

interface CropRejectionResult {
  status: "rejected" | "already_rejected";
  subject_status?: string;
  remaining_crops?: number;
  remaining_references?: number;
  attendance_removed?: boolean;
}

function detailPath(target: DetectionTarget, cursor?: string) {
  const query: Record<string, string | number> = { limit: CROP_BATCH_SIZE };
  if (target.scope === "month") query.month = target.month;
  else query.date = target.date;
  if (target.includeAllCrops) query.include_all = 1;
  if (cursor) query.cursor = cursor;
  return `/api/detections/${encodeURIComponent(target.kind)}/${encodeURIComponent(target.subjectKey)}?${toQuery(query)}`;
}

function cropDate(crop: CropEvidence) {
  return crop.date || crop.seen_at.slice(0, 10);
}

export function DetectionModal({
  target,
  onClose,
  onNotify,
}: {
  target: DetectionTarget;
  onClose: () => void;
  onNotify: (message: string, tone?: "success" | "error") => void;
}) {
  const [detail, setDetail] = useState<DetectionDetail | null>(null);
  const [crops, setCrops] = useState<CropEvidence[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const [rejectCandidate, setRejectCandidate] = useState<CropEvidence | null>(null);
  const [rejectingCropId, setRejectingCropId] = useState<number | null>(null);
  const [rejectError, setRejectError] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const requestId = useRef(0);
  const loadingMoreRef = useRef(false);
  useEscape(onClose);

  useEffect(() => {
    const controller = new AbortController();
    const id = ++requestId.current;
    loadingMoreRef.current = false;
    setDetail(null);
    setCrops([]);
    setNextCursor(null);
    setError("");
    setPageError("");
    setLoading(true);
    setLoadingMore(false);
    stationApi<DetectionDetail>(detailPath(target), { signal: controller.signal })
      .then((payload) => {
        if (id !== requestId.current) return;
        setDetail(payload);
        setCrops(payload.crops || []);
        setNextCursor(payload.next_cursor || null);
      })
      .catch((reason: unknown) => {
        if (id === requestId.current && (reason as Error).name !== "AbortError") {
          setError(reason instanceof Error ? reason.message : "No se pudo cargar el historial.");
        }
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadVersion, target]);

  const rejectCrop = useCallback(async () => {
    if (!rejectCandidate || rejectingCropId !== null) return;
    setRejectingCropId(rejectCandidate.id);
    setRejectError("");
    try {
      const result = await stationApi<CropRejectionResult>(
        `/api/crops/${rejectCandidate.id}/reject`,
        {
          method: "POST",
          body: JSON.stringify({ reason: "Rechazado manualmente desde la revisión visual" }),
        },
      );
      setRejectCandidate(null);
      setReloadVersion((current) => current + 1);
      if (result.attendance_removed) {
        onNotify("Recorte rechazado. Se retiró la asistencia porque ya no quedó evidencia facial válida.");
      } else if (result.subject_status === "candidate") {
        onNotify("Recorte rechazado. La identidad volvió a revisión hasta obtener una referencia válida.");
      } else {
        onNotify("Recorte rechazado. Las demás evidencias válidas conservan la asistencia.");
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo rechazar el recorte.";
      setRejectError(message);
      onNotify(message, "error");
    } finally {
      setRejectingCropId(null);
    }
  }, [onNotify, rejectCandidate, rejectingCropId]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current) return;
    const id = requestId.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setPageError("");
    try {
      const payload = await stationApi<DetectionDetail>(detailPath(target, nextCursor));
      if (id !== requestId.current) return;
      setDetail((current) => current
        ? {
            ...current,
            summary: payload.summary || current.summary,
            days: payload.days || current.days,
            total_crops: payload.total_crops ?? current.total_crops,
          }
        : payload);
      setCrops((current) => {
        const existing = new Set(current.map((crop) => crop.id));
        return [...current, ...(payload.crops || []).filter((crop) => !existing.has(crop.id))];
      });
      setNextCursor(payload.next_cursor || null);
    } catch (reason) {
      if (id === requestId.current) {
        setPageError(reason instanceof Error ? reason.message : "No se pudieron cargar más recortes.");
      }
    } finally {
      if (id === requestId.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [nextCursor, target]);

  const sentinelRef = useInfiniteTrigger(
    () => void loadMore(),
    Boolean(nextCursor) && !loadingMore,
    scrollRoot,
  );
  const dayMetadata = useMemo(
    () => new Map((detail?.days || []).map((day) => [day.date, day])),
    [detail?.days],
  );
  const cropGroups = useMemo(() => {
    const groups = new Map<string, CropEvidence[]>();
    crops.forEach((crop) => {
      const date = cropDate(crop);
      const current = groups.get(date) || [];
      current.push(crop);
      groups.set(date, current);
    });
    return Array.from(groups, ([date, items]) => ({ date, items }));
  }, [crops]);
  const cropIndex = useMemo(
    () => new Map(crops.map((crop, index) => [crop.id, index])),
    [crops],
  );
  const totalCrops = Number(detail?.total_crops ?? detail?.summary.crops ?? crops.length);
  const isMonth = target.scope === "month";
  const canRejectCrops = target.kind === "unknown"
    && !detail?.subject.linked_person_key
    && ["candidate", "consolidated"].includes(detail?.subject.status || "");
  const subtitle = target.includeAllCrops
    ? isMonth
      ? `Todos los recortes conservados de ${monthLabel(target.month)}, incluidos los descartados por calidad.`
      : `Todos los recortes conservados del ${dateLabel(target.date)}, incluidos los descartados por calidad.`
    : isMonth
      ? `Evidencia representativa de ${monthLabel(target.month)}, agrupada por día. El conteo conserva todas las detecciones.`
    : target.kind === "known"
      ? [detail?.subject.group_name, detail?.subject.team_name].filter(Boolean).join(" · ") || "Persona registrada"
      : "Identidad temporal agrupada por similitud facial";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-emerald-950/75 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="presentation"
    >
      <section
        className="my-auto flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-white/20 bg-zinc-50 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detection-title"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-widest text-emerald-700">
              {isMonth ? <CalendarDays size={14} /> : <ScanFace size={14} />}
              {isMonth ? "Evidencia mensual" : "Historial del rostro"}
            </p>
            <h2 id="detection-title" className="mt-1 truncate text-lg font-bold tracking-tight">
              {detail?.subject.name || "Detalle de detecciones"}
            </h2>
            <p className="mt-1 text-xs text-zinc-500">{detail ? subtitle : "Cargando recortes guardados..."}</p>
          </div>
          <button
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50"
            onClick={onClose}
            type="button"
            aria-label="Cerrar"
          >
            <X size={17} />
          </button>
        </header>

        {detail ? (
          <div className="grid grid-cols-2 gap-2 border-b border-zinc-200 bg-zinc-50 p-4 lg:grid-cols-4">
            {isMonth ? (
              <MetricCard
                accent="emerald"
                label="Días con asistencia"
                value={compactNumber(detail.summary.attendance_days)}
                detail={`${compactNumber(detail.days?.length)} días con evidencia`}
              />
            ) : (
              <MetricCard accent="emerald" label="Detecciones" value={compactNumber(detail.summary.detections)} detail="Apariciones agrupadas" />
            )}
            <MetricCard
              accent="blue"
              label="Recortes"
              value={compactNumber(totalCrops)}
              detail={`${compactNumber(crops.length)} cargados · ${target.includeAllCrops ? "auditoría completa" : "selección por calidad y horario"}`}
            />
            <MetricCard
              accent="violet"
              label="Primera vez"
              value={isMonth ? dateLabel(detail.summary.first_seen_at?.slice(0, 10)) : localTime(detail.summary.first_seen_at)}
              detail={isMonth ? localTime(detail.summary.first_seen_at) : "Inicio del historial"}
            />
            <MetricCard
              accent="amber"
              label="Última vez"
              value={isMonth ? dateLabel(detail.summary.last_seen_at?.slice(0, 10)) : localTime(detail.summary.last_seen_at)}
              detail={isMonth ? localTime(detail.summary.last_seen_at) : "Actividad más reciente"}
            />
          </div>
        ) : null}

        <div ref={setScrollRoot} className="station-scrollbar min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading && !detail && !error ? <LoadingState label="Cargando evidencia local..." /> : null}
          {error ? <EmptyState error title="No se pudo abrir el historial" detail={error} /> : null}
          {detail && !crops.length ? (
            <EmptyState
              title="Sin recortes indexados"
              detail={isMonth
                ? `Esta identidad no tiene evidencia disponible en ${monthLabel(target.month)}.`
                : "Esta identidad no tiene evidencia disponible para la fecha seleccionada."}
            />
          ) : null}
          {detail && crops.length ? (
            <div className="space-y-5">
              {cropGroups.map((group) => (
                <CropDay
                  key={group.date}
                  date={group.date}
                  crops={group.items}
                  metadata={dayMetadata.get(group.date)}
                  subjectName={detail.subject.name || "rostro"}
                  cropIndex={cropIndex}
                  canReject={canRejectCrops}
                  rejectingCropId={rejectingCropId}
                  onReject={(crop) => {
                    setRejectError("");
                    setRejectCandidate(crop);
                  }}
                />
              ))}

              {nextCursor ? (
                <button
                  ref={sentinelRef}
                  className={`flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-dashed bg-white px-4 text-[10px] font-semibold transition ${
                    pageError
                      ? "border-red-300 text-red-700 hover:bg-red-50"
                      : "border-zinc-300 text-zinc-500 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                  }`}
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                  type="button"
                >
                  {loadingMore ? <LoaderCircle className="animate-spin" size={14} /> : <Images size={14} />}
                  {loadingMore
                    ? "Cargando más recortes..."
                    : pageError
                      ? `${pageError} Pulsa para reintentar.`
                      : `Mostrando ${compactNumber(crops.length)} de ${compactNumber(totalCrops)}. Desplázate para cargar más.`}
                </button>
              ) : (
                <p className="flex min-h-10 items-center justify-center gap-2 border-t border-zinc-200 text-[10px] font-semibold text-emerald-700">
                  <Images size={13} /> Se cargaron las {compactNumber(totalCrops)} evidencias conservadas.
                </p>
              )}
            </div>
          ) : null}
        </div>
      </section>
      {rejectCandidate ? (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-zinc-950/65 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && rejectingCropId === null) {
              setRejectCandidate(null);
              setRejectError("");
            }
          }}
          role="presentation"
        >
          <section
            className="w-full max-w-md overflow-hidden rounded-2xl border border-red-100 bg-white shadow-2xl"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reject-crop-title"
          >
            <div className="flex items-start gap-3 border-b border-zinc-100 px-5 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-700">
                <ShieldAlert size={19} />
              </span>
              <div className="min-w-0">
                <h3 id="reject-crop-title" className="text-sm font-bold text-zinc-900">
                  Rechazar este recorte
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                  No volverá a usarse para comparar rostros ni para justificar asistencia.
                  La imagen se conserva temporalmente para auditoría.
                </p>
              </div>
            </div>
            <div className="flex gap-4 p-5">
              <img
                className="size-24 shrink-0 rounded-xl border border-zinc-200 bg-zinc-100 object-cover"
                src={`/api/crops/${rejectCandidate.id}/image`}
                alt="Recorte que se rechazará"
              />
              <div className="min-w-0 text-[11px] text-zinc-600">
                <strong className="block text-zinc-800">{localTime(rejectCandidate.seen_at)}</strong>
                <span className="mt-1 block">{rejectCandidate.camera || "Cámara local"}</span>
                <p className="mt-3 leading-5">
                  Si existen otros recortes válidos de esta persona, su asistencia se conserva.
                </p>
              </div>
            </div>
            {rejectError ? (
              <p className="mx-5 mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-700">
                {rejectError}
              </p>
            ) : null}
            <footer className="flex justify-end gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-4">
              <button
                className="min-h-9 rounded-lg border border-zinc-200 bg-white px-4 text-[10px] font-bold text-zinc-700 transition hover:bg-zinc-100"
                disabled={rejectingCropId !== null}
                onClick={() => {
                  setRejectCandidate(null);
                  setRejectError("");
                }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-red-700 px-4 text-[10px] font-bold text-white shadow-sm transition hover:bg-red-800 disabled:cursor-wait disabled:opacity-60"
                data-testid="confirm-reject-crop"
                disabled={rejectingCropId !== null}
                onClick={() => void rejectCrop()}
                type="button"
              >
                {rejectingCropId !== null ? <LoaderCircle className="animate-spin" size={13} /> : <Ban size={13} />}
                {rejectingCropId !== null ? "Rechazando..." : "Sí, rechazar"}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function CropDay({
  date,
  crops,
  metadata,
  subjectName,
  cropIndex,
  canReject,
  rejectingCropId,
  onReject,
}: {
  date: string;
  crops: CropEvidence[];
  metadata?: DetectionDaySummary;
  subjectName: string;
  cropIndex: Map<number, number>;
  canReject: boolean;
  rejectingCropId: number | null;
  onReject: (crop: CropEvidence) => void;
}) {
  const totalForDay = Number(metadata?.crops || crops.length);
  return (
    <section aria-labelledby={`crop-day-${date}`}>
      <header className="mb-2.5 flex flex-col gap-1 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 id={`crop-day-${date}`} className="text-xs font-bold capitalize text-emerald-950">{dateLabel(date)}</h3>
          <p className="mt-0.5 text-[9px] text-emerald-800/70">
            {compactNumber(crops.length)} de {compactNumber(totalForDay)} evidencias cargadas
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-[9px] font-semibold text-emerald-800/70">
          <Clock3 size={11} />
          {localTime(metadata?.first_seen_at)} – {localTime(metadata?.last_seen_at)}
        </p>
      </header>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-12">
        {crops.map((crop) => {
          const index = cropIndex.get(crop.id) || 0;
          return (
            <figure key={crop.id} className="group overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="aspect-square overflow-hidden bg-zinc-100">
                <img
                  className="size-full object-cover transition duration-200 group-hover:scale-105"
                  src={`/api/crops/${crop.id}/image`}
                  alt={`Recorte ${index + 1} de ${subjectName}`}
                  loading={index < 12 ? "eager" : "lazy"}
                  decoding="async"
                  onError={(event) => {
                    event.currentTarget.style.opacity = "0.2";
                    event.currentTarget.alt = "Recorte no disponible";
                  }}
                />
              </div>
              <figcaption className="px-2 py-1.5">
                <strong className="flex items-center gap-1 truncate text-[9px] text-zinc-700">
                  <Clock3 size={9} /> {localTime(crop.seen_at)}
                </strong>
                <span className="mt-0.5 flex items-center gap-1 truncate text-[8px] text-zinc-400">
                  <Camera size={8} /> {crop.camera || "Cámara local"}
                </span>
                {(crop.evidence_selected === 0 || crop.evidence_selected === false)
                && crop.evidence_reason !== "manual_rejected" ? (
                  <span className="mt-1.5 inline-flex min-h-6 w-full items-center justify-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-1 text-[8px] font-bold text-amber-700">
                    <ShieldAlert size={9} /> Fuera de evidencia
                  </span>
                ) : null}
                {canReject ? (
                  crop.evidence_reason === "manual_rejected" ? (
                    <span className="mt-1.5 inline-flex min-h-6 w-full items-center justify-center gap-1 rounded-md border border-zinc-200 bg-zinc-100 px-1 text-[8px] font-bold text-zinc-500">
                      <Ban size={9} /> Rechazado
                    </span>
                  ) : (
                    <button
                      className="mt-1.5 inline-flex min-h-6 w-full items-center justify-center gap-1 rounded-md border border-red-100 bg-red-50 px-1 text-[8px] font-bold text-red-700 transition hover:border-red-200 hover:bg-red-100"
                      data-testid={`reject-crop-${crop.id}`}
                      disabled={rejectingCropId !== null}
                      onClick={() => onReject(crop)}
                      type="button"
                      aria-label={`Rechazar recorte ${index + 1} de ${subjectName}`}
                    >
                      <Ban size={9} /> Rechazar
                    </button>
                  )
                ) : null}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
