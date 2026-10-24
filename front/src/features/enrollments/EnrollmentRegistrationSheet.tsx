import { useEffect, useState } from 'react';
import { API_URL, apiRequest } from '../../api';
import { enrollmentSignatureKind } from './enrollmentSignature';
import './registrationSheet.css';

type Document = { id: number; kind: string };
type Enrollment = { id: number; name: string; birth_date: string; identity_type: string; team: string; tournament: string;
  phone: string; phone_secondary: string; guardian_name: string; signed_at: string;
  terms_text: string[]; documents: Document[] };
const labels: Record<string,string> = { player_photo:'Foto del jugador', player_signature:'Firma del jugador',
  guardian_signature:'Firma del tutor', ine_front:'INE frente', ine_back:'INE reverso',
  identity_document:'Pasaporte / cartilla', minor_credential:'Credencial del menor', curp:'CURP',
  guardian_ine_front:'INE del tutor frente', guardian_ine_back:'INE del tutor reverso' };

function PrivateDocument({document,token}:{document:Document;token:string}) {
  const [asset,setAsset]=useState<{url:string;type:string}|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();let active=true,url='';
    fetch(`${API_URL}/player-enrollments/documents/${document.id}/`,{headers:{Authorization:'Token '+token},signal:controller.signal})
      .then(async response=>{
        const type=(response.headers.get('Content-Type')||'').split(';')[0];
        if(!response.ok || !['image/png','image/jpeg','image/webp','application/pdf'].includes(type))throw new Error('Documento no disponible');
        url=URL.createObjectURL(await response.blob());if(active)setAsset({url,type});else URL.revokeObjectURL(url);
      }).catch(()=>{if(active)setFailed(true);});
    return ()=>{active=false;controller.abort();if(url)URL.revokeObjectURL(url);};
  },[document.id,token]);
  const label=labels[document.kind]||'Documento de inscripción';
  return <div className="registration-document"><p>{label}</p>{failed ? <p role="status">Documento no disponible. No se sustituyó por otro archivo.</p> : !asset ? <p role="status">Cargando documento…</p> : <>
    {asset.type.startsWith('image/') ? <img src={asset.url} alt={label}/> : <p>Documento PDF: descárgalo para consultarlo.</p>}
    <a className="no-print" href={asset.url} download={`inscripcion-${document.id}-${document.kind}.${asset.type==='application/pdf'?'pdf':asset.type==='image/jpeg'?'jpg':asset.type==='image/webp'?'webp':'png'}`}>Descargar {label.toLowerCase()}</a>
  </>}</div>;
}

export function EnrollmentRegistrationSheet({enrollmentId,token,onBack}:{enrollmentId:number;token:string;onBack:()=>void}) {
  const [record,setRecord]=useState<Enrollment|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setRecord(null);setError('');
    apiRequest<{results:Enrollment[]}>(`/player-enrollments/?enrollment_id=${enrollmentId}`,token,{signal:controller.signal})
      .then(data=>{if(controller.signal.aborted)return;const found=data.results.find(row=>row.id===enrollmentId);if(!found)throw new Error('Esta inscripción no está disponible con tu acceso.');setRecord(found);})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'No pudimos cargar la inscripción.');});
    return ()=>controller.abort();
  },[enrollmentId,token,retry]);
  return <section className="registration-sheet signed-sheet registration-detail" aria-label="Hoja de inscripción firmada">
    <div className="registration-detail-toolbar no-print"><button type="button" onClick={onBack}>Volver a jugadores</button><h2>Hoja de inscripción</h2></div>
    {error ? <p role="alert" className="error">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Volver a intentar</button></p> : !record ? <p role="status">Cargando inscripción…</p> : <>
      <div className="sheet-top"><section className="documentation-frame"><h2>Documentación presentada</h2>
        {record.documents.filter(doc=>!['player_photo','player_signature','guardian_signature'].includes(doc.kind)).map(doc=><PrivateDocument key={doc.id} document={doc} token={token}/>)}
        {!record.documents.some(doc=>!['player_photo','player_signature','guardian_signature'].includes(doc.kind))&&<p>No hay credenciales conservadas para esta inscripción.</p>}
      </section><section className="player-frame"><div className="photo-and-signatures">
        <div>{record.documents.filter(doc=>doc.kind==='player_photo').map(doc=><PrivateDocument key={doc.id} document={doc} token={token}/>)}</div>
        <div>{record.documents.filter(doc=>doc.kind===enrollmentSignatureKind(record)).map(doc=><PrivateDocument key={doc.id} document={doc} token={token}/>)}
        {!record.documents.some(doc=>doc.kind===enrollmentSignatureKind(record))&&<p>{record.identity_type==='minor'?'Firma del tutor no disponible.':'Firma del jugador no disponible.'}</p>}</div>
      </div><div className="player-fields"><p className="full">NOMBRE<br/><strong>{record.name}</strong></p><p>EQUIPO<br/>{record.team}</p><p>TORNEO<br/>{record.tournament}</p>
        <p>TELÉFONO DE CONTACTO<br/>{record.phone}</p><p>TELÉFONO DE EMERGENCIA<br/>{record.phone_secondary||'No registrado'}</p>
        <p>NACIMIENTO<br/>{record.birth_date}</p><p>FIRMADO<br/>{new Date(record.signed_at).toLocaleString('es-MX')}</p>
      </div></section></div>
      <section className="commitments"><h2>Compromisos Generales</h2>{record.terms_text.map((term,index)=><p key={index}>{term}</p>)}
        {record.guardian_name&&<p>Yo {record.guardian_name}, como tutor de {record.name}, autorizo la participación del menor, deslindando de toda responsabilidad a la liga, al club, al colegio y a su personal.</p>}
      </section>
    </>}
  </section>;
}
