import { useState } from "react";
import type { AppData } from "../../types";
import type { SportsSubsection } from "../layout/adminShellModel";
import { SportsCompetition } from "./sportsCompetition";
import { SportsMonthlyExams } from "./sportsMonthlyExams";
import "./sports.css";

export function SportsPanel({ data, section, canEditMatches, canEditAssessments, onUpdateMatch, onSaveAssessment }: {
  data: AppData; section?: SportsSubsection; canEditMatches: boolean; canEditAssessments: boolean;
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
  onSaveAssessment: (payload: unknown) => Promise<void>;
}) {
  const [localSection, setLocalSection] = useState<SportsSubsection>("exams");
  const showExams = Boolean(section) || canEditAssessments || data.students.length > 0;
  const activeSection = section ?? (showExams ? localSection : "matches");
  return <section className="sports-panel">
    {!section && showExams && <nav className="sports-inline-nav" aria-label="Subsecciones de Deportivo"><button aria-pressed={activeSection === "exams"} onClick={() => setLocalSection("exams")}>Examen mensual</button><button aria-pressed={activeSection === "matches"} onClick={() => setLocalSection("matches")}>Marcadores y posiciones</button></nav>}
    {activeSection === "exams" ? <SportsMonthlyExams data={data} canEdit={canEditAssessments} onSaveAssessment={onSaveAssessment} /> : <SportsCompetition data={data} canEdit={canEditMatches} onUpdateMatch={onUpdateMatch} />}
  </section>;
}
