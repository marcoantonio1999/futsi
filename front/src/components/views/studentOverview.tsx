import { useState } from "react";
import { ArrowRight, ClipboardCheck, CreditCard, Plus, Shirt, UsersRound } from "lucide-react";
import type { AppData, Student } from "../../types";
import { SelectInput } from "./shared";
import { statusLabels } from "../../appState";
import { money } from "../../utils/format";

export type StudentFilters = { query: string; site: string; group: string; status: string; uniform: string; waiver: string; payment: string; medical: string };
export const emptyStudentFilters: StudentFilters = { query: "", site: "", group: "", status: "", uniform: "", waiver: "", payment: "", medical: "" };

export function StudentOverview({ data, onManage, onCreate }: {
  data: AppData; onManage: (filters: Partial<StudentFilters>) => void; onCreate: () => void;
}) {
  const [site, setSite] = useState("");
  const students = data.students.filter(student => !site || student.site === Number(site));
  const active = students.filter(student => student.status === "active").length;
  const trial = students.filter(student => student.status === "trial").length;
  const debt = students.filter(student => student.open_charge_count > 0);
  const statuses: Student["status"][] = ["active", "trial", "paused", "injured", "dropped"];
  const pending = [
    { label: "Con pago pendiente", detail: `$${money(debt.reduce((total, student) => total + Number(student.balance_due || 0), 0))} de saldo por cobrar`, count: debt.length, icon: CreditCard, tone: "danger", filter: { payment: "pending" } },
    { label: "Sin responsiva", detail: "Documento por registrar", count: students.filter(student => !student.waiver_url).length, icon: ClipboardCheck, tone: "warning", filter: { waiver: "no" } },
    { label: "Uniforme por entregar", detail: "Uniformes pagados pendientes de entrega", count: students.filter(student => student.uniform_status === "paid").length, icon: Shirt, tone: "warning", filter: { uniform: "paid" } },
  ];
  return <div className="student-enrollment student-overview">
    <header className="student-enrollment-header"><div><p className="student-eyebrow">Academia · Estado actual</p><h2>Resumen de alumnos</h2></div><div className="student-actions !mt-0"><button className="student-button secondary" onClick={() => onManage({ site })}>Gestionar alumnos<ArrowRight size={15} /></button><button className="student-button primary" onClick={onCreate}><Plus size={15} /> Crear alumno</button></div></header>
    <div className="student-overview-filter"><SelectInput label="Sede del resumen" value={site} onChange={event => setSite(event.target.value)}><option value="">Todas las sedes</option>{data.sites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectInput><p>Alumnos y pendientes actuales de la sede seleccionada.</p></div>
    <div className="student-stat-grid">
      {[{ label: "Alumnos registrados", count: students.length, tone: "neutral", filter: {} }, { label: "Activos", count: active, tone: "success", filter: { status: "active" } }, { label: "En prueba", count: trial, tone: "info", filter: { status: "trial" } }, { label: "Con pago pendiente", count: debt.length, tone: debt.length ? "danger" : "success", filter: { payment: "pending" } }].map(item => <button key={item.label} className={`student-stat ${item.tone}`} onClick={() => onManage({ site, ...item.filter })}><span>{item.label}</span><strong>{item.count}</strong><small>Ver alumnos <ArrowRight size={13} /></small></button>)}
    </div>
    {!students.length ? <section className="student-section student-empty"><UsersRound size={30} /><h3>No hay alumnos en esta selección</h3><p>El resumen aparecerá cuando registres al primer alumno.</p></section> : <div className="student-overview-columns">
      <section className="student-section"><div className="student-section-title"><h3>Estado de los alumnos</h3><p>Selecciona un estado para ver sus alumnos.</p></div><div className="student-status-list">{statuses.map(status => {
        const count = students.filter(student => student.status === status).length;
        return <button key={status} onClick={() => onManage({ site, status })}><span>{statusLabels[status]}</span><span className="student-status-track"><span className={`student-status-fill ${status}`} style={{ width: `${count / students.length * 100}%` }} /></span><strong>{count}</strong></button>;
      })}</div></section>
      <section className="student-section"><div className="student-section-title"><h3>Qué necesita atención</h3><p>Un alumno puede aparecer en más de un pendiente.</p></div><div className="student-attention-list">{pending.map(item => <button key={item.label} className={item.count ? item.tone : "success"} onClick={() => onManage({ site, ...item.filter })}><item.icon size={20} /><span><strong>{item.label}</strong><small>{item.count ? item.detail : "Sin pendientes"}</small></span><b>{item.count}</b><ArrowRight size={15} /></button>)}</div></section>
    </div>}
  </div>;
}
