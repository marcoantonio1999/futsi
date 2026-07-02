import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, FolderOpen, Play, RefreshCw, UploadCloud } from "lucide-react";
import { apiFormRequestWithProgress, apiRequest } from "../../../api";
import type { AppData } from "../../../types";
import { SelectInput, TextInput } from "../../../components/views/sharedParts/metrics";
import { EvidenceImage } from "../evidence/AutomaticAttendanceEvidence";
import { formatBytes, similarityPercent } from "../format";

type PendingVideo = {
  filename: string;
  path: string;
  source?: "local" | "drive";
  size: number;
  modified_at: string;
  metadata: {
    site_id?: string | number | null;
    session_id?: string | number | null;
    recorded_date?: string | null;
    start_minute?: string | number | null;
    duration_minutes?: string | number | null;
    alert_threshold?: string | number | null;
    site_source?: string;
    date_source?: string;
    video_clip_id?: string;
    status?: string;
    processed_at?: string | null;
    error_message?: string | null;
  };
  reprocessable?: boolean;
};

type OccupancyFace = {
  id?: number;
  type?: "student" | "player";
  name?: string;
  unknown_id?: number;
  hits?: number;
  similarity?: number;
  margin?: number;
  frame?: number;
  evidence_url?: string;
  evidence_path?: string;
};

type VideoOccupancyJob = {
  id: string;
  status: "queued" | "processing" | "done" | "error";
  total: number;
  processed: number;
  percent: number;
  current_video?: string | null;
  detail?: string;
  results?: Array<{
    video: string;
    detail?: string;
    failed?: boolean;
    unique_people?: number;
    alert?: boolean;
    alert_threshold?: number;
    window?: string;
    sampled_frames?: number;
    duration_seconds?: number;
    identified?: OccupancyFace[];
    unknown?: OccupancyFace[];
    skipped?: string[];
  }>;
};

type VideoOccupancyStatus = {
  enabled: boolean;
  root: string;
  pending_dir: string;
  pending: PendingVideo[];
  active_job: VideoOccupancyJob | null;
  jobs: VideoOccupancyJob[];
};

