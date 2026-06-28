import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Medal, Plus, Search, Shield, Trophy, UserPlus, UsersRound } from "lucide-react";
import { Metric } from "../cards/Metric";
import type { AppData, Match, Team, Tournament, User } from "../../types";
import { MatchScoreCard } from "./sportsDetails";
import { SelectInput, StatusPill, TableHeader, TextInput } from "./shared";
import { TournamentDetails } from "./tournamentDetails";
import { TournamentForms } from "./tournamentForms";
import { TournamentHero } from "./tournamentHero";
import { TournamentNoticeModal } from "./tournamentNoticeModal";
import { TournamentStandingsTable } from "./tournamentStandingsTable";
import { billingLabel, durationFromRange, today } from "./tournamentUtils";
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
  const [formNotice, setFormNotice] = useState<SuccessNotice | null>(null);

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
    const createdTournament = await onCreateTournament({
      site: Number(form.get("site")),
      name: tournamentName,
      billing_type: String(form.get("billing_type") || "weekly_match"),
      starts_on: String(form.get("starts_on") || today()),
      expected_weeks: Number(form.get("expected_weeks") || 12),
      is_active: true,
    }) as Tournament;
    if (createdTournament?.id) {
      setSelectedTournamentId(String(createdTournament.id));
    }
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
      representative_name: String(form.get("representative_name") || "").trim(),
      representative_phone: String(form.get("representative_phone") || "").trim(),
      representative_email: String(form.get("representative_email") || "").trim(),
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
    if (tournamentTeams.length < 2) {
      setFormNotice({
        title: "Faltan equipos",
        detail: "Para agendar un partido necesitas registrar al menos dos equipos en este torneo.",
      });
      return;
    }
    if (!homeTeamId || !awayTeamId) {
      setFormNotice({
        title: "Selecciona equipos",
        detail: "Elige un equipo local y un equipo visitante para agendar el partido.",
      });
      return;
    }
    if (homeTeamId === awayTeamId) {
      setFormNotice({
        title: "Equipos repetidos",
        detail: "El equipo local y el visitante deben ser diferentes.",
      });
      return;
    }
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
      <TournamentNoticeModal notice={successNotice} tone="emerald" eyebrow="Operacion completada" onClose={() => setSuccessNotice(null)} />
      <TournamentNoticeModal notice={formNotice} tone="amber" eyebrow="Revisa el formulario" onClose={() => setFormNotice(null)} />
      <TournamentHero
        isCoachView={isCoachView}
        selectedTournament={selectedTournament ?? null}
        leader={leader}
        activeTournaments={activeTournaments}
        visibleTournaments={visibleTournaments}
        visibleTeams={visibleTeams}
        visibleRegistrationsCount={visibleRegistrations.length}
        visibleMatches={visibleMatches as Match[]}
      />

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

          <TournamentStandingsTable rows={tournamentStandings} />
        </div>

        <TournamentForms
          isCoachView={isCoachView}
          data={data}
          visibleTournaments={visibleTournaments}
          selectedTournamentId={selectedTournamentId}
          selectedTournament={selectedTournament ?? null}
          availableStudents={availableStudents}
          tournamentTeams={tournamentTeams}
          onSubmitTournament={submitTournament}
          onSubmitTeam={submitTeam}
          onSubmitRegistration={submitRegistration}
          onSubmitMatch={submitMatch}
        />
      </div>

      <TournamentDetails
        isCoachView={isCoachView}
        tournamentRegistrations={tournamentRegistrations}
        visibleTournamentMatches={visibleTournamentMatches as Match[]}
        onUpdateMatch={onUpdateMatch}
        onMatchCanceled={(canceledMatch) => setSuccessNotice({
          title: "Juego cancelado",
          detail: `${canceledMatch.home_team_name || "Local"} vs ${canceledMatch.away_team_name || "Visitante"} se cancelo correctamente.`,
        })}
      />
    </section>
  );
}

