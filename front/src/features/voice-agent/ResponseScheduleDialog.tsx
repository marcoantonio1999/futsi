import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../../api';
import { inputClass } from './model';

type Slot={start:string;end:string};
type Schedule = { site:number; site_name:string; days:number[]; starts_at:string; ends_at:string; weekly_hours:Record<string,Slot[]>; timezone:string; can_edit:boolean };
type SiteOption={id:number;name:string};
const weekdays=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const buttonClass='comm-hours-button';
const invalidHours=(hours:Record<string,Slot[]>)=>!Object.values(hours).some(s=>s.length)||Object.values(hours).some(slots=>{
  const sorted=[...slots].sort((a,b)=>a.start.localeCompare(b.start));
  return sorted.some((s,i)=>!s.start||!s.end||s.start>=s.end||(i>0&&sorted[i-1].end>s.start));
});
export function ResponseScheduleDialog({token,onSaved,inline=false,sites=[],siteId=''}:{token:string;onSaved:()=>void;inline?:boolean;sites?:SiteOption[];siteId?:string}) {
  const dialog=useRef<HTMLDialogElement>(null), requestId=useRef(0);
  const initialSite=sites.some(s=>String(s.id)===siteId)?siteId:sites.length===1?String(sites[0].id):'';
  const [selectedSite,setSelectedSite]=useState(initialSite);
  const [schedule,setSchedule]=useState<Schedule|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  useEffect(()=>{setSelectedSite(initialSite);},[initialSite]);
  useEffect(()=>{if(inline||dialog.current?.open)void load(selectedSite);return()=>{requestId.current++;};},[inline,token,selectedSite]);
  async function load(site:string) {
    const id=++requestId.current;
    setSchedule(null);setError('');setSaved(false);setBusy(Boolean(site));
    if(!site)return;
    try {
      const result=await apiRequest<Schedule>(`/whatsapp-conversations/response-schedule/?site=${encodeURIComponent(site)}`,token);
      if(id===requestId.current){if(result.site!==Number(site))throw new Error('El horario no corresponde a la cancha seleccionada.');setSchedule({...result,weekly_hours:result.weekly_hours??Object.fromEntries(weekdays.map((_,i)=>[String(i),result.days.includes(i)?[{start:result.starts_at,end:result.ends_at}]:[]]))});}
    }catch(e){if(id===requestId.current)setError(e instanceof Error?e.message:'No se pudo consultar el horario.');}
    finally{if(id===requestId.current)setBusy(false);}
  }
  async function save() {
    if(!schedule||busy||schedule.site!==Number(selectedSite)||invalidHours(schedule.weekly_hours))return;
    setBusy(true);setError('');setSaved(false);
    try {
      const result=await apiRequest<Schedule>(`/whatsapp-conversations/response-schedule/?site=${encodeURIComponent(selectedSite)}`,token,{method:'PATCH',body:JSON.stringify({weekly_hours:schedule.weekly_hours})});
      if(result.site!==Number(selectedSite))throw new Error('La respuesta no corresponde a esta cancha.');
      setSchedule(result);setSaved(true);dialog.current?.close();onSaved();
    }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar el horario.');}
    finally{setBusy(false);}
  }
  function changeDay(day:string,slots:Slot[]) {
    setSaved(false);setSchedule(current=>current?{...current,weekly_hours:{...current.weekly_hours,[day]:slots}}:null);
  }
  function addSlot(day:string,slots:Slot[]) {
    const last=slots.map(s=>s.end).sort().at(-1)||'09:00';
    const minutes=Number(last.slice(0,2))*60+Number(last.slice(3));
    if(minutes>=1439)return;
    const end=Math.min(1439,minutes+60);
    changeDay(day,[...slots,{start:last,end:`${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`}]);
  }
  const content=<>
    <header className="flex items-center justify-between gap-3"><h3 id="response-schedule-title">Horario laboral</h3>{!inline&&<button type="button" className={buttonClass} disabled={busy} onClick={()=>dialog.current?.close()}>Cerrar</button>}</header>
    <label>Cancha<select className={inputClass} aria-label="Cancha del horario laboral" disabled={busy||sites.length===1} value={selectedSite} onChange={e=>setSelectedSite(e.target.value)}><option value="">Selecciona una cancha</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <p className="comm-muted">Hora de Ciudad de México. Solo se cuenta el tiempo dentro del horario de esta cancha; no cambia el horario del bot.</p>
    {error&&<div role="alert"><p className="comm-error">{error==='Failed to fetch'?'No se pudo conectar con el servidor.':error}</p><button className={buttonClass} type="button" disabled={busy} onClick={()=>void load(selectedSite)}>Volver a consultar</button></div>}
    {saved&&<p role="status">Horario guardado para {schedule?.site_name}.</p>}
    {busy&&!schedule&&<p role="status">Consultando horario…</p>}
    {schedule&&<form onSubmit={e=>{e.preventDefault();void save();}} className="grid gap-4" onChange={()=>setSaved(false)}>
      <fieldset disabled={busy||!schedule.can_edit} className="comm-hours-week"><legend>Horarios que se repiten cada semana</legend>{weekdays.map((day,index)=>{
        const key=String(index),slots=schedule.weekly_hours[key]||[],active=slots.length>0;
        return <section className={`comm-hours-day${active?' is-active':''}`} key={day} aria-label={`Horarios de ${day}`}>
          <div className="comm-hours-day-heading"><button type="button" aria-label={day} aria-pressed={active} className={`${buttonClass} comm-hours-toggle${active?' is-active':''}`} onClick={()=>changeDay(key,active?[]:[{start:'09:00',end:'20:00'}])}>{active&&<Check size={16} aria-hidden="true"/>}{day}</button><span className="comm-muted">{active?'Con atención':'Sin atención'}</span></div>
          {slots.map((slot,i)=><div className="comm-hours-slot" key={i}><label>Desde<input className={inputClass} type="time" required aria-label={`${day} desde ${i+1}`} value={slot.start} onChange={e=>changeDay(key,slots.map((s,n)=>n===i?{...s,start:e.target.value}:s))}/></label><label>Hasta<input className={inputClass} type="time" required aria-label={`${day} hasta ${i+1}`} value={slot.end} onChange={e=>changeDay(key,slots.map((s,n)=>n===i?{...s,end:e.target.value}:s))}/></label><button type="button" className={`${buttonClass} comm-hours-remove`} aria-label={`Quitar horario ${i+1} de ${day}`} onClick={()=>changeDay(key,slots.filter((_,n)=>n!==i))}><Trash2 size={16} aria-hidden="true"/><span>Quitar</span></button></div>)}
          {active&&slots.length<4&&<button type="button" className={buttonClass} aria-label={`Agregar horario a ${day}`} disabled={slots.some(s=>!s.end)||slots.some(s=>s.end==='23:59')} onClick={()=>addSlot(key,slots)}><Plus size={16} aria-hidden="true"/>Agregar horario</button>}
        </section>;
      })}</fieldset>
      {invalidHours(schedule.weekly_hours)&&<p className="comm-error" role="alert">Revisa las horas: agrega al menos un tramo, con apertura antes del cierre y sin cruces en un mismo día.</p>}
      {schedule.can_edit&&<button type="submit" className={`${buttonClass} comm-hours-save`} disabled={busy||invalidHours(schedule.weekly_hours)}>{busy?'Guardando…':'Guardar horario'}</button>}
    </form>}
  </>;
  return inline?<section className="comm-panel comm-response-schedule-inline" aria-labelledby="response-schedule-title">{content}</section>:<><button className={buttonClass} type="button" aria-haspopup="dialog" onClick={()=>{dialog.current?.showModal();void load(selectedSite);}}><Clock3 size={18}/>Horario laboral</button><dialog ref={dialog} className="comm-response-schedule" aria-labelledby="response-schedule-title" onCancel={e=>{if(busy)e.preventDefault();}}>{content}</dialog></>;
}