function statusTone(status?: VideoOccupancyJob["status"]) {
  if (status === "done") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (status === "error") return "text-red-700 bg-red-50 border-red-200";
  return "text-amber-800 bg-amber-50 border-amber-200";
}
export function VideoOccupancyPanel({ token, data }: { token: string; data: AppData }) {
  const [status, setStatus] = useState<VideoOccupancyStatus | null>(null);
  const [job, setJob] = useState<VideoOccupancyJob | null>(null);
  const [siteId, setSiteId] = useState("");
  const [recordedDate, setRecordedDate] = useState(new Date().toISOString().slice(0, 10));
  const [startMinute, setStartMinute] = useState("0");
  const [durationMinutes, setDurationMinutes] = useState("120");
  const [alertThreshold, setAlertThreshold] = useState("10");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ loaded: 0, total: 0, percent: 0 });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const visibleJob = job ?? status?.active_job ?? status?.jobs?.[0] ?? null;
  const isProcessing = visibleJob?.status === "queued" || visibleJob?.status === "processing";
  const pendingCount = status?.pending.length ?? 0;
  const progress = Math.max(0, Math.min(100, visibleJob?.percent ?? 0));

  async function loadStatus(silent = false) {
    if (!silent) setLoadingStatus(true);
    try {
      const nextStatus = await apiRequest<VideoOccupancyStatus>("/video-occupancy/status/", token);
      setStatus(nextStatus);
      if (nextStatus.active_job) setJob(nextStatus.active_job);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el estado local de aforo.");
    } finally {
      setLoadingStatus(false);
    }
  }

  useEffect(() => {
    loadStatus(true);
    const interval = window.setInterval(() => loadStatus(true), 15000);
    return () => window.clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!visibleJob?.id || !isProcessing) return;
    const interval = window.setInterval(async () => {
      try {
        const nextJob = await apiRequest<VideoOccupancyJob>(`/video-occupancy/jobs/${visibleJob.id}/`, token);
        setJob(nextJob);
        if (nextJob.status === "done") {
          await loadStatus(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo leer el progreso de aforo.");
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [isProcessing, token, visibleJob?.id]);

  async function uploadFiles(files: FileList | File[]) {
    const file = Array.from(files).find((item) => item.type.startsWith("video/") || item.name.match(/\.(mp4|mov|avi|mkv|m4v)$/i));
    if (!file) return;
    if (!siteId) {
      setError("Selecciona una sede antes de subir el video de aforo.");
      return;
    }

    setUploading(true);
    setUploadProgress({ loaded: 0, total: file.size, percent: 0 });
    setMessage("");
    setError("");
    try {
      const formData = new FormData();
      formData.append("video", file);
      formData.append("site", siteId);
      formData.append("recorded_date", recordedDate);
      formData.append("start_minute", startMinute || "0");
      formData.append("duration_minutes", durationMinutes || "120");
      formData.append("alert_threshold", alertThreshold || "10");
      await apiFormRequestWithProgress("/video-occupancy/upload/", token, formData, setUploadProgress);
      setMessage("Video agregado a pendientes de aforo.");
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el video de aforo.");
    } finally {
      setUploading(false);
      setUploadProgress({ loaded: 0, total: 0, percent: 0 });
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function processPending() {
    setMessage("");
    setError("");
    try {
      const nextJob = await apiRequest<VideoOccupancyJob>("/video-occupancy/process-pending/", token, { method: "POST" });
      setJob(nextJob);
      setMessage("Analisis local de aforo iniciado.");
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar el analisis de aforo.");
    }
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-zinc-950 dark:text-zinc-50">
              <FolderOpen size={17} /> Aforo en video
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Detecta si hubo mas de 10 personas unicas en una ventana de video, por default 2 horas.</p>
            <p className="mt-1 text-xs text-zinc-400">Carpeta local: {status?.pending_dir ?? "Cargando..."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => loadStatus()} type="button">
              <RefreshCw size={15} /> Actualizar
            </button>
            <button
              className="flex items-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
              disabled={!status?.enabled || pendingCount === 0 || isProcessing}
              onClick={processPending}
              type="button"
            >
              <Play size={15} /> Procesar pendientes
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Servicio local</p>
            <p className={`mt-2 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm font-medium ${status?.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
              {status?.enabled ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              {status?.enabled ? "Disponible" : "No habilitado"}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Pendientes</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{pendingCount}</p>
          </div>
          <div className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="text-xs font-medium uppercase text-zinc-500 dark:text-zinc-400">Ultimo trabajo</p>
            <p className={`mt-2 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm font-medium ${statusTone(visibleJob?.status)}`}>
              <Clock3 size={15} />
              {visibleJob?.status ?? "Sin trabajos"}
            </p>
          </div>
        </div>

        {visibleJob && (
          <div className="mt-4 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-zinc-950 dark:text-zinc-50">{visibleJob.current_video ?? `Trabajo ${visibleJob.id.slice(0, 8)}`}</span>
              <span className="text-zinc-500">{visibleJob.processed}/{visibleJob.total} videos</span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className={`h-full rounded-full bg-zinc-950 transition-all duration-700 dark:bg-zinc-50 ${isProcessing ? "progress-fill-active" : ""}`} style={{ width: `${Math.max(progress, isProcessing ? 3 : 0)}%` }} />
            </div>
            <p className="mt-2 text-xs text-zinc-500">{progress.toFixed(1)}%</p>
            {visibleJob.detail && <p className="mt-2 text-sm text-red-700">{visibleJob.detail}</p>}
          </div>
        )}

        {message && <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loadingStatus && <p className="mt-3 text-sm text-zinc-500">Leyendo carpeta local de aforo...</p>}
      </section>

      <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <form className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
            <UploadCloud size={16} /> Carga manual de aforo
          </h3>
          <div className="mt-4 grid gap-3">
            <SelectInput label="Sede" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              <option value="">Seleccionar sede</option>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>{site.name}</option>
              ))}
            </SelectInput>
            <TextInput label="Fecha del video" type="date" value={recordedDate} onChange={(event) => setRecordedDate(event.target.value)} />
            <TextInput label="Minuto inicial" type="number" min="0" value={startMinute} onChange={(event) => setStartMinute(event.target.value)} />
            <TextInput label="Duracion a analizar (min)" type="number" min="1" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} />
            <TextInput label="Alerta si supera" type="number" min="1" value={alertThreshold} onChange={(event) => setAlertThreshold(event.target.value)} />
          </div>

          <button
            className="mt-4 flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-center text-sm text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              uploadFiles(event.dataTransfer.files);
            }}
            type="button"
          >
            <UploadCloud size={28} />
            <span className="font-medium">Arrastra un video o selecciona archivo</span>
            <span className="text-xs text-zinc-500">MP4, MOV, AVI, MKV o M4V</span>
          </button>
          <input ref={fileInputRef} className="hidden" type="file" accept="video/*" onChange={(event) => event.target.files && uploadFiles(event.target.files)} />
          {uploading && (
            <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-zinc-800 dark:text-zinc-100">Subiendo video</span>
                <span className="font-semibold text-zinc-950 dark:text-zinc-50">{uploadProgress.percent.toFixed(0)}%</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className="progress-fill-active h-full rounded-full bg-zinc-950 transition-all duration-700 dark:bg-zinc-50" style={{ width: `${Math.max(2, uploadProgress.percent)}%` }} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">{formatBytes(uploadProgress.loaded)} de {formatBytes(uploadProgress.total || 1)}</p>
            </div>
          )}
        </form>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Videos pendientes de aforo</h3>
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{pendingCount}</span>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {status?.pending.map((video) => {
              const site = data.sites.find((item) => String(item.id) === String(video.metadata.site_id));
              return (
                <div key={video.path} className="px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-950 dark:text-zinc-50">{video.filename}</p>
                      <p className="mt-1 text-sm text-zinc-500">{formatBytes(video.size)} - {new Date(video.modified_at).toLocaleString()}</p>
                      <p className="mt-1 break-all text-xs text-zinc-400">{video.path}</p>
                    </div>
                    <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">{site?.name ?? "Sin sede"}</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">
                    Ventana {video.metadata.start_minute ?? 0}-{Number(video.metadata.start_minute ?? 0) + Number(video.metadata.duration_minutes ?? 120)} min - alerta &gt; {video.metadata.alert_threshold ?? 10}
                  </p>
                </div>
              );
            })}
            {status?.pending.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay videos de aforo pendientes.</p>}
          </div>
        </div>
      </section>

      {visibleJob?.results?.length ? (
        <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">Resultados recientes de aforo</h3>
          </div>
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {visibleJob.results.map((result) => (
              <div key={result.video} className="px-4 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-medium text-zinc-950 dark:text-zinc-50">{result.video}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Ventana {result.window ?? "-"} - frames muestreados {result.sampled_frames ?? 0} - umbral {result.alert_threshold ?? 10}
                    </p>
                    {result.detail && <p className="mt-1 text-sm text-red-700">{result.detail}</p>}
                  </div>
                  <div className={`rounded-md px-3 py-2 text-sm font-semibold ${result.alert ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"}`}>
                    {result.unique_people ?? 0} personas unicas {result.alert ? "detectadas: revisar aforo" : "detectadas"}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Identificados en DB ({result.identified?.length ?? 0})</h4>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      {(result.identified ?? []).map((face) => (
                        <article key={`${face.type}-${face.id}-${face.frame}`} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                          <EvidenceImage url={face.evidence_url} token={token} />
                          <p className="mt-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">{face.name}</p>
                          <p className="mt-1 text-xs text-zinc-500">Hits {face.hits ?? 1} - similitud {similarityPercent(face.similarity)} - frame {face.frame ?? "-"}</p>
                        </article>
                      ))}
                      {(result.identified ?? []).length === 0 && <p className="text-sm text-zinc-500">Sin personas identificadas contra la DB.</p>}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Rostros no identificados ({result.unknown?.length ?? 0})</h4>
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      {(result.unknown ?? []).map((face) => (
                        <article key={`unknown-${face.unknown_id}-${face.frame}`} className="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
                          <EvidenceImage url={face.evidence_url} token={token} />
                          <p className="mt-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">Rostro no identificado {face.unknown_id}</p>
                          <p className="mt-1 text-xs text-zinc-500">Hits {face.hits ?? 1} - frame {face.frame ?? "-"}</p>
                        </article>
                      ))}
                      {(result.unknown ?? []).length === 0 && <p className="text-sm text-zinc-500">Sin rostros desconocidos persistentes.</p>}
                    </div>
                  </div>
                </div>
                {result.skipped?.length ? <p className="mt-3 text-xs text-zinc-500">Fotos omitidas: {result.skipped.slice(0, 5).join(" | ")}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
