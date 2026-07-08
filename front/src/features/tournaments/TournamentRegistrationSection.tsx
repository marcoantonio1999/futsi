import { FormEvent } from "react";
import { ClipboardList, UserPlus } from "lucide-react";
import type { AppData, Team, Tournament } from "../../types";
import { SelectInput, TextInput } from "../../components/views/shared";

function today() {
  return new Date().toISOString().slice(0, 10);
}

type TournamentRegistrationSectionProps = {
  availableStudents: AppData["students"];
  isCoachView: boolean;
  selectedTournament: Tournament | null;
  selectedTournamentId: string;
  tournamentRegistrations: AppData["studentTournamentRegistrations"];
  tournamentTeams: Team[];
  visibleTournaments: Tournament[];
  onSelectTournament: (id: string) => void;
  onSubmitRegistration: (event: FormEvent<HTMLFormElement>) => void;
};

export function TournamentRegistrationSection({
  availableStudents,
  isCoachView,
  selectedTournament,
  selectedTournamentId,
  tournamentRegistrations,
  tournamentTeams,
  visibleTournaments,
  onSelectTournament,
  onSubmitRegistration,
}: TournamentRegistrationSectionProps) {
  return (
    <section className="grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1fr)]">
      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <UserPlus size={18} />
          <h3 className="font-semibold">Inscribir alumno al torneo</h3>
        </div>
        {isCoachView ? (
          <p className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">La inscripcion de alumnos queda reservada para admin/coordinacion y ventanilla.</p>
        ) : (
          <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={onSubmitRegistration}>
            <TournamentSelect tournaments={visibleTournaments} value={selectedTournamentId} onChange={onSelectTournament} />
            <SelectInput label="Alumno" name="student" required>
              {availableStudents.map((student) => <option key={student.id} value={student.id}>{student.full_name} - {student.group_name}</option>)}
            </SelectInput>
            <SelectInput label="Equipo" name="team">
              <option value="">Sin equipo aun</option>
              {tournamentTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </SelectInput>
            <TextInput label="Dorsal" name="jersey_number" type="number" min="1" max="99" />
            <SelectInput label="Plan de pago" name="billing_type" defaultValue={selectedTournament?.billing_type || "weekly_match"}>
              <option value="weekly_match">Pago semanal por jornada</option>
              <option value="full_tournament">Pago completo antes de jornada 3</option>
            </SelectInput>
            <TextInput label="Monto semanal" name="weekly_amount" type="number" min="0" step="0.01" defaultValue="650" />
            <TextInput label="Monto torneo completo" name="full_amount" type="number" min="0" step="0.01" defaultValue="7800" />
            <TextInput label="Inicio de cobro" name="billing_starts_on" type="date" defaultValue={selectedTournament?.starts_on || today()} />
            <TextInput label="Notas" name="notes" placeholder="Permiso, categoria, observaciones" />
            <button className="self-end rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white">Registrar alumno</button>
          </form>
        )}
      </div>

      <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ClipboardList size={18} />
              <h3 className="font-semibold">Alumnos inscritos</h3>
            </div>
            <p className="mt-1 text-xs text-zinc-500">{selectedTournament?.name || "Selecciona un torneo"} - {tournamentRegistrations.length} inscritos</p>
          </div>
          <TournamentSelect compact tournaments={visibleTournaments} value={selectedTournamentId} onChange={onSelectTournament} />
        </div>
        <div className="mt-4 overflow-hidden rounded-md border border-zinc-200">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Alumno</th>
                <th className="px-4 py-3 font-semibold">Equipo</th>
                <th className="px-4 py-3 font-semibold">Cobro</th>
                <th className="px-4 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {tournamentRegistrations.map((registration) => (
                <tr key={registration.id} className="border-t border-zinc-100">
                  <td className="px-4 py-3 font-medium text-zinc-950">
                    {registration.student_name}
                    {registration.jersey_number ? <span className="block text-xs text-zinc-500">Dorsal {registration.jersey_number}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{registration.team_name || "Sin equipo"}</td>
                  <td className="px-4 py-3 text-zinc-700">
                    {registration.billing_type === "full_tournament" ? "Torneo completo" : "Semanal"}
                    <span className="block text-xs text-zinc-500">${registration.weekly_amount} semanal</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">{registration.status}</span>
                  </td>
                </tr>
              ))}
              {tournamentRegistrations.length === 0 && (
                <tr>
                  <td className="px-4 py-8 text-center text-sm text-zinc-500" colSpan={4}>Todavia no hay alumnos inscritos en este torneo.</td>
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
