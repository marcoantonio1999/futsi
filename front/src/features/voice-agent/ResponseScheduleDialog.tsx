import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { apiRequest } from '../../api';
import { inputClass, primaryButtonClass, secondaryButtonClass } from './model';

type Schedule = { days:number[]; starts_at:string; ends_at:string; timezone:string; can_edit:boolean };
const weekdays=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
export function ResponseScheduleDialog({token,onSaved,inline=false}:{token:string;onSaved:()=>void;inline?:boolean}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [schedule,setSchedule]=useState<Schedule|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [saved,setSaved]=useState(false);
  useEffect(()=>{if(inline)void open();},[inline,token]);
  async function open() {
    setSchedule(null);setError('');setSaved(false);setBusy(true);if(!inline)dialog.current?.showModal();
    try {setSchedule(await apiRequest<Schedule>('/whatsapp-conversations/response-schedule/',token));}
    catch(e){setError(e instanceof Error?e.message:'No se pudo consultar el horario.');}
    finally{setBusy(false);}
  }
  async function save() {
    if(!schedule||busy)return;
    setBusy(true);setError('');setSaved(false);
    try {
      const result=await apiRequest<Schedule>('/whatsapp-conversations/response-schedule/',token,{method:'PATCH',body:JSON.stringify({days:schedule.days,starts_at:schedule.starts_at,ends_at:schedule.ends_at})});
      setSchedule(result);setSaved(true);dialog.current?.close();onSaved();
    }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar el horario.');}
    finally{setBusy(false);}
  }
  const content=<>
      <header className="flex items-center justify-between gap-3"><h3 id="response-schedule-title">Horario laboral</h3>{!inline&&<button type="button" className={secondaryButtonClass} disabled={busy} onClick={()=>dialog.current?.close()}>Cerrar</button>}</header>
      <p className="comm-muted">Hora de Ciudad de México. Solo se cuenta el tiempo dentro de este horario; no cambia el horario del bot.</p>
      {error&&<p role="alert" className="comm-error">{error}</p>}
      {saved&&<p role="status">Horario guardado.</p>}
      {busy&&!schedule&&<p role="status">Consultando horario…</p>}
      {schedule&&<form onSubmit={e=>{e.preventDefault();void save();}} className="grid gap-4">
        <fieldset disabled={busy||!schedule.can_edit}><legend>Repetir cada semana</legend><div className="comm-response-days">{weekdays.map((day,index)=><button key={day} type="button" aria-label={['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][index]} aria-pressed={schedule.days.includes(index)} className={schedule.days.includes(index)?primaryButtonClass:secondaryButtonClass} onClick={()=>setSchedule({...schedule,days:schedule.days.includes(index)?schedule.days.filter(d=>d!==index):[...schedule.days,index].sort()})}>{day}</button>)}</div></fieldset>
        <div className="grid gap-4 sm:grid-cols-2"><label>Desde<input className={inputClass} type="time" required disabled={busy||!schedule.can_edit} value={schedule.starts_at} onChange={e=>setSchedule({...schedule,starts_at:e.target.value})}/></label><label>Hasta<input className={inputClass} type="time" required disabled={busy||!schedule.can_edit} value={schedule.ends_at} onChange={e=>setSchedule({...schedule,ends_at:e.target.value})}/></label></div>
        {schedule.can_edit&&<button type="submit" className={primaryButtonClass} disabled={busy||!schedule.days.length||!schedule.starts_at||schedule.starts_at>=schedule.ends_at}>{busy?'Guardando…':'Guardar horario'}</button>}
      </form>}</>;
  return inline?<section className="comm-panel comm-response-schedule-inline" aria-labelledby="response-schedule-title">{content}</section>:<><button className={secondaryButtonClass} type="button" aria-haspopup="dialog" onClick={()=>void open()}><Clock3 size={18}/>Horario laboral</button><dialog ref={dialog} className="comm-response-schedule" aria-labelledby="response-schedule-title" onCancel={e=>{if(busy)e.preventDefault();}}>{content}</dialog></>;
}
