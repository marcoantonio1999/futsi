import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, Plus, Shield, Trophy, UsersRound, X, Trash2 } from "lucide-react";
import type { AppData, Match, StudentDeletionConfirmation, StudentDeletionResult, StudentTournamentRegistration, Tournament, User } from "../../types";
import { SelectInput, TextInput } from "../../components/views/shared";
import { standingsForTournament } from "../../components/views/sportsViewModel";
import { TournamentStandingsTable } from "./TournamentStandingsTable";
import { TournamentCreatePage } from "./TournamentCreatePage";
import { TournamentDialog } from "./TournamentDialog";
import { CreateTeamDialog, EnrollmentDialog, ScheduleMatchDialog } from "./TournamentManagementDialogs";
import { TournamentRoster } from "./TournamentRoster";
import { TournamentMatches } from "./TournamentMatches";
import "../../components/views/sports.css";
import "./tournaments.css";
import { AcademyDeleteDialog } from "../../components/views/studentDeleteDialog";
import "../../components/views/students.css";

export type TournamentSection = "overview" | "create" | "detail" | "teams" | "registrations" | "schedule";
type Props = {
  token: string;
  onDeleteTournament: (id: number, confirmation: StudentDeletionConfirmation) => Promise<StudentDeletionResult>;
  data: AppData; user?: User; scope?: "academy" | "adult"; readOnly?: boolean; section: TournamentSection;
  onSelectSection: (section: TournamentSection) => void;
  onCreateTournament: (payload: unknown) => Promise<unknown>; onCreateTeam: (payload: unknown) => Promise<unknown>;
  onRegisterStudent: (payload: unknown) => Promise<unknown>; onUpdateRegistration: (id: number, payload: unknown) => Promise<boolean>;
  onCreateMatch: (payload: unknown) => Promise<unknown>; onUpdateMatch: (id: number, payload: unknown) => Promise<void>;
};
type Dialog = { kind: "team" | "match" } | { kind: "enrollment"; row?: StudentTournamentRegistration; team?: number } | { kind: "withdraw"; row: StudentTournamentRegistration };

