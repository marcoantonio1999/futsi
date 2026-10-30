import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { apiRequest } from '../../api';
import { inputClass, primaryButtonClass, secondaryButtonClass } from './model';

type Schedule = { site:number; site_name:string; days:number[]; starts_at:string; ends_at:string; timezone:string; can_edit:boolean };
type SiteOption={id:number;name:string};
const weekdays=['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
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
      if(id===requestId.current){if(result.site!==Number(site))throw new Error('El horario no corresponde a la cancha seleccionada.');setSchedule(result);}
    }catch(e){if(id===requestId.current)setError(e instanceof Error?e.message:'No se pudo consultar el horario.');}
    finally{if(id===requestId.current)setBusy(false);}
  }
  async function save() {
    if(!schedule||busy||schedule.site!==Number(selectedSite))return;
    setBusy(true);setError('');setSaved(false);
    try {
      const result=await apiRequest<Schedule>(`/whatsapp-conversations/response-schedule/?site=${encodeURIComponent(selectedSite)}`,token,{method:'PATCH',body:JSON.stringify({days:schedule.days,starts_at:schedule.starts_at,ends_at:schedule.ends_at})});
      if(result.site!==Number(selectedSite))throw new Error('La respuesta no corresponde a esta cancha.');
      setSchedule(result);setSaved(true);dialog.current?.close();onSaved();
    }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar el horario.');}
    finally{setBusy(false);}
  }
  const content=<>
    <header className="flex items-center justify-between gap-3"><h3 id="response-schedule-title">Horario laboral</h3>{!inline&&<button type="button" className={secondaryButtonClass} disabled={busy} onClick={()=>dialog.current?.close()}>Cerrar</button>}</header>
    <label>Cancha<select className={inputClass} aria-label="Cancha del horario laboral" disabled={busy||sites.length===1} value={selectedSite} onChange={e=>setSelectedSite(e.target.value)}><option value="">Selecciona una cancha</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    <p className="comm-muted">Hora de Ciudad de México. Solo se cuenta el tiempo dentro del horario de esta cancha; no cambia el horario del bot.</p>
    {error&&<div role="alert"><p className="comm-error">{error==='Failed to fetch'?'No se pudo conectar con el servidor.':error}</p><button className={secondaryButtonClass} type="button" disabled={busy} onClick={()=>void load(selectedSite)}>Volver a consultar</button></div>}
    {saved&&<p role="status">Horario guardado para {schedule?.site_name}.</p>}
    {busy&&!schedule&&<p role="status">Consultando horario…</p>}
    {schedule&&<form onSubmit={e=>{e.preventDefault();void save();}} className="grid gap-4" onChange={()=>setSaved(false)}>
      <fieldset disabled={busy||!schedule.can_edit}><legend>Repetir cada semana</legend><div className="comm-response-days">{weekdays.map((day,index)=><button key={day} type="button" aria-label={['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][index]} aria-pressed={schedule.days.includes(index)} className={schedule.days.includes(index)?primaryButtonClass:secondaryButtonClass} onClick={()=>{setSaved(false);setSchedule({...schedule,days:schedule.days.includes(index)?schedule.days.filter(d=>d!==index):[...schedule.days,index].sort()});}}>{day}</button>)}</div></fieldset>
      <div className="grid gap-4 sm:grid-cols-2"><label>Desde<input className={inputClass} type="time" required disabled={busy||!schedule.can_edit} value={schedule.starts_at} onChange={e=>setSchedule({...schedule,starts_at:e.target.value})}/></label><label>Hasta<input className={inputClass} type="time" required disabled={busy||!schedule.can_edit} value={schedule.ends_at} onChange={e=>setSchedule({...schedule,ends_at:e.target.value})}/></label></div>
      {schedule.can_edit&&<button type="submit" className={primaryButtonClass} disabled={busy||!schedule.days.length||!schedule.starts_at||schedule.starts_at>=schedule.ends_at}>{busy?'Guardando…':'Guardar horario'}</button>}
    </form>}
  </>;
  return inline?<section className="comm-panel comm-response-schedule-inline" aria-labelledby="response-schedule-title">{content}</section>:<><button className={secondaryButtonClass} type="button" aria-haspopup="dialog" onClick={()=>{dialog.current?.showModal();void load(selectedSite);}}><Clock3 size={18}/>Horario laboral</button><dialog ref={dialog} className="comm-response-schedule" aria-labelledby="response-schedule-title" onCancel={e=>{if(busy)e.preventDefault();}}>{content}</dialog></>;
}
