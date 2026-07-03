import { Fragment, type UIEvent } from "react";
import { Bug, Check, Play } from "lucide-react";
import type { AppData } from "../../types";
import { EvidenceImage } from "../automatic-attendance";
import { formatBytes } from "../automatic-attendance/format";
import {
  activityWindowStatusClass,
  activityWindowStatusLabel,
  appearanceTimeLabel,
  captureStatusClass,
  captureStatusLabel,
  formatTimeOnly,
  qualityRejectText,
  qualityText,
  subjectAppearanceTimes,
  type UnknownActivityWindow,
  type UnknownAttendanceJob,
  type UnknownDailyReport,
  type UnknownRejectedFaceDebug,
  type UnknownSubject,
} from "./model";

type PendingSession = {
  cameraLabel: string;
  siteLabel: string;
  timeRange: string;
  totalBytes: number;
} | null;

type ProcessedResult = NonNullable<UnknownAttendanceJob["results"]>[number]["processed"][number];

export function UnknownPendingSessionSection({
  activeJobIsCurrentDate,
  detailDateLabel,
  isProcessing,
  onProcess,
  onReprocessFailed,
  pendingCount,
  pendingSession,
  pendingUploadCount,
  progress,
  selectedReport,
  unknownProcessingEnabled,
}: {
  activeJobIsCurrentDate: boolean;
  detailDateLabel: string;
  isProcessing: boolean;
  onProcess: () => void;
  onReprocessFailed?: () => void;
  pendingCount: number;
  pendingSession: PendingSession;
  pendingUploadCount: number;
  progress: number;
  selectedReport?: UnknownDailyReport;
  unknownProcessingEnabled: boolean;
}) {
  const canReprocessFailed = Boolean(
    onReprocessFailed &&
      selectedReport &&
      selectedReport.total_captures > 0 &&
      selectedReport.pending_count === 0 &&
      selectedReport.failed_count > 0,
  );
  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Detalle de desconocidos del dia</h3>
          <p className="mt-1 text-xs text-zinc-500">Sesion diaria del {detailDateLabel}.</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{pendingCount}</span>
      </div>
      <div className="p-4">
        {pendingSession ? (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{pendingSession.siteLabel}</p>
                <p className="mt-1 text-sm text-zinc-500">{detailDateLabel} - {pendingSession.timeRange} - {pendingSession.cameraLabel}</p>
                <p className="mt-1 text-xs text-zinc-500">{pendingCount} capturas - {formatBytes(pendingSession.totalBytes)}</p>
              </div>
              <button
                className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${activeJobIsCurrentDate ? "bg-blue-700 text-white dark:bg-blue-500 dark:text-blue-950" : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"}`}
                disabled={!unknownProcessingEnabled || pendingCount === 0 || isProcessing}
                onClick={onProcess}
                type="button"
              >
                <Play size={15} /> {activeJobIsCurrentDate ? `Procesando ${progress.toFixed(1)}%` : "Procesar toda la sesion"}
              </button>
            </div>
          </div>
        ) : pendingUploadCount > 0 ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100">
            <p className="text-sm font-semibold">Capturas detectadas, pero todavia no subidas por el cron</p>
            <p className="mt-1 text-sm">Hay {pendingUploadCount} capturas en estado local/sin subir. El backend no puede descargar ni procesar caras hasta que el cron las suba a Drive y queden como pendientes procesables.</p>
            <p className="mt-2 text-xs">Por eso no aparecen imagenes de caras ni boton de procesamiento para este dia.</p>
          </div>
        ) : canReprocessFailed ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-semibold">No hay pendientes, pero hay capturas rechazadas</p>
                <p className="mt-1 text-sm">Puedes reprocesar {selectedReport?.failed_count ?? 0} rechazadas con la logica nueva: los conocidos se comparan aunque la cara no sea apta para crear un desconocido consolidado.</p>
              </div>
              <button
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!unknownProcessingEnabled || isProcessing}
                onClick={onReprocessFailed}
                type="button"
              >
                <Play size={15} /> Reprocesar rechazadas
              </button>
            </div>
          </div>
        ) : (
          <p className="py-6 text-sm text-zinc-500">{selectedReport?.pending_count ? "No se pudo cargar el bloque pendiente de este dia." : "No hay capturas pendientes para procesar en este dia."}</p>
        )}
      </div>
    </section>
  );
}

