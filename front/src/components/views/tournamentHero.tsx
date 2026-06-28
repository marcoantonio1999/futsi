import { Trophy } from "lucide-react";
import { Metric } from "../cards/Metric";
import type { Match, Team, Tournament } from "../../types";

function billingLabel(value: string) {
  return value === "full_tournament" ? "Torneo completo" : "Pago semanal";
}

type TournamentHeroProps = {
  isCoachView: boolean;
  selectedTournament: Tournament | null;
  leader: { team_name?: string | null } | null;
  activeTournaments: Tournament[];
  visibleTournaments: Tournament[];
  visibleTeams: Team[];
  visibleRegistrationsCount: number;
  visibleMatches: Match[];
};

export function TournamentHero({
  isCoachView,
  selectedTournament,
  leader,
  activeTournaments,
  visibleTournaments,
  visibleTeams,
  visibleRegistrationsCount,
  visibleMatches,
}: TournamentHeroProps) {
  return (
    <div className="overflow-hidden rounded-md border border-zinc-200 bg-white text-zinc-950 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">
            <Trophy size={16} />
            Torneos y liguillas
          </div>
          <h2 className="mt-3 text-2xl font-semibold">{isCoachView ? "Torneos asignados a tus sesiones y equipos." : "Control visual de torneos activos, equipos, alumnos inscritos y partidos."}</h2>
          <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-300">
            {isCoachView
              ? "Como coach, esta vista es solo de consulta: no puedes crear torneos, inscribir alumnos ni agendar partidos. Solo ves el torneo/equipo relacionado con tus sesiones."
              : "Los alumnos de academia se registran aqui a torneos/liguillas sin mezclarse con jugadores adultos. Esto permite cruzar inscripcion, cobranza, asistencia y rendimiento deportivo por torneo."}
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-white/10">
              <p className="text-xs text-zinc-500 dark:text-zinc-300">Torneo seleccionado</p>
              <p className="mt-1 font-semibold">{selectedTournament?.name || "Sin torneo"}</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-white/10">
              <p className="text-xs text-zinc-500 dark:text-zinc-300">Lider actual</p>
              <p className="mt-1 font-semibold">{leader?.team_name || "Sin tabla"}</p>
            </div>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-white/10">
              <p className="text-xs text-zinc-500 dark:text-zinc-300">Formato</p>
              <p className="mt-1 font-semibold">{selectedTournament ? billingLabel(selectedTournament.billing_type) : "-"}</p>
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Metric label="Torneos activos" value={activeTournaments.length} helper={`${visibleTournaments.length} visibles`} />
          <Metric label="Equipos" value={visibleTeams.length} helper={isCoachView ? "Asignados" : "Adultos y academia"} />
          <Metric label="Ninos inscritos" value={visibleRegistrationsCount} helper={isCoachView ? "Solo de tu alcance" : "Registros a torneos"} />
          <Metric label="Partidos activos" value={visibleMatches.filter((match) => match.status === "live" || match.status === "scheduled").length} helper="Programados/en vivo" />
        </div>
      </div>
    </div>
  );
}
