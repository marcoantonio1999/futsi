import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../api';
import { EnrollmentDatePicker, EnrollmentDateRangePicker } from './EnrollmentDatePicker';
import { calendarDateValue, parseCalendarDate } from './enrollmentDates';
type Offense = {code:string;group:string;label:string;recommendation:string;description?:string};
type Member = {id:number;type:'enrollment'|'player';name:string;is_delegate:boolean};
type Result = {id:number;player_name:string;offense:string;starts_on:string;ends_on:string|null;applied_by:string};
type Catalog = {tournaments:{id:number;name:string;site:number}[];teams:{id:number;name:string;tournament:number}[];sites:{id:number;name:string}[]};
const today = () => calendarDateValue(new Date());
export function NewSanction({token,catalog}:{token:string;catalog:Catalog}) {
  const [tournament,setTournament]=useState(''),[team,setTeam]=useState(''),[member,setMember]=useState(''),[offense,setOffense]=useState('');
  const [data,setData]=useState<{catalog:Offense[];members:Member[]}>({catalog:[],members:[]});
  const [unit,setUnit]=useState('dates');
  const [incident,setIncident]=useState(today),[starts,setStarts]=useState(today),[ends,setEnds]=useState('');
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [result,setResult]=useState<Result|null>(null);
  const saving=useRef(false), requestId=useRef(crypto.randomUUID());
  function changedDate() { requestId.current=crypto.randomUUID();setResult(null); }
  useEffect(()=>{
    const controller=new AbortController();setLoading(true);setError('');
    apiRequest<typeof data>('/player-enrollments/sanctions/'+(team?'?team_id='+team:''),token,{signal:controller.signal})
      .then(body=>{if(!controller.signal.aborted)setData(body)})
      .catch(reason=>{if(!controller.signal.aborted){setData({catalog:[],members:[]});setError(reason.message)}})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)});
    return()=>controller.abort();
  },[token,team]);
  const selected=data.catalog.find(row=>row.code===offense);
  return <section className="operator-controls new-sanction"><h2>Nueva sanción</h2>
    {result&&<div role="status" className="sanction-result"><strong>Sanción #{result.id} registrada para {result.player_name}</strong><p>{result.offense}</p><p>Desde {result.starts_on} hasta {result.ends_on||'sin fecha de término'} · Aplicada por {result.applied_by}</p></div>}
    <form onChange={()=>{requestId.current=crypto.randomUUID();setResult(null)}} onSubmit={async event=>{
      event.preventDefault();if(saving.current||loading)return;setError('');
      if(!parseCalendarDate(incident)||incident>today()){setError('Selecciona una fecha del incidente válida, no posterior a hoy.');return}
      if(!parseCalendarDate(starts)||starts<incident){setError('La sanción debe comenzar el día del incidente o después.');return}
      if(unit==='dates'&&(!parseCalendarDate(ends)||ends<starts)){setError('Selecciona y aplica el periodo completo de la sanción (inicio y fin).');return}
      if(!data.members.some(row=>`${row.type}:${row.id}`===member)){setError('Selecciona un jugador vigente del equipo.');return}
      const values=new FormData(event.currentTarget),[memberType,memberId]=member.split(':');
      const payload:Record<string,unknown>={team_id:Number(team),member_type:memberType,member_id:Number(memberId),offense_code:offense,reason:values.get('reason'),incident_on:values.get('incident_on'),starts_on:values.get('starts_on'),duration_unit:unit,request_id:requestId.current};
      if(unit==='dates')payload.ends_on=values.get('ends_on');else if(unit!=='indefinite')payload.duration_value=Number(values.get('duration_value'));
      saving.current=true;setBusy(true);
      try{const body=await apiRequest<Result>('/player-enrollments/sanctions/',token,{method:'POST',body:JSON.stringify(payload)});setResult(body)}
      catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar la sanción.')}
      finally{saving.current=false;setBusy(false)}
    }}><fieldset disabled={busy}><legend className="sr-only">Registrar sanción del jugador</legend><div className="control-grid">
      <label>Torneo<select required value={tournament} onChange={event=>{setTournament(event.target.value);setTeam('');setMember('')}}><option value="">Selecciona un torneo</option>{catalog.tournaments.map(row=><option key={row.id} value={row.id}>{row.name} · {catalog.sites.find(site=>site.id===row.site)?.name}</option>)}</select></label>
      <label>Equipo<select required value={team} disabled={!tournament} onChange={event=>{setTeam(event.target.value);setMember('')}}><option value="">Selecciona un equipo</option>{catalog.teams.filter(row=>String(row.tournament)===tournament).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>Jugador<select required value={member} disabled={!team||loading} onChange={event=>setMember(event.target.value)}><option value="">Selecciona un jugador</option>{data.members.map(row=><option key={`${row.type}:${row.id}`} value={`${row.type}:${row.id}`}>{row.name}{row.is_delegate?' · Delegado':''}{row.type==='player'?' · Plantilla':' · Inscripción'}</option>)}</select></label>
    </div>
    {loading&&<p role="status">Cargando tabulador y jugadores…</p>}{team&&!loading&&!data.members.length&&<p>Este equipo no tiene jugadores vigentes.</p>}
    <label>Motivo del tabulador<select required value={offense} onChange={event=>setOffense(event.target.value)}><option value="">Selecciona una sanción</option>{[...new Set(data.catalog.map(row=>row.group))].map(group=><optgroup key={group} label={group}>{data.catalog.filter(row=>row.group===group).map(row=><option key={row.code} value={row.code}>{row.label}</option>)}</optgroup>)}</select></label>
    {selected&&<div className="sanction-recommendation">{selected.description&&<p>{selected.description}</p>}<strong>Recomendación del tabulador:</strong> {selected.recommendation}<br/>Solo referencia. No se aplican bajas, pagos ni resultados de partidos automáticamente.</div>}
    <div className="control-grid"><EnrollmentDatePicker label="Fecha del incidente" name="incident_on" required value={incident} max={today()} onChange={value=>{setIncident(value);if(starts<value){setStarts(value);setEnds('')}changedDate()}} /><label>Duración elegida<select value={unit} onChange={event=>setUnit(event.target.value)}><option value="dates">Elegir periodo (inicio y fin)</option><option value="days">Días</option><option value="weeks">Semanas</option><option value="months">Meses</option><option value="years">Años</option><option value="indefinite">Sin fecha de término / definitiva</option></select></label>
      {unit==='dates'?<EnrollmentDateRangePicker label="Periodo de sanción" from={starts} to={ends} min={incident} onChange={(from,to)=>{setStarts(from);setEnds(to);changedDate()}} />:<><EnrollmentDatePicker label="Inicio de la sanción" name="starts_on" required value={starts} min={incident} onChange={value=>{setStarts(value);changedDate()}} />{unit!=='indefinite'&&<label>Cantidad<input name="duration_value" type="number" min={1} max={10000} required defaultValue={1} /></label>}</>}
    </div><label>Descripción del incidente y decisión del coordinador<textarea name="reason" required minLength={3} maxLength={2000} rows={4} placeholder="Describe lo ocurrido y el motivo del periodo elegido." /></label>
    <p>Registrar esta sanción conserva al jugador en su equipo. No ejecuta una baja ni altera partidos o cobros.</p>
    {error&&<p role="alert" className="error">{error}</p>}<button type="submit" className="primary" disabled={busy||loading||!member||!offense}>{busy?'Guardando sanción…':'Registrar sanción'}</button></fieldset></form>
  </section>;
}
