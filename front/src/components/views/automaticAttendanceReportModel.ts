import type { AppData, AttendanceSession } from "../../types";
import { similarityPercent } from "./automaticAttendanceFormat";

export type ReportType = AttendanceSession["session_type"] | "all";

export type AutomaticSessionSummary = {
  id: number;
  site: number;
  site_name: string;
  date: string;
  starts_at: string | null;
  ends_at: string | null;
  duration_minutes: number;
  group_name: string;
  session_type?: string;
  match?: number | null;
  match_name?: string;
  team?: number | null;
  team_name?: string;
  tournament?: number | null;
  tournament_name?: string;
};

type UnknownFace = {
  unknown_id: number;
  hits?: number;
  similarity: number;
  frame?: number;
  evidence_url?: string;
  evidence_path?: string;
};

export type FaceComparison = {
  student_id: number;
  student_name: string;
  person_id?: number;
  person_type?: "student" | "player" | string;
  person_key?: string;
  team_id?: number | null;
  team_name?: string;
  is_expected_roster?: boolean;
  hits?: number;
  similarity: number;
  margin?: number;
  frame?: number;
  reason?: string;
  evidence_url?: string;
  evidence_path?: string;
  manual_confirmed?: boolean;
  candidates?: Array<{
    student_id: number;
    student_name: string;
    person_id?: number;
    person_type?: "student" | "player" | string;
    person_key?: string;
    team_id?: number | null;
    team_name?: string;
    is_expected_roster?: boolean;
    similarity: number;
  }>;
};

export type AutomaticSessionResult = {
  session: AutomaticSessionSummary;
  marked: FaceComparison[];
  review?: FaceComparison[];
  off_roster?: FaceComparison[];
  unknown_faces?: UnknownFace[];
  sampled_frames?: number;
  total_frames?: number;
  duration_seconds?: number | null;
  window?: string;
  probed_seconds?: number;
  active_seconds?: number;
  skipped_seconds?: number;
  face_groups?: number;
  rejected_quality_faces?: number;
  clustered_pipeline?: boolean;
  detail?: string;
  failed?: boolean;
  skipped?: string[];
  thresholds?: {
    similarity: number;
    margin: number;
    min_hits: number;
    review_similarity: number;
    duplicate_guard: number;
    second_probe?: boolean;
    dense_frame_stride?: number;
  };
};

export type AutomaticReportGroup = {
  id: string;
  primary: AttendanceSession;
  sessions: AttendanceSession[];
};

export type AttendanceDetailEntry = {
  name: string;
  detail: string;
  evidenceUrl?: string;
};

type AutomaticRosterPerson = {
  id: number;
  full_name: string;
  kind: "student" | "player";
  team?: number | null;
};

export function sessionTitle(session: Pick<AttendanceSession, "session_type" | "match" | "match_name" | "team_name" | "group_name">, data?: AppData) {
  if (session.session_type === "tournament_match") {
    const match = session.match ? data?.matches.find((item) => item.id === session.match) : undefined;
    if (match?.home_team_name && match.away_team_name) return `${match.home_team_name} vs ${match.away_team_name}`;
    if (session.match_name) return session.match_name;
    if (session.team_name) return `${session.team_name} vs rival por definir`;
    return "Partido sin equipos definidos";
  }
  return `Entrenamiento: ${session.group_name || session.team_name || "Grupo general"}`;
}

export function automaticSessionSummary(session: AttendanceSession): AutomaticSessionSummary {
  return {
    id: session.id,
    site: session.site,
    site_name: session.site_name ?? "Sede",
    date: session.date,
    starts_at: session.starts_at,
    ends_at: session.ends_at,
    duration_minutes: session.duration_minutes || 120,
    group_name: session.group_name,
    session_type: session.session_type,
    match: session.match,
    match_name: session.match_name,
    team: session.team,
    team_name: session.team_name,
    tournament: session.tournament,
    tournament_name: session.tournament_name,
  };
}

