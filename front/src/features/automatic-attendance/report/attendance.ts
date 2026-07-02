import type { AppData, AttendanceSession } from "../../../types";
import { similarityPercent } from "../format";
import { comparisonCameraText, comparisonTimeText } from "./timing";
import type { AttendanceDetailEntry, AutomaticGroupDetailCounts, AutomaticRosterPerson, AutomaticSessionDetailCounts, AutomaticSessionResult, AutomaticSessionSummary, FaceComparison } from "./types";

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
  const markedDetail = (marked: FaceComparison) => {
    const timeText = comparisonTimeText(marked, sessionResult);
    const cameraText = comparisonCameraText(marked, sessionResult);
    return `Reconocido por video - similitud ${similarityPercent(marked.similarity)} - hits ${marked.hits ?? 1}${cameraText ? ` - ${cameraText}` : ""}${timeText ? ` - ${timeText}` : ""}`;
  };
  const comparisonReason = (comparison: FaceComparison) => {
    const parts = [];
    if (comparison.reason) parts.push(`motivo: ${comparison.reason}`);
    if (comparison.margin != null) parts.push(`margen ${similarityPercent(comparison.margin)}`);
    return parts.join(" - ");
  };
  const addConfirmed = (id: number, fallback: string, detail: string, evidenceUrl?: string) => {
    if (confirmedIds.has(id)) {
      const existing = confirmed.find((item) => item.name === personName(id, fallback));
      if (existing && detail.includes("hora ")) {
        existing.detail = detail;
        existing.evidenceUrl = evidenceUrl ?? existing.evidenceUrl;
      }
      return;
    }
    confirmedIds.add(id);
    confirmed.push({ name: personName(id, fallback), detail, evidenceUrl });
  };

  if (isAdultSession) {
    data.playerAttendanceRecords
      .filter((record) => record.session === sessionResult.session.id && record.status === "present" && record.player)
      .forEach((record) => {
        const playerId = Number(record.player);
        const marked = markedByStudent.get(playerId);
        addConfirmed(playerId, record.player_name ?? `Jugador ${playerId}`, marked ? markedDetail(marked) : "Marcado en la sesion", marked?.evidence_url);
      });
  } else {
    data.attendanceRecords
      .filter((record) => record.session === sessionResult.session.id && record.status === "present" && record.student)
      .forEach((record) => {
        const studentId = Number(record.student);
        const marked = markedByStudent.get(studentId);
        addConfirmed(studentId, record.student_name ?? `Alumno ${studentId}`, marked ? markedDetail(marked) : "Marcado en la sesion", marked?.evidence_url);
      });
  }

  sessionResult.marked.forEach((marked) => {
    addConfirmed(marked.student_id, marked.student_name, markedDetail(marked), marked.evidence_url);
  });
  (sessionResult.review ?? []).forEach((comparison) => {
    if (!confirmedIds.has(comparison.student_id)) {
      const timeText = comparisonTimeText(comparison, sessionResult);
      const reasonText = comparisonReason(comparison);
      const cameraText = comparisonCameraText(comparison, sessionResult);
      insufficient.push({
        name: personName(comparison.student_id, comparison.student_name),
        detail: `Evidencia insuficiente - similitud ${similarityPercent(comparison.similarity)} - hits ${comparison.hits ?? 1}${reasonText ? ` - ${reasonText}` : ""}${cameraText ? ` - ${cameraText}` : ""}${timeText ? ` - ${timeText}` : ""}`,
        evidenceUrl: comparison.evidence_url,
      });
    }
  });
  (sessionResult.off_roster ?? []).forEach((comparison) => {
    const timeText = comparisonTimeText(comparison, sessionResult);
    const cameraText = comparisonCameraText(comparison, sessionResult);
    const expectedRoster = sessionResult.session.team_name || sessionResult.session.group_name || `Sesion ${sessionResult.session.id}`;
    const registeredTeam = comparison.team_name || "sin equipo registrado en el sistema";
    offRoster.push({
      name: comparison.student_name,
      detail: [
        "Detectado por video fuera del roster esperado",
        `esperado: ${expectedRoster}`,
        `registrado en: ${registeredTeam}`,
        comparison.person_type === "player" ? "jugador adulto" : "alumno",
        `similitud ${similarityPercent(comparison.similarity)}`,
        comparison.margin != null ? `margen ${similarityPercent(comparison.margin)}` : "",
        `hits ${comparison.hits ?? 1}`,
        cameraText,
        timeText,
      ].filter(Boolean).join(" - "),
      evidenceUrl: comparison.evidence_url,
    });
  });
  (sessionResult.unknown_faces ?? []).forEach((face) => {
    const timeText = comparisonTimeText(face, sessionResult);
    const cameraText = comparisonCameraText(face, sessionResult);
    insufficient.push({
      name: `Rostro no identificado ${face.unknown_id}`,
      detail: `Sin coincidencia suficiente - frame ${face.frame ?? "-"} - similitud max ${similarityPercent(face.similarity)}${cameraText ? ` - ${cameraText}` : ""}${timeText ? ` - ${timeText}` : ""}`,
      evidenceUrl: face.evidence_url,
    });
  });
  return {
    confirmed: confirmed.sort((a, b) => a.name.localeCompare(b.name)),
    offRoster: offRoster.sort((a, b) => a.name.localeCompare(b.name)),
    insufficient: insufficient.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function normalizeEntryKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeMatchLevelDetail(detail: string) {
  return detail.replace(/esperado: [^-]+ - /, "esperado: roster del partido - ");
}

function mergeMatchLevelEntries(items: AttendanceDetailEntry[]) {
  const merged = new Map<string, AttendanceDetailEntry>();
  items.forEach((item) => {
    const isUnknown = item.name.toLowerCase().startsWith("rostro no identificado");
    const key = item.evidenceUrl || (isUnknown ? item.detail : item.name);
    const normalizedKey = normalizeEntryKey(key);
    const current = merged.get(normalizedKey);
    if (!current) {
      merged.set(normalizedKey, { ...item, detail: normalizeMatchLevelDetail(item.detail) });
      return;
    }
    const currentHits = Number(current.detail.match(/hits\s+(\d+)/i)?.[1] ?? 0);
    const nextHits = Number(item.detail.match(/hits\s+(\d+)/i)?.[1] ?? 0);
    if (nextHits > currentHits) {
      merged.set(normalizedKey, { ...item, detail: normalizeMatchLevelDetail(item.detail) });
    }
  });
  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function attendanceGroupDetailEntries(data: AppData, results: AutomaticSessionResult[]) {
  const details = results.map((result) => attendanceDetailEntries(data, result));
  return {
    confirmedBySession: details.map((detail, index) => ({ sessionId: results[index]?.session.id, confirmed: detail.confirmed })),
    offRoster: mergeMatchLevelEntries(details.flatMap((detail) => detail.offRoster)),
    insufficient: mergeMatchLevelEntries(details.flatMap((detail) => detail.insufficient)),
  };
}

export function detailCountsForSession(data: AppData, sessionResult: AutomaticSessionResult): AutomaticSessionDetailCounts {
  const detail = attendanceDetailEntries(data, sessionResult);
  return {
    sessionId: sessionResult.session.id,
    label: sessionResult.session.team_name ?? sessionResult.session.group_name ?? `Sesion ${sessionResult.session.id}`,
    confirmed: detail.confirmed.length,
    offRoster: detail.offRoster.length,
    insufficient: detail.insufficient.length,
  };
}

export function detailCountsForGroup(data: AppData, results: AutomaticSessionResult[]): AutomaticGroupDetailCounts {
  const sessions = results.map((result) => detailCountsForSession(data, result));
  const groupDetail = attendanceGroupDetailEntries(data, results);
  return {
    confirmed: sessions.reduce((sum, item) => sum + item.confirmed, 0),
    offRoster: groupDetail.offRoster.length,
    insufficient: groupDetail.insufficient.length,
    sessions,
  };
}
