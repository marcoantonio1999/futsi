import type { AttendanceSession } from "../../../types";
import { automaticSessionSummary } from "./attendance";
import type { AutomaticReportGroup, AutomaticSessionResult, ReportType } from "./types";

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
