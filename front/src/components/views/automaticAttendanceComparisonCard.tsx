import { Check } from "lucide-react";
import { EvidenceImage } from "./automaticAttendanceEvidence";
import { similarityPercent } from "./automaticAttendanceFormat";
import type { FaceComparison } from "./automaticAttendanceReport";

export function AutomaticFaceComparisonCard({
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
          {(comparison.person_type || comparison.team_name) ? (
            <p className="mt-1 text-xs text-zinc-500">
              {comparison.person_type === "player" ? "Jugador adulto" : comparison.person_type === "student" ? "Alumno" : comparison.person_type}
              {comparison.team_name ? ` - ${comparison.team_name}` : ""}
            </p>
          ) : null}
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
              <span key={candidate.person_key ?? `${candidate.person_type ?? "student"}-${candidate.student_id}`} className="rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-800">
                {candidate.student_name}{candidate.team_name ? ` (${candidate.team_name})` : ""}: {similarityPercent(candidate.similarity)}
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
