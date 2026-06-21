import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, Clock3, FolderOpen, Play, RefreshCw, Search, UploadCloud } from "lucide-react";
import { apiFormRequestWithProgress, apiRequest } from "../../api";
import type { AppData, AttendanceSession } from "../../types";
import { SelectInput, TextInput } from "./sharedParts/metrics";

type PendingVideo = {
  filename: string;
  path: string;
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
  };
};

type AutomaticAttendanceJob = {
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
    sessions?: AutomaticSessionResult[];
  }>;
};

type AutomaticSessionSummary = {
  id: number;
  site: number;
  site_name: string;
  date: string;
  starts_at: string | null;
  duration_minutes: number;
  group_name: string;
  session_type?: string;
  team?: number | null;
  team_name?: string;
  tournament?: number | null;
};

type UnknownFace = {
  unknown_id: number;
  hits?: number;
  similarity: number;
  frame?: number;
  evidence_url?: string;
  evidence_path?: string;
};

type AutomaticSessionResult = {
  session: AutomaticSessionSummary;
  marked: FaceComparison[];
  review?: FaceComparison[];
  unknown_faces?: UnknownFace[];
  detail?: string;
  failed?: boolean;
  skipped?: string[];
  thresholds?: {
    similarity: number;
    margin: number;
    min_hits: number;
    review_similarity: number;
    duplicate_guard: number;
  };
};

type FaceComparison = {
  student_id: number;
  student_name: string;
  hits?: number;
  similarity: number;
  margin?: number;
  frame?: number;
  reason?: string;
  evidence_url?: string;
  evidence_path?: string;
  manual_confirmed?: boolean;
  candidates?: Array<{ student_id: number; student_name: string; similarity: number }>;
};

