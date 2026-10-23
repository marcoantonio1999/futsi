import {useState} from 'react';

type Skill = {id:string;label:string;delivered:number;graded:number;without_breakdown:number;question_count:number;average_score:number|null;lowest_score:number|null;highest_score:number|null;per_exam:{exam_id:number;title:string;graded:number;average_score:number}[]};
export type SkillStatistics = {mapping_version:string;results:Skill[];unclassified:number};
const number=(v:number|null)=>v===null?'Sin desglose':new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(v);

export function ExamSkillStatistics({data}:{data:SkillStatistics}) {
  const [skill,setSkill]=useState('');
  const visible=data.results.filter(s=>!skill||s.id===skill);
  return <section className="exam-card" aria-label="Resultados por habilidad">
    <h2>Resultados por habilidad</h2>
    <label>Filtrar por habilidad<select aria-label="Filtrar por habilidad" value={skill} onChange={e=>setSkill(e.target.value)}><option value="">Todas las habilidades</option>{data.results.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    <p className="exam-muted">Usa las fechas y el examen seleccionados arriba. Este filtro muestra las notas por área; la actividad y las calificaciones generales del reporte siguen correspondiendo al examen completo.</p>
    <div className="exam-stat-exams">{visible.map(s=><article className="exam-stat-exam" key={s.id}>
      <h3>{s.label}</h3><dl>{[['Promedio / 10',s.average_score],['Mejor nota / 10',s.highest_score],['Menor nota / 10',s.lowest_score],['Evaluaciones con esta habilidad',s.delivered],['Con desglose calificado',s.graded],['Sin desglose calificado',s.without_breakdown],['Preguntas calificadas',s.question_count]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{number(value as number|null)}</dd></div>)}</dl>
      {s.per_exam.length>0&&<details><summary>Ver por examen</summary>{s.per_exam.map(e=><p key={e.exam_id}><strong>{e.title}</strong><br/>{number(e.average_score)} / 10 · {e.graded} evaluaciones con desglose</p>)}</details>}
      {!s.delivered&&<p>No hay evaluaciones con preguntas reconocidas de esta habilidad en el período.</p>}
    </article>)}</div>
    <p className="exam-muted">Cada pregunta de la plantilla Business Operations &amp; AI pertenece a un área según su contenido. Primero se promedian sus puntos por evaluación y después se promedian las evaluaciones con desglose completo del área. Las pendientes, los errores y las notas totales importadas sin detalle no se cuentan como cero.</p>
    {data.unclassified>0&&<p className="exam-notice">{data.unclassified} evaluaciones del período no contienen preguntas reconocidas de la plantilla; no se les asignó una habilidad automáticamente.</p>}
    <p className="exam-muted">Las notas describen respuestas al examen; no certifican habilidades ni implican una decisión de contratación. Los exámenes de distinta dificultad no son equivalentes.</p>
  </section>;
}
