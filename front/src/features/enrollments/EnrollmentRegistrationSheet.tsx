import { useCallback, useEffect, useState } from 'react';
import { API_URL, apiRequest } from '../../api';
import { enrollmentSignatureKind } from './enrollmentSignature';
import { renderRegistrationPdf } from './renderRegistrationPdf';
import './registrationSheet.css';
import {fetchEnrollmentDocument} from './fetchEnrollmentDocument';

type Document = { id: number; kind: string };
type Enrollment = { id: number; name: string; birth_date: string; identity_type: string; team: string; tournament: string;
  phone: string; phone_secondary: string; guardian_name: string; signed_at: string;
  terms_text: string[]; documents: Document[] };
const labels: Record<string,string> = { player_photo:'Foto del jugador', player_signature:'Firma del jugador',
  guardian_signature:'Firma del tutor', ine_front:'INE frente', ine_back:'INE reverso',
  identity_document:'Pasaporte / cartilla', minor_credential:'Documento del menor', curp:'CURP',
  guardian_ine_front:'INE del tutor frente', guardian_ine_back:'INE del tutor reverso' };

function PrivateDocument({document,token,onReady}:{document:Document;token:string;onReady:(id:number,ready:boolean)=>void}) {
  const [pages,setPages]=useState<string[]>([]),[failed,setFailed]=useState(false),[loaded,setLoaded]=useState<Set<number>>(()=>new Set());
  useEffect(()=>{
    const controller=new AbortController();let active=true,url='';
    setPages([]);setFailed(false);setLoaded(new Set());onReady(document.id,false);
    fetchEnrollmentDocument(`/player-enrollments/documents/${document.id}/`,token,controller.signal)
      .then(async response=>{
        const type=(response.headers.get('Content-Type')||'').split(';')[0];
        if(!response.ok || !['image/png','image/jpeg','image/webp','application/pdf'].includes(type))throw new Error('Documento no disponible');
        const blob=await response.blob();
        if(type==='application/pdf') {
          const images=await renderRegistrationPdf(blob,controller.signal);if(active)setPages(images);
        } else if(active) { url=URL.createObjectURL(blob);setPages([url]); }
      }).catch(()=>{if(active){setFailed(true);onReady(document.id,false);}});
    return ()=>{active=false;controller.abort();if(url)URL.revokeObjectURL(url);};
  },[document.id,token,onReady]);
  const label=labels[document.kind]||'Documento de inscripción';
  return <div className="registration-document"><p>{label}</p>{failed ? <p role="status">Documento no disponible. No se sustituyó por otro archivo.</p> : !pages.length ? <p role="status">Cargando documento…</p> : pages.map((src,index)=><img key={src} src={src} alt={pages.length===1?label:`${label} · página ${index+1}`} onLoad={()=>{setLoaded(previous=>{const next=new Set(previous);next.add(index);return next;});}} onError={()=>{setFailed(true);onReady(document.id,false);}}/>)}
    {!failed&&loaded.size===pages.length&&pages.length>0&&<DocumentReady id={document.id} onReady={onReady}/>}
  </div>;
}

function DocumentReady({id,onReady}:{id:number;onReady:(id:number,ready:boolean)=>void}) {
  useEffect(()=>{onReady(id,true);},[id,onReady]);return null;
}

export function EnrollmentRegistrationSheet({enrollmentId,token,onBack}:{enrollmentId:number;token:string;onBack:()=>void}) {
  const [record,setRecord]=useState<Enrollment|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [readyDocuments,setReadyDocuments]=useState<Record<number,boolean>>({});
  const documentReady=useCallback((id:number,ready:boolean)=>setReadyDocuments(previous=>previous[id]===ready?previous:{...previous,[id]:ready}),[]);
  useEffect(()=>{
    const controller=new AbortController();setRecord(null);setError('');setReadyDocuments({});
    apiRequest<{results:Enrollment[]}>(`/player-enrollments/?enrollment_id=${enrollmentId}`,token,{signal:controller.signal})
      .then(data=>{if(controller.signal.aborted)return;const found=data.results.find(row=>row.id===enrollmentId);if(!found)throw new Error('Esta inscripción no está disponible con tu acceso.');setRecord(found);})
      .catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:'No pudimos cargar la inscripción.');});
    return ()=>controller.abort();
  },[enrollmentId,token,retry]);
  const visibleDocuments=record?.documents.filter(doc=>!['player_signature','guardian_signature'].includes(doc.kind)||doc.kind===enrollmentSignatureKind(record))||[];
  const printReady=!!record&&visibleDocuments.every(doc=>readyDocuments[doc.id]===true);
  return <section className="registration-sheet signed-sheet registration-detail" aria-label="Hoja de inscripción firmada">
    <div className="registration-detail-toolbar no-print"><button type="button" onClick={onBack}>Volver a jugadores</button><h2>Hoja de inscripción</h2><button type="button" className="primary" disabled={!printReady} onClick={()=>{if(printReady)window.print();}}>Imprimir / guardar PDF</button></div>
    {record&&!printReady&&<p role="status" className="no-print">Espera a que carguen todos los documentos para imprimir. Si alguno no está disponible, recarga la hoja.</p>}
    {error ? <p role="alert" className="error">{error} <button type="button" onClick={()=>setRetry(value=>value+1)}>Volver a intentar</button></p> : !record ? <p role="status">Cargando inscripción…</p> : <>
      <div className="sheet-top"><section className="documentation-frame"><h2>Documentación presentada</h2>
        {record.documents.filter(doc=>!['player_photo','player_signature','guardian_signature'].includes(doc.kind)).map(doc=><PrivateDocument key={doc.id} document={doc} token={token} onReady={documentReady}/>)}
        {!record.documents.some(doc=>!['player_photo','player_signature','guardian_signature'].includes(doc.kind))&&<p>No hay credenciales conservadas para esta inscripción.</p>}
      </section><section className="player-frame"><div className="photo-and-signatures">
        <div>{record.documents.filter(doc=>doc.kind==='player_photo').map(doc=><PrivateDocument key={doc.id} document={doc} token={token} onReady={documentReady}/>)}</div>
        <div>{record.documents.filter(doc=>doc.kind===enrollmentSignatureKind(record)).map(doc=><PrivateDocument key={doc.id} document={doc} token={token} onReady={documentReady}/>)}
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