function rosterForAutomaticSession(data: AppData, session: AutomaticSessionSummary): AutomaticRosterPerson[] {
  if (session.session_type === "tournament_match" && session.tournament) {
    const match = session.match ? data.matches.find((item) => item.id === session.match) : undefined;
    const teamIds = session.team ? [session.team] : match ? [match.home_team, match.away_team].filter((teamId): teamId is number => Boolean(teamId)) : [];
    const registeredIds = new Set(
      data.studentTournamentRegistrations
        .filter((registration) => registration.status === "registered" && teamIds.includes(Number(registration.team)) && registration.tournament === session.tournament)
        .map((registration) => registration.student),
    );
    if (registeredIds.size) {
      return data.students.filter((student) => registeredIds.has(student.id)).map((student) => ({ id: student.id, full_name: student.full_name, kind: "student" }));
    }
    return data.players
      .filter((player) => teamIds.includes(Number(player.team)) && player.is_active)
      .map((player) => ({ id: player.id, full_name: player.full_name, kind: "player", team: player.team }));
  }
  return data.students
    .filter((student) => student.site === session.site && (!session.group_name || student.group_name === session.group_name))
    .map((student) => ({ id: student.id, full_name: student.full_name, kind: "student" }));
}

export function attendanceSummary(data: AppData, sessionResult: AutomaticSessionResult) {
  const roster = rosterForAutomaticSession(data, sessionResult.session);
  const rosterIds = new Set(roster.map((person) => person.id));
  const isAdultSession = roster.some((person) => person.kind === "player");
  const presentIds = new Set<number>();

  if (isAdultSession) {
    data.playerAttendanceRecords
      .filter((record) => record.session === sessionResult.session.id && record.status === "present" && record.player)
      .forEach((record) => presentIds.add(Number(record.player)));
  } else {
    data.attendanceRecords
      .filter((record) => record.session === sessionResult.session.id && record.status === "present" && record.student)
      .forEach((record) => presentIds.add(Number(record.student)));
  }

  sessionResult.marked.forEach((comparison) => presentIds.add(comparison.student_id));
  return {
    label: sessionResult.session.team_name ?? sessionResult.session.group_name ?? `Sesion ${sessionResult.session.id}`,
    present: rosterIds.size ? Array.from(presentIds).filter((id) => rosterIds.has(id)).length : presentIds.size,
    total: roster.length,
  };
}

