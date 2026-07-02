import { Medal } from "lucide-react";
import type { Match } from "../../types";
import { MatchScoreCard } from "../../components/views/sportsDetails";
import { TableHeader } from "../../components/views/shared";

function billingLabel(value: string) {
  return value === "full_tournament" ? "Torneo completo" : "Pago semanal";
}

type TournamentDetailsProps = {
  isCoachView: boolean;
  tournamentRegistrations: Array<{
    id: number;
    student_name: string;
    student_group_name?: string | null;
    student_category?: string | null;
    team_name?: string | null;
    billing_type: string;
    jersey_number?: number | null;
  }>;
  visibleTournamentMatches: Match[];
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
  onMatchCanceled: (match: Match) => void;
};

export function TournamentDetails({ isCoachView, tournamentRegistrations, visibleTournamentMatches, onUpdateMatch, onMatchCanceled }: TournamentDetailsProps) {
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        {!isCoachView && (
          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <TableHeader title="Alumnos inscritos" count={tournamentRegistrations.length} />
            <div className="divide-y divide-zinc-100">
              {tournamentRegistrations.slice(0, 12).map((registration) => (
                <div key={registration.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{registration.student_name}</p>
                    <p className="text-sm text-zinc-500">
                      {registration.student_group_name || registration.student_category || "Sin grupo"} Â· {registration.team_name || "Sin equipo"} Â· {billingLabel(registration.billing_type)}
                    </p>
                  </div>
                  <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">#{registration.jersey_number || "-"}</span>
                </div>
              ))}
              {tournamentRegistrations.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">Sin alumnos inscritos en este torneo.</p>}
            </div>
          </div>
        )}

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Partidos y marcadores" count={visibleTournamentMatches.length} />
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {visibleTournamentMatches.slice(0, 8).map((match) => (
              <MatchScoreCard key={match.id} match={match} canEdit={!isCoachView} onUpdateMatch={onUpdateMatch} onMatchCanceled={onMatchCanceled} />
            ))}
            {visibleTournamentMatches.length === 0 && <p className="text-sm text-zinc-500">No hay partidos programados para este torneo.</p>}
          </div>
        </div>
      </div>

      {!isCoachView && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="flex items-center gap-2 font-semibold">
            <Medal size={18} />
            Como se registra un nino a torneo
          </div>
          <p className="mt-2">
            Primero el alumno existe en academia. Luego se le crea una inscripcion al torneo/liguilla desde esta pagina. Esa inscripcion puede tener equipo y dorsal; con eso se puede calcular cobranza esperada, asistencia al partido, adeudos y rendimiento deportivo sin duplicar su perfil.
          </p>
        </div>
      )}
    </>
  );
}
