import { FormEvent, useEffect, useMemo, useState } from "react";
import { Award, TrendingDown, Trophy } from "lucide-react";
import { Metric } from "../cards/Metric";
import type { AppData, Student, StudentValueAssessment } from "../../types";
import { Avatar, SelectInput, TableHeader, TextInput } from "./shared";

const valueFields = [
  { key: "respect", label: "Respeto", fontClass: "font-serif", accent: "border-emerald-200 bg-emerald-50 text-emerald-900", style: undefined },
  { key: "discipline", label: "Disciplina", fontClass: "font-mono", accent: "border-zinc-200 bg-zinc-50 text-zinc-900", style: undefined },
  { key: "teamwork", label: "Trabajo en equipo", fontClass: "font-sans", accent: "border-sky-200 bg-sky-50 text-sky-950", style: undefined },
  { key: "responsibility", label: "Responsabilidad", fontClass: "", accent: "border-amber-200 bg-amber-50 text-amber-950", style: { fontFamily: "Georgia, serif" } },
  { key: "sportsmanship", label: "Deportividad", fontClass: "", accent: "border-rose-200 bg-rose-50 text-rose-950", style: { fontFamily: "Trebuchet MS, Arial, sans-serif" } },
] as const;

type ValueFieldKey = (typeof valueFields)[number]["key"];

function monthStart() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
}

function valueRating(assessment: StudentValueAssessment | null) {
  if (!assessment) return 0;
  return Number(assessment.overall_values_rating || 0);
}

function recommendationForRating(rating: number) {
  if (rating >= 90) return "Prioridad alta de minutos";
  if (rating >= 80) return "Minutos constantes";
  if (rating >= 70) return "Rotacion controlada";
  if (rating >= 60) return "Minutos condicionados";
  return "Plan formativo antes de competir";
}

function latestByStudent(assessments: StudentValueAssessment[]) {
  const map = new Map<number, StudentValueAssessment>();
  [...assessments]
    .sort((a, b) => `${b.assessment_month}-${b.updated_at}`.localeCompare(`${a.assessment_month}-${a.updated_at}`))
    .forEach((assessment) => {
      if (!map.has(assessment.student)) map.set(assessment.student, assessment);
    });
  return map;
}

function LeaderboardRow({ student, assessment, index }: { student: Student; assessment: StudentValueAssessment | null; index: number }) {
  const rating = valueRating(assessment);
  const recommendation = assessment?.minutes_recommendation || recommendationForRating(rating);
  const tone = rating >= 85 ? "bg-emerald-50 text-emerald-800" : rating >= 70 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700";
  return (
    <tr className="border-b border-zinc-100 transition hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
      <td className="px-4 py-3">
        <span className={`inline-grid size-8 place-items-center rounded-full text-sm font-bold ${index === 0 ? "bg-emerald-700 text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"}`}>
          {index + 1}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar name={student.full_name} imageUrl={student.photo_url} />
          <div>
            <p className="font-semibold">{student.full_name}</p>
            <p className="text-xs text-zinc-500">{student.category} - {student.group_name} - {student.site_name}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-lg font-bold">{rating || "-"}</td>
      <td className="px-4 py-3">
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>{recommendation}</span>
      </td>
      <td className="px-4 py-3 text-sm text-zinc-500">{assessment?.notes || "Sin observaciones"}</td>
    </tr>
  );
}