export function TournamentsPanel(props: Props) {
  const { data, section, onSelectSection, scope = "academy" } = props;
  const readOnly = props.readOnly || props.user?.role === "coach";
  const adult = scope === "adult";
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [deletingTournament, setDeletingTournament] = useState<Tournament | null>(null);
  const [notice, setNotice] = useState("");
  const [rosterTeam, setRosterTeam] = useState("");
  const scoped = useMemo(() => {
    if (!readOnly) return data;
    const studentIds = new Set(data.students.map(row => row.id));
    const teamIds = new Set<number>();
    const ids = new Set<number>();
    data.attendanceSessions.forEach(row => {
      if (row.team) teamIds.add(row.team);
      if (row.tournament) ids.add(row.tournament);
      const match = data.matches.find(match => match.id === row.match);
      if (match) { teamIds.add(match.home_team); teamIds.add(match.away_team); ids.add(match.tournament); }
    });
    data.studentTournamentRegistrations.forEach(row => { if (studentIds.has(row.student) && row.team) teamIds.add(row.team); });
    const registrations = data.studentTournamentRegistrations.filter(row => studentIds.has(row.student) || Boolean(row.team && teamIds.has(row.team)));
    registrations.forEach(row => ids.add(row.tournament));
    return {
      ...data,
      tournaments: data.tournaments.filter(row => ids.has(row.id)),
      teams: data.teams.filter(row => ids.has(row.tournament) && (!teamIds.size || teamIds.has(row.id))),
      matches: data.matches.filter(row => ids.has(row.tournament) && (!teamIds.size || teamIds.has(row.home_team) || teamIds.has(row.away_team))),
      studentTournamentRegistrations: registrations,
    };
  }, [data, readOnly]);
  const selected = scoped.tournaments.find(row => row.id === selectedId) || scoped.tournaments.find(row => row.is_active) || scoped.tournaments[0];
  const teams = scoped.teams.filter(row => row.tournament === selected?.id);
  const registrations = scoped.studentTournamentRegistrations.filter(row => row.tournament === selected?.id);
  const enrolled = registrations.filter(row => row.status === "registered");
  const matches = scoped.matches.filter(row => row.tournament === selected?.id);
  const standings = standingsForTournament(scoped.standings, selected?.id);
  const go = (next: TournamentSection) => { setDialog(null); setRosterTeam(""); onSelectSection(next); };
  const openTournament = (id: number) => { setSelectedId(id); go("detail"); };
  const showRoster = (team = "") => { go("registrations"); setRosterTeam(team); };
  const toast = notice && <div className="tournament-toast" role="status"><CheckCircle2 size={19} /><span>{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice("")}><X size={17} /></button></div>;
  return <div className="tournament-ui sports-panel" data-testid="tournament-workspace">{toast}
    {section === "create" ? readOnly ? <p className="tournament-feedback warning">Esta cuenta solo puede consultar torneos.</p> : <TournamentCreatePage sites={data.sites} onBack={() => go("overview")} onCreate={props.onCreateTournament} onCreated={created => { setNotice(`Torneo creado correctamente: ${created.name}.`); openTournament(created.id); }} />
      : section === "overview" ? <TournamentDirectory data={scoped} adult={adult} readOnly={Boolean(readOnly)} onOpen={openTournament} onCreate={() => go("create")} onDelete={setDeletingTournament} />
      : !selected ? <div className="tournament-empty tournament-surface"><Trophy size={30} /><h2>Aún no hay torneos</h2><p>Crea el primero para registrar equipos, alumnos y partidos.</p>{!readOnly && <button className="tournament-button primary" onClick={() => go("create")}>Crear torneo</button>}</div>
      : <><button className="tournament-back" onClick={() => go("overview")}><ArrowLeft size={16} />Volver a torneos</button><header className="tournament-page-heading"><div><p className="tournament-eyebrow">Torneos / {section === "detail" ? "Dashboard" : section === "teams" ? "Equipos" : section === "registrations" ? "Alumnos inscritos" : "Partidos"}</p><h2>{selected.name}</h2><p>{data.sites.find(row => row.id === selected.site)?.name} · {selected.billing_type === "full_tournament" ? "Pago por torneo completo" : "Pago semanal"}</p></div><div className="tournament-context-select"><span className={`tournament-badge ${selected.is_active ? "success" : "muted"}`}>{selected.is_active ? "Torneo activo" : "Torneo inactivo"}</span><SelectInput label="Cambiar torneo" value={selected.id} onChange={event => { setSelectedId(Number(event.target.value)); setRosterTeam(""); setDialog(null); }}>{scoped.tournaments.map(row => <option key={row.id} value={row.id}>{row.name}{row.is_active ? "" : " · Inactivo"}</option>)}</SelectInput></div></header>
      <nav className="tournament-tabs" aria-label="Gestión del torneo"><button aria-current={section === "detail" ? "page" : undefined} onClick={() => go("detail")}>Dashboard</button><button aria-current={section === "teams" ? "page" : undefined} onClick={() => go("teams")}>Equipos <span>{teams.length}</span></button>{!adult && <button aria-current={section === "registrations" ? "page" : undefined} onClick={() => showRoster()}>Alumnos inscritos <span>{enrolled.length}</span></button>}<button aria-current={section === "schedule" ? "page" : undefined} onClick={() => go("schedule")}>Partidos <span>{matches.length}</span></button></nav>
      {section === "detail" && <><div className="tournament-metrics"><button onClick={() => go("teams")}><Shield size={18} /><span>Equipos activos</span><strong>{teams.filter(row => row.is_active).length}</strong></button><button onClick={() => adult ? go("teams") : showRoster()}><UsersRound size={18} /><span>{adult ? "Jugadores" : "Alumnos inscritos"}</span><strong>{adult ? data.players.filter(row => teams.some(team => team.id === row.team)).length : enrolled.length}</strong></button><button className="blue" onClick={() => go("schedule")}><CalendarDays size={18} /><span>Partidos programados</span><strong>{matches.filter(row => row.status === "scheduled").length}</strong></button><button className="rose" onClick={() => go("schedule")}><Trophy size={18} /><span>En vivo</span><strong>{matches.filter(row => row.status === "live").length}</strong></button></div>
        {!adult && enrolled.some(row => !row.team) && <div className="tournament-feedback warning"><span><strong>{enrolled.filter(row => !row.team).length} alumnos sin equipo.</strong> Asígnalos para completar las plantillas.</span><button className="tournament-button secondary compact" onClick={() => showRoster("none")}>Asignar equipos</button></div>}
        {!readOnly && <div className="tournament-quick-actions"><button onClick={() => { go("teams"); setDialog({ kind: "team" }); }}><Shield size={20} /><span>Crear equipo</span><ArrowRight size={16} /></button>{!adult && <button onClick={() => { showRoster(); setDialog({ kind: "enrollment" }); }}><UsersRound size={20} /><span>Inscribir alumno</span><ArrowRight size={16} /></button>}<button onClick={() => { go("schedule"); if (teams.filter(row => row.is_active).length >= 2) setDialog({ kind: "match" }); }}><CalendarDays size={20} /><span>Agendar partido</span><ArrowRight size={16} /></button></div>}
        <div className="tournament-dashboard-grid"><TournamentStandingsTable rows={standings} /><section className="tournament-surface"><header className="tournament-section-heading"><div><h3>Actividad del torneo</h3><p>{matches.filter(row => row.status === "finished").length} partidos finalizados de {matches.length} registrados</p></div></header><div className="tournament-dashboard-summary"><p><span>Fecha de inicio</span><strong>{selected.starts_on || "Sin definir"}</strong></p><p><span>Duración prevista</span><strong>{selected.expected_weeks ? `${selected.expected_weeks} semanas` : "Sin definir"}</strong></p><p><span>Líder actual</span><strong>{standings.find(row => row.is_leader)?.team_name || "Sin resultados"}</strong></p><button className="tournament-button secondary" onClick={() => go("schedule")}>Ver todos los partidos <ArrowRight size={16} /></button></div></section></div></>}
      {section === "teams" && <section className="tournament-surface"><header className="tournament-section-heading"><div><h3>Equipos del torneo</h3><p>Consulta sus alumnos o agrega un equipo nuevo.</p></div>{!readOnly && <button className="tournament-button primary" onClick={() => setDialog({ kind: "team" })}><Plus size={16} />Crear equipo</button>}</header><div className="tournament-team-grid">{teams.map(team => { const members = enrolled.filter(row => row.team === team.id); return <article key={team.id}><div className="tournament-team-heading"><span className="tournament-team-icon"><Shield size={22} /></span><div><h4>{team.name}</h4><span className={`tournament-badge ${team.is_active ? "success" : "muted"}`}>{team.is_active ? "Activo" : "Inactivo"}</span></div></div>{adult ? <p>{team.representative_name} · {team.representative_phone}</p> : <><p><strong>{members.length}</strong> alumnos inscritos</p><p className="tournament-member-preview">{members.length ? members.slice(0, 3).map(row => row.student_name).join(" · ") + (members.length > 3 ? ` y ${members.length - 3} más` : "") : "Este equipo aún no tiene alumnos."}</p><footer><button className="tournament-button secondary compact" onClick={() => showRoster(String(team.id))}>Ver alumnos</button>{!readOnly && team.is_active && <button className="tournament-text-button" onClick={() => setDialog({ kind: "enrollment", team: team.id })}>Inscribir alumnos <Plus size={14} /></button>}</footer></>}</article>; })}</div>{!teams.length && <div className="tournament-empty"><Shield size={30} /><h4>Crea el primer equipo</h4><p>Después podrás agregar alumnos y programar sus partidos.</p></div>}</section>}
      {section === "registrations" && !adult && <TournamentRoster key={`${selected.id}:${rosterTeam}`} registrations={registrations} teams={teams} initialTeam={rosterTeam} canEdit={!readOnly} onAdd={() => setDialog({ kind: "enrollment" })} onEdit={row => setDialog({ kind: "enrollment", row })} onWithdraw={row => setDialog({ kind: "withdraw", row })} />}
      {section === "schedule" && <TournamentMatches key={selected.id} matches={matches} canEdit={!readOnly} canSchedule={teams.filter(row => row.is_active).length >= 2} onSchedule={() => setDialog({ kind: "match" })} onCreateTeams={() => go("teams")} onUpdate={async (id, payload) => { await props.onUpdateMatch(id, payload); setNotice("Partido actualizado correctamente."); }} />}
      </>}
    {selected && !readOnly && dialog?.kind === "team" && <CreateTeamDialog tournament={selected} adult={adult} onClose={() => setDialog(null)} onSave={async payload => { await props.onCreateTeam(payload); setNotice("Equipo creado correctamente. Ya puedes inscribir alumnos."); }} />}
    {selected && !readOnly && dialog?.kind === "match" && <ScheduleMatchDialog tournament={selected} teams={teams.filter(row => row.is_active)} onClose={() => setDialog(null)} onSave={async payload => { await props.onCreateMatch(payload); setNotice("Partido agendado correctamente."); }} />}
    {selected && !readOnly && dialog?.kind === "enrollment" && <EnrollmentDialog tournament={selected} students={data.students} teams={teams.filter(row => row.is_active || row.id === dialog.row?.team)} registrations={registrations} existing={dialog.row} initialTeam={dialog.team} onClose={() => setDialog(null)} onSave={async (payload, id) => { if (id) { if (!await props.onUpdateRegistration(id, payload)) throw new Error("No se pudo actualizar la inscripción."); } else await props.onRegisterStudent(payload); setNotice("Inscripción guardada correctamente."); }} />}
    {selected && !readOnly && dialog?.kind === "withdraw" && <TournamentDialog title="Dar de baja del torneo" description={selected.name} submitLabel="Confirmar baja" danger onClose={() => setDialog(null)} onSubmit={async () => { if (!await props.onUpdateRegistration(dialog.row.id, { status: "withdrawn" })) throw new Error("No se pudo dar de baja al alumno."); setNotice(`${dialog.row.student_name} se dio de baja del torneo correctamente.`); }}><div className="tournament-context"><strong>{dialog.row.student_name}</strong><span>{dialog.row.team_name || "Sin equipo"}</span></div><p>El alumno saldrá de la plantilla activa del torneo y dejará de generar nuevos cobros de esta inscripción. Los cargos existentes y su historial se conservan.</p><p className="tournament-info">Su ficha de academia seguirá disponible. Puedes reinscribirlo desde el filtro «Bajas».</p></TournamentDialog>}
    {deletingTournament && !readOnly && <AcademyDeleteDialog kind="tournament" record={{ id: deletingTournament.id, full_name: deletingTournament.name, site_name: data.sites.find(row => row.id === deletingTournament.site)?.name }} token={props.token} onDelete={props.onDeleteTournament} onClose={() => setDeletingTournament(null)} />}
  </div>;
}

