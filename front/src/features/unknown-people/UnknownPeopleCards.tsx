import { CalendarClock, Check, Trash2, UserPlus } from "lucide-react";
import { API_URL } from "../../api";
import { EvidenceImage } from "../automatic-attendance";
import { captureStatusClass, captureStatusLabel, qualityRejectText, qualityText, subjectAppearanceTimes, type UnknownCapture, type UnknownSubject } from "../unknown-attendance/model";

export function UnknownSubjectCard({
  accepting,
  discarding,
  subject,
  token,
  onAccept,
  onDiscard,
  onOpen,
}: {
  accepting: boolean;
  discarding: boolean;
  subject: UnknownSubject;
  token: string;
  onAccept: (subjectId: string) => void;
  onDiscard: (subjectId: string) => void;
  onOpen: (subject: UnknownSubject) => void;
}) {
  const isAccepted = Boolean(subject.metadata?.accepted_at);
  const registered = Boolean(subject.matched_player_id || subject.matched_student_id || isAccepted);
  return (
    <article className="motion-card rounded-md border border-zinc-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950">
      <EvidenceImage url={subject.image_url} token={token} fit="contain" ratio="square" />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-semibold text-zinc-950 dark:text-zinc-50">{subject.temporary_name || "Desconocido"}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{subject.capture_count} capturas - {subjectAppearanceTimes(subject).join(" | ")}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{qualityText(subject.metadata?.quality)}</p>
        </div>
        <span className={`inline-flex w-fit max-w-full shrink-0 items-center justify-center rounded-md px-2 py-1 text-center text-xs font-semibold leading-tight ${registered ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {registered ? "Registrado" : "Consolidado"}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-55 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100"
          disabled={isAccepted || accepting || discarding}
          onClick={() => onAccept(subject.id)}
          type="button"
        >
          <Check size={13} /> {isAccepted ? "Aceptado como desconocido" : accepting ? "Aceptando..." : "Aceptar desconocido"}
        </button>
        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-blue-300"
          disabled={accepting || discarding}
          onClick={() => onOpen(subject)}
          type="button"
        >
          <UserPlus size={13} /> Registrar persona
        </button>
        <button
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-55 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200"
          disabled={accepting || discarding}
          onClick={() => onDiscard(subject.id)}
          type="button"
        >
          <Trash2 size={13} /> {discarding ? "Rechazando..." : "Rechazar"}
        </button>
      </div>
    </article>
  );
}

export function UnknownCaptureCard({ capture, token, onOpenSubject }: { capture: UnknownCapture; token: string; onOpenSubject: (subjectId: string) => void }) {
  const subjectId = capture.subject_id ?? capture.metadata?.unknown_subject?.id ?? capture.metadata?.unknown_subjects?.[0]?.unknown_subject.id ?? "";
  const imageUrl = capture.image_url || `${API_URL}/unknown-attendance/captures/${encodeURIComponent(capture.id)}/image/`;
  return (
    <article className="motion-card rounded-md border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <EvidenceImage url={imageUrl} token={token} fit="contain" ratio="square" />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-semibold text-zinc-950 dark:text-zinc-50">{capture.temporary_name || capture.local_file_name || "Captura desconocida"}</p>
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
            <CalendarClock size={13} /> {new Date(capture.captured_at).toLocaleString()}
          </p>
        </div>
        <span className={`inline-flex w-fit max-w-full shrink-0 items-center justify-center rounded-md border px-2 py-1 text-center text-xs font-semibold leading-tight ${captureStatusClass(capture.status)}`}>
          {captureStatusLabel(capture.status)}
        </span>
      </div>
      <button
        className="mt-3 rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        disabled={!subjectId}
        onClick={() => onOpenSubject(subjectId)}
        type="button"
      >
        {subjectId ? "Abrir consolidado" : "Sin sujeto consolidado"}
      </button>
      {qualityRejectText(capture.metadata?.quality) && <p className="mt-2 text-xs font-semibold text-red-700">Rechazo: {qualityRejectText(capture.metadata?.quality)}</p>}
    </article>
  );
}
