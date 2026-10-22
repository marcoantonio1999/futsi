import {useEffect,useRef,useState,type FormEvent} from 'react';
import {apiRequest} from '../../api';
import './ExamStatistics.css';

type Metrics={delivered:number;graded:number;average_score:number|null;highest_score:number|null;lowest_score:number|null;grading_errors:number;pending_grading:number;invalid_grades:number};
type Statistics={since:string;until:string;days:number;timezone:string;generated_at:string;summary:Metrics&{started:number;without_delivery:number;exams_created:number;average_seconds:number|null};averages:Record<'received'|'created_by_vero',{total:number;daily:number;weekly:number;monthly:number}>;daily:{day:string;total:number}[];per_exam:(Metrics&{exam_id:number;exam__title:string})[];distribution:{label:string;total:number}[]};
const number=(v:number|null)=>v===null?'Sin datos':new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(v);
const day=(value:string)=>new Date(value+'T12:00:00').toLocaleDateString('es-MX',{day:'numeric',month:'short'});
const localDate=(offset=0)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Date.now()+offset*86400000));

export function ExamStatistics({token,exams}:{token:string;exams:{id:number;title:string}[]}) {
  const [since,setSince]=useState(()=>localDate(-29)),[until,setUntil]=useState(()=>localDate()),[exam,setExam]=useState('');
  const [metric,setMetric]=useState<'received'|'created_by_vero'>('received');
  const [data,setData]=useState<Statistics|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const controller=useRef<AbortController|null>(null),mounted=useRef(true);
  async function load(filters={since,until,exam}) {
    controller.current?.abort();const request=new AbortController();controller.current=request;setBusy(true);setError('');
    try{const result=await apiRequest<Statistics>('/recruitment-exams/statistics/?'+new URLSearchParams(filters),token,{signal:request.signal});if(mounted.current&&!request.signal.aborted)setData(result);}
    catch(e){if(mounted.current&&!request.signal.aborted){setData(null);setError(e instanceof Error?e.message:'No se pudo cargar el reporte.');}}
    finally{if(mounted.current&&!request.signal.aborted)setBusy(false);}
  }
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;controller.current?.abort();};},[token]);
  function submit(e:FormEvent){e.preventDefault();void load();}
  const average=data?.averages[metric],summary=data?.summary;
  const maxDaily=Math.max(1,...(data?.daily.map(d=>d.total)||[]));
  const maxDistribution=Math.max(1,...(data?.distribution.map(d=>d.total)||[]));
  return <div className="exam-statistics">
    <form className="exam-card exam-stats-filters" onSubmit={submit} aria-label="Filtros de estadísticas"><div className="exam-stats-filter-grid">
      <label>Desde<input type="date" required max={until} value={since} onChange={e=>setSince(e.target.value)} disabled={busy}/></label>
      <label>Hasta<input type="date" required min={since} max={localDate()} value={until} onChange={e=>setUntil(e.target.value)} disabled={busy}/></label>
      <label>Examen / postulación<select value={exam} onChange={e=>setExam(e.target.value)} disabled={busy}><option value="">Todos los exámenes</option>{exams.map(e=><option value={e.id} key={e.id}>{e.title}</option>)}</select></label>
    </div><button className="exam-primary" disabled={busy}>{busy?'Consultando…':'Actualizar estadísticas'}</button><p className="exam-muted">Fechas de Ciudad de México, hasta 366 días. Se consulta al entrar o actualizar; sin IA ni consultas periódicas.</p></form>
    {error&&<p className="exam-error" role="alert">{error} No se reintentará automáticamente.</p>}
    {busy&&<p role="status">Cargando estadísticas…</p>}
    {data&&average&&summary&&<><section aria-label="Promedios de actividad" className="exam-card">
      <h2>Actividad de exámenes · Recursos Humanos</h2>
      <label>Indicador de los promedios<select aria-label="Indicador de los promedios" value={metric} onChange={e=>setMetric(e.target.value as typeof metric)}><option value="received">Evaluaciones recibidas de candidatos</option><option value="created_by_vero">Exámenes nuevos creados por Vero</option></select></label>
      <div className="exam-stat-kpis">{[['Por día',average.daily],['Por semana',average.weekly],['Por mes de 30 días',average.monthly]].map(([label,value])=><article className="exam-stat-kpi" key={label}><h3>{label}</h3><strong>{number(value as number)}</strong><span>en promedio</span></article>)}</div>
      <p className="exam-muted">{average.total} {metric==='received'?'evaluaciones recibidas':'exámenes creados por cuentas de Vero'} del {day(data.since)} al {day(data.until)} ({data.days} días naturales, incluidos días sin actividad). Diario = total ÷ días; semanal = diario × 7; mensual = diario × 30. No son proyecciones garantizadas.</p>
      <p className="exam-muted">Las evaluaciones las contestan los candidatos; no se atribuyen como trabajo manual de Vero. «Creados por Vero» usa el autor registrado con permiso de Vero; los creados por administración no se le atribuyen.</p>
    </section>
    <section aria-label="Resumen de resultados" className="exam-card"><h2>Resultados del período</h2><div className="exam-stat-kpis exam-stat-summary">{[['Evaluaciones recibidas',summary.delivered],['Calificadas',summary.graded],['Pendientes de calificar',summary.pending_grading],['Errores de calificación',summary.grading_errors],['Calificación promedio / 10',summary.average_score],['Mejor calificación / 10',summary.highest_score],['Menor calificación / 10',summary.lowest_score],['Tiempo promedio (min)',summary.average_seconds===null?null:Math.round(summary.average_seconds/60*10)/10]].map(([label,value])=><article className="exam-stat-kpi" key={label}><h3>{label}</h3><strong>{number(value as number|null)}</strong></article>)}</div>
    <p className="exam-muted">{summary.started} intentos iniciados en el período; {summary.without_delivery} de ellos sin entrega registrada. {summary.exams_created} exámenes nuevos creados por todo el equipo. Los resultados se cuentan por fecha de entrega, aunque el intento haya empezado antes. No se cierran ni califican intentos al abrir este reporte.</p>
    {summary.invalid_grades>0&&<p className="exam-error">{summary.invalid_grades} entregas figuran como calificadas sin una nota válida: requieren revisión y no se incluyen en el promedio.</p>}</section>
    <div className="exam-stats-charts"><section className="exam-card"><h2>Distribución de calificaciones</h2><p className="exam-muted">Solo notas válidas de 0 a 10; pendientes y errores no cuentan como cero.</p><ul className="exam-stat-bars">{data.distribution.map(b=><li key={b.label}><span>{b.label}</span><div className="exam-stat-track" aria-hidden="true"><div style={{width:`${b.total/maxDistribution*100}%`}}/></div><strong>{b.total}</strong></li>)}</ul></section>
    <section className="exam-card"><h2>Evaluaciones recibidas por día</h2><p className="exam-muted">Incluye todos los días del período. Desplazamiento dentro del listado.</p><ol className="exam-stat-bars exam-stat-days" aria-label="Entregas diarias">{data.daily.map(b=><li key={b.day}><span>{day(b.day)}</span><div className="exam-stat-track" aria-hidden="true"><div style={{width:`${b.total/maxDaily*100}%`}}/></div><strong>{b.total}</strong></li>)}</ol></section></div>
    <section className="exam-card"><h2>Resultados por examen / postulación</h2><p className="exam-muted">No se comparan como equivalentes las dificultades de exámenes distintos.</p><div className="exam-stat-exams">{data.per_exam.map(e=><article className="exam-stat-exam" key={e.exam_id}><h3>{e.exam__title}</h3><dl>{[['Recibidos',e.delivered],['Calificados',e.graded],['Promedio / 10',e.average_score],['Pendientes',e.pending_grading],['Errores',e.grading_errors]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{number(value as number|null)}</dd></div>)}</dl></article>)}</div>{!data.per_exam.length&&<p>No hay evaluaciones recibidas en este período.</p>}</section>
    <p className="exam-muted">Consulta: {new Date(data.generated_at).toLocaleString('es-MX',{timeZone:data.timezone})} · Ciudad de México.</p></>}
  </div>;
}
