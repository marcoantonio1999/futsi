import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AppData, Match, Team, Tournament, User } from "../../types";
import { TournamentCardsSection } from "./TournamentCardsSection";
import { TournamentDetails } from "./TournamentDetails";
import { TournamentForms } from "./TournamentForms";
import { TournamentHero } from "./TournamentHero";
import { TournamentMatchScheduleSection } from "./TournamentMatchScheduleSection";
import { TournamentNoticeModal } from "./TournamentNoticeModal";
import { TournamentRegistrationSection } from "./TournamentRegistrationSection";
import { TournamentStandingsTable } from "./TournamentStandingsTable";
import { TournamentTeamsSection } from "./TournamentTeamsSection";
import { durationFromRange, today } from "./utils";

export type TournamentSection = "overview" | "teams" | "registrations" | "schedule";

type TournamentsPanelProps = {
  data: AppData;
  user?: User;
  scope?: "academy" | "adult";
  readOnly?: boolean;
  section?: TournamentSection;
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
  scope = "academy",
  readOnly = false,
  section = "overview",
  onCreateTournament,
  onCreateTeam,
  onRegisterStudent,
  onCreateMatch,
  onUpdateMatch,
}: TournamentsPanelProps) {
  const isCoachView = readOnly || user?.role === "coach";
  const isAdultScope = scope === "adult";
  const coachStudentIds = useMemo(() => new Set(data.students.map((student) => student.id)), [data.students]);
  const coachTeamIds = useMemo(() => buildCoachTeamIds(data, coachStudentIds), [coachStudentIds, data]);
  const coachTournamentIds = useMemo(() => buildCoachTournamentIds(data, coachStudentIds, coachTeamIds), [coachStudentIds, coachTeamIds, data]);
  const visibleTournaments = useMemo(() => isCoachView ? data.tournaments.filter((tournament) => coachTournamentIds.has(tournament.id)) : data.tournaments, [coachTournamentIds, data.tournaments, isCoachView]);
  const visibleTeams = useMemo(() => isCoachView ? data.teams.filter((team) => coachTournamentIds.has(team.tournament) && (coachTeamIds.size === 0 || coachTeamIds.has(team.id))) : data.teams, [coachTeamIds, coachTournamentIds, data.teams, isCoachView]);
  const visibleMatches = useMemo(() => isCoachView ? data.matches.filter((match) => coachTournamentIds.has(match.tournament) && (coachTeamIds.size === 0 || coachTeamIds.has(match.home_team) || coachTeamIds.has(match.away_team))) : data.matches, [coachTeamIds, coachTournamentIds, data.matches, isCoachView]);
  const visibleRegistrations = useMemo(() => {
    if (!isCoachView) return data.studentTournamentRegistrations;
    return data.studentTournamentRegistrations.filter((registration) => coachTournamentIds.has(registration.tournament) && (coachStudentIds.has(registration.student) || Boolean(registration.team && coachTeamIds.has(registration.team))));
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

  const tournamentCards = useMemo(() => buildTournamentCards(data, visibleTournaments, visibleTeams, visibleRegistrations, visibleMatches), [data, visibleMatches, visibleRegistrations, visibleTeams, visibleTournaments]);
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

  useEffect(() => {
    if (!selectedTournament && firstTournament) setSelectedTournamentId(String(firstTournament.id));
    if (!firstTournament && selectedTournamentId) setSelectedTournamentId("");
  }, [firstTournament, selectedTournament, selectedTournamentId]);

  useEffect(() => setTournamentPage(0), [tournamentSearch, tournamentSiteFilter, tournamentStatusFilter, tournamentBillingFilter]);
  useEffect(() => {
    if (tournamentPage >= tournamentPageCount) setTournamentPage(tournamentPageCount - 1);
  }, [tournamentPage, tournamentPageCount]);

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
    if (createdTournament?.id) setSelectedTournamentId(String(createdTournament.id));
    setSuccessNotice({ title: "Torneo creado", detail: `${tournamentName || "El torneo"} se guardo correctamente.` });
    event.currentTarget.reset();
  }

  async function submitTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const teamName = String(form.get("name") || "").trim();
    await onCreateTeam({
      tournament: Number(form.get("tournament")),
      name: teamName,
      representative_name: isAdultScope ? String(form.get("representative_name") || "").trim() : "Equipo infantil",
      representative_phone: isAdultScope ? String(form.get("representative_phone") || "").trim() : "N/A",
      representative_email: String(form.get("representative_email") || "").trim(),
      is_active: true,
    });
    setSuccessNotice({ title: "Equipo creado", detail: `${teamName || "El equipo"} se registro correctamente.` });
    event.currentTarget.reset();
  }

  async function submitRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const studentId = Number(form.get("student"));
    const studentName = data.students.find((student) => student.id === studentId)?.full_name || "El alumno";
    await onRegisterStudent({
      tournament: Number(form.get("tournament")),
      student: studentId,
      team: form.get("team") ? Number(form.get("team")) : null,
      jersey_number: form.get("jersey_number") ? Number(form.get("jersey_number")) : null,
      billing_type: String(form.get("billing_type") || "weekly_match"),
      weekly_amount: String(form.get("weekly_amount") || "650"),
      full_amount: String(form.get("full_amount") || "7800"),
      billing_starts_on: String(form.get("billing_starts_on") || selectedTournament?.starts_on || today()),
      status: "registered",
      notes: String(form.get("notes") || ""),
    });
    setSuccessNotice({ title: "Alumno inscrito", detail: `${studentName} quedo inscrito correctamente en el torneo.` });
    event.currentTarget.reset();
  }

  async function submitMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const homeTeamId = Number(form.get("home_team"));
    const awayTeamId = Number(form.get("away_team"));
    if (tournamentTeams.length < 2) return setFormNotice({ title: "Faltan equipos", detail: "Para agendar un partido necesitas registrar al menos dos equipos en este torneo." });
    if (!homeTeamId || !awayTeamId) return setFormNotice({ title: "Selecciona equipos", detail: "Elige un equipo local y un equipo visitante para agendar el partido." });
    if (homeTeamId === awayTeamId) return setFormNotice({ title: "Equipos repetidos", detail: "El equipo local y el visitante deben ser diferentes." });
    const tournament = data.tournaments.find((item) => item.id === Number(form.get("tournament")));
    const startsAt = String(form.get("starts_at") || "20:00");
    const endsAt = String(form.get("ends_at") || "22:00");
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
    setSuccessNotice({ title: "Partido agendado", detail: `${homeTeamName} vs ${awayTeamName} se programo correctamente.` });
    event.currentTarget.reset();
  }

  const canceledNotice = (canceledMatch: Match) => setSuccessNotice({
    title: "Juego cancelado",
    detail: `${canceledMatch.home_team_name || "Local"} vs ${canceledMatch.away_team_name || "Visitante"} se cancelo correctamente.`,
  });

  if (section === "schedule") {
    return (
      <section className="grid min-w-0 gap-5">
        <TournamentNoticeModal notice={successNotice} tone="emerald" eyebrow="Operacion completada" onClose={() => setSuccessNotice(null)} />
        <TournamentNoticeModal notice={formNotice} tone="amber" eyebrow="Revisa el formulario" onClose={() => setFormNotice(null)} />
        <TournamentMatchScheduleSection
          isCoachView={isCoachView}
          selectedTournament={selectedTournament ?? null}
          selectedTournamentId={selectedTournamentId}
          tournamentTeams={tournamentTeams}
          visibleTournaments={visibleTournaments}
          visibleTournamentMatches={visibleTournamentMatches as Match[]}
          onSelectTournament={setSelectedTournamentId}
          onSubmitMatch={submitMatch}
          onUpdateMatch={onUpdateMatch}
          onMatchCanceled={canceledNotice}
        />
      </section>
    );
  }

  if (section === "teams") {
    return (
      <section className="grid min-w-0 gap-5">
        <TournamentNoticeModal notice={successNotice} tone="emerald" eyebrow="Operacion completada" onClose={() => setSuccessNotice(null)} />
        <TournamentNoticeModal notice={formNotice} tone="amber" eyebrow="Revisa el formulario" onClose={() => setFormNotice(null)} />
        <TournamentTeamsSection
          isAdultScope={isAdultScope}
          isCoachView={isCoachView}
          selectedTournament={selectedTournament ?? null}
          selectedTournamentId={selectedTournamentId}
          tournamentTeams={tournamentTeams}
          visibleTournaments={visibleTournaments}
          onSelectTournament={setSelectedTournamentId}
          onSubmitTeam={submitTeam}
        />
      </section>
    );
  }

  if (section === "registrations") {
    return (
      <section className="grid min-w-0 gap-5">
        <TournamentNoticeModal notice={successNotice} tone="emerald" eyebrow="Operacion completada" onClose={() => setSuccessNotice(null)} />
        <TournamentNoticeModal notice={formNotice} tone="amber" eyebrow="Revisa el formulario" onClose={() => setFormNotice(null)} />
        <TournamentRegistrationSection
          availableStudents={availableStudents}
          isCoachView={isCoachView}
          selectedTournament={selectedTournament ?? null}
          selectedTournamentId={selectedTournamentId}
          tournamentRegistrations={tournamentRegistrations}
          tournamentTeams={tournamentTeams}
          visibleTournaments={visibleTournaments}
          onSelectTournament={setSelectedTournamentId}
          onSubmitRegistration={submitRegistration}
        />
      </section>
    );
  }

  return (
    <section className="grid min-w-0 gap-5">
      <TournamentNoticeModal notice={successNotice} tone="emerald" eyebrow="Operacion completada" onClose={() => setSuccessNotice(null)} />
      <TournamentNoticeModal notice={formNotice} tone="amber" eyebrow="Revisa el formulario" onClose={() => setFormNotice(null)} />
      <TournamentHero isCoachView={isCoachView} selectedTournament={selectedTournament ?? null} leader={leader} activeTournaments={activeTournaments} visibleTournaments={visibleTournaments} visibleTeams={visibleTeams} visibleRegistrationsCount={visibleRegistrations.length} visibleMatches={visibleMatches as Match[]} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(420px,0.95fr)]">
        <div className="grid gap-5">
          <TournamentCardsSection
            sites={data.sites}
            tournamentCardsCount={tournamentCards.length}
            filteredTournamentCardsCount={filteredTournamentCards.length}
            visibleTournamentCards={visibleTournamentCards}
            selectedTournamentId={selectedTournament?.id}
            page={tournamentPage}
            pageCount={tournamentPageCount}
            search={tournamentSearch}
            siteFilter={tournamentSiteFilter}
            statusFilter={tournamentStatusFilter}
            billingFilter={tournamentBillingFilter}
            onBillingFilterChange={setTournamentBillingFilter}
            onPageChange={setTournamentPage}
            onSearchChange={setTournamentSearch}
            onSelectTournament={setSelectedTournamentId}
            onSiteFilterChange={setTournamentSiteFilter}
            onStatusFilterChange={setTournamentStatusFilter}
          />
          <TournamentStandingsTable rows={tournamentStandings} />
        </div>

        <TournamentForms
          isCoachView={isCoachView}
          data={data}
          onSubmitTournament={submitTournament}
        />
      </div>

      <TournamentDetails isCoachView={isCoachView} tournamentRegistrations={tournamentRegistrations} visibleTournamentMatches={visibleTournamentMatches as Match[]} onUpdateMatch={onUpdateMatch} onMatchCanceled={canceledNotice} />
    </section>
  );
}

function buildCoachTeamIds(data: AppData, coachStudentIds: Set<number>) {
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
}

function buildCoachTournamentIds(data: AppData, coachStudentIds: Set<number>, coachTeamIds: Set<number>) {
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
}

function buildTournamentCards(data: AppData, visibleTournaments: Tournament[], visibleTeams: Team[], visibleRegistrations: AppData["studentTournamentRegistrations"], visibleMatches: Match[]) {
  return visibleTournaments.map((tournament) => {
    const teams = visibleTeams.filter((team) => team.tournament === tournament.id);
    const registrations = visibleRegistrations.filter((registration) => registration.tournament === tournament.id);
    const matches = visibleMatches.filter((match) => match.tournament === tournament.id);
    const liveCount = matches.filter((match) => match.status === "live" || match.status === "scheduled").length;
    const top = data.standings.find((row) => row.tournament === tournament.id && row.position === 1);
    return { tournament, teams, registrations, matches, liveCount, top };
  });
}
