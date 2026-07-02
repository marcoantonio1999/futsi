import { ArrowLeft } from "lucide-react";
import type { AppData } from "../../../types";
import { EvidenceImage } from "../evidence/AutomaticAttendanceEvidence";
import { attendanceDetailEntries, attendanceGroupDetailEntries, attendanceSummary, cameraLabelsForResults, cameraLabelsForSessionResult, detailCountsForGroup, sessionTitle, type AttendanceDetailEntry, type AutomaticReportGroup, type AutomaticSessionResult } from "./model";

function addMinutesToTime(timeValue?: string | null, minutesToAdd?: number | null) {
  if (!timeValue || !minutesToAdd) return "";
  const [hours = 0, minutes = 0, seconds = 0] = timeValue.split(":").map((part) => Number(part));
  const totalSeconds = (((hours * 3600 + minutes * 60 + seconds + minutesToAdd * 60) % 86400) + 86400) % 86400;
  return `${String(Math.floor(totalSeconds / 3600)).padStart(2, "0")}:${String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function sessionTimeRange(session: AutomaticSessionResult["session"]) {
  const start = session.starts_at ?? "--:--";
  const end = session.ends_at ?? (addMinutesToTime(session.starts_at, session.duration_minutes) || "--:--");
  return `${start} - ${end}`;
}

function DetailList({ title, tone, empty, items, token }: { title: string; tone: "emerald" | "amber" | "red"; empty: string; items: AttendanceDetailEntry[]; token: string }) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/20"
      : tone === "red"
        ? "border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/20"
        : "border-amber-200 bg-amber-50/60 dark:border-amber-900/60 dark:bg-amber-950/20";
  const headerClass =
    tone === "emerald"
      ? "border-emerald-200 text-emerald-900 dark:border-emerald-900/60 dark:text-emerald-100"
      : tone === "red"
        ? "border-red-200 text-red-900 dark:border-red-900/60 dark:text-red-100"
        : "border-amber-200 text-amber-900 dark:border-amber-900/60 dark:text-amber-100";
  const itemClass = tone === "emerald" ? "border-emerald-100 dark:border-emerald-900/50" : tone === "red" ? "border-red-100 dark:border-red-900/50" : "border-amber-100 dark:border-amber-900/50";

  return (
    <div className={`rounded-md border ${toneClass}`}>
      <div className={`border-b px-3 py-2 ${headerClass}`}>
        <p className="text-sm font-semibold">{title} ({items.length})</p>
      </div>
      <div className="grid gap-2 p-3">
        {items.map((item, index) => (
          <div key={`${item.name}-${index}`} className={`grid gap-3 rounded-md border bg-white p-3 dark:bg-zinc-950 sm:grid-cols-[1fr_150px] ${itemClass}`}>
            <div>
              <p className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{item.name}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{item.detail}</p>
            </div>
            <div>{item.evidenceUrl ? <EvidenceImage url={item.evidenceUrl} token={token} /> : <span className="text-xs text-zinc-400">Sin evidencia visual</span>}</div>
          </div>
        ))}
        {items.length === 0 && <p className="rounded-md bg-white px-3 py-4 text-sm text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">{empty}</p>}
      </div>
    </div>
  );
}

export function AutomaticAttendanceReportDetail({
  data,
  group,
  results,
  videos,
  token,
  onBack,
}: {
  data: AppData;
  group: AutomaticReportGroup;
  results: AutomaticSessionResult[];
  videos: string[];
  token: string;
  onBack: () => void;
}) {
  const session = group.primary;
  const sessionCards = results.map((sessionResult) => ({
    sessionResult,
    summary: attendanceSummary(data, sessionResult),
    detail: attendanceDetailEntries(data, sessionResult),
    label: sessionResult.session.team_name ?? sessionResult.session.group_name ?? `Sesion ${sessionResult.session.id}`,
    timeRange: sessionTimeRange(sessionResult.session),
  }));
  const detailCounts = detailCountsForGroup(data, results);
  const groupDetail = attendanceGroupDetailEntries(data, results);
  const cameras = cameraLabelsForResults(results);

  return (
    <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <button className="inline-flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800" onClick={onBack} type="button">
          <ArrowLeft size={15} /> Volver al reporte
        </button>
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">Detalle de asistencia automatica</p>
          <h2 className="mt-1 text-xl font-semibold text-zinc-950 dark:text-zinc-50">{sessionTitle(session, data)}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {session.date} {session.starts_at ?? "--:--"} - {session.site_name ?? "Sede"}
            {session.tournament_name ? ` - ${session.tournament_name}` : ""}
          </p>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{videos.length ? `Videos procesados: ${videos.join(", ")}` : "No hay video automatico procesado para esta sesion; se muestran registros guardados."}</p>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_auto_auto]">
          {sessionCards.map(({ summary, sessionResult, timeRange }, index) => (
            <div key={`${summary.label}-${index}`} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-50">
              <p className="text-xs font-semibold uppercase opacity-75">{summary.label}</p>
              <p className="mt-1 text-lg font-semibold">Asistio {summary.present} de {summary.total}</p>
              <p className="mt-1 text-xs opacity-75">Sesion {sessionResult.session.id} - horario {timeRange}</p>
              <p className="mt-1 text-xs opacity-75">Roster esperado: {summary.total}</p>
            </div>
          ))}
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-950 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-50">
            <p className="text-xs font-semibold uppercase opacity-75">Fuera de roster total</p>
            <p className="mt-1 text-lg font-semibold">{detailCounts.offRoster} detectado{detailCounts.offRoster === 1 ? "" : "s"}</p>
            <p className="mt-1 text-xs opacity-75">Sin duplicar entre equipos/camaras</p>
          </div>
          <div className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-violet-950 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-50">
            <p className="text-xs font-semibold uppercase opacity-75">Camaras procesadas</p>
            <p className="mt-1 text-lg font-semibold">{cameras.length || 0}</p>
            <p className="mt-1 text-xs opacity-75">{cameras.length ? cameras.join(" - ") : "Sin evidencia por camara"}</p>
          </div>
        </div>
      </div>
      <div className={`grid gap-5 p-4 ${sessionCards.length === 2 ? "xl:grid-cols-2 xl:items-start" : ""}`}>
        {sessionCards.map(({ sessionResult, summary, detail, label, timeRange }) => {
          const sessionCameras = cameraLabelsForSessionResult(sessionResult);
          return (
            <article key={sessionResult.session.id} className="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="border-b border-zinc-200 pb-3 dark:border-zinc-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">{label}</h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">Sesion {sessionResult.session.id} - horario {timeRange}</p>
                    {sessionResult.window ? <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Ventana procesada: {sessionResult.window}</p> : null}
                    {sessionCameras.length ? <p className="mt-1 text-xs font-semibold text-violet-700 dark:text-violet-300">{sessionCameras.join(" - ")}</p> : null}
                  </div>
                  <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-right text-blue-950 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-50">
                    <p className="text-xs font-semibold uppercase opacity-75">Equipo</p>
                    <p className="text-sm font-semibold">Asistio {summary.present} de {summary.total}</p>
                    <p className="mt-1 text-xs opacity-75">{timeRange}</p>
                  </div>
                </div>
                {sessionResult.detail && <p className={`mt-1 text-sm ${sessionResult.failed ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>{sessionResult.detail}</p>}
              </div>
              <div className="mt-4 grid gap-4">
                <DetailList title="Lista confirmada" tone="emerald" empty="No hay asistencias confirmadas para esta sesion." items={detail.confirmed} token={token} />
              </div>
            </article>
          );
        })}
      </div>
      <div className="grid gap-5 border-t border-zinc-200 p-4 dark:border-zinc-800 xl:grid-cols-2 xl:items-start">
        <DetailList title="Detectados fuera de roster" tone="red" empty="No se detectaron conocidos fuera del roster esperado." items={groupDetail.offRoster} token={token} />
        <DetailList title="Sin evidencia suficiente" tone="amber" empty="No hay rostros en revision o sin coincidencia suficiente." items={groupDetail.insufficient} token={token} />
      </div>
    </section>
  );
}