export function attendanceDetailEntries(data: AppData, sessionResult: AutomaticSessionResult) {
  const roster = rosterForAutomaticSession(data, sessionResult.session);
  const peopleById = new Map(roster.map((person) => [person.id, person]));
  const studentsById = new Map(data.students.map((student) => [student.id, student]));
  const isAdultSession = roster.some((person) => person.kind === "player");
  const markedByStudent = new Map(sessionResult.marked.map((comparison) => [comparison.student_id, comparison]));
  const confirmedIds = new Set<number>();
  const confirmed: AttendanceDetailEntry[] = [];
  const offRoster: AttendanceDetailEntry[] = [];
  const insufficient: AttendanceDetailEntry[] = [];

  const personName = (id: number, fallback: string) => peopleById.get(id)?.full_name ?? (!isAdultSession ? studentsById.get(id)?.full_name : undefined) ?? fallback;
  const addConfirmed = (id: number, fallback: string, detail: string, evidenceUrl?: string) => {
    if (confirmedIds.has(id)) return;
    confirmedIds.add(id);
    confirmed.push({ name: personName(id, fallback), detail, evidenceUrl });
  };

  if (isAdultSession) {
    data.playerAttendanceRecords
      .filter((record) => record.session === sessionResult.session.id && record.status === "present" && record.player)
      .forEach((record) => {
        const playerId = Number(record.player);
        const marked = markedByStudent.get(playerId);
        addConfirmed(playerId, record.player_name ?? `Jugador ${playerId}`, marked ? `Reconocido por video - similitud ${similarityPercent(marked.similarity)}` : "Marcado en la sesion", marked?.evidence_url);
      });
  } else {
    data.attendanceRecords
      .filter((record) => record.session === sessionResult.session.id && record.status === "present" && record.student)
      .forEach((record) => {
        const studentId = Number(record.student);
        const marked = markedByStudent.get(studentId);
        addConfirmed(studentId, record.student_name ?? `Alumno ${studentId}`, marked ? `Reconocido por video - similitud ${similarityPercent(marked.similarity)}` : "Marcado en la sesion", marked?.evidence_url);
      });
  }

  sessionResult.marked.forEach((marked) => {
    addConfirmed(marked.student_id, marked.student_name, `Reconocido por video - similitud ${similarityPercent(marked.similarity)} - hits ${marked.hits ?? 1}`, marked.evidence_url);
  });
  (sessionResult.review ?? []).forEach((comparison) => {
    if (!confirmedIds.has(comparison.student_id)) {
      insufficient.push({
        name: personName(comparison.student_id, comparison.student_name),
        detail: `Evidencia insuficiente - similitud ${similarityPercent(comparison.similarity)} - hits ${comparison.hits ?? 1}`,
        evidenceUrl: comparison.evidence_url,
      });
    }
  });
  (sessionResult.off_roster ?? []).forEach((comparison) => {
    offRoster.push({
      name: comparison.student_name,
      detail: [
        "Detectado por video fuera del roster esperado",
        comparison.team_name ? `equipo ${comparison.team_name}` : "",
        comparison.person_type === "player" ? "jugador adulto" : "alumno",
        `similitud ${similarityPercent(comparison.similarity)}`,
        `hits ${comparison.hits ?? 1}`,
      ].filter(Boolean).join(" - "),
      evidenceUrl: comparison.evidence_url,
    });
  });
  (sessionResult.unknown_faces ?? []).forEach((face) => {
    insufficient.push({
      name: `Rostro no identificado ${face.unknown_id}`,
      detail: `Sin coincidencia suficiente - frame ${face.frame ?? "-"} - similitud max ${similarityPercent(face.similarity)}`,
      evidenceUrl: face.evidence_url,
    });
  });
  return {
    confirmed: confirmed.sort((a, b) => a.name.localeCompare(b.name)),
    offRoster: offRoster.sort((a, b) => a.name.localeCompare(b.name)),
    insufficient: insufficient.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function buildReportGroups(sessions: AttendanceSession[], reportType: ReportType, reportDate: string, reportSearch: string) {
  const normalizedSearch = reportSearch.trim().toLowerCase();
  const groupsByKey = new Map<string, AutomaticReportGroup>();
  sessions
    .filter((session) => reportType === "all" || session.session_type === reportType)
    .filter((session) => !reportDate || session.date === reportDate)
    .forEach((session) => {
      const groupId = session.session_type === "tournament_match" && session.match ? `match-${session.match}` : `session-${session.id}`;
      const current = groupsByKey.get(groupId);
      if (current) {
        current.sessions.push(session);
        current.primary = current.sessions.slice().sort((a, b) => `${a.date} ${a.starts_at ?? ""} ${a.id}`.localeCompare(`${b.date} ${b.starts_at ?? ""} ${b.id}`))[0];
      } else {
        groupsByKey.set(groupId, { id: groupId, primary: session, sessions: [session] });
      }
    });
  return Array.from(groupsByKey.values())
    .filter((group) => {
      if (!normalizedSearch) return true;
      return group.sessions.some((session) =>
        [session.date, session.starts_at ?? "", session.site_name ?? "", session.group_name ?? "", session.team_name ?? "", session.tournament_name ?? "", session.match_name ?? ""].some((value) =>
          String(value).toLowerCase().includes(normalizedSearch),
        ),
      );
    })
    .sort((a, b) => `${b.primary.date} ${b.primary.starts_at ?? ""}`.localeCompare(`${a.primary.date} ${a.primary.starts_at ?? ""}`));
}

export function resultForSession(session: AttendanceSession, resultsBySession: Map<number, { result: AutomaticSessionResult; video: string; jobId: string }>) {
  return resultsBySession.get(session.id)?.result ?? {
    session: automaticSessionSummary(session),
    marked: [],
    review: [],
    off_roster: [],
    unknown_faces: [],
  };
}