export function UnknownActivityWindowsSection({ activityWindows, data, token }: { activityWindows: UnknownActivityWindow[]; data: AppData; token: string }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Actividad no agendada</h3>
          <p className="mt-1 text-xs text-zinc-500">Ventanas con actividad suficiente y su evidencia visual.</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{activityWindows.length}</span>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full border-collapse text-left text-sm text-zinc-900 dark:text-zinc-100">
          <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Ventana</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Personas</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Capturas</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Sede / camara</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Agenda</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {activityWindows.map((windowItem) => (
              <ActivityWindowRows data={data} key={`${windowItem.camera_id}-${windowItem.window_start}`} token={token} windowItem={windowItem} />
            ))}
            {activityWindows.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-sm text-zinc-500" colSpan={6}>No hay ventanas de actividad suficientes para este dia.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function UnknownProcessedResultsSection({ processedResults, token }: { processedResults: ProcessedResult[]; token: string }) {
  if (!processedResults.length) return null;
  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Resultado del ultimo procesamiento</h3>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {processedResults.map((item) => (
          <article key={item.capture_id} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <EvidenceImage url={item.image_url} token={token} fit="contain" ratio="square" />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-zinc-950 dark:text-zinc-50">{item.subject_name ?? item.known_name ?? item.capture_id.slice(0, 8)}</p>
                {item.captured_at && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Aparecio: {appearanceTimeLabel(item.captured_at)}</p>}
                <p className="mt-1 text-xs text-zinc-500">{qualityText(item.quality)}</p>
                {qualityRejectText(item.quality) && <p className="mt-1 text-xs font-semibold text-red-700">Rechazo: {qualityRejectText(item.quality)}</p>}
                {(item.known_count || item.unknown_count || item.rejected_count) ? <p className="mt-1 text-xs text-zinc-500">{item.known_count ?? 0} conocidos - {item.unknown_count ?? 0} desconocidos - {item.rejected_count ?? 0} rechazados</p> : null}
                {item.detail && <p className="mt-1 text-xs text-red-700">{item.detail}</p>}
              </div>
              <span className={`inline-flex w-fit max-w-full shrink-0 items-center justify-center rounded-md border px-2 py-1 text-center text-xs font-semibold leading-tight ${captureStatusClass(item.status)}`}>{captureStatusLabel(item.status)}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function UnknownSubjectsSection({ acceptingSubjectId, data, onAccept, token, visibleSubjects }: { acceptingSubjectId: string; data: AppData; onAccept: (subjectId: string) => void; token: string; visibleSubjects: UnknownSubject[] }) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Personas desconocidas consolidadas</h3>
          <p className="mt-1 text-xs text-zinc-500">Un mismo rostro se agrupa por similitud para evitar duplicados.</p>
        </div>
        <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{visibleSubjects.length}</span>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {visibleSubjects.map((subject) => (
          <UnknownSubjectCard acceptingSubjectId={acceptingSubjectId} data={data} key={subject.id} onAccept={onAccept} subject={subject} token={token} />
        ))}
        {visibleSubjects.length === 0 && <p className="text-sm text-zinc-500">Todavia no hay desconocidos con evidencia visual.</p>}
      </div>
    </section>
  );
}

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

function ActivityWindowRows({ data, token, windowItem }: { data: AppData; token: string; windowItem: UnknownActivityWindow }) {
  const site = data.sites.find((item) => item.id === windowItem.site_id);
  const evidence = windowItem.evidence ?? [];
  return (
    <Fragment>
      <tr className="bg-white dark:bg-zinc-950">
        <td className="whitespace-nowrap px-4 py-3">
          <p className="font-semibold">{formatTimeOnly(windowItem.window_start)} - {formatTimeOnly(windowItem.window_end)}</p>
          <p className="text-xs text-zinc-500">activo {windowItem.active_minutes.toFixed(1)} min</p>
        </td>
        <td className="px-4 py-3">
          <p className="font-semibold">{windowItem.unique_people}</p>
          <p className="text-xs text-zinc-500">{windowItem.known_people} conocidos - {windowItem.unknown_people} desconocidos</p>
        </td>
        <td className="px-4 py-3">
          <p className="font-semibold">{windowItem.motion_captures}</p>
          <p className="text-xs text-zinc-500">{windowItem.processed_captures} con rostro procesado</p>
          {windowItem.processed_captures === 0 ? <p className="mt-1 text-xs font-semibold text-amber-700">rostros pendientes de procesar</p> : null}
        </td>
        <td className="px-4 py-3">
          <p className="font-semibold">{site?.name ?? "Sin sede"}</p>
          <p className="text-xs text-zinc-500">{windowItem.camera_id || "Sin camara"}</p>
        </td>
        <td className="px-4 py-3">
          {windowItem.scheduled_match_id ? (
            <>
              <p className="font-semibold">{windowItem.scheduled_match_label}</p>
              <p className="text-xs text-zinc-500">Partido {windowItem.scheduled_match_id} - {windowItem.scheduled_starts_at ?? "sin hora"}</p>
            </>
          ) : (
            <p className="text-sm font-semibold text-red-700">Sin partido empalmado</p>
          )}
        </td>
        <td className="px-4 py-3">
          <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${activityWindowStatusClass(windowItem.status)}`}>{activityWindowStatusLabel(windowItem.status)}</span>
          <p className="mt-1 max-w-xs text-xs text-zinc-500">{windowItem.reason}</p>
        </td>
      </tr>
      <tr className="bg-zinc-50/70 dark:bg-zinc-900/30">
        <td className="px-4 py-3" colSpan={6}>
          {evidence.length ? <ActivityEvidenceGrid evidence={evidence} token={token} /> : <p className="text-xs text-zinc-500">{windowItem.status === "preliminary" ? "Ventana preliminar por movimiento: todavia no hay rostros procesados ni evidencia visual para listar personas." : "No hay evidencia visual ligada a esta ventana."}</p>}
        </td>
      </tr>
    </Fragment>
  );
}

function ActivityEvidenceGrid({ evidence, token }: { evidence: NonNullable<UnknownActivityWindow["evidence"]>; token: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {evidence.map((item) => (
        <article key={item.capture_id} className="rounded-md border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-950">
          <EvidenceImage url={item.image_url} token={token} fit="contain" ratio="square" />
          <div className="mt-2 flex flex-col gap-2">
            <div>
              <p className="break-words text-xs font-semibold text-zinc-950 dark:text-zinc-50">{item.subject_name || item.known_name || "Persona detectada"}</p>
              <p className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">{item.captured_at ? appearanceTimeLabel(item.captured_at) : "Sin hora"}</p>
              <p className="mt-1 text-[11px] text-zinc-500">{qualityText(item.quality)}</p>
            </div>
            <span className={`inline-flex w-fit max-w-full items-center justify-center rounded-md border px-2 py-1 text-center text-[11px] font-semibold leading-tight ${captureStatusClass(item.status)}`}>{captureStatusLabel(item.status)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function UnknownSubjectCard({ acceptingSubjectId, data, onAccept, subject, token }: { acceptingSubjectId: string; data: AppData; onAccept: (subjectId: string) => void; subject: UnknownSubject; token: string }) {
  const site = data.sites.find((item) => item.id === subject.site_id);
  const isAccepted = Boolean(subject.metadata?.accepted_at);
  const firstAppearance = subject.day_first_seen_at ?? subject.first_seen_at;
  const lastAppearance = subject.day_last_seen_at ?? subject.last_seen_at;
  const appearanceTimes = subjectAppearanceTimes(subject);
  return (
    <article className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <EvidenceImage url={subject.image_url} token={token} fit="contain" ratio="square" />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-zinc-950 dark:text-zinc-50">{subject.temporary_name}</p>
          <p className="mt-1 text-xs text-zinc-500">{site?.name ?? "Sin sede"} - {subject.appearance_count ?? subject.capture_count} capturas del dia</p>
          <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Primera aparicion: {appearanceTimeLabel(firstAppearance)}</p>
          <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Ultima aparicion: {appearanceTimeLabel(lastAppearance)}</p>
          <p className="mt-1 text-xs text-zinc-500">{qualityText(subject.metadata?.quality)}</p>
          {subject.metadata?.latest_quality && subject.metadata.latest_quality.quality_score !== subject.metadata.quality?.quality_score ? <p className="mt-1 text-xs text-zinc-500">Ultima captura: {qualityText(subject.metadata.latest_quality)}</p> : null}
        </div>
        <span className={`inline-flex w-fit max-w-full shrink-0 items-center justify-center rounded-md border px-2 py-1 text-center text-xs font-semibold leading-tight ${isAccepted ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
          {isAccepted ? "Aceptado" : "Revision"}
        </span>
      </div>
      {appearanceTimes.length ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {appearanceTimes.map((time) => <span key={`${subject.id}-${time}`} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">{formatTimeOnly(time)}</span>)}
          {(subject.appearance_count ?? appearanceTimes.length) > appearanceTimes.length && <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-semibold text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">+{(subject.appearance_count ?? appearanceTimes.length) - appearanceTimes.length}</span>}
        </div>
      ) : null}
      <button
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        disabled={isAccepted || acceptingSubjectId === subject.id}
        onClick={() => onAccept(subject.id)}
        type="button"
      >
        <Check size={15} /> {isAccepted ? "Aceptado" : acceptingSubjectId === subject.id ? "Aceptando..." : "Aceptar consolidado"}
      </button>
    </article>
  );
}
