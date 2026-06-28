import { X } from "lucide-react";
import { EvidenceImage } from "./automaticAttendanceEvidence";
import { AutomaticFaceComparisonCard } from "./automaticAttendanceComparisonCard";
import { formatBytes, formatDuration, formatSpeed, similarityPercent } from "./automaticAttendanceFormat";
import type { AutomaticAttendanceJob } from "./automaticAttendance";

export function AutomaticJobResultsModal({ job, token, onClose }: { job: AutomaticAttendanceJob; token: string; onClose: () => void }) {
  const isProcessing = job.status === "queued" || job.status === "processing";
  const jobProgress = Math.max(0, Math.min(100, job.percent ?? 0));
  const downloadPercent = job.download_percent == null ? null : Math.max(0, Math.min(100, job.download_percent));
  const hasResults = Boolean(job.results?.length);

  return (
    <div className="fixed inset-0 z-[1200] flex items-start justify-center overflow-y-auto bg-zinc-950/55 px-3 py-6">
      <div className="w-full max-w-5xl rounded-md border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <h3 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">Trabajo {job.id.slice(0, 8)}</h3>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {job.processed}/{job.total} videos - {jobProgress.toFixed(1)}% - {job.status}
            </p>
            <p className="mt-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{job.phase_label ?? (isProcessing ? "Procesando trabajo" : "Trabajo finalizado")}</p>
          </div>
          <button className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={onClose} type="button">
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-4 p-4">
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-zinc-950 dark:text-zinc-50">{job.current_video ?? "Esperando trabajo"}</span>
              <span className="text-zinc-500 dark:text-zinc-400">{isProcessing ? "En proceso" : "Finalizado"}</span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className={`h-full rounded-full bg-emerald-700 transition-all duration-700 ${isProcessing ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(jobProgress, isProcessing ? 3 : 0)}%` }} />
            </div>
            {downloadPercent !== null ? (
              <div className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:bg-blue-950 dark:text-blue-100">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">Descargando desde Drive</span>
                  <span>{downloadPercent.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900">
                  <div className={`h-full rounded-full bg-blue-700 transition-all duration-700 ${isProcessing && downloadPercent < 100 ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(downloadPercent, isProcessing ? 3 : 0)}%` }} />
                </div>
                <p className="mt-1 text-xs">
                  {formatBytes(job.downloaded_bytes ?? 0)} de {formatBytes(job.download_total_bytes || 1)}
                </p>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-blue-900/40">Actual: {formatSpeed(job.download_speed_bps)}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-blue-900/40">Promedio: {formatSpeed(job.download_average_bps)}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-blue-900/40">ETA: {formatDuration(job.download_eta_seconds)}</span>
                </div>
              </div>
            ) : null}
            {job.phase === "processing" || job.process_frame ? (
              <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">Analizando video</span>
                  <span>{jobProgress.toFixed(1)}%</span>
                </div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-4">
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Duracion video: {formatDuration(job.video_duration_seconds)}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Ventana: {formatDuration(job.process_window_seconds)}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">FPS: {job.video_fps?.toFixed(2) ?? "-"}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Frames video: {job.video_total_frames ?? "-"}</span>
                </div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Frame: {job.process_frame ?? "-"}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Total ventana: {job.process_total_frames ?? "-"}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Muestreados: {job.process_sampled_frames ?? "-"}</span>
                </div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Segundos probados: {job.process_probed_seconds ?? "-"}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Con cara: {job.process_active_seconds ?? "-"}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Saltados: {job.process_skipped_seconds ?? "-"}</span>
                </div>
                <div className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Personas agrupadas: {job.process_face_groups ?? "-"}</span>
                  <span className="rounded-md bg-white/70 px-2 py-1 dark:bg-emerald-900/40">Rostros descartados: {job.process_rejected_faces ?? "-"}</span>
                </div>
                {job.process_window ? <p className="mt-1 text-xs">Ventana: {job.process_window}</p> : null}
              </div>
            ) : null}
            {job.download_log_tail ? (
              <details className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <summary className="cursor-pointer font-semibold">Log rclone</summary>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap">{job.download_log_tail}</pre>
              </details>
            ) : null}
            {job.detail && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{job.detail}</p>}
          </div>

          {!hasResults && (
            <div className="rounded-md border border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              {isProcessing ? "Los resultados apareceran aqui cuando termine el procesamiento." : "Este trabajo no tiene resultados."}
            </div>
          )}

          {job.results?.map((result) => (
            <div key={result.video} className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
              <p className="font-semibold text-zinc-950 dark:text-zinc-50">{result.video}</p>
              {result.detail && <p className="mt-1 text-sm text-red-700 dark:text-red-300">{result.detail}</p>}
              {result.sessions?.map((sessionResult) => (
                <div key={sessionResult.session.id} className="mt-3 rounded-md bg-white p-3 dark:bg-zinc-950">
                  <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
                        {sessionResult.session.site_name} - {sessionResult.session.date} - {sessionResult.session.team_name || sessionResult.session.group_name || "Todos"}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {sessionResult.marked.length} marcados - {sessionResult.off_roster?.length ?? 0} fuera roster - {sessionResult.review?.length ?? 0} en revision - {sessionResult.unknown_faces?.length ?? 0} sin identificar
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        Video {formatDuration(sessionResult.duration_seconds)} - ventana {sessionResult.window ?? "-"} - frames video {sessionResult.total_frames ?? "-"} - analizados {sessionResult.sampled_frames ?? "-"}
                      </p>
                    </div>
                    {sessionResult.thresholds ? (
                      <div className="rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                        Umbral {similarityPercent(sessionResult.thresholds.similarity)} - margen {similarityPercent(sessionResult.thresholds.margin)} - min hits {sessionResult.thresholds.min_hits}
                      </div>
                    ) : null}
                  </div>
                  {sessionResult.detail && <p className={`mt-2 text-sm ${sessionResult.failed ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>{sessionResult.detail}</p>}
                  {sessionResult.skipped?.length ? <p className="mt-1 text-xs text-zinc-500">Omitidos: {sessionResult.skipped.slice(0, 8).join(" | ")}</p> : null}
                  {sessionResult.marked.length || sessionResult.off_roster?.length || sessionResult.review?.length ? (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      {sessionResult.marked.slice(0, 4).map((comparison) => (
                        <AutomaticFaceComparisonCard key={`modal-marked-${comparison.student_id}-${comparison.frame}`} comparison={comparison} token={token} accepted />
                      ))}
                      {(sessionResult.off_roster ?? []).slice(0, 6).map((comparison) => (
                        <AutomaticFaceComparisonCard key={`modal-off-roster-${comparison.person_key ?? comparison.student_id}-${comparison.frame}`} comparison={comparison} token={token} accepted={false} />
                      ))}
                      {(sessionResult.review ?? []).slice(0, 4).map((comparison) => (
                        <AutomaticFaceComparisonCard key={`modal-review-${comparison.student_id}-${comparison.frame}-${comparison.reason}`} comparison={comparison} token={token} accepted={false} />
                      ))}
                    </div>
                  ) : null}
                  {sessionResult.unknown_faces?.length ? (
                    <div className="mt-3">
                      <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Rostros sin identificar</h4>
                      <div className="mt-2 grid gap-3 md:grid-cols-2">
                        {sessionResult.unknown_faces.slice(0, 8).map((face) => (
                          <article key={`modal-unknown-${face.unknown_id}-${face.frame}`} className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                            <EvidenceImage url={face.evidence_url} token={token} />
                            <p className="mt-2 text-sm font-semibold text-amber-950 dark:text-amber-100">Rostro no identificado {face.unknown_id}</p>
                            <p className="mt-1 text-xs text-amber-800 dark:text-amber-200">
                              Hits {face.hits ?? 1} - similitud max {similarityPercent(face.similarity)} - frame {face.frame ?? "-"}
                            </p>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
