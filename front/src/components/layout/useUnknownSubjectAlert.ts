import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../api";
import type { UnknownAttendanceStatus, UnknownSubject } from "../../features/unknown-attendance";

function needsRegistration(subject: UnknownSubject) {
  return !subject.matched_player_id && !subject.matched_student_id && !subject.metadata?.accepted_at;
}

export function useUnknownSubjectAlert(token: string) {
  const [subjects, setSubjects] = useState<UnknownSubject[]>([]);

  const pendingSubjects = useMemo(() => subjects.filter(needsRegistration), [subjects]);
  const primarySubject = pendingSubjects[0] ?? null;

  useEffect(() => {
    let disposed = false;

    async function loadUnknownSubjects() {
      try {
        const status = await apiRequest<UnknownAttendanceStatus>("/unknown-attendance/status/?pending_limit=0&recent_limit=0&subject_limit=25&report_limit=0", token);
        if (!disposed) setSubjects(status.subjects);
      } catch {
        if (!disposed) setSubjects([]);
      }
    }

    void loadUnknownSubjects();
    const timer = window.setInterval(loadUnknownSubjects, 60000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [token]);

  return {
    pendingSubjects,
    primarySubject,
    count: pendingSubjects.length,
  };
}
