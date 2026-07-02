import { Play } from "lucide-react";
import { formatBytes } from "../automatic-attendance/format";
import {
  activityWindowStatusClass,
  activityWindowStatusLabel,
  formatTimeOnly,
  type UnknownAttendanceJob,
  type UnknownDailyReport,
} from "./model";

export function UnknownAttendanceDailyReportsTable({
  activeJobDate,
  dailyReports,
  isProcessing,
  onOpenDetail,
  onProcess,
  progress,
  selectedUnknownDate,
  statusEnabled,
  visibleJob,
}: {
  activeJobDate: string;
  dailyReports: UnknownDailyReport[];
  isProcessing: boolean;
  onOpenDetail: (date: string, report: UnknownDailyReport) => void;
  onProcess: (date: string) => void;
  progress: number;
  selectedUnknownDate: string;
  statusEnabled: boolean;
  visibleJob: UnknownAttendanceJob | null;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Reporte diario de desconocidos</h3>
          <p className="mt-1 text-xs text-zinc-500">Una sesion por dia; abre el detalle para revisar capturas y consolidados.</p>
        </div>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="min-w-full border-collapse text-left text-sm text-zinc-900 dark:text-zinc-100">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Dia</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Horario</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Capturas</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Pendientes</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Conocidos</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Con evidencia</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Candidatos</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Actividad</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Accion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {dailyReports.map((report) => (
              <DailyReportRow
                activeJobDate={activeJobDate}
                isProcessing={isProcessing}
                key={report.date}
                onOpenDetail={onOpenDetail}
                onProcess={onProcess}
                progress={progress}
                report={report}
                selected={selectedUnknownDate === report.date}
                statusEnabled={statusEnabled}
                visibleJob={visibleJob}
              />
            ))}
            {dailyReports.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-sm text-zinc-500" colSpan={9}>Todavia no hay dias con capturas de desconocidos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DailyReportRow({
  activeJobDate,
  isProcessing,
  onOpenDetail,
  onProcess,
  progress,
  report,
  selected,
  statusEnabled,
  visibleJob,
}: {
  activeJobDate: string;
  isProcessing: boolean;
  onOpenDetail: (date: string, report: UnknownDailyReport) => void;
  onProcess: (date: string) => void;
  progress: number;
  report: UnknownDailyReport;
  selected: boolean;
  statusEnabled: boolean;
  visibleJob: UnknownAttendanceJob | null;
}) {
  const isActiveReport = isProcessing && activeJobDate === report.date;
  const unscheduledCount = report.unscheduled_activity_count ?? 0;
  const preliminaryCount = report.preliminary_activity_count ?? 0;
  const scheduledCount = report.scheduled_activity_count ?? 0;
  const activityStatus = unscheduledCount ? "unscheduled_candidate" : preliminaryCount ? "preliminary" : scheduledCount ? "scheduled_overlap" : "low_signal";
  const rowClassName = isActiveReport ? "bg-blue-50/80 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/20 dark:ring-blue-900/60" : selected ? "bg-amber-50/70 dark:bg-amber-950/20" : "bg-white dark:bg-zinc-950";

  return (
    <tr className={rowClassName}>
      <td className="whitespace-nowrap px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold">{new Date(`${report.date}T00:00:00`).toLocaleDateString()}</p>
          {isActiveReport ? <span className="rounded-md border border-blue-200 bg-blue-100 px-2 py-1 text-[11px] font-semibold text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-100">Procesando</span> : null}
        </div>
        <p className="text-xs text-zinc-500">{formatBytes(report.total_bytes)}</p>
        {isActiveReport ? <p className="mt-1 text-xs font-semibold text-blue-700 dark:text-blue-200">{visibleJob?.phase_label ?? "Trabajo activo"}</p> : null}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-zinc-600 dark:text-zinc-300">
        {report.first_captured_at && report.last_captured_at ? `${formatTimeOnly(report.first_captured_at)} - ${formatTimeOnly(report.last_captured_at)}` : "Sin horario"}
      </td>
      <td className="px-4 py-3">
        <p className="font-semibold">{report.total_captures}</p>
        <p className="text-xs text-zinc-500">{report.processed_count} procesadas</p>
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${report.pending_count ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{report.pending_count}</span>
        {(report.pending_upload_count ?? 0) > 0 ? <p className="mt-1 text-xs font-semibold text-red-700">{report.pending_upload_count} sin subir</p> : null}
      </td>
      <td className="px-4 py-3">{report.matched_known_count}</td>
      <td className="px-4 py-3">
        <p className="font-semibold">{report.visual_subjects}</p>
        <p className="text-xs text-zinc-500">{report.accepted_subjects} aceptados</p>
      </td>
      <td className="px-4 py-3">
        <p className="font-semibold">{report.candidate_subjects}</p>
        <p className="text-xs text-zinc-500">{report.failed_count} rechazadas</p>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${activityWindowStatusClass(activityStatus)}`}>{activityWindowStatusLabel(activityStatus)}</span>
        <p className="mt-1 text-xs text-zinc-500">{unscheduledCount} no ag. - {preliminaryCount} prelim. - {scheduledCount} agenda</p>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <button
            className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${isActiveReport ? "bg-blue-700 text-white dark:bg-blue-500 dark:text-blue-950" : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"}`}
            disabled={!statusEnabled || report.pending_count === 0 || isProcessing}
            onClick={() => onProcess(report.date)}
            type="button"
          >
            <Play size={13} /> {isActiveReport ? `${progress.toFixed(1)}%` : "Procesar"}
          </button>
          <button
            className="inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            onClick={() => onOpenDetail(report.date, report)}
            type="button"
          >
            Ver detalles
          </button>
        </div>
      </td>
    </tr>
  );
}
