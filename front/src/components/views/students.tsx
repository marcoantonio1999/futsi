import type { StudentDeletionConfirmation, StudentDeletionResult } from "../../types";
import React, { useEffect, useMemo, useState } from "react";
import { statusLabels } from "../../appState";
import type { AppData, Guardian, Student } from "../../types";
import { SelectInput, TextInput } from "./shared";
import { StudentCard } from "./studentCard";
import type { StudentsSubsection } from "../layout/adminShellModel";

import { StudentEnrollment } from "./studentEnrollment";
import { StudentEditor } from "./studentEditor";
import { StudentOverview, emptyStudentFilters } from "./studentOverview";
import { StudentDeleteDialog } from "./studentDeleteDialog";

export function StudentsPanel({
  data,
  section = "overview",
  editingId, onEdit, onSelectSection, onDelete,
  onCreate,
  onCreateGuardian,
  token,
  onUpdate,
}: {
  data: AppData;
  editingId: number | null;
  onEdit: (id: number) => void;
  onSelectSection: (section: StudentsSubsection) => void;
  onDelete: (id: number, confirmation: StudentDeletionConfirmation) => Promise<StudentDeletionResult>;
  section?: StudentsSubsection;
  token: string;
  onCreate: (payload: FormData) => Promise<Student>;
  onCreateGuardian: (payload: unknown) => Promise<Guardian>;
  onUpdate: (studentId: number, payload: unknown) => Promise<boolean>;
}) {
  const editingStudent = data.students.find(student => student.id === editingId);
  const [filters, setFilters] = useState(emptyStudentFilters);
  const [studentPage, setStudentPage] = useState(0);
  const [deletingStudent, setDeletingStudent] = useState<Student | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => { setDeletingStudent(null); setNotice(""); }, [section]);

  const groups = useMemo(() => {
    return Array.from(new Set(data.students.map((student) => student.group_name).filter(Boolean))).sort();
  }, [data.students]);

  const filteredStudents = useMemo(() => {
    return data.students.filter((student) => {
      const text = `${student.full_name} ${student.guardian_name ?? ""} ${student.group_name} ${student.category}`.toLowerCase();
      const queryMatches = !filters.query || text.includes(filters.query.toLowerCase());
      const siteMatches = !filters.site || student.site === Number(filters.site);
      const groupMatches = !filters.group || student.group_name === filters.group;
      const statusMatches = !filters.status || student.status === filters.status;
      const uniformMatches = !filters.uniform || student.uniform_status === filters.uniform;
      const waiverMatches = !filters.waiver || (filters.waiver === "yes" ? Boolean(student.waiver_url) : !student.waiver_url);
      const paymentMatches =
        !filters.payment ||
        (filters.payment === "pending" ? student.open_charge_count > 0 : student.open_charge_count === 0);
      const medicalMatches =
        !filters.medical ||
        (filters.medical === "yes" ? Boolean(student.medical_notes) : !student.medical_notes);
      return queryMatches && siteMatches && groupMatches && statusMatches && uniformMatches && waiverMatches && paymentMatches && medicalMatches;
    });
  }, [data.students, filters]);
  const studentsPerPage = 8;
  const studentPageCount = Math.max(1, Math.ceil(filteredStudents.length / studentsPerPage));
  const visibleStudents = filteredStudents.slice(studentPage * studentsPerPage, (studentPage + 1) * studentsPerPage);

  useEffect(() => {
    setStudentPage(0);
  }, [filters]);

  useEffect(() => {
    if (studentPage >= studentPageCount) setStudentPage(studentPageCount - 1);
  }, [studentPage, studentPageCount]);

  function clearFilters() { setFilters(emptyStudentFilters); }

  if (section === "edit") return editingStudent
    ? <StudentEditor key={editingStudent.id} student={editingStudent} data={data} token={token} onUpdate={onUpdate} onBack={() => onSelectSection("registered")} />
    : <div className="student-enrollment student-section"><h2>Alumno no disponible</h2><button className="student-button secondary mt-4" onClick={() => onSelectSection("registered")}>Volver a gestionar alumnos</button></div>;

  return (
    <>
      {section === "overview" && <StudentOverview data={data} onCreate={() => onSelectSection("create")} onManage={next => { setFilters({ ...emptyStudentFilters, ...next }); onSelectSection("registered"); }} />}
      {section === "create" && <StudentEnrollment data={data} onCreate={onCreate} onCreateGuardian={onCreateGuardian} />}
      {section === "registered" && (
      <section className="rounded-md border border-zinc-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-zinc-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold">Gestionar alumnos</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {filteredStudents.length} de {data.students.length} alumnos filtrados · mostrando {visibleStudents.length} por pagina
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={studentPage === 0}
              onClick={() => setStudentPage((page) => Math.max(0, page - 1))}
              type="button"
              aria-label="Alumnos anteriores"
            >
              ‹
            </button>
            <span className="min-w-16 text-center text-sm font-semibold text-zinc-700">
              {studentPage + 1}/{studentPageCount}
            </span>
            <button
              className="grid size-9 place-items-center rounded-md border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={studentPage >= studentPageCount - 1}
              onClick={() => setStudentPage((page) => Math.min(studentPageCount - 1, page + 1))}
              type="button"
              aria-label="Mas alumnos"
            >
              ›
            </button>
            <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium" onClick={clearFilters} type="button">
              Limpiar filtros
            </button>
          </div>
        </div>
        {notice && <p role="status" className="m-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          <TextInput label="Buscar" placeholder="Alumno, tutor, grupo" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} />
          <SelectInput label="Sede" value={filters.site} onChange={(e) => setFilters({ ...filters, site: e.target.value })}>
            <option value="">Todas</option>
            {data.sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </SelectInput>
          <SelectInput label="Grupo" value={filters.group} onChange={(e) => setFilters({ ...filters, group: e.target.value })}>
            <option value="">Todos</option>
            {groups.map((group) => (
              <option key={group} value={group}>{group}</option>
            ))}
          </SelectInput>
          <SelectInput label="Estado" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Todos</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SelectInput>
          <SelectInput label="Uniforme" value={filters.uniform} onChange={(e) => setFilters({ ...filters, uniform: e.target.value })}>
            <option value="">Todos</option>
            <option value="pending">Pendiente</option>
            <option value="paid">Pagado</option>
            <option value="delivered">Entregado</option>
          </SelectInput>
          <SelectInput label="Responsiva" value={filters.waiver} onChange={(e) => setFilters({ ...filters, waiver: e.target.value })}>
            <option value="">Todas</option>
            <option value="yes">Registrada</option>
            <option value="no">Pendiente</option>
          </SelectInput>
          <SelectInput label="Cobranza" value={filters.payment} onChange={(e) => setFilters({ ...filters, payment: e.target.value })}>
            <option value="">Todos</option>
            <option value="pending">Con pago pendiente</option>
            <option value="clear">Sin pago pendiente</option>
          </SelectInput>
          <SelectInput label="Info medica" value={filters.medical} onChange={(e) => setFilters({ ...filters, medical: e.target.value })}>
            <option value="">Todos</option>
            <option value="yes">Con nota medica</option>
            <option value="no">Sin nota medica</option>
          </SelectInput>
        </div>
        <div className="grid gap-3 border-t border-zinc-200 p-4 xl:grid-cols-2">
          {visibleStudents.map((student) => (
            <StudentCard key={student.id} student={student} token={token} onEdit={student => onEdit(student.id)} onDelete={setDeletingStudent} />
          ))}
          {filteredStudents.length === 0 && <p className="px-4 py-8 text-sm text-zinc-500">No hay alumnos con estos filtros.</p>}
        </div>
      </section>
      )}
      {section === "registered" && deletingStudent && <StudentDeleteDialog token={token} student={deletingStudent} onClose={() => setDeletingStudent(null)} onDelete={async (id, confirmation) => { const result = await onDelete(id, confirmation); setNotice("Alumno e historial eliminados."); return result; }} />}
    </>
  );
}
