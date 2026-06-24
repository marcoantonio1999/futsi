import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Medal, Plus, Search, Shield, Trophy, UserPlus, UsersRound } from "lucide-react";
import { Metric } from "../cards/Metric";
import type { AppData, Match, Team, Tournament, User } from "../../types";
import { MatchScoreCard } from "./sportsDetails";
import { SelectInput, StatusPill, TableHeader, TextInput } from "./shared";

type TournamentsPanelProps = {
  data: AppData;
  user?: User;
  readOnly?: boolean;
  onCreateTournament: (payload: unknown) => Promise<unknown>;
  onCreateTeam: (payload: unknown) => Promise<unknown>;
  onRegisterStudent: (payload: unknown) => Promise<unknown>;
  onCreateMatch: (payload: unknown) => Promise<unknown>;
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
};

type SuccessNotice = {
  title: string;
  detail: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function durationFromRange(startsAt: string, endsAt: string) {
  const starts = minutesFromTime(startsAt);
  const ends = minutesFromTime(endsAt);
  if (starts === null || ends === null) return 120;
  const normalizedEnd = ends <= starts ? ends + 24 * 60 : ends;
  return Math.max(1, normalizedEnd - starts);
}

function billingLabel(value: string) {
  return value === "full_tournament" ? "Torneo completo" : "Pago semanal";
}

export function TournamentsPanel({
  data,
  user,
  readOnly = false,
  onCreateTournament,
  onCreateTeam,
  onRegisterStudent,
  onCreateMatch,
  onUpdateMatch,
}: TournamentsPanelProps) {
  const isCoachView = readOnly || user?.role === "coach";
  const coachStudentIds = useMemo(() => new Set(data.students.map((student) => student.id)), [data.students]);
  const coachTeamIds = useMemo(() => {
    const ids = new Set<number>();
    data.attendanceSessions.forEach((session) => {
      if (session.team) ids.add(session.team);
      if (session.match) {
        const match = data.matches.find((item) => item.id === session.match);
        if (match) {
          ids.add(match.home_team);
          ids.add(match.away_team);
        }
      }
    });
    data.studentTournamentRegistrations.forEach((registration) => {
      if (coachStudentIds.has(registration.student) && registration.team) ids.add(registration.team);
    });
    return ids;
  }, [coachStudentIds, data.attendanceSessions, data.matches, data.studentTournamentRegistrations]);
  const coachTournamentIds = useMemo(() => {
    const ids = new Set<number>();
    data.attendanceSessions.forEach((session) => {
      if (session.tournament) ids.add(session.tournament);
      if (session.match) {
        const match = data.matches.find((item) => item.id === session.match);
        if (match) ids.add(match.tournament);
      }
    });
    data.studentTournamentRegistrations.forEach((registration) => {
      if (coachStudentIds.has(registration.student)) ids.add(registration.tournament);
      if (registration.team && coachTeamIds.has(registration.team)) ids.add(registration.tournament);
    });
    return ids;
  }, [coachStudentIds, coachTeamIds, data.attendanceSessions, data.matches, data.studentTournamentRegistrations]);
  const visibleTournaments = useMemo(() => {
    if (!isCoachView) return data.tournaments;
    return data.tournaments.filter((tournament) => coachTournamentIds.has(tournament.id));
  }, [coachTournamentIds, data.tournaments, isCoachView]);
  const visibleTeams = useMemo(() => {
    if (!isCoachView) return data.teams;
    return data.teams.filter((team) => coachTournamentIds.has(team.tournament) && (coachTeamIds.size === 0 || coachTeamIds.has(team.id)));
  }, [coachTeamIds, coachTournamentIds, data.teams, isCoachView]);
  const visibleMatches = useMemo(() => {
    if (!isCoachView) return data.matches;
    return data.matches.filter((match) => coachTournamentIds.has(match.tournament) && (coachTeamIds.size === 0 || coachTeamIds.has(match.home_team) || coachTeamIds.has(match.away_team)));
  }, [coachTeamIds, coachTournamentIds, data.matches, isCoachView]);
  const visibleRegistrations = useMemo(() => {
    if (!isCoachView) return data.studentTournamentRegistrations;
    return data.studentTournamentRegistrations.filter((registration) => {
      if (!coachTournamentIds.has(registration.tournament)) return false;
      if (coachStudentIds.has(registration.student)) return true;
      return Boolean(registration.team && coachTeamIds.has(registration.team));
    });
  }, [coachStudentIds, coachTeamIds, coachTournamentIds, data.studentTournamentRegistrations, isCoachView]);
  const activeTournaments = visibleTournaments.filter((tournament) => tournament.is_active);
  const firstTournament = activeTournaments[0] ?? visibleTournaments[0] ?? null;
  const [selectedTournamentId, setSelectedTournamentId] = useState(firstTournament?.id ? String(firstTournament.id) : "");
  const selectedTournament = visibleTournaments.find((tournament) => String(tournament.id) === selectedTournamentId) ?? firstTournament;
  const tournamentTeams = visibleTeams.filter((team) => !selectedTournament || team.tournament === selectedTournament.id);
  const tournamentMatches = visibleMatches.filter((match) => !selectedTournament || match.tournament === selectedTournament.id);
  const visibleTournamentMatches = tournamentMatches.filter((match) => match.status !== "canceled");
  const tournamentStandings = data.standings.filter((row) => !selectedTournament || row.tournament === selectedTournament.id);
  const tournamentRegistrations = visibleRegistrations.filter((registration) => !selectedTournament || registration.tournament === selectedTournament.id);
  const availableStudents = data.students.filter((student) => !selectedTournament?.site || student.site === selectedTournament.site);
  const leader = tournamentStandings[0] ?? null;
  const [tournamentSearch, setTournamentSearch] = useState("");
  const [tournamentSiteFilter, setTournamentSiteFilter] = useState("all");
  const [tournamentStatusFilter, setTournamentStatusFilter] = useState("active");
  const [tournamentBillingFilter, setTournamentBillingFilter] = useState("all");
  const [tournamentPage, setTournamentPage] = useState(0);
  const [successNotice, setSuccessNotice] = useState<SuccessNotice | null>(null);

  useEffect(() => {
    if (!selectedTournament && firstTournament) {
      setSelectedTournamentId(String(firstTournament.id));
    }
    if (!firstTournament && selectedTournamentId) {
      setSelectedTournamentId("");
    }
  }, [firstTournament, selectedTournament, selectedTournamentId]);

  const tournamentCards = useMemo(() => {
    return visibleTournaments.map((tournament) => {
      const teams = visibleTeams.filter((team) => team.tournament === tournament.id);
      const registrations = visibleRegistrations.filter((registration) => registration.tournament === tournament.id);
      const matches = visibleMatches.filter((match) => match.tournament === tournament.id);
      const liveCount = matches.filter((match) => match.status === "live" || match.status === "scheduled").length;
      const top = data.standings.find((row) => row.tournament === tournament.id && row.position === 1);
      return { tournament, teams, registrations, matches, liveCount, top };
    });
  }, [data.standings, visibleMatches, visibleRegistrations, visibleTeams, visibleTournaments]);
  const filteredTournamentCards = useMemo(() => {
    const query = tournamentSearch.trim().toLowerCase();
    return tournamentCards.filter(({ tournament }) => {
      const site = data.sites.find((item) => item.id === tournament.site);
      const matchesSearch = !query || `${tournament.name} ${site?.name || ""}`.toLowerCase().includes(query);
      const matchesSite = tournamentSiteFilter === "all" || String(tournament.site) === tournamentSiteFilter;
      const matchesStatus = tournamentStatusFilter === "all" || (tournamentStatusFilter === "active" ? tournament.is_active : !tournament.is_active);
      const matchesBilling = tournamentBillingFilter === "all" || tournament.billing_type === tournamentBillingFilter;
      return matchesSearch && matchesSite && matchesStatus && matchesBilling;
    });
  }, [data.sites, tournamentBillingFilter, tournamentCards, tournamentSearch, tournamentSiteFilter, tournamentStatusFilter]);
  const tournamentsPerPage = 4;
  const tournamentPageCount = Math.max(1, Math.ceil(filteredTournamentCards.length / tournamentsPerPage));
  const visibleTournamentCards = filteredTournamentCards.slice(tournamentPage * tournamentsPerPage, (tournamentPage + 1) * tournamentsPerPage);

  async function submitTournament(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const tournamentName = String(form.get("name") || "").trim();
    await onCreateTournament({
      site: Number(form.get("site")),
      name: tournamentName,
      billing_type: String(form.get("billing_type") || "weekly_match"),
      starts_on: String(form.get("starts_on") || today()),
      expected_weeks: Number(form.get("expected_weeks") || 12),
      is_active: true,
    });
    setSuccessNotice({
      title: "Torneo creado",
      detail: `${tournamentName || "El torneo"} se guardo correctamente.`,
    });
    event.currentTarget.reset();
  }

  async function submitTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const teamName = String(form.get("name") || "").trim();
    await onCreateTeam({
      tournament: Number(form.get("tournament")),
      name: teamName,
      representative_name: String(form.get("representative_name") || "Pendiente"),
      representative_phone: String(form.get("representative_phone") || ""),
      representative_email: String(form.get("representative_email") || ""),
      is_active: true,
    });
    setSuccessNotice({
      title: "Equipo creado",
      detail: `${teamName || "El equipo"} se registro correctamente.`,
    });
    event.currentTarget.reset();
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const team = String(form.get("team") || "");
    const studentId = Number(form.get("student"));
    const studentName = data.students.find((student) => student.id === studentId)?.full_name || "El alumno";
    await onRegisterStudent({
      tournament: Number(form.get("tournament")),
      student: studentId,
      team: team ? Number(team) : null,
      jersey_number: form.get("jersey_number") ? Number(form.get("jersey_number")) : null,
      billing_type: String(form.get("billing_type") || "weekly_match"),
      weekly_amount: String(form.get("weekly_amount") || "650"),
      full_amount: String(form.get("full_amount") || "7800"),
      billing_starts_on: String(form.get("billing_starts_on") || selectedTournament?.starts_on || today()),
      status: "registered",
      notes: String(form.get("notes") || ""),
    });
    setSuccessNotice({
      title: "Alumno inscrito",
      detail: `${studentName} quedo inscrito correctamente en el torneo.`,
    });
    event.currentTarget.reset();
  }

  async function submitMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const tournament = data.tournaments.find((item) => item.id === Number(form.get("tournament")));
    const startsAt = String(form.get("starts_at") || "20:00");
    const endsAt = String(form.get("ends_at") || "22:00");
    const homeTeamId = Number(form.get("home_team"));
    const awayTeamId = Number(form.get("away_team"));
    const homeTeamName = data.teams.find((team) => team.id === homeTeamId)?.name || "Local";
    const awayTeamName = data.teams.find((team) => team.id === awayTeamId)?.name || "Visitante";
    await onCreateMatch({
      tournament: Number(form.get("tournament")),
      site: tournament?.site,
      home_team: homeTeamId,
      away_team: awayTeamId,
      played_on: String(form.get("played_on") || today()),
      starts_at: startsAt,
      duration_minutes: durationFromRange(startsAt, endsAt),
      status: "scheduled",
    });
    setSuccessNotice({
      title: "Partido agendado",
      detail: `${homeTeamName} vs ${awayTeamName} se programo correctamente.`,
    });
    event.currentTarget.reset();
  }

  useEffect(() => {
    setTournamentPage(0);
  }, [tournamentSearch, tournamentSiteFilter, tournamentStatusFilter, tournamentBillingFilter]);

  useEffect(() => {
    if (tournamentPage >= tournamentPageCount) setTournamentPage(tournamentPageCount - 1);
  }, [tournamentPage, tournamentPageCount]);

  return (
    <section className="grid min-w-0 gap-5">
      {successNotice ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/35 px-4">
          <div className="w-full max-w-md rounded-2xl border border-emerald-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-emerald-700">
              <Shield size={20} />
              <p className="text-sm font-semibold uppercase tracking-wide">Operacion completada</p>
            </div>
            <h3 className="mt-3 text-xl font-semibold text-zinc-950">{successNotice.title}</h3>
            <p className="mt-2 text-sm text-zinc-600">{successNotice.detail}</p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                onClick={() => setSuccessNotice(null)}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
            <Metric label="Ninos inscritos" value={visibleRegistrations.length} helper={isCoachView ? "Solo de tu alcance" : "Registros a torneos"} />
            <Metric label="Partidos activos" value={visibleMatches.filter((match) => match.status === "live" || match.status === "scheduled").length} helper="Programados/en vivo" />
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)]">
        <div className="grid gap-5">
          <div className="rounded-md border border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div>
                <h3 className="font-semibold">Torneos activos</h3>
                <p className="text-xs text-zinc-500">{filteredTournamentCards.length} de {tournamentCards.length} torneos</p>
              </div>
              <div className="flex gap-2">
                <button
                  className="grid size-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={tournamentPage === 0}
                  onClick={() => setTournamentPage((page) => Math.max(0, page - 1))}
                  type="button"
                  aria-label="Torneos anteriores"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="grid h-8 min-w-14 place-items-center rounded-md bg-zinc-100 px-2 text-xs font-semibold text-zinc-600">
                  {tournamentPage + 1}/{tournamentPageCount}
                </span>
                <button
                  className="grid size-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={tournamentPage >= tournamentPageCount - 1}
                  onClick={() => setTournamentPage((page) => Math.min(tournamentPageCount - 1, page + 1))}
                  type="button"
                  aria-label="Mas torneos"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="grid min-w-0 gap-2 border-b border-zinc-100 px-4 py-3 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(0,150px)_minmax(0,130px)_minmax(0,160px)]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={15} />
                <input
                  className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-emerald-600"
                  placeholder="Buscar torneo o sede"
                  value={tournamentSearch}
                  onChange={(event) => setTournamentSearch(event.target.value)}
                />
              </label>
              <select className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-600" value={tournamentSiteFilter} onChange={(event) => setTournamentSiteFilter(event.target.value)}>
                <option value="all">Todas las sedes</option>
                {data.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
              </select>
              <select className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-600" value={tournamentStatusFilter} onChange={(event) => setTournamentStatusFilter(event.target.value)}>
                <option value="active">Activos</option>
                <option value="inactive">Cerrados</option>
                <option value="all">Todos</option>
              </select>
              <select className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-white px-3 text-sm outline-none focus:border-emerald-600" value={tournamentBillingFilter} onChange={(event) => setTournamentBillingFilter(event.target.value)}>
                <option value="all">Todos los cobros</option>
                <option value="weekly_match">Pago semanal</option>
                <option value="full_tournament">Torneo completo</option>
              </select>
            </div>
            <div className="grid gap-3 p-4 md:grid-cols-2">
              {visibleTournamentCards.map(({ tournament, teams, registrations, matches, liveCount, top }) => (
                <button
                  key={tournament.id}
                  className={`min-h-[158px] rounded-md border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${
                    selectedTournament?.id === tournament.id ? "border-emerald-700 bg-emerald-50" : "border-zinc-200 bg-white"
                  }`}
                  onClick={() => setSelectedTournamentId(String(tournament.id))}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-zinc-500">{tournament.starts_on || "sin fecha"} · {billingLabel(tournament.billing_type)}</p>
                      <h3 className="mt-1 line-clamp-2 font-semibold">{tournament.name}</h3>
                    </div>
                    <StatusPill label={tournament.is_active ? "Activo" : "Cerrado"} />
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-xs">
                    <div className="rounded-md bg-zinc-50 p-1.5"><p className="text-sm font-bold">{teams.length}</p><p>Eq.</p></div>
                    <div className="rounded-md bg-zinc-50 p-1.5"><p className="text-sm font-bold">{registrations.length}</p><p>Ninos</p></div>
                    <div className="rounded-md bg-zinc-50 p-1.5"><p className="text-sm font-bold">{matches.length}</p><p>Juegos</p></div>
                    <div className="rounded-md bg-zinc-50 p-1.5"><p className="text-sm font-bold">{liveCount}</p><p>Act.</p></div>
                  </div>
                  <p className="mt-2 truncate text-xs text-zinc-500">Lider: <span className="font-medium text-zinc-900">{top?.team_name || "pendiente"}</span></p>
                </button>
              ))}
              {visibleTournamentCards.length === 0 && <p className="col-span-full text-sm text-zinc-500">No hay torneos con esos filtros.</p>}
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

        <div className="grid content-start gap-3">
          {!isCoachView && (
          <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Plus size={18} />
              <h3 className="font-semibold">Crear torneo o liguilla</h3>
            </div>
            <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={submitTournament}>
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
            <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={submitTeam}>
              <TournamentSelect tournaments={visibleTournaments} value={selectedTournamentId} />
              <TextInput label="Equipo" name="name" placeholder="Sub-12 A" required />
              <TextInput label="Representante" name="representative_name" placeholder="Nombre del responsable" />
              <TextInput label="Telefono" name="representative_phone" placeholder="55..." />
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
            <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={submitRegistration}>
              <TournamentSelect tournaments={visibleTournaments} value={selectedTournamentId} />
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
            <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={submitMatch}>
              <TournamentSelect tournaments={visibleTournaments} value={selectedTournamentId} />
              <TeamSelect label="Local" name="home_team" teams={tournamentTeams} />
              <TeamSelect label="Visitante" name="away_team" teams={tournamentTeams} />
              <TextInput label="Fecha" name="played_on" type="date" defaultValue={today()} />
              <TextInput label="Hora inicio" name="starts_at" type="time" defaultValue="20:00" />
              <TextInput label="Hora fin" name="ends_at" type="time" defaultValue="22:00" />
              <button className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white">Agendar</button>
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
      </div>

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
                    {registration.student_group_name || registration.student_category || "Sin grupo"} · {registration.team_name || "Sin equipo"} · {billingLabel(registration.billing_type)}
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
              <MatchScoreCard key={match.id} match={match as Match} canEdit={!isCoachView} onUpdateMatch={onUpdateMatch} />
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
