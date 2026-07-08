import { FormEvent } from "react";
import { Shield, UsersRound } from "lucide-react";
import type { Team, Tournament } from "../../types";
import { SelectInput, TextInput } from "../../components/views/shared";

type TournamentTeamsSectionProps = {
  isAdultScope: boolean;
  isCoachView: boolean;
  selectedTournament: Tournament | null;
  selectedTournamentId: string;
  tournamentTeams: Team[];
  visibleTournaments: Tournament[];
  onSelectTournament: (id: string) => void;
  onSubmitTeam: (event: FormEvent<HTMLFormElement>) => void;
};

export function TournamentTeamsSection({
  isAdultScope,
  isCoachView,
  selectedTournament,
  selectedTournamentId,
  tournamentTeams,
  visibleTournaments,
  onSelectTournament,
  onSubmitTeam,
}: TournamentTeamsSectionProps) {
  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(360px,0.75fr)_minmax(0,1fr)]">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Shield size={18} />
          <h3 className="font-semibold">Crear equipo</h3>
        </div>
        {isCoachView ? (
          <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">La administracion de equipos queda reservada para admin/coordinacion.</p>
        ) : (
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={onSubmitTeam}>
            <TournamentSelect tournaments={visibleTournaments} value={selectedTournamentId} onChange={onSelectTournament} />
            <TextInput label="Equipo" name="name" placeholder={isAdultScope ? "Real Roma" : "Sub-12 A"} required />
            {isAdultScope && (
              <>
                <TextInput label="Representante" name="representative_name" placeholder="Nombre del responsable" required />
                <TextInput label="Telefono" name="representative_phone" placeholder="55..." required />
                <TextInput label="Correo" name="representative_email" type="email" />
              </>
            )}
            <button className="self-end rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white">Crear equipo</button>
          </form>
        )}
      </div>

      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <UsersRound size={18} />
              <h3 className="font-semibold">Equipos del torneo</h3>
            </div>
            <p className="mt-1 text-xs text-zinc-500">{selectedTournament?.name || "Selecciona un torneo"} - {tournamentTeams.length} equipos</p>
          </div>
          <TournamentSelect compact tournaments={visibleTournaments} value={selectedTournamentId} onChange={onSelectTournament} />
        </div>
        <div className="mt-4 overflow-hidden rounded-md border border-zinc-200">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Equipo</th>
                {isAdultScope && <th className="px-4 py-3 font-semibold">Representante</th>}
                {isAdultScope && <th className="px-4 py-3 font-semibold">Contacto</th>}
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {tournamentTeams.map((team) => (
                <tr key={team.id} className="border-t border-zinc-100">
                  <td className="px-4 py-3 font-medium text-zinc-950">{team.name}</td>
                  {isAdultScope && <td className="px-4 py-3 text-zinc-700">{team.representative_name || "Sin representante"}</td>}
                  {isAdultScope && (
                    <td className="px-4 py-3 text-zinc-700">
                      {team.representative_phone || "Sin telefono"}
                      {team.representative_email ? <span className="block text-xs text-zinc-500">{team.representative_email}</span> : null}
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-1 text-xs font-semibold ${team.is_active ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                      {team.is_active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                </tr>
              ))}
              {tournamentTeams.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={isAdultScope ? 4 : 2}>Todavia no hay equipos registrados en este torneo.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function TournamentSelect({ compact = false, tournaments, value, onChange }: { compact?: boolean; tournaments: Tournament[]; value: string; onChange: (value: string) => void }) {
  return (
    <SelectInput
      key={value || "empty"}
      label={compact ? "Torneo" : "Torneo"}
      name="tournament"
      defaultValue={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      required
    >
      {tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
    </SelectInput>
  );
}
