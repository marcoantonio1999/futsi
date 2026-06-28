import { FormEvent } from "react";
import { CalendarDays, Plus, Shield, UserPlus } from "lucide-react";
import type { AppData, Team, Tournament } from "../../types";
import { SelectInput, TextInput } from "./shared";

function today() {
  return new Date().toISOString().slice(0, 10);
}

type TournamentFormsProps = {
  isCoachView: boolean;
  data: AppData;
  visibleTournaments: Tournament[];
  selectedTournamentId: string;
  selectedTournament: Tournament | null;
  availableStudents: AppData["students"];
  tournamentTeams: Team[];
  onSubmitTournament: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitTeam: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitRegistration: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitMatch: (event: FormEvent<HTMLFormElement>) => void;
};

export function TournamentForms({
  isCoachView,
  data,
  visibleTournaments,
  selectedTournamentId,
  selectedTournament,
  availableStudents,
  tournamentTeams,
  onSubmitTournament,
  onSubmitTeam,
  onSubmitRegistration,
  onSubmitMatch,
}: TournamentFormsProps) {
  return (
    <div className="grid content-start gap-3">
      {!isCoachView && (
        <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Plus size={18} />
            <h3 className="font-semibold">Crear torneo o liguilla</h3>
          </div>
          <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={onSubmitTournament}>
            <SelectInput label="Sede" name="site" required>
              {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
            </SelectInput>
            <TextInput label="Nombre" name="name" placeholder="Liguilla Sub-12 Junio" required />
            <SelectInput label="Cobro" name="billing_type" defaultValue="weekly_match">
              <option value="weekly_match">Pago semanal</option>
              <option value="full_tournament">Torneo completo</option>
            </SelectInput>
            <TextInput label="Inicio" name="starts_on" type="date" defaultValue={today()} />
            <TextInput label="Semanas esperadas" name="expected_weeks" type="number" min="1" defaultValue={12} />
            <button className="self-end rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white">Crear torneo</button>
          </form>
        </div>
      )}

      {!isCoachView && (
        <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <Shield size={18} />
            <h3 className="font-semibold">Crear equipo</h3>
          </div>
          <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={onSubmitTeam}>
            <TournamentSelect tournaments={visibleTournaments} value={selectedTournamentId} />
            <TextInput label="Equipo" name="name" placeholder="Sub-12 A" required />
            <TextInput label="Representante" name="representative_name" placeholder="Nombre del responsable" required />
            <TextInput label="Telefono" name="representative_phone" placeholder="55..." required />
            <TextInput label="Correo" name="representative_email" type="email" />
            <button className="self-end rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white">Crear equipo</button>
          </form>
        </div>
      )}

      {!isCoachView && (
        <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <UserPlus size={18} />
            <h3 className="font-semibold">Inscribir alumno al torneo</h3>
          </div>
          <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={onSubmitRegistration}>
            <TournamentSelect tournaments={visibleTournaments} value={selectedTournamentId} />
            <SelectInput label="Alumno" name="student" required>
              {availableStudents.map((student) => <option key={student.id} value={student.id}>{student.full_name} Â· {student.group_name}</option>)}
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
        </div>
      )}

      {!isCoachView && (
        <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <CalendarDays size={18} />
            <h3 className="font-semibold">Agendar partido</h3>
          </div>
          {tournamentTeams.length < 2 ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              Debe haber minimo dos equipos registrados en este torneo para poder agendar un partido.
            </div>
          ) : null}
          <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={onSubmitMatch}>
            <TournamentSelect tournaments={visibleTournaments} value={selectedTournamentId} />
            <TeamSelect label="Local" name="home_team" teams={tournamentTeams} disabled={tournamentTeams.length < 2} />
            <TeamSelect label="Visitante" name="away_team" teams={tournamentTeams} disabled={tournamentTeams.length < 2} />
            <TextInput label="Fecha" name="played_on" type="date" defaultValue={today()} required />
            <TextInput label="Hora inicio" name="starts_at" type="time" defaultValue="20:00" required />
            <TextInput label="Hora fin" name="ends_at" type="time" defaultValue="22:00" required />
            <button className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={tournamentTeams.length < 2}>
              Agendar
            </button>
          </form>
        </div>
      )}

      {isCoachView && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="flex items-center gap-2 font-semibold">
            <Shield size={18} />
            Vista limitada para coach
          </div>
          <p className="mt-2">
            Los torneos, equipos, partidos y alumnos mostrados aqui se limitan al alcance de tus sesiones y alumnos asignados. La administracion de torneos queda reservada para admin/coordinacion.
          </p>
        </div>
      )}
    </div>
  );
}

function TournamentSelect({ tournaments, value }: { tournaments: Tournament[]; value: string }) {
  return (
    <SelectInput key={value || "empty"} label="Torneo" name="tournament" defaultValue={value} required>
      {tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
    </SelectInput>
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
