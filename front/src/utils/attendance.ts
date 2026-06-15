import type { AppData, AttendanceSession, Match, Student } from "../types";

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function minutesFromTime(value?: string | null) {
  if (!value) return null;
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function currentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

export function isInAttendanceWindow(date: string, startsAt?: string | null) {
  if (date !== todayKey()) return false;
  const starts = minutesFromTime(startsAt);
  if (starts === null) return true;
  const current = currentMinutes();
  return current >= starts - 60 && current <= starts + 60;
}

export function canMarkSession(session: AttendanceSession) {
  if (session.closed_at) return false;
  if (typeof session.can_mark_attendance === "boolean") return session.can_mark_attendance;
  return isInAttendanceWindow(session.date, session.starts_at);
}

export function sessionWindowText(session: AttendanceSession) {
  if (session.attendance_window) return session.attendance_window;
  const starts = minutesFromTime(session.starts_at);
  if (starts === null) return "Disponible solo hoy";
  const start = Math.max(0, starts - 60);
  const end = Math.min(1439, starts + 60);
  const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return `${format(start)} a ${format(end)}`;
}

export function matchIsCurrent(match: Match) {
  return match.played_on === todayKey() && match.status !== "finished" && match.status !== "canceled" && isInAttendanceWindow(match.played_on, match.starts_at);
}

export function findCurrentSession(sessions: AttendanceSession[], siteId?: number | null, teamId?: number | null) {
  return sessions.find((session) => {
    if (!canMarkSession(session)) return false;
    if (siteId && session.site !== siteId) return false;
    if (teamId && session.team !== teamId) return false;
    return true;
  }) ?? null;
}

export function findCurrentMatch(matches: Match[], siteId?: number | null, teamId?: number | null) {
  return matches.find((match) => {
    if (!matchIsCurrent(match)) return false;
    if (siteId && match.site !== siteId) return false;
    if (teamId && match.home_team !== teamId && match.away_team !== teamId) return false;
    return true;
  }) ?? null;
}

export function studentsForAttendanceSession(data: AppData, session: AttendanceSession | null, fallbackSiteId?: string, fallbackGroupName?: string) {
  if (!session) {
    return data.students.filter((student) => {
      const siteMatches = !fallbackSiteId || student.site === Number(fallbackSiteId);
      const groupMatches = !fallbackGroupName || student.group_name === fallbackGroupName;
      return siteMatches && groupMatches && student.status !== "dropped";
    });
  }

  if (session.session_type === "tournament_match") {
    const match = session.match ? data.matches.find((item) => item.id === session.match) : null;
    const allowedTeamIds = new Set<number>();
    if (session.team) allowedTeamIds.add(session.team);
    if (match) {
      allowedTeamIds.add(match.home_team);
      allowedTeamIds.add(match.away_team);
    }
    const allowedStudentIds = new Set(
      data.studentTournamentRegistrations
        .filter((registration) => {
          if (registration.status !== "registered") return false;
          if (session.tournament && registration.tournament !== session.tournament) return false;
          if (allowedTeamIds.size > 0 && (!registration.team || !allowedTeamIds.has(registration.team))) return false;
          return true;
        })
        .map((registration) => registration.student),
    );
    return data.students.filter((student) => allowedStudentIds.has(student.id) && student.status !== "dropped");
  }

  return data.students.filter((student: Student) => {
    const siteMatches = student.site === session.site;
    const groupMatches = !session.group_name || student.group_name === session.group_name;
    return siteMatches && groupMatches && student.status !== "dropped";
  });
}
