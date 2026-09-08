import { useState } from "react";
import type { AppData } from "../../types";
import { SportsCompetition } from "./sportsCompetition";
import { SportsMonthlyExams } from "./sportsMonthlyExams";
import "./sports.css";

export function SportsPanel({ data, canEditMatches, canEditAssessments, onUpdateMatch, onSaveAssessment }: {
  data: AppData; canEditMatches: boolean; canEditAssessments: boolean;
  onUpdateMatch: (matchId: number, payload: unknown) => Promise<void>;
  onSaveAssessment: (payload: unknown) => Promise<void>;
}) {
  const [localSection, setLocalSection] = useState<"exams" | "matches">("exams");
  const showExams = canEditAssessments || data.students.length > 0;
  const activeSection = (showExams ? localSection : "matches");
  return <section className="sports-panel">
    {showExams && <nav className="sports-inline-nav" aria-label="Rendimiento y torneos"><button aria-pressed={activeSection === "exams"} onClick={() => setLocalSection("exams")}>Evaluación mensual</button><button aria-pressed={activeSection === "matches"} onClick={() => setLocalSection("matches")}>Torneos</button></nav>}
    {activeSection === "exams" ? <SportsMonthlyExams data={data} canEdit={canEditAssessments} onSaveAssessment={onSaveAssessment} /> : <SportsCompetition data={data} canEdit={canEditMatches} onUpdateMatch={onUpdateMatch} />}
  </section>;
}

export function PerformancePanel({ data, canEdit, onSaveAssessment }: {
  data: AppData; canEdit: boolean; onSaveAssessment: (payload: unknown) => Promise<void>;
}) {
  return <section className="sports-panel" data-testid="performance-panel"><SportsMonthlyExams data={data} canEdit={canEdit} onSaveAssessment={onSaveAssessment} /></section>;
}
