import { FormEvent } from "react";
import { CalendarDays } from "lucide-react";
import type { Match, Team, Tournament } from "../../types";
import { MatchScoreCard } from "../../components/views/sportsDetails";
import { SelectInput, TableHeader, TextInput } from "../../components/views/shared";

function today() {
  return new Date().toISOString().slice(0, 10);
}

type TournamentMatchScheduleSectionProps = {
  isCoachView: boolean;
  selectedTournamentId: string;
  selectedTournament: Tournament | null;
  tournamentTeams: Team[];
  visibleTournaments: Tournament[];
  visibleTournamentMatches: Match[];
  onSelectTournament: (id: string) => void;
  onSubmitMatch: (event: FormEvent<HTMLFormElement>) => void;
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
  onMatchCanceled: (match: Match) => void;
};

export function TournamentMatchScheduleSection({
  isCoachView,
  selectedTournamentId,
  selectedTournament,
  tournamentTeams,
  visibleTournaments,
  visibleTournamentMatches,
  onSelectTournament,
  onSubmitMatch,
  onUpdateMatch,
  onMatchCanceled,
}: TournamentMatchScheduleSectionProps) {
  return (
    <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
      {!isCoachView && (
        <section className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} />
            <div>
              <h3 className="font-semibold">Agendar partido</h3>
              <p className="text-sm text-zinc-500">Selecciona torneo, equipos, fecha y horario.</p>
            </div>
          </div>

          <label className="mt-4 grid gap-1 text-sm">
            <span className="font-medium text-zinc-700">Torneo</span>
            <select className="rounded-md border border-zinc-300 bg-white px-3 py-2" value={selectedTournamentId} onChange={(event) => onSelectTournament(event.target.value)} required>
              {visibleTournaments.map((tournament) => (
                <option key={tournament.id} value={tournament.id}>{tournament.name}</option>
              ))}
            </select>
          </label>

          {tournamentTeams.length < 2 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              Debe haber minimo dos equipos registrados en este torneo para poder agendar un partido.
            </div>
          ) : null}

          <form className="mt-3 grid gap-3" onSubmit={onSubmitMatch}>
            <input name="tournament" type="hidden" value={selectedTournamentId} />
            <TeamSelect label="Local" name="home_team" teams={tournamentTeams} disabled={tournamentTeams.length < 2} />
            <TeamSelect label="Visitante" name="away_team" teams={tournamentTeams} disabled={tournamentTeams.length < 2} />
            <div className="grid gap-3 sm:grid-cols-3">
              <TextInput label="Fecha" name="played_on" type="date" defaultValue={today()} required />
              <TextInput label="Hora inicio" name="starts_at" type="time" defaultValue="20:00" required />
              <TextInput label="Hora fin" name="ends_at" type="time" defaultValue="22:00" required />
            </div>
            <button className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={tournamentTeams.length < 2}>
              Agendar
            </button>
          </form>
        </section>
      )}

      <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <TableHeader title={`Partidos${selectedTournament ? ` - ${selectedTournament.name}` : ""}`} count={visibleTournamentMatches.length} />
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {visibleTournamentMatches.map((match) => (
            <MatchScoreCard key={match.id} match={match} canEdit={!isCoachView} onUpdateMatch={onUpdateMatch} onMatchCanceled={onMatchCanceled} />
          ))}
          {visibleTournamentMatches.length === 0 && <p className="text-sm text-zinc-500">No hay partidos programados para este torneo.</p>}
        </div>
      </section>
    </div>
  );
}

function TeamSelect({ label, name, teams, disabled = false }: { label: string; name: string; teams: Team[]; disabled?: boolean }) {
  return (
    <SelectInput label={label} name={name} required disabled={disabled}>
      <option value="">Selecciona equipo</option>
      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
    </SelectInput>
  );
}