function TournamentDirectory({ data, adult, readOnly, onOpen, onCreate, onDelete }: { data: AppData; adult: boolean; readOnly: boolean; onOpen: (id: number) => void; onCreate: () => void; onDelete: (tournament: Tournament) => void }) {
  const [query, setQuery] = useState(""); const [site, setSite] = useState(""); const [status, setStatus] = useState("active"); const [limit, setLimit] = useState(8);
  const filtered = data.tournaments.filter(row => (!site || String(row.site) === site) && (!status || row.is_active === (status === "active")) && row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <><header className="tournament-page-heading"><div><p className="tournament-eyebrow">Gestión de torneos</p><h2>{status === "active" ? "Torneos activos" : status === "inactive" ? "Torneos inactivos" : "Todos los torneos"}</h2><p>Abre un torneo para gestionar sus equipos, alumnos y partidos.</p></div>{!readOnly && <button className="tournament-button primary" onClick={onCreate}><Plus size={17} />Crear torneo</button>}</header><div className="tournament-directory-filters tournament-surface"><TextInput label="Buscar torneo" value={query} placeholder="Nombre del torneo" onChange={event => { setQuery(event.target.value); setLimit(8); }} /><SelectInput label="Sede" value={site} onChange={event => { setSite(event.target.value); setLimit(8); }}><option value="">Todas las sedes</option>{data.sites.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</SelectInput><SelectInput label="Estado" value={status} onChange={event => { setStatus(event.target.value); setLimit(8); }}><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="">Todos</option></SelectInput></div><p className="tournament-muted mb-4">{filtered.length} torneos encontrados</p><div className="tournament-directory-grid">{filtered.slice(0, limit).map(tournament => { const teams = data.teams.filter(row => row.tournament === tournament.id); const participants = adult ? data.players.filter(row => teams.some(team => team.id === row.team)) : data.studentTournamentRegistrations.filter(row => row.tournament === tournament.id && row.status === "registered"); const matches = data.matches.filter(row => row.tournament === tournament.id); return <article key={tournament.id} className="tournament-directory-card"><header><span className="tournament-trophy"><Trophy size={22} /></span><span className={`tournament-badge ${tournament.is_active ? "success" : "muted"}`}>{tournament.is_active ? "Activo" : "Inactivo"}</span></header><h3>{tournament.name}</h3><p>{data.sites.find(row => row.id === tournament.site)?.name || "Sede sin nombre"}</p><div className="tournament-card-metrics"><span><strong>{teams.length}</strong>Equipos</span><span><strong>{participants.length}</strong>{adult ? "Jugadores" : "Alumnos"}</span><span><strong>{matches.length}</strong>Partidos</span></div><footer><span>Inicio: {tournament.starts_on || "Por definir"}</span><div className="tournament-row-actions">{!readOnly && <button className="tournament-icon-button danger" aria-label={`Eliminar torneo ${tournament.name}`} title="Eliminar torneo" onClick={() => onDelete(tournament)}><Trash2 size={16} /></button>}<button className="tournament-text-button" aria-label={`Abrir torneo ${tournament.name}`} onClick={() => onOpen(tournament.id)}>Abrir torneo <ArrowRight size={16} /></button></div></footer></article>; })}</div>{!filtered.length && <div className="tournament-empty tournament-surface"><Trophy size={32} /><h3>{data.tournaments.length ? "Sin torneos con estos filtros" : "Crea tu primer torneo"}</h3><p>{data.tournaments.length ? "Prueba otra sede, nombre o estado." : "Comienza con el nombre y la sede. Después agrega equipos y alumnos."}</p></div>}{filtered.length > limit && <div className="tournament-actions centered"><button className="tournament-button secondary" onClick={() => setLimit(value => value + 8)}>Ver más torneos ({filtered.length - limit} restantes)</button></div>}</>;
}
