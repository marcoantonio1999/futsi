import React, { FormEvent, useMemo, useState } from "react";
import { CalendarDays, Medal, Plus, Shield, Trophy, UserPlus, UsersRound } from "lucide-react";
import { Metric } from "../cards/Metric";
import type { AppData, Match, Team, Tournament } from "../../types";
import { MatchScoreCard } from "./sportsDetails";
import { SelectInput, StatusPill, TableHeader, TextInput } from "./shared";

type TournamentsPanelProps = {
  data: AppData;
  onCreateTournament: (payload: unknown) => Promise<void>;
  onCreateTeam: (payload: unknown) => Promise<void>;
  onRegisterStudent: (payload: unknown) => Promise<void>;
  onCreateMatch: (payload: unknown) => Promise<void>;
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function billingLabel(value: string) {
  return value === "full_tournament" ? "Torneo completo" : "Pago semanal";
}

export function TournamentsPanel({
  data,
  onCreateTournament,
  onCreateTeam,
  onRegisterStudent,
  onCreateMatch,
  onUpdateMatch,
}: TournamentsPanelProps) {
  const activeTournaments = data.tournaments.filter((tournament) => tournament.is_active);
  const firstTournament = activeTournaments[0] ?? data.tournaments[0] ?? null;
  const [selectedTournamentId, setSelectedTournamentId] = useState(firstTournament?.id ? String(firstTournament.id) : "");
  const selectedTournament = data.tournaments.find((tournament) => String(tournament.id) === selectedTournamentId) ?? firstTournament;
  const tournamentTeams = data.teams.filter((team) => !selectedTournament || team.tournament === selectedTournament.id);
  const tournamentMatches = data.matches.filter((match) => !selectedTournament || match.tournament === selectedTournament.id);
  const tournamentStandings = data.standings.filter((row) => !selectedTournament || row.tournament === selectedTournament.id);
  const tournamentRegistrations = data.studentTournamentRegistrations.filter((registration) => !selectedTournament || registration.tournament === selectedTournament.id);
  const availableStudents = data.students.filter((student) => !selectedTournament?.site || student.site === selectedTournament.site);
  const leader = tournamentStandings[0] ?? null;

  const tournamentCards = useMemo(() => {
    return data.tournaments.map((tournament) => {
      const teams = data.teams.filter((team) => team.tournament === tournament.id);
      const registrations = data.studentTournamentRegistrations.filter((registration) => registration.tournament === tournament.id);
      const matches = data.matches.filter((match) => match.tournament === tournament.id);
      const liveCount = matches.filter((match) => match.status === "live" || match.status === "scheduled").length;
      const top = data.standings.find((row) => row.tournament === tournament.id && row.position === 1);
      return { tournament, teams, registrations, matches, liveCount, top };
    });
  }, [data.matches, data.standings, data.studentTournamentRegistrations, data.teams, data.tournaments]);

  function submitTournament(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onCreateTournament({
      site: Number(form.get("site")),
      name: String(form.get("name") || ""),
      billing_type: String(form.get("billing_type") || "weekly_match"),
      starts_on: String(form.get("starts_on") || today()),
      expected_weeks: Number(form.get("expected_weeks") || 12),
      is_active: true,
    });
    event.currentTarget.reset();
  }

  function submitTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onCreateTeam({
      tournament: Number(form.get("tournament")),
      name: String(form.get("name") || ""),
      representative_name: String(form.get("representative_name") || "Pendiente"),
      representative_phone: String(form.get("representative_phone") || ""),
      representative_email: String(form.get("representative_email") || ""),
      is_active: true,
    });
    event.currentTarget.reset();
  }

  function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const team = String(form.get("team") || "");
    onRegisterStudent({
      tournament: Number(form.get("tournament")),
      student: Number(form.get("student")),
      team: team ? Number(team) : null,
      jersey_number: form.get("jersey_number") ? Number(form.get("jersey_number")) : null,
      billing_type: String(form.get("billing_type") || "weekly_match"),
      weekly_amount: String(form.get("weekly_amount") || "650"),
      full_amount: String(form.get("full_amount") || "7800"),
      billing_starts_on: String(form.get("billing_starts_on") || selectedTournament?.starts_on || today()),
      status: "registered",
      notes: String(form.get("notes") || ""),
    });
    event.currentTarget.reset();
  }

  function submitMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const tournament = data.tournaments.find((item) => item.id === Number(form.get("tournament")));
    onCreateMatch({
      tournament: Number(form.get("tournament")),
      site: tournament?.site,
      home_team: Number(form.get("home_team")),
      away_team: Number(form.get("away_team")),
      played_on: String(form.get("played_on") || today()),
      starts_at: String(form.get("starts_at") || "20:00"),
      status: "scheduled",
    });
    event.currentTarget.reset();
  }

  return (
    <section className="grid min-w-0 gap-5">
      <div className="overflow-hidden rounded-[22px] border border-zinc-200 bg-zinc-950 text-white shadow-sm">
        <div className="grid gap-5 p-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase text-emerald-300">
              <Trophy size={16} />
              Torneos y liguillas
            </div>
            <h2 className="mt-3 text-2xl font-semibold">Control visual de torneos activos, equipos, alumnos inscritos y partidos.</h2>
            <p className="mt-2 max-w-3xl text-sm text-zinc-300">
              Los alumnos de academia se registran aqui a torneos/liguillas sin mezclarse con jugadores adultos. Esto permite cruzar inscripcion, cobranza, asistencia y rendimiento deportivo por torneo.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md bg-white/10 p-3">
                <p className="text-xs text-zinc-300">Torneo seleccionado</p>
                <p className="mt-1 font-semibold">{selectedTournament?.name || "Sin torneo"}</p>
              </div>
              <div className="rounded-md bg-white/10 p-3">
                <p className="text-xs text-zinc-300">Lider actual</p>
                <p className="mt-1 font-semibold">{leader?.team_name || "Sin tabla"}</p>
              </div>
              <div className="rounded-md bg-white/10 p-3">
                <p className="text-xs text-zinc-300">Formato</p>
                <p className="mt-1 font-semibold">{selectedTournament ? billingLabel(selectedTournament.billing_type) : "-"}</p>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label="Torneos activos" value={activeTournaments.length} helper={`${data.tournaments.length} totales`} />
            <Metric label="Equipos" value={data.teams.length} helper="Adultos y academia" />
            <Metric label="Ninos inscritos" value={data.studentTournamentRegistrations.length} helper="Registros a torneos" />
            <Metric label="Partidos activos" value={data.matches.filter((match) => match.status === "live" || match.status === "scheduled").length} helper="Programados/en vivo" />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="grid gap-5">
          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <TableHeader title="Torneos activos" count={tournamentCards.length} />
            <div className="grid gap-3 p-4 lg:grid-cols-2">
              {tournamentCards.map(({ tournament, teams, registrations, matches, liveCount, top }) => (
                <button
                  key={tournament.id}
                  className={`rounded-md border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                    selectedTournament?.id === tournament.id ? "border-emerald-700 bg-emerald-50" : "border-zinc-200 bg-white"
                  }`}
                  onClick={() => setSelectedTournamentId(String(tournament.id))}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-zinc-500">{tournament.starts_on || "sin fecha"} · {billingLabel(tournament.billing_type)}</p>
                      <h3 className="mt-1 font-semibold">{tournament.name}</h3>
                    </div>
                    <StatusPill label={tournament.is_active ? "Activo" : "Cerrado"} />
                  </div>
                  <div className="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded-md bg-zinc-50 p-2"><p className="font-bold text-base">{teams.length}</p><p>Equipos</p></div>
                    <div className="rounded-md bg-zinc-50 p-2"><p className="font-bold text-base">{registrations.length}</p><p>Ninos</p></div>
                    <div className="rounded-md bg-zinc-50 p-2"><p className="font-bold text-base">{matches.length}</p><p>Juegos</p></div>
                    <div className="rounded-md bg-zinc-50 p-2"><p className="font-bold text-base">{liveCount}</p><p>Activos</p></div>
                  </div>
                  <p className="mt-3 text-sm text-zinc-500">Lider: <span className="font-medium text-zinc-900">{top?.team_name || "pendiente"}</span></p>
                </button>
              ))}
              {tournamentCards.length === 0 && <p className="text-sm text-zinc-500">Todavia no hay torneos creados.</p>}
            </div>
          </div>

          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <TableHeader title="Tabla del torneo" count={tournamentStandings.length} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="px-4 py-3">Pos</th>
                    <th className="px-4 py-3">Equipo</th>
                    <th className="px-4 py-3">PJ</th>
                    <th className="px-4 py-3">DG</th>
                    <th className="px-4 py-3">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {tournamentStandings.map((row) => (
                    <tr key={row.team} className={`border-b border-zinc-100 ${row.is_leader ? "bg-amber-50" : ""}`}>
                      <td className="px-4 py-3"><span className="grid size-8 place-items-center rounded-full bg-zinc-950 font-semibold text-white">{row.position}</span></td>
                      <td className="px-4 py-3 font-medium">{row.team_name}{row.is_leader && <span className="ml-2 rounded-md bg-amber-200 px-2 py-1 text-xs text-amber-900">Lider</span>}</td>
                      <td className="px-4 py-3">{row.played}</td>
                      <td className={`px-4 py-3 font-semibold ${row.goal_difference >= 0 ? "text-emerald-700" : "text-red-700"}`}>{row.goal_difference > 0 ? "+" : ""}{row.goal_difference}</td>
                      <td className="px-4 py-3 text-lg font-bold">{row.points}</td>
                    </tr>
                  ))}
                  {tournamentStandings.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">La tabla se calcula cuando hay partidos finalizados o en vivo.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid gap-5">
          <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Plus size={18} />
              <h3 className="font-semibold">Crear torneo o liguilla</h3>
            </div>
            <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submitTournament}>
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

          <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Shield size={18} />
              <h3 className="font-semibold">Crear equipo</h3>
            </div>
            <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submitTeam}>
              <TournamentSelect tournaments={data.tournaments} value={selectedTournamentId} />
              <TextInput label="Equipo" name="name" placeholder="Sub-12 A" required />
              <TextInput label="Representante" name="representative_name" placeholder="Nombre del responsable" />
              <TextInput label="Telefono" name="representative_phone" placeholder="55..." />
              <TextInput label="Correo" name="representative_email" type="email" className="sm:col-span-2" />
              <button className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white sm:col-span-2">Crear equipo</button>
            </form>
          </div>

          <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <UserPlus size={18} />
              <h3 className="font-semibold">Inscribir alumno al torneo</h3>
            </div>
            <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submitRegistration}>
              <TournamentSelect tournaments={data.tournaments} value={selectedTournamentId} />
              <SelectInput label="Alumno" name="student" required>
                {availableStudents.map((student) => <option key={student.id} value={student.id}>{student.full_name} · {student.group_name}</option>)}
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
              <TextInput label="Notas" name="notes" className="sm:col-span-2" placeholder="Permiso, categoria, observaciones" />
              <button className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white sm:col-span-2">Registrar alumno</button>
            </form>
          </div>

          <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <CalendarDays size={18} />
              <h3 className="font-semibold">Agendar partido</h3>
            </div>
            <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submitMatch}>
              <TournamentSelect tournaments={data.tournaments} value={selectedTournamentId} />
              <TeamSelect label="Local" name="home_team" teams={tournamentTeams} />
              <TeamSelect label="Visitante" name="away_team" teams={tournamentTeams} />
              <TextInput label="Fecha" name="played_on" type="date" defaultValue={today()} />
              <TextInput label="Hora" name="starts_at" type="time" defaultValue="20:00" />
              <button className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white">Agendar</button>
            </form>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Alumnos inscritos" count={tournamentRegistrations.length} />
          <div className="divide-y divide-zinc-100">
            {tournamentRegistrations.slice(0, 12).map((registration) => (
              <div key={registration.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{registration.student_name}</p>
                  <p className="text-sm text-zinc-500">
                    {registration.student_group_name || registration.student_category || "Sin grupo"} · {registration.team_name || "Sin equipo"} · {billingLabel(registration.billing_type)}
                  </p>
                </div>
                <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-800">#{registration.jersey_number || "-"}</span>
              </div>
            ))}
            {tournamentRegistrations.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">Sin alumnos inscritos en este torneo.</p>}
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
          <TableHeader title="Partidos y marcadores" count={tournamentMatches.length} />
          <div className="grid gap-3 p-4 md:grid-cols-2">
            {tournamentMatches.slice(0, 8).map((match) => (
              <MatchScoreCard key={match.id} match={match as Match} canEdit onUpdateMatch={onUpdateMatch} />
            ))}
            {tournamentMatches.length === 0 && <p className="text-sm text-zinc-500">No hay partidos programados para este torneo.</p>}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <div className="flex items-center gap-2 font-semibold">
          <Medal size={18} />
          Como se registra un nino a torneo
        </div>
        <p className="mt-2">
          Primero el alumno existe en academia. Luego se le crea una inscripcion al torneo/liguilla desde esta pagina. Esa inscripcion puede tener equipo y dorsal; con eso se puede calcular cobranza esperada, asistencia al partido, adeudos y rendimiento deportivo sin duplicar su perfil.
        </p>
      </div>
    </section>
  );
}

function TournamentSelect({ tournaments, value }: { tournaments: Tournament[]; value: string }) {
  return (
    <SelectInput key={value || "empty"} label="Torneo" name="tournament" defaultValue={value} required>
      {tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name}</option>)}
    </SelectInput>
  );
}

function TeamSelect({ label, name, teams }: { label: string; name: string; teams: Team[] }) {
  return (
    <SelectInput label={label} name={name} required>
      {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
    </SelectInput>
  );
}
