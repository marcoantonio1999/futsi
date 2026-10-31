import {Button, Input, Label, Textarea} from '../../components/ui/enrollment-ui';
import {fetchEnrollmentDocument} from './fetchEnrollmentDocument';
import {useEffect,useRef,useState} from 'react';
import {apiRequest,apiFormRequestWithProgress} from '../../api';
import {TournamentDialog} from '../tournaments/TournamentDialog';
import {compressEnrollmentPhoto} from './compressEnrollmentPhoto';
import {CameraCapture} from './CameraCapture';
import {calendarDateValue, parseCalendarDate, displayCalendarDate} from './enrollmentDates';

export type AppealRow={id:number;player_name:string;status:string;starts_on?:string;ends_on?:string|null;payment_required?:boolean;fine_amount?:string|null;payment_folio?:string;payment_recorded_by?:string|null;payment_recorded_at?:string|null;appeal_status?:string;appeal_reason?:string;has_appeal_letter?:boolean;appeal_submitted_by?:string|null;appeal_submitted_at?:string|null;appeal_decision_reason?:string;appeal_decided_by?:string|null;appeal_decided_at?:string|null};
export const appealLabels:Record<string,string>={none:'Sin apelación',pending:'Pendiente',accepted:'Aceptada',rejected:'No aceptada'};
function nextDate(value?: string | null) {
  const date = parseCalendarDate(value || '');
  if (!date) return '';
  date.setDate(date.getDate() + 1);
  return date.getFullYear() <= 9999 ? calendarDateValue(date) : '';
}

type Action='appeal'|'accepted'|'rejected'|'payment';

export function SanctionActions({row,token,admin,canDecide=admin,onSaved}:{row:AppealRow;token:string;admin:boolean;canDecide?:boolean;onSaved:()=>void}){
  const [action,setAction]=useState<Action|null>(null),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState(''),[error,setError]=useState(''),[compressing,setCompressing]=useState(false);
  const [cameraOpen,setCameraOpen]=useState(false);
  const [changeReturn,setChangeReturn]=useState(false),[returnDate,setReturnDate]=useState('');
  const attachment=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!file){setPreview('');return}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url)},[file]);
  async function choose(photo?:File){if(!photo)return;setCompressing(true);setError('');try{setFile(await compressEnrollmentPhoto(photo))}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo preparar la foto.')}finally{setCompressing(false)}}
  const titles={appeal:'Apelar sanción',accepted:'Aceptar apelación',rejected:'No aceptar apelación',payment:'Registrar folio de pago'};
  return <div className="sanction-actions">
    {(row.appeal_status||'none')==='none'&&<Button type="button" onClick={()=>{setFile(null);setError('');setAction('appeal')}}>Apelar sanción</Button>}
    {canDecide&&row.appeal_status==='pending'&&<><Button type="button" onClick={()=>{setChangeReturn(false);setReturnDate(nextDate(row.ends_on));setAction('accepted')}}>Aceptar apelación</Button><Button type="button" onClick={()=>setAction('rejected')}>No aceptar apelación</Button></>}
    {admin&&row.payment_required&&!row.payment_folio&&<Button type="button" onClick={()=>setAction('payment')}>Registrar folio de pago</Button>}
    {action&&<TournamentDialog title={titles[action]} description={row.player_name} submitLabel={titles[action]} submitDisabled={cameraOpen||compressing} onClose={()=>{setCameraOpen(false);setAction(null)}} onSubmit={async form=>{
      if(compressing)throw new Error('Espera a que termine la compresión de la foto.');
      if(action==='accepted'&&changeReturn&&(!parseCalendarDate(returnDate)||(row.starts_on&&returnDate<=row.starts_on)))throw new Error('Selecciona una fecha de regreso posterior al inicio de la sanción.');
      if(action==='appeal'){
        if(!file)throw new Error('Toma o adjunta la foto de la carta escrita por el jugador.');
        const body=new FormData();body.set('letter',file);
        await apiFormRequestWithProgress(`/player-enrollments/sanctions/${row.id}/appeal/`,token,body,()=>{});
      }else await apiRequest(`/player-enrollments/sanctions/${row.id}/decision/`,token,{method:'POST',body:JSON.stringify({action,...(action==='accepted'&&changeReturn?{return_on:returnDate}:{}),...(action==='rejected'?{reason:form.get('reason')}:{}),folio:form.get('folio')})});
      onSaved();
    }}>
      {action==='appeal'?<><div hidden={cameraOpen}><p>Fotografía la carta redactada por la persona sancionada explicando los motivos de su apelación. La imagen será privada.</p>
        <Input ref={attachment} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>void choose(event.target.files?.[0])}/>
        <div className="sanction-actions"><Button type="button" disabled={compressing} onClick={()=>setCameraOpen(true)}>Tomar foto de la carta</Button><Button type="button" disabled={compressing} onClick={()=>attachment.current?.click()}>Adjuntar foto</Button></div>
        {compressing&&<p role="status">Preparando foto…</p>}{error&&<p role="alert" className="error">{error}</p>}{preview&&<img className="sanction-appeal-letter" src={preview} alt="Vista previa de la carta de apelación"/>}
      </div>{cameraOpen&&<CameraCapture embedded selfie={false} onClose={()=>setCameraOpen(false)} onCapture={photo=>{setCameraOpen(false);void choose(photo)}}/>}</>:action==='payment'?<><p>El folio acredita el pago registrado por administración. La sanción seguirá vigente hasta que también termine el periodo completo, incluido su último día. Una sanción sin término no se libera solo con el pago.</p><Label className="sanction-payment-field">Folio de pago<Input type="text" name="folio" required maxLength={100} autoComplete="off" placeholder="Ej. PAGO-000123"/></Label></>:action==='accepted'?<><p>Fecha de regreso actual: <strong>{nextDate(row.ends_on)?displayCalendarDate(nextDate(row.ends_on)):'Sin fecha definida'}</strong></p><Label className="sanction-return-toggle"><Input type="checkbox" checked={changeReturn} onChange={event=>setChangeReturn(event.target.checked)}/>Modificar fecha de regreso</Label>{changeReturn&&<Label className="sanction-return-date">Nueva fecha de regreso<Input type="date" name="return_on" required value={returnDate} min={nextDate(row.starts_on)} onChange={event=>setReturnDate(event.target.value)}/></Label>}<p>El regreso es el primer día fuera del periodo de sanción; el último día sancionado será el anterior. También debe estar registrado el folio de pago.</p></>:<><p>Esta decisión se conserva en el historial y no levanta la sanción. Para cumplirla se requieren el periodo completo y el folio de pago.</p>{action==='rejected'&&<Label>Motivo de la decisión<Textarea name="reason" required minLength={3} maxLength={2000} rows={4}/></Label>}</>}
    </TournamentDialog>}
  </div>;
}

