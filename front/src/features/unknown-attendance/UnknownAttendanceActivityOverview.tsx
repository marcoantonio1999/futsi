import type { AppData } from "../../types";
import {
  activityWindowStatusClass,
  activityWindowStatusLabel,
  formatTimeOnly,
  type UnknownActivityWindow,
  type UnknownDailyReport,
} from "./model";

export function UnknownAttendanceActivityOverview({
  activityAlertReports,
  data,
  dailyReports,
  onOpenDetail,
  ruleMinPeople,
  ruleWindowMinutes,
  visibleActivityWindows,
}: {
  activityAlertReports: UnknownDailyReport[];
  data: AppData;
  dailyReports: UnknownDailyReport[];
  onOpenDetail: (date: string, report: UnknownDailyReport) => void;
  ruleMinPeople: number;
  ruleWindowMinutes: number;
  visibleActivityWindows: UnknownActivityWindow[];
}) {
  const unscheduledTotal = activityAlertReports.reduce((sum, report) => sum + (report.unscheduled_activity_count ?? 0), 0);
  const preliminaryTotal = activityAlertReports.reduce((sum, report) => sum + (report.preliminary_activity_count ?? 0), 0);
  const scheduledTotal = activityAlertReports.reduce((sum, report) => sum + (report.scheduled_activity_count ?? 0), 0);

  return (
    <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Posibles partidos fuera de agenda</h3>
          <p className="mt-1 text-xs text-zinc-500">Regla: ventana de {ruleWindowMinutes} min con {ruleMinPeople}+ personas unicas procesadas y sin partido agendado empalmado.</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <ActivityCounter label="No ag." value={unscheduledTotal} className="border-red-200 bg-red-50 text-red-700" />
          <ActivityCounter label="Prelim." value={preliminaryTotal} className="border-amber-200 bg-amber-50 text-amber-800" />
          <ActivityCounter label="Agenda" value={scheduledTotal} className="border-emerald-200 bg-emerald-50 text-emerald-800" />
        </div>
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-2 xl:grid-cols-3">
        {visibleActivityWindows.slice(0, 6).map((windowItem) => {
          const site = data.sites.find((item) => item.id === windowItem.site_id);
          const report = dailyReports.find((item) => item.date === windowItem.date);
          return (
            <article key={`${windowItem.camera_id}-${windowItem.window_start}`} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{new Date(`${windowItem.date}T00:00:00`).toLocaleDateString()} - {formatTimeOnly(windowItem.window_start)} - {formatTimeOnly(windowItem.window_end)}</p>
                  <p className="mt-1 text-xs text-zinc-500">{site?.name ?? "Sin sede"} - {windowItem.camera_id || "Sin camara"}</p>
                </div>
                <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${activityWindowStatusClass(windowItem.status)}`}>
                  {activityWindowStatusLabel(windowItem.status)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <SmallMetric label="personas" value={windowItem.unique_people} />
                <SmallMetric label="capturas" value={windowItem.motion_captures} />
                <SmallMetric label="activo" value={`${windowItem.active_minutes.toFixed(0)} min`} />
              </div>
              <p className="mt-3 text-xs text-zinc-500">{windowItem.reason}</p>
              <button
                className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                onClick={() => onOpenDetail(windowItem.date, report ?? ({ date: windowItem.date } as UnknownDailyReport))}
                type="button"
              >
                Ver detalle y evidencia
              </button>
            </article>
          );
        })}
        {visibleActivityWindows.length === 0 && activityAlertReports.slice(0, 6).map((report) => (
          <ActivityReportCard key={report.date} onOpenDetail={onOpenDetail} report={report} />
        ))}
        {visibleActivityWindows.length === 0 && activityAlertReports.length === 0 && (
          <p className="text-sm text-zinc-500">No hay ventanas que cumplan la regla de posible partido fuera de agenda.</p>
        )}
      </div>
    </section>
  );
}

function ActivityReportCard({ onOpenDetail, report }: { onOpenDetail: (date: string, report: UnknownDailyReport) => void; report: UnknownDailyReport }) {
  const unscheduledCount = report.unscheduled_activity_count ?? 0;
  const preliminaryCount = report.preliminary_activity_count ?? 0;
  const scheduledCount = report.scheduled_activity_count ?? 0;
  const activityStatus = unscheduledCount ? "unscheduled_candidate" : preliminaryCount ? "preliminary" : "scheduled_overlap";
  return (
    <article className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{new Date(`${report.date}T00:00:00`).toLocaleDateString()}</p>
          <p className="mt-1 text-xs text-zinc-500">{report.first_captured_at && report.last_captured_at ? `${formatTimeOnly(report.first_captured_at)} - ${formatTimeOnly(report.last_captured_at)}` : "Sin horario"}</p>
        </div>
        <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${activityWindowStatusClass(activityStatus)}`}>
          {activityWindowStatusLabel(activityStatus)}
        </span>
      </div>
      <p className="mt-3 text-xs text-zinc-500">{unscheduledCount} posible no agendado - {preliminaryCount} preliminar - {scheduledCount} con agenda.</p>
      <button
        className="mt-3 inline-flex w-full items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        onClick={() => onOpenDetail(report.date, report)}
        type="button"
      >
        Ver detalle y evidencia
      </button>
    </article>
  );
}

function ActivityCounter({ className, label, value }: { className: string; label: string; value: number }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${className}`}>
      <p className="text-lg font-semibold">{value}</p>
      <p>{label}</p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-900">
      <p className="font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      <p className="text-zinc-500">{label}</p>
    </div>
  );
}
