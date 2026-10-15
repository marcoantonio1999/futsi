import {useEffect,useRef,useState} from 'react';
import {API_URL,apiRequest,apiFormRequestWithProgress} from '../../api';
import {TournamentDialog} from '../tournaments/TournamentDialog';
import {compressEnrollmentPhoto} from './compressEnrollmentPhoto';
import {CameraCapture} from './CameraCapture';

export type AppealRow={id:number;player_name:string;status:string;payment_required?:boolean;fine_amount?:string|null;payment_folio?:string;payment_recorded_by?:string|null;payment_recorded_at?:string|null;appeal_status?:string;appeal_reason?:string;has_appeal_letter?:boolean;appeal_submitted_by?:string|null;appeal_submitted_at?:string|null;appeal_decision_reason?:string;appeal_decided_by?:string|null;appeal_decided_at?:string|null};
export const appealLabels:Record<string,string>={none:'Sin apelación',pending:'Pendiente',accepted:'Aceptada',rejected:'No aceptada'};
type Action='appeal'|'accepted'|'rejected'|'payment';

export function SanctionActions({row,token,admin,onSaved}:{row:AppealRow;token:string;admin:boolean;onSaved:()=>void}){
  const [action,setAction]=useState<Action|null>(null),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[error,setError]=useState(''),[compressing,setCompressing]=useState(false);
  const [cameraOpen,setCameraOpen]=useState(false);
  const attachment=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!file){setPreview('');return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file]);
  async function choose(photo?:File){if(!photo)return;setCompressing(true);setError('');try{setFile(await compressEnrollmentPhoto(photo))}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo preparar la foto.')}finally{setCompressing(false)}}
  const titles={appeal:'Apelar sanción',accepted:'Aceptar apelación',rejected:'No aceptar apelación',payment:'Registrar folio de pago'};
  return <div className="sanction-actions">
    {(row.appeal_status||'none')==='none'&&<button type="button" onClick={()=>{setFile(null);setError('');setAction('appeal')}}>Apelar sanción</button>}
    {admin&&row.appeal_status==='pending'&&<><button type="button" onClick={()=>setAction('accepted')}>Aceptar apelación</button><button type="button" onClick={()=>setAction('rejected')}>No aceptar apelación</button></>}
    {admin&&row.payment_required&&!row.payment_folio&&<button type="button" onClick={()=>setAction('payment')}>Registrar folio de pago</button>}
    {action&&<TournamentDialog title={titles[action]} description={row.player_name} submitLabel={titles[action]} submitDisabled={cameraOpen||compressing} onClose={()=>{setCameraOpen(false);setAction(null)}} onSubmit={async form=>{
      if(compressing)throw new Error('Espera a que termine la compresión de la foto.');
      if(action==='appeal'){
        if(!file)throw new Error('Toma o adjunta la foto de la carta escrita por el jugador.');
        const body=new FormData();body.set('reason',String(form.get('reason')));body.set('letter',file);
        await apiFormRequestWithProgress(`/player-enrollments/sanctions/${row.id}/appeal/`,token,body,()=>{});
      }else await apiRequest(`/player-enrollments/sanctions/${row.id}/decision/`,token,{method:'POST',body:JSON.stringify({action,reason:form.get('reason'),folio:form.get('folio')})});
      onSaved();
    }}>
      {action==='appeal'?<><div hidden={cameraOpen}><p>Fotografía la carta redactada por la persona sancionada explicando los motivos de su apelación. La imagen será privada.</p><label>Motivos de la apelación<textarea name="reason" required minLength={10} maxLength={4000} rows={4}/></label>
        <input ref={attachment} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>void choose(event.target.files?.[0])}/>
        <div className="sanction-actions"><button type="button" disabled={compressing} onClick={()=>setCameraOpen(true)}>Tomar foto de la carta</button><button type="button" disabled={compressing} onClick={()=>attachment.current?.click()}>Adjuntar foto</button></div>
        {compressing&&<p role="status">Preparando foto…</p>}{error&&<p role="alert" className="error">{error}</p>}{preview&&<img className="sanction-appeal-letter" src={preview} alt="Vista previa de la carta de apelación"/>}
      </div>{cameraOpen&&<CameraCapture embedded selfie={false} onClose={()=>setCameraOpen(false)} onCapture={photo=>{setCameraOpen(false);void choose(photo)}}/>}</>:action==='payment'?<><p>El folio acredita el pago registrado por administración. La sanción seguirá vigente hasta que también termine el periodo completo, incluido su último día. Una sanción sin término no se libera solo con el pago.</p><label>Folio de pago<input name="folio" required maxLength={100} autoComplete="off"/></label></>:<><p>Esta decisión se conserva en el historial y no levanta la sanción. Para cumplirla se requieren el periodo completo y el folio de pago.</p><label>Motivo de la decisión<textarea name="reason" required minLength={3} maxLength={2000} rows={4}/></label></>}
    </TournamentDialog>}
  </div>;
}

export function SanctionAppealDetails({row,token}:{row:AppealRow;token:string}){
  const [letter,setLetter]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const url=useRef('');
  useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current)},[]);
  async function load(){setLoading(true);setError('');try{const response=await fetch(`${API_URL}/player-enrollments/sanctions/${row.id}/appeal/`,{headers:{Authorization:`Token ${token}`}});if(!response.ok)throw new Error('No se pudo cargar la carta.');url.current=URL.createObjectURL(await response.blob());setLetter(url.current)}catch(reason){setError(reason instanceof Error?reason.message:'Carta no disponible.')}finally{setLoading(false)}}
  return <section className="sanction-appeal-details"><h3>Apelación y pago</h3><dl>
    <div><dt>Apelación</dt><dd>{appealLabels[row.appeal_status||'none']}</dd></div>
    <div><dt>Motivos</dt><dd>{row.appeal_reason||'—'}</dd></div><div><dt>Registrada por</dt><dd>{row.appeal_submitted_by||'—'} {row.appeal_submitted_at&&new Date(row.appeal_submitted_at).toLocaleString('es-MX')}</dd></div>
    <div><dt>Decisión</dt><dd>{row.appeal_decision_reason||'Sin decisión'} · {row.appeal_decided_by||'—'} {row.appeal_decided_at&&new Date(row.appeal_decided_at).toLocaleString('es-MX')}</dd></div>
    <div><dt>Sanción económica</dt><dd>{row.fine_amount?`$${row.fine_amount} MXN`:'Importe no especificado'}</dd></div><div><dt>Folio de pago</dt><dd>{row.payment_folio|| (row.payment_required?'Pendiente':'No requerido (sanción histórica)')}</dd></div><div><dt>Pago registrado por</dt><dd>{row.payment_recorded_by||'—'} {row.payment_recorded_at&&new Date(row.payment_recorded_at).toLocaleString('es-MX')}</dd></div>
  </dl>{row.has_appeal_letter&&!letter&&<button type="button" disabled={loading} onClick={()=>void load()}>{loading?'Cargando carta…':'Ver foto de la carta'}</button>}{error&&<p role="alert">{error}</p>}{letter&&<img className="sanction-appeal-letter" src={letter} alt={`Carta de apelación de ${row.player_name}`}/>}</section>;
}