export function SanctionAppealDetails({row,token}:{row:AppealRow;token:string}){
  const [letter,setLetter]=useState(''),[error,setError]=useState(''),[loading,setLoading]=useState(false);
  const url=useRef('');
  useEffect(()=>()=>{if(url.current)URL.revokeObjectURL(url.current)},[]);
  async function load(){setLoading(true);setError('');try{const response=await fetchEnrollmentDocument(`/player-enrollments/sanctions/${row.id}/appeal/`,token);if(!response.ok)throw new Error('No se pudo cargar la carta.');url.current=URL.createObjectURL(await response.blob());setLetter(url.current)}catch(reason){setError(reason instanceof Error?reason.message:'Carta no disponible.')}finally{setLoading(false)}}
  return <section className="sanction-appeal-details"><h3>Apelación y pago</h3><dl>
    <div><dt>Apelación</dt><dd>{appealLabels[row.appeal_status||'none']}</dd></div>
    {row.appeal_status==='accepted'&&<div><dt>Fecha de regreso</dt><dd>{nextDate(row.ends_on)?displayCalendarDate(nextDate(row.ends_on)):'Sin fecha definida'}</dd></div>}
    <div><dt>Registrada por</dt><dd>{row.appeal_submitted_by||'—'} {row.appeal_submitted_at&&new Date(row.appeal_submitted_at).toLocaleString('es-MX')}</dd></div>
    <div><dt>Decisión</dt><dd>{row.appeal_status==='accepted'?'Aceptada':row.appeal_decision_reason||'Sin decisión'} · {row.appeal_decided_by||'—'} {row.appeal_decided_at&&new Date(row.appeal_decided_at).toLocaleString('es-MX')}</dd></div>
    <div><dt>Folio de pago</dt><dd>{row.payment_folio|| (row.payment_required?'Pendiente':'No requerido (sanción histórica)')}</dd></div><div><dt>Pago registrado por</dt><dd>{row.payment_recorded_by||'—'} {row.payment_recorded_at&&new Date(row.payment_recorded_at).toLocaleString('es-MX')}</dd></div>
  </dl>{row.has_appeal_letter&&!letter&&<Button type="button" disabled={loading} onClick={()=>void load()}>{loading?'Cargando carta…':'Ver foto de la carta'}</Button>}{error&&<p role="alert">{error}</p>}{letter&&<img className="sanction-appeal-letter" src={letter} alt={`Carta de apelación de ${row.player_name}`}/>}</section>;
}