export function ValuesPanel({ data, onSaveAssessment }: { data: AppData; onSaveAssessment: (payload: unknown) => Promise<void> }) {
  const valuesByStudent = useMemo(() => latestByStudent(data.studentValueAssessments), [data.studentValueAssessments]);
  const rankedStudents = useMemo(() => {
    return [...data.students].sort((a, b) => valueRating(valuesByStudent.get(b.id) ?? null) - valueRating(valuesByStudent.get(a.id) ?? null));
  }, [data.students, valuesByStudent]);
  const best = rankedStudents[0] ?? null;
  const lowest = [...rankedStudents].reverse().find((student) => valuesByStudent.has(student.id)) ?? null;
  const averageRating = data.studentValueAssessments.length
    ? Math.round(data.studentValueAssessments.reduce((sum, item) => sum + Number(item.overall_values_rating || 0), 0) / data.studentValueAssessments.length)
    : 0;

  return (
    <section className="grid min-w-0 gap-5 xl:grid-cols-[1fr_380px]">
      <div className="grid min-w-0 gap-5">
        <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-300">Valores formativos</p>
              <h2 className="text-xl font-semibold">Leaderboard de conducta y minutos</h2>
              <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-300">
                Evalua valores escolares mensualmente para decidir minutos con criterio visible: no solo talento, tambien convivencia, respeto y compromiso.
              </p>
            </div>
            <Award className="text-emerald-700" size={28} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Metric label="Evaluaciones de valores" value={data.studentValueAssessments.length} />
            <Metric label="Promedio valores" value={averageRating} />
            <Metric label="Alumnos evaluados" value={new Set(data.studentValueAssessments.map((item) => item.student)).size} />
          </div>
        </div>

        <div className="rounded-md border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <TableHeader title="Ranking por valores" count={rankedStudents.length} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
                <tr>
                  <th className="px-4 py-3">Pos</th>
                  <th className="px-4 py-3">Alumno</th>
                  <th className="px-4 py-3">Rating</th>
                  <th className="px-4 py-3">Minutos sugeridos</th>
                  <th className="px-4 py-3">Observaciones</th>
                </tr>
              </thead>
              <tbody>
                {rankedStudents.map((student, index) => (
                  <LeaderboardRow key={student.id} student={student} assessment={valuesByStudent.get(student.id) ?? null} index={index} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {best && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200"><Trophy size={16} /> Mejor perfil formativo</p>
              <p className="mt-2 text-xl font-bold">{best.full_name}</p>
              <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-200">{recommendationForRating(valueRating(valuesByStudent.get(best.id) ?? null))}</p>
            </div>
          )}
          {lowest && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200"><TrendingDown size={16} /> Requiere seguimiento</p>
              <p className="mt-2 text-xl font-bold">{lowest.full_name}</p>
              <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">{valuesByStudent.get(lowest.id)?.notes || "Sin observaciones"}</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid content-start gap-5">
        <ValueAssessmentForm students={data.students} assessments={data.studentValueAssessments} onSaveAssessment={onSaveAssessment} />
        <div className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="font-semibold">Valores evaluados</h3>
          <div className="mt-3 grid gap-2">
            {valueFields.map((field) => (
              <div key={field.key} className={`rounded-md border px-3 py-2 ${field.accent} dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100`}>
                <span className={`text-sm font-bold ${field.fontClass}`} style={field.style}>{field.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ValueAssessmentForm({ students, assessments, onSaveAssessment }: { students: Student[]; assessments: StudentValueAssessment[]; onSaveAssessment: (payload: unknown) => Promise<void> }) {
  const [studentId, setStudentId] = useState(() => String(students[0]?.id ?? ""));
  const current = assessments.find((item) => item.student === Number(studentId));
  const [form, setForm] = useState<Record<ValueFieldKey | "assessment_month" | "notes", string>>({
    assessment_month: current?.assessment_month || monthStart(),
    respect: String(current?.respect ?? 80),
    discipline: String(current?.discipline ?? 80),
    teamwork: String(current?.teamwork ?? 80),
    responsibility: String(current?.responsibility ?? 80),
    sportsmanship: String(current?.sportsmanship ?? 80),
    notes: current?.notes || "",
  });

  useEffect(() => {
    const next = assessments.find((item) => item.student === Number(studentId));
    setForm({
      assessment_month: next?.assessment_month || monthStart(),
      respect: String(next?.respect ?? 80),
      discipline: String(next?.discipline ?? 80),
      teamwork: String(next?.teamwork ?? 80),
      responsibility: String(next?.responsibility ?? 80),
      sportsmanship: String(next?.sportsmanship ?? 80),
      notes: next?.notes || "",
    });
  }, [studentId, assessments.length]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!studentId) return;
    await onSaveAssessment({
      student: Number(studentId),
      assessment_month: form.assessment_month,
      respect: Number(form.respect),
      discipline: Number(form.discipline),
      teamwork: Number(form.teamwork),
      responsibility: Number(form.responsibility),
      sportsmanship: Number(form.sportsmanship),
      notes: form.notes,
    });
  }

  return (
    <form onSubmit={submit} className="rounded-md border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <h3 className="font-semibold">Nuevo examen de valores</h3>
      <SelectInput className="mt-3" label="Alumno" value={studentId} onChange={(event) => setStudentId(event.target.value)} required>
        {students.map((student) => (
          <option key={student.id} value={student.id}>{student.full_name} - {student.group_name}</option>
        ))}
      </SelectInput>
      <TextInput className="mt-3" label="Mes" type="date" value={form.assessment_month} onChange={(event) => setForm({ ...form, assessment_month: event.target.value })} />
      <div className="mt-3 grid gap-3">
        {valueFields.map((field) => (
          <label key={field.key} className={`rounded-md border p-3 ${field.accent} dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100`}>
            <div className="flex items-center justify-between gap-3">
              <span className={`text-sm font-bold ${field.fontClass}`} style={field.style}>{field.label}</span>
              <span className="text-sm font-semibold">{form[field.key]}</span>
            </div>
            <input
              className="mt-3 w-full accent-emerald-700"
              type="range"
              min="0"
              max="100"
              value={form[field.key]}
              onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="mt-3 block text-sm font-medium">
        Observaciones
        <textarea
          className="mt-2 min-h-20 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 outline-none focus:border-emerald-700 dark:border-zinc-700 dark:bg-zinc-950"
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
      </label>
      <button className="mt-4 w-full rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white dark:bg-emerald-700" type="submit">
        Guardar examen de valores
      </button>
    </form>
  );
}
