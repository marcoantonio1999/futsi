import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BrainCircuit, Gauge, HardDrive, Images, Moon, Play, Square, X } from "lucide-react";
import { stationApi, toQuery } from "./api";
import { Button, EmptyState, MetricCard, SectionHeading, panelClass } from "./components";
import { compactNumber, fileSize, localTime, stateLabel, todayLocal } from "./format";
import { useInfiniteTrigger } from "./hooks";
import type { CameraKey, CameraStatus, CropQueueResponse, CropQueueSummary, QueuedCrop, StationStatus, ToastMessage } from "./types";

const CROP_BATCH_SIZE = 48;
const CAMERA_VIEWS: ReadonlyArray<{
  key: CameraKey;
  fallbackLabel: string;
  sourceLabel: string;
}> = [
  { key: "primary", fallbackLabel: "Raspberry principal", sourceLabel: "Raspberry principal" },
  { key: "secondary", fallbackLabel: "Dahua", sourceLabel: "Cámara de red" },
  { key: "tertiary", fallbackLabel: "Raspberry adicional", sourceLabel: "Raspberry adicional" },
];

export function LiveView({
  status,
  onRefreshStatus,
  onNotify,
}: {
  status: StationStatus | null;
  onRefreshStatus: () => Promise<void>;
  onNotify: (text: string, tone?: ToastMessage["tone"]) => void;
}) {
  const [manualConfirmOpen, setManualConfirmOpen] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const queue = status?.crop_queue;
  const capture = status?.capture;
  const manual = queue?.manual;
  const automatic = queue?.automatic;
  const manualBusy = Boolean(manual?.requested || manual?.active);
  const automaticBusy = Boolean(automatic?.requested || automatic?.active);
  const batchBusy = manualBusy || automaticBusy;
  const manualCompleted = Number(manual?.processed || 0) + Number(manual?.discarded || 0) + Number(manual?.failed || 0);
  const automaticCompleted = Number(queue?.batch_processed || 0) + Number(queue?.batch_discarded || 0) + Number(queue?.batch_failed || 0);
  const batchCompleted = manualBusy ? manualCompleted : automaticCompleted;
  const batchInitial = manualBusy ? Number(manual?.initial_pending || 0) : Number(automatic?.initial_pending || 0);
  const evidence = queue?.evidence_maintenance;
  const persistence = status?.persistence;
  const originalFrames = persistence?.original_frames;
  const persistenceDrops = Number(persistence?.dropped || 0);
  const persistenceFailures = Number(persistence?.failed || 0);
  const originalFrameDrops = Number(originalFrames?.dropped || 0);
  const originalFaceDrops = Number(originalFrames?.dropped_faces || 0);
  const originalFrameFailures = Number(originalFrames?.failed || 0);
  const configuredCameras = CAMERA_VIEWS
    .map((definition) => ({ ...definition, camera: status?.cameras?.[definition.key] }))
    .filter((entry) => entry.key === "primary" || Boolean(entry.camera));
  const cameraPipelines = configuredCameras
    .filter((entry): entry is typeof entry & { camera: CameraStatus } => Boolean(entry.camera?.capture_pipeline))
    .map(({ camera }) => ({ camera, pipeline: camera.capture_pipeline! }));
  const cameraPipelineErrors = cameraPipelines.reduce((total, { pipeline }) => total
    + Number(pipeline.compressed_frames_dropped || 0)
    + Number(pipeline.packet_frames_dropped || 0)
    + Number(pipeline.decode_errors || 0)
    + Number(pipeline.jpeg_errors || 0), 0);
  const cameraWorkerFailures = cameraPipelines.filter(({ camera, pipeline }) => (
    status?.state === "running"
    && camera.connected
    && pipeline.pipeline_mode === "async_mjpeg"
    && (pipeline.receiver_alive === false || pipeline.decoder_alive === false)
  )).length;
  const hasPersistenceLoss = persistenceDrops > 0
    || persistenceFailures > 0
    || originalFrameDrops > 0
    || originalFaceDrops > 0
    || originalFrameFailures > 0
    || cameraPipelineErrors > 0
    || cameraWorkerFailures > 0;
  const cameraPerformance = configuredCameras
    .filter((entry): entry is typeof entry & { camera: CameraStatus } => Boolean(entry.camera))
    .map(({ camera, fallbackLabel }) => `${camera.label || fallbackLabel} ${Number(camera.processing_fps || 0).toFixed(1)}`)
    .join(" · ");

  async function engineAction(action: "start" | "stop" | "benchmark") {
    try {
      await stationApi(`/api/engine/${action}`, { method: "POST", body: "{}" });
      onNotify(action === "benchmark" ? "Prueba de rendimiento iniciada." : "Orden enviada al motor.");
      window.setTimeout(() => void onRefreshStatus(), 350);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "No se pudo controlar el motor.", "error");
    }
  }

  async function startManualBatch() {
    setManualSubmitting(true);
    try {
      const result = await stationApi<{ queued: boolean; pending: number }>("/api/batch/manual/start", { method: "POST", body: "{}" });
      setManualConfirmOpen(false);
      onNotify(`Lote preparado: ${compactNumber(result.pending)} recortes. La detección se pausará mientras se usa la GPU.`);
      window.setTimeout(() => void onRefreshStatus(), 250);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "No se pudo iniciar el procesamiento manual.", "error");
    } finally {
      setManualSubmitting(false);
    }
  }

  async function cancelManualBatch() {
    setManualSubmitting(true);
    try {
      await stationApi("/api/batch/manual/cancel", { method: "POST", body: "{}" });
      onNotify("Se detendrá el lote al terminar el recorte actual y se reanudará la detección.");
      window.setTimeout(() => void onRefreshStatus(), 250);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "No se pudo detener el procesamiento manual.", "error");
    } finally {
      setManualSubmitting(false);
    }
  }

  return (
    <>
    <div>
      <section className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3.5" aria-label="Estado de la estación">
        <MetricCard
          label="Estado del motor"
          value={batchBusy ? "Procesando cola" : stateLabel(status?.state)}
          detail={batchBusy ? `Detección pausada · ${compactNumber(batchCompleted)} de ${compactNumber(batchInitial)}` : status?.last_error || status?.provider || "Conectando"}
          accent={batchBusy ? "amber" : "emerald"}
        />
        <MetricCard label="Rendimiento" value={`${Number(status?.processing_fps || 0).toFixed(1)} FPS`} detail={cameraPerformance || "Procesamiento concurrente por cámara"} accent="blue" />
        <MetricCard label="Captura facial" value={compactNumber(queue?.today?.captured)} detail={`${compactNumber(capture?.frames_today)} frames desde el último inicio`} accent="violet" />
        <MetricCard label="Cola nocturna" value={`${compactNumber(queue?.pending)} recortes`} detail={`${fileSize(queue?.active_bytes)} · ${evidence?.daily_limit || 30} evidencias/día · auditoría ${evidence?.safety_days || 7} días`} accent="amber" />
      </section>

      {persistence ? (
        <section
          aria-live="polite"
          className={`mb-4 flex flex-col gap-2 rounded-xl border px-3.5 py-3 text-[10px] sm:flex-row sm:items-center sm:justify-between ${hasPersistenceLoss ? "border-red-200 bg-red-50 text-red-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}
          data-testid="persistence-health"
          role={hasPersistenceLoss ? "alert" : "status"}
        >
          <div className="flex min-w-0 items-start gap-2.5">
            <HardDrive className={`mt-0.5 shrink-0 ${hasPersistenceLoss ? "text-red-700" : "text-emerald-700"}`} size={16} />
            <div className="min-w-0">
              <strong className="block text-[11px] font-extrabold">
                {hasPersistenceLoss ? "Advertencia: se perdió evidencia durante esta ejecución" : "Persistencia de recortes saludable"}
              </strong>
              <span className="mt-0.5 block leading-4">
                {originalFrames
                  ? `Frame original: cola ${compactNumber(originalFrames.queue_depth)}/${compactNumber(originalFrames.queue_capacity)} · ${compactNumber(originalFrameDrops)} frames descartados (${compactNumber(originalFaceDrops)} rostros) · ${compactNumber(originalFrameFailures)} fallos.`
                  : "Frame original: métricas no disponibles en esta versión del motor."}
              </span>
              <span className="mt-0.5 block leading-4">
                Captura de camara: {compactNumber(cameraPipelineErrors)} descartes/errores
                {cameraWorkerFailures ? ` · ${compactNumber(cameraWorkerFailures)} pipeline(s) incompleto(s)` : " · receptores y decoders activos"}.
              </span>
            </div>
          </div>
          <span className="shrink-0 font-bold tabular-nums sm:text-right">
            Escritura: cola {compactNumber(persistence.queue_depth)}/{compactNumber(persistence.queue_capacity)} · {compactNumber(persistenceDrops)} descartes · {compactNumber(persistenceFailures)} fallos
          </span>
        </section>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(280px,0.68fr)_minmax(0,1.72fr)]">
        <section className={`${panelClass} order-2 xl:order-1`}>
          <SectionHeading
            eyebrow="Vista técnica"
            title="Monitor de depuración"
            description="SCRFD analiza a 640; cada recorte se extrae directamente del frame original."
            action={batchBusy
              ? <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[9px] font-extrabold text-amber-800"><BrainCircuit size={11} /> GPU EN LOTE</span>
              : <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[9px] font-extrabold text-red-700"><i className="size-1.5 animate-pulse rounded-full bg-red-500" /> EN VIVO</span>}
          />
          <div className={`grid gap-px bg-zinc-200 ${configuredCameras.length > 1 ? "md:grid-cols-2 xl:grid-cols-1" : "grid-cols-1"}`}>
            {configuredCameras.map(({ key, camera, fallbackLabel, sourceLabel }) => (
              <CameraFeed
                key={key}
                kind={key}
                camera={camera}
                fallbackLabel={fallbackLabel}
                sourceLabel={sourceLabel}
                paused={batchBusy}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-zinc-200 bg-emerald-950 px-4 py-2.5 text-[9px] font-semibold text-emerald-50/75">
            <Legend color="bg-sky-400" label="Rostro enviado a la cola" />
            <Legend color="bg-violet-400" label="Comparación nocturna" />
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            <Button disabled={Boolean(status?.running)} onClick={() => void engineAction("start")} tone="primary" type="button" data-testid="engine-start"><Play size={13} /> Iniciar motor</Button>
            <Button disabled={!status?.running || batchBusy} onClick={() => void engineAction("stop")} type="button" data-testid="engine-stop"><Square size={12} /> Detener</Button>
            <Button disabled={!status?.running || status.state === "benchmarking" || batchBusy} onClick={() => void engineAction("benchmark")} type="button" data-testid="engine-benchmark"><Gauge size={14} /> Medir rendimiento</Button>
            {manualBusy ? (
              <Button disabled={manualSubmitting || manual?.status === "cancelling"} onClick={() => void cancelManualBatch()} tone="danger" type="button" data-testid="manual-batch-cancel">
                <Square size={12} /> {manual?.status === "cancelling" ? "Deteniendo lote…" : "Detener lote y reanudar"}
              </Button>
            ) : automaticBusy ? (
              <Button disabled type="button"><BrainCircuit size={14} /> Lote nocturno en curso</Button>
            ) : (
              <Button disabled={!status?.running || !Number(queue?.pending || 0)} onClick={() => setManualConfirmOpen(true)} tone="primary" type="button" data-testid="manual-batch-open">
                <BrainCircuit size={14} /> Comparar y agrupar ahora
              </Button>
            )}
          </div>
          {status?.benchmark?.samples ? (
            <p className="border-t border-zinc-100 px-4 py-3 text-[10px] leading-4 text-zinc-500">
              {status.benchmark.provider}: {status.benchmark.average_ms} ms/frame · capacidad {status.benchmark.capacity_fps} FPS · recomendado {status.benchmark.recommended_fps} FPS.
            </p>
          ) : null}
        </section>

        <CropQueue status={status} onNotify={onNotify} />
      </div>
    </div>
    {manualConfirmOpen ? (
      <ManualBatchConfirmation
        pending={Number(queue?.pending || 0)}
        references={Number(status?.references?.ready || 0)}
        submitting={manualSubmitting}
        onClose={() => setManualConfirmOpen(false)}
        onConfirm={() => void startManualBatch()}
      />
    ) : null}
    </>
  );
}

function ManualBatchConfirmation({
  pending,
  references,
  submitting,
  onClose,
  onConfirm,
}: {
  pending: number;
  references: number;
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-zinc-950/55 px-4 py-8 backdrop-blur-sm" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !submitting) onClose();
    }}>
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="manual-batch-title" data-testid="manual-batch-dialog">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
          <div className="flex min-w-0 gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><BrainCircuit size={20} /></span>
            <div>
              <span className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-amber-700">Prueba manual de GPU</span>
              <h2 id="manual-batch-title" className="mt-1 text-base font-extrabold tracking-tight text-zinc-900">¿Procesar toda la cola ahora?</h2>
            </div>
          </div>
          <button className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40" disabled={submitting} onClick={onClose} type="button" aria-label="Cerrar"><X size={17} /></button>
        </div>
        <div className="space-y-4 px-5 py-5">
          <p className="text-sm leading-6 text-zinc-600">
            FaceGuard pausará la detección de todas las cámaras y usará la GPU para comparar <strong className="text-zinc-900">{compactNumber(pending)} recortes pendientes</strong> con <strong className="text-zinc-900">{compactNumber(references)} referencias válidas</strong> y con los desconocidos ya consolidados.
          </p>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[11px] leading-5 text-amber-950">
            Las cámaras seguirán conectadas, pero no crearán recortes durante la prueba. La detección se reanudará automáticamente al terminar, si ocurre un error o si detienes el lote.
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-zinc-100 bg-zinc-50 px-5 py-4 sm:flex-row sm:justify-end">
          <Button disabled={submitting} onClick={onClose} type="button">Cancelar</Button>
          <Button disabled={submitting} onClick={onConfirm} tone="primary" type="button" data-testid="manual-batch-confirm">
            <BrainCircuit size={14} /> {submitting ? "Preparando lote…" : "Pausar cámaras y procesar"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function CameraFeed({
  kind,
  camera,
  fallbackLabel,
  sourceLabel,
  paused,
}: {
  kind: CameraKey;
  camera?: CameraStatus;
  fallbackLabel: string;
  sourceLabel: string;
  paused?: boolean;
}) {
  const label = camera?.label || fallbackLabel;
  const pipeline = camera?.capture_pipeline;
  const asyncMjpeg = pipeline?.pipeline_mode === "async_mjpeg";
  const pipelineDrops = Number(pipeline?.compressed_frames_dropped || 0)
    + Number(pipeline?.packet_frames_dropped || 0)
    + Number(pipeline?.decode_errors || 0)
    + Number(pipeline?.jpeg_errors || 0);
  const pipelineHealthy = !asyncMjpeg
    || (pipeline?.receiver_alive !== false && pipeline?.decoder_alive !== false);
  const cameraLive = Boolean(camera?.connected && pipelineHealthy);
  const pipelineLabel = asyncMjpeg
    ? `MJPEG directo · ${Number(pipeline?.ingress_fps || 0).toFixed(1)} FPS de entrada · detección 1/${Number(pipeline?.decode_reduction || 1)}`
    : kind === "secondary"
      ? "RTSP · ruta OpenCV"
      : "Ruta compatible OpenCV";
  const roiLabel = camera?.roi_active && camera.roi
    ? `Área útil ${Math.round(camera.roi[0] * 100)}–${Math.round(camera.roi[1] * 100)}%`
    : "Marco completo";
  return (
    <article className="min-w-0 bg-zinc-950">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5 text-white">
        <div className="min-w-0">
          <span className="block text-[7px] font-extrabold uppercase tracking-widest text-zinc-500">{sourceLabel}</span>
          <strong className="block truncate text-[11px]">{label}</strong>
          <span className={`mt-0.5 block text-[7px] font-bold uppercase tracking-wide ${camera?.roi_active ? "text-rose-300" : "text-zinc-600"}`}>{roiLabel}</span>
          <span className={`mt-0.5 block text-[7px] font-bold uppercase tracking-wide ${pipelineDrops ? "text-amber-300" : asyncMjpeg ? "text-sky-300" : "text-zinc-600"}`}>
            {pipelineLabel}{pipelineDrops ? ` · ${pipelineDrops} incidencias` : ""}{!pipelineHealthy ? " · pipeline incompleto" : ""}
          </span>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[8px] font-bold ${paused ? "border-amber-300/30 text-amber-100" : cameraLive ? "border-emerald-400/25 text-emerald-200" : "border-amber-300/20 text-amber-100"}`}>
          <i className={`size-1.5 rounded-full ${paused ? "animate-pulse bg-amber-400" : cameraLive ? "bg-emerald-400" : "bg-amber-400"}`} /> {paused ? "Detección pausada" : cameraLive ? `En vivo · ${Number(camera?.processing_fps || 0).toFixed(1)} FPS${camera?.hardware_acceleration ? " · HW" : ""}` : camera?.connected ? "Pipeline incompleto" : "Sin señal"}
        </span>
      </div>
      <div className="relative aspect-video overflow-hidden bg-black">
        <img className="size-full object-contain" src={`/api/stream.mjpg?camera=${kind}`} alt={`Vista en vivo de la cámara ${label}`} data-testid={`camera-stream-${kind}`} />
        <span className="pointer-events-none absolute inset-0 border border-white/5" />
      </div>
      {camera?.last_error ? <p className="border-t border-red-900/50 bg-red-950/50 px-3 py-2 text-[9px] leading-4 text-red-200">{camera.last_error}</p> : null}
    </article>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5"><i className={`size-1.5 rounded-full ${color}`} /> {label}</span>;
}

function CropQueue({ status, onNotify }: { status: StationStatus | null; onNotify: (text: string, tone?: ToastMessage["tone"]) => void }) {
  const [rows, setRows] = useState<QueuedCrop[]>([]);
  const [date, setDate] = useState(todayLocal());
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<CropQueueSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);

  const signature = useMemo(() => JSON.stringify([
    status?.crop_queue?.date,
    status?.crop_queue?.pending,
    status?.crop_queue?.processing,
    status?.crop_queue?.failed,
    status?.crop_queue?.active_bytes,
    status?.crop_queue?.oldest_at,
  ]), [status?.crop_queue]);

  useEffect(() => {
    if (!status?.crop_queue) return;
    const nextDate = status.crop_queue.oldest_at?.slice(0, 10) || status.crop_queue.date || todayLocal();
    stationApi<CropQueueResponse>(`/api/crop-queue?${toQuery({ date: nextDate, status: "active", offset: 0, limit: CROP_BATCH_SIZE })}`)
      .then((payload) => {
        setDate(nextDate);
        setRows(payload.items || []);
        setTotal(payload.total);
        setSummary(payload.summary);
      })
      .catch((error) => onNotify(error instanceof Error ? error.message : "No se pudo leer la cola de recortes.", "error"));
  }, [signature]);

  const hasMore = rows.length < total;
  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const payload = await stationApi<CropQueueResponse>(`/api/crop-queue?${toQuery({ date, status: "active", offset: rows.length, limit: CROP_BATCH_SIZE })}`);
      setRows((current) => [...current, ...(payload.items || [])]);
      setTotal(payload.total);
      setSummary(payload.summary);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "No se pudieron cargar más recortes.", "error");
    } finally {
      setLoading(false);
    }
  }, [date, hasMore, loading, onNotify, rows.length]);
  const sentinelRef = useInfiniteTrigger(() => void loadMore(), hasMore && !loading, scrollRoot);
  const batchState = status?.crop_queue?.batch_state || "waiting_schedule";
  const manual = status?.crop_queue?.manual;
  const sqliteWrites = status?.crop_queue?.sqlite_writes;
  const unassigned = status?.crop_queue?.unassigned;
  const manualCompleted = Number(manual?.processed || 0) + Number(manual?.discarded || 0) + Number(manual?.failed || 0);
  const batchLabel: Record<string, string> = {
    waiting_schedule: `Detectando · lote programado a las ${status?.crop_queue?.automatic?.start_time || "00:30"}`,
    automatic_pausing: "Pausando completamente ambas detecciones",
    automatic_draining: "Guardando los últimos recortes antes del lote",
    processing: "Lote nocturno exclusivo · detección en 0 FPS",
    reconciling: "Reconciliando identidades · detección en 0 FPS",
    caught_up: "Cola terminada · detección reanudada",
    error: "El lote encontró un error · detección reanudada",
    loading: "Preparando modelos nocturnos",
    manual_pausing: "Pausando detección y vaciando inferencias",
    manual_draining: "Guardando los últimos recortes antes del lote manual",
    manual_loading: "Pausando detección · preparando modelos",
    manual_processing: `Lote manual · ${compactNumber(manualCompleted)} de ${compactNumber(manual?.initial_pending)}`,
    manual_reconciling: "Reconciliando identidades del lote manual",
    manual_complete: "Lote manual terminado · detección reanudada",
  };

  return (
    <section className={`${panelClass} order-1 flex h-[620px] min-h-0 flex-col xl:order-2 xl:h-[min(68vh,680px)]`}>
      <SectionHeading
        eyebrow="Prioridad de captura"
        title="Cola de recortes"
        description={`${batchLabel[batchState] || batchState} · ArcFace ×${status?.crop_queue?.embedding_batch_size || 1} · SQLite ${sqliteWrites?.mode === "atomic" ? `atómico (${compactNumber(sqliteWrites.atomic_commits)} commits)` : "legacy"} · ${date} · mostrando ${compactNumber(rows.length)} de ${compactNumber(total)} pendientes · ${fileSize(summary?.active_bytes)}.`}
        action={(
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:max-w-[310px] sm:justify-end" aria-label="Resumen de la cola y recortes sin asignar">
            <span className="grid size-8 place-items-center rounded-lg bg-sky-50 text-xs font-extrabold tabular-nums text-sky-800" title={`${total} recortes pendientes`}>
              {compactNumber(total)}
            </span>
            {unassigned ? (
              <div className="flex items-center gap-1 rounded-lg border border-amber-100 bg-amber-50/70 p-1 text-[8px] font-bold text-amber-950">
                <span className="rounded-md bg-white px-1.5 py-1 shadow-sm" title={`${unassigned.pending} recortes pendientes de asignar`}>
                  {compactNumber(unassigned.pending)} sin asignar
                </span>
                <span className="px-1 py-1 text-amber-800" title={`${unassigned.low_quality} recortes con calidad insuficiente`}>
                  {compactNumber(unassigned.low_quality)} baja calidad
                </span>
                <span className="px-1 py-1 text-violet-700" title={`${unassigned.ambiguous} recortes con coincidencia ambigua`}>
                  {compactNumber(unassigned.ambiguous)} ambiguos
                </span>
              </div>
            ) : null}
          </div>
        )}
      />
      <div ref={setScrollRoot} className="station-scrollbar min-h-0 flex-1 overflow-y-auto bg-zinc-50/70 p-2.5" data-testid="recent-scroll">
        {!rows.length ? <EmptyState title="No hay recortes pendientes" detail="SCRFD colocará aquí cada cara detectada. El lote automático se ejecuta una vez al día y reanuda la detección al terminar." /> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {rows.map((row, index) => {
              return (
                <article key={row.id} className="group min-w-0 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-px hover:border-sky-200 hover:shadow-md">
                  <div className="relative aspect-square overflow-hidden bg-zinc-100">
                    <img className="size-full object-cover" src={`/api/crop-queue/${row.id}/image`} alt={`Recorte ${row.id}`} loading={index < 16 ? "eager" : "lazy"} decoding="async" />
                    <span className={`absolute right-1.5 top-1.5 rounded-md px-1.5 py-1 text-[7px] font-extrabold ${row.status === "processing" ? "bg-violet-700 text-white" : row.status === "error" ? "bg-red-700 text-white" : "bg-sky-700 text-white"}`}>
                      {row.status === "processing" ? "Procesando" : row.status === "error" ? "Error" : "En cola"}
                    </span>
                  </div>
                  <div className="p-2">
                    <div className="flex items-center justify-between gap-1">
                      <strong className="truncate text-[9px] text-zinc-700">{row.camera_label || row.camera_key}</strong>
                      <span className="text-[8px] font-bold text-sky-700">{Math.round(Number(row.det_score || 0) * 100)}%</span>
                    </div>
                    <span className="mt-1 block truncate text-[8px] text-zinc-400">{localTime(row.captured_at)} · {row.crop_width}×{row.crop_height}</span>
                    <span className="mt-0.5 block text-[8px] text-zinc-400">{fileSize(row.file_bytes)}</span>
                  </div>
                </article>
              );
            })}
            {hasMore ? (
              <button ref={sentinelRef} className="col-span-full flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-white text-[10px] font-semibold text-zinc-500 hover:border-emerald-300 hover:text-emerald-700" onClick={() => void loadMore()} type="button">
                <Images size={14} /> {loading ? "Cargando más recortes..." : "Desliza para cargar más recortes"}
              </button>
            ) : null}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 divide-x divide-zinc-100 border-t border-zinc-100 bg-white px-2 py-2 text-center text-[8px] font-bold uppercase tracking-wide text-zinc-400">
        <span className="inline-flex items-center justify-center gap-1"><Activity size={11} /> SCRFD directo</span>
        <span className="inline-flex items-center justify-center gap-1"><HardDrive size={11} /> Disco local</span>
        <span className="inline-flex items-center justify-center gap-1"><Moon size={11} /> Lote nocturno</span>
      </div>
    </section>
  );
}
