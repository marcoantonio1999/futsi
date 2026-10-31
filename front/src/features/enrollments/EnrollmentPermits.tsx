import {useEffect, useRef, useState, type FormEvent} from 'react';
import {API_URL, apiFormRequest, apiRequest} from '../../api';
import {Button, Card, Dialog, Input, Label, NativeSelect} from '../../components/ui/enrollment-ui';
import {CameraCapture} from './CameraCapture';
import {compressEnrollmentPhoto} from './compressEnrollmentPhoto';
import {fetchEnrollmentDocument} from './fetchEnrollmentDocument';
import {EnrollmentBrand} from './EnrollmentBrand';
import {Signature} from './EnrollmentSignaturePad';
import './enrollments.css';
import './enrollmentAdmin.css';
import './enrollmentButtons.css';
import './localEnrollment.css';
import '../../components/ui/enrollment-ui.css';
import './enrollmentPermits.css';

type Permit = {id:number; folio:string; name:string; team:string; tournament:string; issued_at:string; expires_at:string; status:string; terms:string[];source:string};
type TeamDetails = {name:string;tournament:string};
type Catalog = {tournaments:{id:number;name:string;is_active:boolean}[];teams:{id:number;name:string;tournament:number}[]};
const date = (value:string) => new Date(value).toLocaleString('es-MX',{timeZone:'America/Mexico_City',dateStyle:'medium',timeStyle:'medium'});
const defaultTerms = [
  'Equipo que utilice jugador con permiso podrá perder su partido si el equipo contrario juega bajo protesta, ya que la administración no puede acreditar la edad e identidad del jugador.',
  'Válido por 24 horas desde su emisión, hasta la fecha y hora de vencimiento indicadas.',
  'Acepto jugar bajo mi propio riesgo, deslindando de toda responsabilidad a la liga y a su personal por cualquier eventualidad de mi persona.',
];
function useObjectUrl(blob:Blob|null){
  const [url,setUrl]=useState('');
  useEffect(()=>{if(!blob){setUrl('');return;}const value=URL.createObjectURL(blob);setUrl(value);return()=>URL.revokeObjectURL(value);},[blob]);
  return url;
}
function PermitTicket({row,photo,signature}:{row:Permit;photo:string;signature:string}) {
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{setNow(Date.now());const remaining=Date.parse(row.expires_at)-Date.now();if(remaining<=0)return;const timer=window.setTimeout(()=>setNow(Date.now()),Math.min(remaining+20,2147483647));return()=>clearTimeout(timer);},[row.expires_at]);
  const active=Date.parse(row.issued_at)<=now&&now<Date.parse(row.expires_at);
  const [ready,setReady]=useState({photo:'',signature:''});
  return <><div className="permit-actions no-print"><Button disabled={!photo||!signature||ready.photo!==photo||ready.signature!==signature} onClick={()=>window.print()}>Imprimir permiso</Button></div>
    <article className="permit-ticket"><header><EnrollmentBrand/><strong>PERMISO · {row.folio}</strong></header>
      <p className="permit-state">{active?'VIGENTE':'VENCIDO'} · VÁLIDO POR 24 HORAS</p>
      <div className="permit-identity"><div>{photo?<img src={photo} alt={`Foto de ${row.name}`} onLoad={()=>setReady(v=>({...v,photo:photo}))} onError={()=>setReady(v=>({...v,photo:''}))}/>:<p>Foto no disponible</p>}</div><dl>
        <dt>Nombre del jugador</dt><dd>{row.name}</dd><dt>Equipo</dt><dd>{row.team}</dd><dt>Torneo</dt><dd>{row.tournament}</dd>
        <dt>Emitido</dt><dd>{date(row.issued_at)}</dd><dt>Vence</dt><dd>{date(row.expires_at)}</dd>
      </dl></div><p>Horario de Ciudad de México.</p>{row.terms.map((term,i)=><p key={i}>{term}</p>)}
      <div className="permit-signed">{signature?<img src={signature} alt={`Firma de ${row.name}`} onLoad={()=>setReady(v=>({...v,signature:signature}))} onError={()=>setReady(v=>({...v,signature:''}))}/>:<p>Firma no disponible</p>}<p>Firma del jugador · {row.name}</p></div>
    </article></>;
}
function StoredPermit({row,token}:{row:Permit;token:string}){
  const [files,setFiles]=useState<{photo:Blob|null;signature:Blob|null}>({photo:null,signature:null}),[error,setError]=useState('');
  const photo=useObjectUrl(files.photo),signature=useObjectUrl(files.signature);
  useEffect(()=>{const controller=new AbortController();setFiles({photo:null,signature:null});setError('');
    Promise.all(['photo','signature'].map(async kind=>{
      const response=await fetchEnrollmentDocument(`/player-enrollments/permits/${row.id}/${kind}/`,token,controller.signal);
      if(!response.ok||!response.headers.get('Content-Type')?.startsWith('image/'))throw new Error('No se pudieron cargar la foto y firma del permiso.');
      return response.blob();
    })).then(([photo,signature])=>{if(!controller.signal.aborted)setFiles({photo,signature});}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[row.id,token]);
  return <>{error&&<p role="alert" className="error no-print">{error}</p>}<PermitTicket row={row} photo={photo} signature={signature}/></>;
}
export function PermitForm({team,token,teamId,invitation,terms=defaultTerms,embedded=false,onIssued,onBusyChange}:{
  team:TeamDetails;token?:string;teamId?:number;invitation?:string;terms?:string[];embedded?:boolean;
  onIssued?:(row:Permit)=>void;onBusyChange?:(busy:boolean)=>void;
}){
  const [name,setName]=useState(''),[photo,setPhoto]=useState<File|null>(null),[signature,setSignature]=useState<Blob|null>(null);
  const [accepted,setAccepted]=useState(false),[camera,setCamera]=useState(false),[processing,setProcessing]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState<Permit|null>(null),[signatureVersion,setSignatureVersion]=useState(0);
  const preview=useObjectUrl(photo),signedPreview=useObjectUrl(signature);
  const requestId=useRef(crypto.randomUUID()),saving=useRef(false),selection=useRef(0);
  useEffect(()=>{onBusyChange?.(busy||processing);},[busy,processing,onBusyChange]);
  useEffect(()=>()=>{selection.current++;},[]);
  function resetConsent(){setAccepted(false);setSignature(null);setSignatureVersion(v=>v+1);}
  async function choosePhoto(file:File|null){
    const version=++selection.current;setPhoto(null);resetConsent();setProcessing(true);setError('');
    try{if(file&&!['image/jpeg','image/png'].includes(file.type))throw new Error('Usa una foto JPG o PNG.');
      const prepared=file?await compressEnrollmentPhoto(file):null;if(version===selection.current)setPhoto(prepared);
    }catch(e){if(version===selection.current)setError(e instanceof Error?e.message:'No se pudo preparar la foto.');}
    finally{if(version===selection.current)setProcessing(false);}
  }
  async function submit(event:FormEvent){
    event.preventDefault();if(saving.current||processing||!photo||!signature||!accepted)return;
    saving.current=true;setBusy(true);setError('');
    const form=new FormData();form.set('request_id',requestId.current);form.set('name',name.trim());form.set('photo',photo);form.set('signature',signature,'firma-permiso.png');form.set('accepted','true');
    if(teamId)form.set('team_id',String(teamId));
    try{let row:Permit;
      if(invitation){const response=await fetch(`${API_URL}/player-enrollments/permits/public/${encodeURIComponent(invitation)}/`,{method:'POST',body:form,credentials:'omit'});const data=await response.json();if(!response.ok)throw new Error(data.detail||Object.values(data).flat().join(' ')||'No se pudo emitir el permiso.');row=data;}
      else row=await apiFormRequest<Permit>('/player-enrollments/permits/',token!,form);
      setDone(row);onIssued?.(row);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo emitir el permiso.');}
    finally{saving.current=false;setBusy(false);}
  }
  if(done)return <section className="permit-section"><p role="status" className="no-print">Permiso firmado y emitido. Su vigencia es de 24 horas.</p><PermitTicket row={done} photo={preview} signature={signedPreview}/></section>;
  return <section className="permit-section"><Card as="section" className="permit-create no-print"><h2>{embedded?'Permiso local':'Permiso en línea'}</h2><p>{team.name} · {team.tournament}</p><p>La vigencia de 24 horas comienza al completar y firmar el permiso.</p>
    <form onSubmit={submit}><fieldset disabled={busy}><Label>Nombre completo del jugador<Input required maxLength={160} minLength={2} value={name} onChange={e=>{setName(e.target.value);resetConsent();}}/></Label>
      <div className="permit-photo-input"><Label>Foto del jugador<Input type="file" accept="image/jpeg,image/png" onChange={e=>void choosePhoto(e.target.files?.[0]||null)}/></Label><Button type="button" onClick={()=>setCamera(true)}>Tomar foto</Button>{preview&&<img src={preview} alt="Foto del jugador para el permiso"/>}{processing&&<p role="status">Preparando foto…</p>}</div>
      {terms.map((term,i)=><p key={i}>{term}</p>)}<Label className="consent"><Input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>He leído y acepto las condiciones del permiso.</Label>
      <Signature key={signatureVersion} label="Firma del jugador obligatoria" onChange={setSignature}/>
      <Button type="submit" disabled={processing||!photo||!signature||!accepted||name.trim().length<2}>{busy?'Emitiendo permiso…':'Firmar y emitir permiso de 24 horas'}</Button>
    </fieldset></form>{error&&<p role="alert" className="error">{error}</p>}</Card>
    {camera&&<CameraCapture embedded={embedded} selfie={false} onClose={()=>setCamera(false)} onCapture={file=>{setCamera(false);void choosePhoto(file);}}/>}
  </section>;
}
export function PublicEnrollmentPermit({invitation}:{invitation:string}){
  const [details,setDetails]=useState<{team:string;tournament:string;terms:string[]}|null>(null),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();setDetails(null);setError('');
    fetch(`${API_URL}/player-enrollments/permits/public/${encodeURIComponent(invitation)}/`,{signal:controller.signal,credentials:'omit'}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.detail||'El enlace no está disponible.');if(!controller.signal.aborted)setDetails(data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();
  },[invitation]);
  return <main className="enrollment-page permit-public"><section className="registration-sheet"><div className="enrollment-public-brand no-print"><EnrollmentBrand/></div><h1 className="no-print">Permiso en línea</h1>{error?<p role="alert" className="error">{error}</p>:details?<PermitForm key={invitation} invitation={invitation} team={{name:details.team,tournament:details.tournament}} terms={details.terms}/>:<p role="status">Cargando permiso…</p>}</section></main>;
}
export function EnrollmentPermits({token,catalog}:{token:string;catalog:Catalog}){
  const [tournament,setTournament]=useState(''),[team,setTeam]=useState(''),[error,setError]=useState('');
  const [local,setLocal]=useState<{id:number;name:string;tournament:string}|null>(null),[saving,setSaving]=useState(false),[completed,setCompleted]=useState(false);
  const [now,setNow]=useState(Date.now());
  const [rows,setRows]=useState<Permit[]>([]),[count,setCount]=useState(0),[page,setPage]=useState(1),[status,setStatus]=useState(''),[loading,setLoading]=useState(true),[revision,setRevision]=useState(0),[selected,setSelected]=useState<Permit|null>(null);
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[historyTournament,setHistoryTournament]=useState(''),[historyTeam,setHistoryTeam]=useState('');
  const [dateFrom,setDateFrom]=useState(''),[dateTo,setDateTo]=useState('');
  const [filters,setFilters]=useState<{tournaments:string[];teams:string[]}>({tournaments:[],teams:[]});
  useEffect(()=>{const timer=window.setTimeout(()=>{setQuery(search.trim());setPage(1);},300);return()=>clearTimeout(timer);},[search]);
  const dialog=useRef<HTMLDialogElement>(null),localButton=useRef<HTMLButtonElement>(null);
  const selectedTeam=catalog.teams.find(t=>String(t.id)===team&&String(t.tournament)===tournament);
  const selectedTournament=catalog.tournaments.find(t=>String(t.id)===tournament&&t.is_active);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');
    const params=new URLSearchParams({page:String(page),status,search:query,tournament:historyTournament,team:historyTeam,date_from:dateFrom,date_to:dateTo});
    apiRequest<{results:Permit[];count:number;filters?:{tournaments:string[];teams:string[]}}>(`/player-enrollments/permits/?${params}`,token,{signal:controller.signal}).then(data=>{setRows(data.results);setCount(data.count);setFilters(data.filters||{tournaments:[],teams:[]});}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
  },[token,page,status,revision,query,historyTournament,historyTeam,dateFrom,dateTo]);
  useEffect(()=>{const next=rows.map(r=>Date.parse(r.expires_at)).filter(t=>t>now).sort((a,b)=>a-b)[0];if(!next)return;const timer=window.setTimeout(()=>setNow(Date.now()),Math.max(1,next-Date.now()+20));return()=>clearTimeout(timer);},[rows,now]);
  useEffect(()=>{if(!local)return;const node=dialog.current,overflow=document.body.style.overflow;document.body.style.overflow='hidden';node?.showModal();return()=>{node?.close();document.body.style.overflow=overflow;localButton.current?.focus();};},[local]);
  function closeLocal(){if(saving)return;if(!completed&&!window.confirm('¿Cerrar el permiso local? Los datos que no hayas enviado se perderán.'))return;setLocal(null);if(completed)setRevision(v=>v+1);}
  return <section className="permit-section"><Card as="section" className="permit-create no-print"><h2>Permisos de 24 horas</h2><p>Selecciona el equipo para completar la foto y firma del jugador en ventanilla.</p><div className="permit-fields">
    <Label>Torneo<NativeSelect aria-label="Torneo" value={tournament} onChange={e=>{setTournament(e.target.value);setTeam('');}}><option value="">Selecciona un torneo</option>{catalog.tournaments.filter(t=>t.is_active).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Label>
    <Label>Equipo<NativeSelect aria-label="Equipo" value={team} onChange={e=>{setTeam(e.target.value);}}><option value="">Selecciona un equipo</option>{catalog.teams.filter(t=>String(t.tournament)===tournament).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</NativeSelect></Label>
    </div><div className="permit-actions"><Button className="primary" ref={localButton} disabled={!selectedTeam||!selectedTournament} onClick={()=>{setCompleted(false);setSaving(false);setSelected(null);setLocal({id:selectedTeam!.id,name:selectedTeam!.name,tournament:selectedTournament!.name});}}>Permiso local</Button></div>
    </Card>{error&&<p role="alert" className="error no-print">{error}</p>}
    {selected&&<><div className="no-print"><Button onClick={()=>setSelected(null)}>Cerrar comprobante</Button></div><StoredPermit key={selected.id} row={selected} token={token}/></>}
    <Card as="section" className="permit-history no-print"><h2>Historial de permisos</h2><div className="permit-history-filters">
      <Label>Buscar jugador o folio<Input type="search" value={search} placeholder="Nombre o P-000123" onChange={e=>setSearch(e.target.value)}/></Label>
      <Label>Torneo del histórico<NativeSelect aria-label="Torneo del histórico" value={historyTournament} onChange={e=>{setHistoryTournament(e.target.value);setHistoryTeam('');setPage(1);}}><option value="">Todos los torneos</option>{filters.tournaments.map(name=><option key={name} value={name}>{name}</option>)}</NativeSelect></Label>
      <Label>Equipo del histórico<NativeSelect aria-label="Equipo del histórico" value={historyTeam} onChange={e=>{setHistoryTeam(e.target.value);setPage(1);}}><option value="">Todos los equipos</option>{filters.teams.map(name=><option key={name} value={name}>{name}</option>)}</NativeSelect></Label>
      <Label>Estado<NativeSelect aria-label="Estado" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Todos</option><option value="active">Vigentes</option><option value="expired">Vencidos</option></NativeSelect></Label>
      <Label>Emitidos desde<Input type="date" value={dateFrom} max={dateTo||undefined} onChange={e=>{setDateFrom(e.target.value);setPage(1);}}/></Label>
      <Label>Emitidos hasta<Input type="date" value={dateTo} min={dateFrom||undefined} onChange={e=>{setDateTo(e.target.value);setPage(1);}}/></Label>
      <Button type="button" onClick={()=>{setSearch('');setQuery('');setHistoryTournament('');setHistoryTeam('');setStatus('');setDateFrom('');setDateTo('');setPage(1);}}>Limpiar filtros</Button>
    </div><p role="status">{count} permiso(s) encontrados</p>
      {loading?<p role="status">Cargando permisos…</p>:<><div className="permit-list">{rows.map(row=><article key={row.id}><strong>{row.folio} · {row.name}</strong><p>{row.team} · {row.tournament}</p><p>{now<Date.parse(row.expires_at)?'Vigente':'Vencido'} · Vence {date(row.expires_at)}</p><Button onClick={()=>setSelected(row)}>Ver permiso {row.folio}</Button></article>)}</div>{!rows.length&&<p>No hay permisos con estos filtros.</p>}</>}
      <div className="permit-actions"><Button disabled={loading||page===1} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span>Página {page} de {Math.max(1,Math.ceil(count/20))}</span><Button disabled={loading||page*20>=count} onClick={()=>setPage(p=>p+1)}>Siguiente</Button></div></Card>
    <Dialog ref={dialog} className="local-enrollment-dialog permit-local-dialog no-print" aria-labelledby="permit-local-title" onCancel={event=>{event.preventDefault();closeLocal();}}>{local&&<><header className="local-enrollment-header"><div><h2 id="permit-local-title">Permiso local</h2><p>{local.tournament} · {local.name}</p></div><Button disabled={saving} onClick={closeLocal}>{completed?'Finalizar permiso local':'Cerrar permiso local'}</Button></header><div className="local-enrollment-content"><PermitForm key={local.id} embedded team={{name:local.name,tournament:local.tournament}} teamId={local.id} token={token} onIssued={()=>setCompleted(true)} onBusyChange={setSaving}/></div></>}</Dialog>
  </section>;
}