type AutomaticAttendanceStatus = {
  enabled: boolean;
  root: string;
  pending_dir: string;
  pending: PendingVideo[];
  active_job: AutomaticAttendanceJob | null;
  jobs: AutomaticAttendanceJob[];
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
    thresholds?: {
      similarity: number;
      margin: number;
      min_hits: number;
      sample_every: number;
    };
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

type ReportType = AttendanceSession["session_type"];

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function sessionLabel(session: AttendanceSession) {
  const type = session.session_type === "tournament_match" ? "Partido" : "Entrenamiento";
  return `${session.date} ${session.starts_at ?? "--:--"} (${session.duration_minutes || 120} min) - ${type} - ${session.site_name ?? "Sede"}${session.group_name ? ` - ${session.group_name}` : ""}`;
}

function automaticSessionSummary(session: AttendanceSession): AutomaticSessionSummary {
  return {
    id: session.id,
    site: session.site,
    site_name: session.site_name ?? "Sede",
    date: session.date,
    starts_at: session.starts_at,
    duration_minutes: session.duration_minutes || 120,
    group_name: session.group_name,
    session_type: session.session_type,
    team: session.team,
    team_name: session.team_name,
    tournament: session.tournament,
  };
}

function hasUsablePersonPhoto(person: { photo?: string; photo_url?: string }) {
  const url = person.photo_url ?? "";
  return Boolean(person.photo) || url.startsWith("supabase://") || url.includes("/media/");
}

function statusTone(status?: AutomaticAttendanceJob["status"]) {
  if (status === "done") return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (status === "error") return "text-red-700 bg-red-50 border-red-200";
  return "text-amber-800 bg-amber-50 border-amber-200";
}

function similarityPercent(value?: number) {
  return `${(((value ?? 0) * 1000) / 10).toFixed(1)}%`;
}

function EvidenceImage({ url, token }: { url?: string; token: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    if (!url) {
      setSrc("");
      return;
    }
    let objectUrl = "";
    let cancelled = false;
    fetch(url, { headers: { Authorization: `Token ${token}` } })
      .then((response) => {
        if (!response.ok) throw new Error("No se pudo cargar evidencia.");
        return response.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc("");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, url]);

  if (!url) {
    return (
      <div className="flex aspect-[2/1] items-center justify-center rounded-md bg-zinc-100 text-xs text-zinc-500">
        Sin evidencia
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex aspect-[2/1] items-center justify-center rounded-md bg-zinc-100 text-xs text-zinc-500">
        Cargando evidencia...
      </div>
    );
  }

  return <img src={src} alt="Comparacion de rostro" className="aspect-[2/1] w-full rounded-md border border-zinc-300 bg-black object-cover" />;
}

function FaceComparisonCard({
  comparison,
  token,
  accepted,
  onConfirm,
  confirming,
}: {
  comparison: FaceComparison;
  token: string;
  accepted: boolean;
  onConfirm?: () => void;
  confirming?: boolean;
}) {
  const tone = accepted ? "border-emerald-500 bg-white shadow-sm" : "border-amber-500 bg-white shadow-sm";
  const badgeTone = accepted ? "bg-emerald-700 text-white" : "bg-amber-600 text-white";
  return (
    <article className={`rounded-md border-2 ${tone} p-3`}>
      <EvidenceImage url={comparison.evidence_url} token={token} />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-zinc-950">{comparison.student_name}</p>
          <p className="mt-1 text-xs font-medium text-zinc-700">
            Similitud {similarityPercent(comparison.similarity)} - margen {similarityPercent(comparison.margin)} - hits {comparison.hits ?? 1} - frame {comparison.frame ?? "-"}
          </p>
        </div>
        <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${badgeTone}`}>
          {comparison.manual_confirmed ? "Confirmado" : accepted ? "Marcado" : "Revision"}
        </span>
      </div>
      {comparison.reason && <p className="mt-2 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950">{comparison.reason}</p>}
      {comparison.candidates?.length ? (
        <div className="mt-3 border-t border-zinc-300 pt-2">
          <p className="text-[11px] font-semibold uppercase text-zinc-700">Candidatos cercanos</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {comparison.candidates.slice(0, 3).map((candidate) => (
              <span key={candidate.student_id} className="rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-800">
                {candidate.student_name}: {similarityPercent(candidate.similarity)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {!accepted && onConfirm ? (
        <button
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={confirming}
          onClick={onConfirm}
          type="button"
        >
          <Check size={15} /> {confirming ? "Confirmando..." : "Confirmar asistencia"}
        </button>
      ) : null}
    </article>
  );
}

type AttendanceReportRow = {
  category: string;
  name: string;
  payment: string;
  detail: string;
  evidenceUrl?: string;
};

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return amount.toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function rosterForAutomaticSession(data: AppData, session: AutomaticSessionSummary) {
  let students = data.students.filter((student) => student.site === session.site && (!session.group_name || student.group_name === session.group_name));
  if (session.session_type === "tournament_match" && session.team && session.tournament) {
    const registeredIds = new Set(
      data.studentTournamentRegistrations
        .filter((registration) => registration.status === "registered" && registration.team === session.team && registration.tournament === session.tournament)
        .map((registration) => registration.student),
    );
    students = data.students.filter((student) => registeredIds.has(student.id));
  }
  return students;
}

function openStudentCharges(data: AppData, studentId: number) {
  return data.charges.filter((charge) => charge.student === studentId && ["pending", "partial"].includes(charge.status) && Number(charge.balance || 0) > 0);
}

function AutomaticAttendanceReportTable({ data, sessionResult, token }: { data: AppData; sessionResult: AutomaticSessionResult; token: string }) {
  const rows = useMemo<AttendanceReportRow[]>(() => {
    const records = data.attendanceRecords.filter((record) => record.session === sessionResult.session.id);
    const studentsById = new Map(data.students.map((student) => [student.id, student]));
    const markedByStudent = new Map(sessionResult.marked.map((comparison) => [comparison.student_id, comparison]));
    const presentStudentIds = new Set<number>();
    const reportRows: AttendanceReportRow[] = [];

    function addPresentStudent(studentId: number, fallbackName: string, marked?: FaceComparison, hadDebtAtCapture = false) {
      if (presentStudentIds.has(studentId)) return;
      presentStudentIds.add(studentId);
      const student = studentsById.get(studentId);
      const openCharges = openStudentCharges(data, studentId);
      const balance = openCharges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
      reportRows.push({
        category: openCharges.length || hadDebtAtCapture ? "Asistio sin pago" : "Asistio pagado",
        name: student?.full_name ?? fallbackName,
        payment: openCharges.length ? `Adeudo ${money(balance)}` : hadDebtAtCapture ? "Adeudo al capturar" : "Al corriente",
        detail: marked ? `Similitud ${similarityPercent(marked.similarity)} - hits ${marked.hits ?? 1}` : "Marcado en la sesion",
        evidenceUrl: marked?.evidence_url,
      });
    }

    records
      .filter((record) => record.status === "present" && record.student)
      .forEach((record) => {
        const studentId = Number(record.student);
        addPresentStudent(studentId, record.student_name ?? `Alumno ${studentId}`, markedByStudent.get(studentId), record.had_debt_at_capture);
      });

    sessionResult.marked.forEach((marked) => {
      addPresentStudent(marked.student_id, marked.student_name, marked);
    });

    records
      .filter((record) => record.status !== "present" && record.student && !presentStudentIds.has(Number(record.student)))
      .forEach((record) => {
        const studentId = Number(record.student);
        const student = studentsById.get(studentId);
        const openCharges = openStudentCharges(data, studentId);
        const balance = openCharges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
        reportRows.push({
          category: "No asistio",
          name: student?.full_name ?? record.student_name ?? `Alumno ${studentId}`,
          payment: openCharges.length ? `Adeudo ${money(balance)}` : record.had_debt_at_capture ? "Adeudo al capturar" : "Al corriente",
          detail: record.status === "justified" ? "Falta justificada registrada" : "Falta registrada en esta sesion",
        });
      });

    (sessionResult.review ?? []).forEach((comparison) => {
      if (presentStudentIds.has(comparison.student_id)) return;
      const student = studentsById.get(comparison.student_id);
      const openCharges = openStudentCharges(data, comparison.student_id);
      const balance = openCharges.reduce((sum, charge) => sum + Number(charge.balance || 0), 0);
      reportRows.push({
        category: "En revision",
        name: student?.full_name ?? comparison.student_name,
        payment: openCharges.length ? `Adeudo ${money(balance)}` : "Al corriente",
        detail: `Similitud ${similarityPercent(comparison.similarity)} - hits ${comparison.hits ?? 1}`,
        evidenceUrl: comparison.evidence_url,
      });
    });

    (sessionResult.unknown_faces ?? []).forEach((face) => {
      reportRows.push({
        category: "Rostro sin alumno",
        name: `Rostro no identificado ${face.unknown_id}`,
        payment: "No aplica",
        detail: `Frame ${face.frame ?? "-"} - hits ${face.hits ?? 1} - similitud max ${similarityPercent(face.similarity)}`,
        evidenceUrl: face.evidence_url,
      });
    });

    const order = ["Asistio pagado", "Asistio sin pago", "En revision", "No asistio", "Rostro sin alumno"];
    return reportRows.sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.name.localeCompare(b.name));
  }, [data, sessionResult]);

  const counts = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.category] = (acc[row.category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="mt-4 rounded-md border border-zinc-300 bg-white text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        <span>Asistio pagado: {counts["Asistio pagado"] ?? 0}</span>
        <span>Asistio sin pago: {counts["Asistio sin pago"] ?? 0}</span>
        <span>En revision: {counts["En revision"] ?? 0}</span>
        <span>No asistio: {counts["No asistio"] ?? 0}</span>
        <span>Rostros sin alumno: {counts["Rostro sin alumno"] ?? 0}</span>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="min-w-full border-collapse text-left text-xs text-zinc-900 dark:text-zinc-100">
          <thead className="sticky top-0 bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            <tr>
              <th className="border-b border-zinc-300 px-3 py-2 font-semibold dark:border-zinc-700">Categoria</th>
              <th className="border-b border-zinc-300 px-3 py-2 font-semibold dark:border-zinc-700">Alumno / rostro</th>
              <th className="border-b border-zinc-300 px-3 py-2 font-semibold dark:border-zinc-700">Pago</th>
              <th className="border-b border-zinc-300 px-3 py-2 font-semibold dark:border-zinc-700">Detalle</th>
              <th className="border-b border-zinc-300 px-3 py-2 font-semibold dark:border-zinc-700">Evidencia</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.category}-${row.name}-${index}`} className="odd:bg-white even:bg-zinc-50 dark:odd:bg-zinc-950 dark:even:bg-zinc-900/70">
                <td className="border-b border-zinc-100 px-3 py-2 font-medium text-zinc-950 dark:border-zinc-800 dark:text-zinc-50">{row.category}</td>
                <td className="border-b border-zinc-100 px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-100">{row.name}</td>
                <td className="border-b border-zinc-100 px-3 py-2 text-zinc-800 dark:border-zinc-800 dark:text-zinc-100">{row.payment}</td>
                <td className="border-b border-zinc-100 px-3 py-2 text-zinc-600 dark:border-zinc-800 dark:text-zinc-300">{row.detail}</td>
                <td className="w-44 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                  {row.evidenceUrl ? (
                    <div className="w-36">
                      <EvidenceImage url={row.evidenceUrl} token={token} />
                    </div>
                  ) : (
                    <span className="text-zinc-400 dark:text-zinc-500">-</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
                  Sin datos para esta sesion.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
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
              <div className="h-full rounded-full bg-zinc-950 transition-all dark:bg-zinc-50" style={{ width: `${progress}%` }} />
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
                <div className="h-full rounded-full bg-zinc-950 transition-all dark:bg-zinc-50" style={{ width: `${Math.max(2, uploadProgress.percent)}%` }} />
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

export function AutomaticAttendancePanel({
  token,
  data,
  onRefreshData,
  mode = "process",
}: {
  token: string;
  data: AppData;
  onRefreshData: () => Promise<void> | void;
  mode?: "process" | "report";
}) {
  const [status, setStatus] = useState<AutomaticAttendanceStatus | null>(null);
  const [job, setJob] = useState<AutomaticAttendanceJob | null>(null);
  const [siteId, setSiteId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [recordedDate, setRecordedDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmingKey, setConfirmingKey] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ loaded: 0, total: 0, percent: 0 });
  const [reportType, setReportType] = useState<ReportType>("tournament_match");
  const [reportSessionId, setReportSessionId] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sessions = useMemo(() => {
    return data.attendanceSessions
      .filter((session) => !siteId || session.site === Number(siteId))
      .slice()
      .sort((a, b) => `${b.date} ${b.starts_at ?? ""}`.localeCompare(`${a.date} ${a.starts_at ?? ""}`));
  }, [data.attendanceSessions, siteId]);

  const sessionPhotoStats = useMemo(() => {
    const stats = new Map<number, { total: number; configured: number }>();
    sessions.forEach((session) => {
      let students = data.students.filter((student) => student.site === session.site && (!session.group_name || student.group_name === session.group_name));
      if (session.session_type === "tournament_match" && session.team && session.tournament) {
        const registeredIds = new Set(
          data.studentTournamentRegistrations
            .filter((registration) => registration.status === "registered" && registration.team === session.team && registration.tournament === session.tournament)
            .map((registration) => registration.student),
        );
        students = data.students.filter((student) => registeredIds.has(student.id));
        if (!students.length) {
          const players = data.players.filter((player) => player.team === session.team && player.is_active);
          stats.set(session.id, { total: players.length, configured: players.filter(hasUsablePersonPhoto).length });
          return;
        }
      }
      stats.set(session.id, { total: students.length, configured: students.filter(hasUsablePersonPhoto).length });
    });
    return stats;
  }, [data.studentTournamentRegistrations, data.students, sessions]);

  const selectedSessionStats = sessionId ? sessionPhotoStats.get(Number(sessionId)) : undefined;

  const visibleJob = job ?? status?.active_job ?? status?.jobs?.[0] ?? null;
  const isProcessing = visibleJob?.status === "queued" || visibleJob?.status === "processing";
  const automaticResultsBySession = useMemo(() => {
    const resultMap = new Map<number, { result: AutomaticSessionResult; video: string; jobId: string }>();
    const seenJobs = new Set<string>();
    const jobs = [job, status?.active_job, ...(status?.jobs ?? [])].filter(Boolean) as AutomaticAttendanceJob[];
    jobs.forEach((candidate) => {
      if (seenJobs.has(candidate.id)) return;
      seenJobs.add(candidate.id);
      candidate.results?.forEach((videoResult) => {
        videoResult.sessions?.forEach((sessionResult) => {
          if (!resultMap.has(sessionResult.session.id)) {
            resultMap.set(sessionResult.session.id, { result: sessionResult, video: videoResult.video, jobId: candidate.id });
          }
        });
      });
    });
    return resultMap;
  }, [job, status?.active_job, status?.jobs]);

  const reportSessions = useMemo(() => {
    return data.attendanceSessions
      .filter((session) => session.session_type === reportType)
      .slice()
      .sort((a, b) => `${b.date} ${b.starts_at ?? ""}`.localeCompare(`${a.date} ${a.starts_at ?? ""}`));
  }, [data.attendanceSessions, reportType]);

  const selectedReportSession = useMemo(() => {
    return reportSessions.find((session) => String(session.id) === reportSessionId) ?? reportSessions[0] ?? null;
  }, [reportSessionId, reportSessions]);

  const selectedReportResult = useMemo<AutomaticSessionResult | null>(() => {
    if (!selectedReportSession) return null;
    return (
      automaticResultsBySession.get(selectedReportSession.id)?.result ?? {
        session: automaticSessionSummary(selectedReportSession),
        marked: [],
        review: [],
        unknown_faces: [],
      }
    );
  }, [automaticResultsBySession, selectedReportSession]);

  useEffect(() => {
    if (siteId || !sessions.length) return;
    const preferredSession = sessions.find((session) => (sessionPhotoStats.get(session.id)?.configured ?? 0) > 0) ?? sessions[0];
    setSiteId(String(preferredSession.site));
  }, [sessionPhotoStats, sessions, siteId]);

  useEffect(() => {
    if (!sessions.length) return;
    const currentSession = sessions.find((session) => String(session.id) === sessionId);
    const currentHasPhotos = currentSession ? (sessionPhotoStats.get(currentSession.id)?.configured ?? 0) > 0 : false;
    if (!currentSession || !currentHasPhotos) {
      const preferredSession = sessions.find((session) => (sessionPhotoStats.get(session.id)?.configured ?? 0) > 0) ?? sessions[0];
      setSessionId(String(preferredSession.id));
      setRecordedDate(preferredSession.date);
    }
  }, [sessionId, sessionPhotoStats, sessions]);

  async function loadStatus(silent = false) {
    if (!silent) setLoadingStatus(true);
    try {
      const nextStatus = await apiRequest<AutomaticAttendanceStatus>("/automatic-attendance/status/", token);
      setStatus(nextStatus);
      if (nextStatus.active_job) setJob(nextStatus.active_job);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer el estado local.");
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
        const nextJob = await apiRequest<AutomaticAttendanceJob>(`/automatic-attendance/jobs/${visibleJob.id}/`, token);
        setJob(nextJob);
        if (nextJob.status === "done") {
          await onRefreshData();
          await loadStatus(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo leer el progreso.");
      }
    }, 2000);
    return () => window.clearInterval(interval);
  }, [isProcessing, onRefreshData, token, visibleJob?.id]);

  useEffect(() => {
    if (mode !== "report") return;
    if (!reportSessions.length) {
      if (reportSessionId) setReportSessionId("");
      return;
    }
    if (!reportSessions.some((session) => String(session.id) === reportSessionId)) {
      setReportSessionId(String(reportSessions[0].id));
    }
  }, [mode, reportSessionId, reportSessions]);

  async function uploadFiles(files: FileList | File[]) {
    const file = Array.from(files).find((item) => item.type.startsWith("video/") || item.name.match(/\.(mp4|mov|avi|mkv|m4v)$/i));
    if (!file) return;
    if (!siteId || !sessionId) {
      setError("Selecciona sede y sesion antes de subir un video manual.");
      return;
    }
    if (!selectedSessionStats?.configured) {
      setError("La sesion seleccionada no tiene fotos locales o privadas para comparar. Selecciona una sesion con fotos cargadas.");
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
      formData.append("session", sessionId);
      formData.append("recorded_date", recordedDate);
      await apiFormRequestWithProgress("/automatic-attendance/upload/", token, formData, setUploadProgress);
      setMessage("Video agregado a pendientes.");
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo subir el video.");
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
      const nextJob = await apiRequest<AutomaticAttendanceJob>("/automatic-attendance/process-pending/", token, { method: "POST" });
      setJob(nextJob);
      setMessage("Procesamiento local iniciado.");
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar el procesamiento.");
    }
  }

  async function confirmReview(jobId: string, attendanceSessionId: number, comparison: FaceComparison) {
    const key = `${attendanceSessionId}-${comparison.student_id}-${comparison.frame ?? ""}`;
    setConfirmingKey(key);
    setMessage("");
    setError("");
    try {
      const nextJob = await apiRequest<AutomaticAttendanceJob>(`/automatic-attendance/jobs/${jobId}/confirm-review/`, token, {
        method: "POST",
        body: JSON.stringify({
          session_id: attendanceSessionId,
          student_id: comparison.student_id,
          frame: comparison.frame ?? null,
        }),
      });
      setJob(nextJob);
      setMessage("Asistencia confirmada manualmente y guardada para revision futura.");
      await onRefreshData();
      await loadStatus(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar la asistencia.");
    } finally {
      setConfirmingKey("");
    }
  }

  const pendingCount = status?.pending.length ?? 0;
  const progress = Math.max(0, Math.min(100, visibleJob?.percent ?? 0));

  if (mode === "report") {
    const automaticMatch = selectedReportSession ? automaticResultsBySession.get(selectedReportSession.id) : undefined;
    const sessionTypeLabel = reportType === "tournament_match" ? "partidos" : "entrenamientos";

    return (
      <div className="grid gap-5">
        <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">Reporte de asistencia automatica</h2>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Filtra por tipo y sesion para revisar la asistencia exacta de ese partido o entrenamiento.</p>
            </div>
            <button className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100" onClick={() => loadStatus()} type="button">
              <RefreshCw size={15} /> Actualizar
            </button>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
            <label className="block text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-200">Tipo de sesion</span>
              <select
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-emerald-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                value={reportType}
                onChange={(event) => setReportType(event.target.value as ReportType)}
              >
                <option value="tournament_match">Partidos</option>
                <option value="academy_class">Entrenamientos</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium text-zinc-700 dark:text-zinc-200">Sesion</span>
              <select
                className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-950 outline-none focus:border-emerald-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                value={selectedReportSession ? String(selectedReportSession.id) : ""}
                onChange={(event) => setReportSessionId(event.target.value)}
              >
                {reportSessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {sessionLabel(session)}
                    {automaticResultsBySession.has(session.id) ? " - con video procesado" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {selectedReportSession && selectedReportResult ? (
          <section className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">{sessionLabel(selectedReportSession)}</h3>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {automaticMatch ? `Ultimo video procesado: ${automaticMatch.video}` : `No hay video automatico procesado para esta sesion; se muestran registros guardados.`}
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Los ausentes solo se muestran si ya existen como falta registrada en esta sesion. No se infieren desde todo el banco de fotos.
              </p>
            </div>
            {selectedReportResult.detail && <p className={`px-4 pt-3 text-sm ${selectedReportResult.failed ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}>{selectedReportResult.detail}</p>}
            <div className="px-4 pb-4">
              <AutomaticAttendanceReportTable data={data} sessionResult={selectedReportResult} token={token} />
            </div>
          </section>
        ) : (
          <section className="rounded-md border border-zinc-200 bg-white px-4 py-8 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
            No hay {sessionTypeLabel} para reportar.
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <FolderOpen size={17} /> Pase de lista automatico
            </h2>
            <p className="mt-1 text-sm text-zinc-500">Carpeta local: {status?.pending_dir ?? "Cargando..."}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="flex items-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium" onClick={() => loadStatus()} type="button">
              <RefreshCw size={15} /> Actualizar
            </button>
            <button
              className="flex items-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              disabled={!status?.enabled || pendingCount === 0 || isProcessing}
              onClick={processPending}
              type="button"
            >
              <Play size={15} /> Procesar pendientes
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-zinc-200 p-3">
            <p className="text-xs font-medium uppercase text-zinc-500">Servicio local</p>
            <p className={`mt-2 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm font-medium ${status?.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700"}`}>
              {status?.enabled ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
              {status?.enabled ? "Disponible" : "No habilitado"}
            </p>
          </div>
          <div className="rounded-md border border-zinc-200 p-3">
            <p className="text-xs font-medium uppercase text-zinc-500">Pendientes</p>
            <p className="mt-2 text-2xl font-semibold">{pendingCount}</p>
          </div>
          <div className="rounded-md border border-zinc-200 p-3">
            <p className="text-xs font-medium uppercase text-zinc-500">Ultimo trabajo</p>
            <p className={`mt-2 inline-flex items-center gap-2 rounded-md border px-2 py-1 text-sm font-medium ${statusTone(visibleJob?.status)}`}>
              <Clock3 size={15} />
              {visibleJob?.status ?? "Sin trabajos"}
            </p>
          </div>
        </div>

        {visibleJob && (
          <div className="mt-4 rounded-md border border-zinc-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">{visibleJob.current_video ?? `Trabajo ${visibleJob.id.slice(0, 8)}`}</span>
              <span className="text-zinc-500">
                {visibleJob.processed}/{visibleJob.total} videos
              </span>
            </div>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-emerald-700 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="mt-2 text-xs text-zinc-500">{progress.toFixed(1)}%</p>
            {visibleJob.detail && <p className="mt-2 text-sm text-red-700">{visibleJob.detail}</p>}
          </div>
        )}

        {message && <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
        {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {loadingStatus && <p className="mt-3 text-sm text-zinc-500">Leyendo carpeta local...</p>}
      </section>

      <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <form className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <UploadCloud size={16} /> Carga manual
          </h3>
          <div className="mt-4 grid gap-3">
            <SelectInput label="Sede" value={siteId} onChange={(event) => setSiteId(event.target.value)}>
              {data.sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </SelectInput>
            <SelectInput label="Sesion" value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
              {sessions.map((session) => {
                const stats = sessionPhotoStats.get(session.id) ?? { total: 0, configured: 0 };
                return (
                <option key={session.id} value={session.id} disabled={stats.configured === 0}>
                  {sessionLabel(session)} - {stats.configured}/{stats.total} fotos
                </option>
                );
              })}
            </SelectInput>
            {selectedSessionStats && selectedSessionStats.configured === 0 ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Esta sesion no tiene fotos locales o privadas configuradas y no se puede procesar.</p>
            ) : null}
            <TextInput label="Fecha del video" type="date" value={recordedDate} onChange={(event) => setRecordedDate(event.target.value)} />
          </div>

          <button
            className="mt-4 flex min-h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-center text-sm text-zinc-600 hover:bg-zinc-100"
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
            <div className="mt-3 rounded-md border border-zinc-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-zinc-800">Subiendo video</span>
                <span className="font-semibold text-zinc-950">{uploadProgress.percent.toFixed(0)}%</span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-zinc-100">
                <div className="h-full rounded-full bg-zinc-950 transition-all" style={{ width: `${Math.max(2, uploadProgress.percent)}%` }} />
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {formatBytes(uploadProgress.loaded)} de {formatBytes(uploadProgress.total || 1)}
              </p>
            </div>
          )}
        </form>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <h3 className="font-semibold">Videos pendientes</h3>
            <span className="rounded-md bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600">{pendingCount}</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {status?.pending.map((video) => {
              const site = data.sites.find((item) => String(item.id) === String(video.metadata.site_id));
              const session = data.attendanceSessions.find((item) => String(item.id) === String(video.metadata.session_id));
              return (
                <div key={video.path} className="px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{video.filename}</p>
                      <p className="mt-1 text-sm text-zinc-500">{formatBytes(video.size)} - {new Date(video.modified_at).toLocaleString()}</p>
                      <p className="mt-1 break-all text-xs text-zinc-400">{video.path}</p>
                    </div>
                    <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-1 text-xs text-zinc-600">{site?.name ?? "Sin sede"}</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-600">{session ? sessionLabel(session) : video.metadata.recorded_date ? `Fecha detectada: ${video.metadata.recorded_date}` : "Sin sesion asignada"}</p>
                </div>
              );
            })}
            {status?.pending.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay videos en pendientes.</p>}
          </div>
        </div>
      </section>

      {visibleJob?.results?.length ? (
        <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-4 py-3">
            <h3 className="font-semibold">Resultados recientes</h3>
          </div>
          <div className="divide-y divide-zinc-100">
            {visibleJob.results.map((result) => (
              <div key={result.video} className="px-4 py-3">
                <p className="font-medium">{result.video}</p>
                {result.detail && <p className="mt-1 text-sm text-red-700">{result.detail}</p>}
                {result.sessions?.map((sessionResult) => (
                  <div key={sessionResult.session.id} className="mt-3 rounded-md bg-zinc-50 p-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="text-sm font-medium">
                          {sessionResult.session.site_name} - {sessionResult.session.date} - {sessionResult.session.team_name || sessionResult.session.group_name || "Todos"}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          {sessionResult.marked.length} marcados · {sessionResult.review?.length ?? 0} en revision
                        </p>
                      </div>
                      {sessionResult.thresholds ? (
                        <div className="rounded-md bg-white px-3 py-2 text-xs text-zinc-600">
                          Umbral {similarityPercent(sessionResult.thresholds.similarity)} · margen {similarityPercent(sessionResult.thresholds.margin)} · min hits {sessionResult.thresholds.min_hits}
                        </div>
                      ) : null}
                    </div>
                    {sessionResult.detail && <p className={`mt-1 text-sm ${sessionResult.failed ? "text-red-700" : "text-amber-700"}`}>{sessionResult.detail}</p>}
                    {sessionResult.skipped?.length ? <p className="mt-1 text-xs text-zinc-500">Omitidos: {sessionResult.skipped.slice(0, 4).join(" | ")}</p> : null}
                    {sessionResult.marked.length ? (
                      <div className="mt-4">
                        <h4 className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                          <CheckCircle2 size={15} /> Asistencias confirmadas
                        </h4>
                        <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {sessionResult.marked.map((comparison) => (
                            <FaceComparisonCard key={`marked-${comparison.student_id}-${comparison.frame}`} comparison={comparison} token={token} accepted />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm text-zinc-600">No se marco asistencia automaticamente con estos umbrales.</p>
                    )}
                    {sessionResult.review?.length ? (
                      <div className="mt-5">
                        <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                          <Search size={15} /> Comparaciones para revision
                        </h4>
                        <p className="mt-1 text-xs text-zinc-500">Estos rostros se guardan como evidencia, pero no escriben asistencia.</p>
                        <div className="mt-2 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {sessionResult.review.map((comparison) => (
                            <FaceComparisonCard
                              key={`review-${comparison.student_id}-${comparison.frame}-${comparison.reason}`}
                              comparison={comparison}
                              token={token}
                              accepted={false}
                              confirming={confirmingKey === `${sessionResult.session.id}-${comparison.student_id}-${comparison.frame ?? ""}`}
                              onConfirm={() => visibleJob?.id && confirmReview(visibleJob.id, sessionResult.session.id, comparison)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
