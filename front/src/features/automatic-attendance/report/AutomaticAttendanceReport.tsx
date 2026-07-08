import { useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { AppData } from "../../../types";
import { AutomaticAttendanceReportDetail } from "./AutomaticAttendanceReportDetail";
import { attendanceSummary, buildReportGroups, cameraLabelsForResults, detailCountsForGroup, resultForSession, type AutomaticSessionResult, type ReportType } from "./model";

export type { AutomaticSessionResult, FaceComparison } from "./model";

export function AutomaticAttendanceReportPanel({
  token,
  data,
  resultsBySession,
  onRefresh,
  scope = "academy",
}: {
  token: string;
  data: AppData;
  resultsBySession: Map<number, { result: AutomaticSessionResult; video: string; jobId: string }>;
  onRefresh: () => void;
  scope?: "academy" | "adult";
}) {
  const [reportType, setReportType] = useState<ReportType>("all");
  const [reportSearch, setReportSearch] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const reportGroups = useMemo(() => buildReportGroups(data.attendanceSessions, reportType, reportDate, reportSearch), [data.attendanceSessions, reportDate, reportSearch, reportType]);
  const selectedGroup = reportGroups.find((group) => group.id === selectedGroupId) ?? null;
  const sessionTypeLabel = reportType === "all" ? "sesiones" : reportType === "tournament_match" ? "partidos" : "entrenamientos";
  const titleColorClass = scope === "adult" ? "text-blue-700 dark:text-blue-300" : "text-emerald-700 dark:text-emerald-300";

  if (selectedGroup) {
    const results = selectedGroup.sessions.map((session) => resultForSession(session, resultsBySession));
    const videos = Array.from(new Set(selectedGroup.sessions.map((session) => resultsBySession.get(session.id)?.video).filter((video): video is string => Boolean(video))));
    return <AutomaticAttendanceReportDetail data={data} group={selectedGroup} results={results} videos={videos} token={token} onBack={() => setSelectedGroupId("")} />;
  }

  return (
    <section className="overflow-hidden rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wide ${titleColorClass}`}>Reporte automatico</p>
            <h2 className={`mt-1 text-lg font-semibold ${titleColorClass}`}>Sesiones procesadas y pase de lista</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Revisa el resumen por renglon y abre el detalle completo cuando lo necesites.</p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800" onClick={onRefresh} type="button">
            <RefreshCw size={15} /> Actualizar
          </button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[220px_220px_minmax(0,1fr)]">
          <label className="block text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">Tipo de sesion</span>
            <select className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)}>
              <option value="all">Todos</option>
              <option value="tournament_match">Partidos</option>
              <option value="academy_class">Entrenamientos</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">Fecha</span>
            <div className="mt-1 flex gap-2">
              <input className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} />
              {reportDate && (
                <button className="shrink-0 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800" onClick={() => setReportDate("")} type="button">
                  Limpiar
                </button>
              )}
            </div>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-zinc-700 dark:text-zinc-200">Buscar en la tabla</span>
            <input className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Fecha, sede, equipo, torneo o grupo" />
          </label>
        </div>
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="min-w-full border-collapse text-left text-sm text-zinc-900 dark:text-zinc-100">
          <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900/60 dark:text-zinc-400">
            <tr>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Sesion</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Fecha</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Sede</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Equipo / grupo</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Asistencia</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Fuera roster</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Video</th>
              <th className="border-b border-zinc-200 px-4 py-3 font-semibold dark:border-zinc-800">Accion</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {reportGroups.map((group) => {
              const session = group.primary;
              const results = group.sessions.map((item) => resultForSession(item, resultsBySession));
              const summaries = results.map((item) => attendanceSummary(data, item));
              const present = summaries.reduce((sum, item) => sum + item.present, 0);
              const total = summaries.reduce((sum, item) => sum + item.total, 0);
              const detailCounts = detailCountsForGroup(data, results);
              const offRosterCount = detailCounts.offRoster;
              const videos = Array.from(new Set(group.sessions.map((item) => resultsBySession.get(item.id)?.video).filter((video): video is string => Boolean(video))));
              const cameras = cameraLabelsForResults(results);
              const sessionIds = group.sessions.map((item) => item.id).sort((a, b) => a - b);
              return (
                <tr key={group.id} className="bg-white transition hover:bg-blue-50/60 dark:bg-zinc-950 dark:hover:bg-blue-950/20">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-zinc-950 dark:text-zinc-50">{session.session_type === "tournament_match" ? "Partido" : "Entrenamiento"}</p>
                    <p className="mt-1 text-xs text-zinc-500">
                      {session.session_type === "tournament_match" && session.match ? `Partido ${session.match}` : `Sesion ${session.id}`}
                      {group.sessions.length > 1 ? ` - ${group.sessions.length} equipos` : ""}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                      {sessionIds.length > 1 ? `Sesiones ${sessionIds.join(", ")}` : `Sesion ${sessionIds[0]}`}
                    </p>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <p className="font-medium">{session.date}</p>
                    <p className="text-xs text-zinc-500">{session.starts_at ?? "--:--"} - {session.duration_minutes || 120} min</p>
                  </td>
                  <td className="px-4 py-3">{session.site_name ?? "Sede"}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium">{session.team_name ?? session.group_name ?? "Sin equipo/grupo"}</p>
                    {session.session_type === "tournament_match" && session.match_name && <p className="mt-1 text-xs text-zinc-500">{session.match_name}</p>}
                    {session.tournament_name && <p className="mt-1 text-xs text-zinc-500">{session.tournament_name}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-zinc-950 dark:text-zinc-50">{present} de {total}</p>
                    <p className="mt-1 text-xs text-zinc-500">{summaries.length > 1 ? `${summaries.length} equipos` : summaries[0]?.label ?? "Sesion"}</p>
                  </td>
                  <td className="px-4 py-3">
                    {offRosterCount ? (
                      <div className="grid gap-1">
                        <span className="inline-flex w-fit rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">{offRosterCount} detectado{offRosterCount === 1 ? "" : "s"}</span>
                        <span className="text-xs text-zinc-500">Sin duplicar entre equipos/camaras</span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {videos.length ? (
                      <div className="grid gap-2">
                        <span className="inline-flex w-fit rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">Procesado</span>
                        {cameras.length ? (
                          <div className="flex max-w-[260px] flex-wrap gap-1">
                            {cameras.map((camera) => (
                              <span key={camera} className="rounded-md border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-800">{camera}</span>
                            ))}
                          </div>
                        ) : null}
                        <span className="max-w-[260px] truncate text-xs text-zinc-500">{videos.join(", ")}</span>
                      </div>
                    ) : (
                      <span className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-semibold text-zinc-600">Sin video</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-100 dark:hover:bg-blue-950/50"
                      onClick={() => {
                        setSelectedGroupId(group.id);
                        window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
                      }}
                      type="button"
                    >
                      <Search size={14} /> Ver detalles
                    </button>
                  </td>
                </tr>
              );
            })}
            {reportGroups.length === 0 && (
              <tr>
                <td className="px-4 py-8 text-sm text-zinc-500" colSpan={8}>No hay {sessionTypeLabel} para reportar con ese filtro.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
