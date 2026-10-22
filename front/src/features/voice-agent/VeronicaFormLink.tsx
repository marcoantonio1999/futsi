import {useEffect,useState} from 'react';
import {apiRequest} from '../../api';
import {inputClass,primaryButtonClass} from './model';
export function VeronicaFormLink({token}:{token:string}) {
  const [status,setStatus]=useState<{ready:boolean;url:string;detail:string}|null>(null),[message,setMessage]=useState('');
  useEffect(()=>{apiRequest<{ready:boolean;url:string;detail:string}>('/veronica/form-link/',token).then(setStatus).catch(e=>setMessage(e.message));},[token]);
  return <section className="comm-panel"><h3>Formulario de postulación</h3>{message&&<p role="status">{message}</p>}{status?<><p>{status.ready?'Enlace automático activo.':'El envío automático no está disponible; revisa la conexión de Vero.'}</p><p>{status.detail}</p><label>Enlace público<input className={inputClass} readOnly value={status.url} onFocus={e=>e.target.select()}/></label><button className={primaryButtonClass} onClick={()=>void navigator.clipboard.writeText(status.url).then(()=>setMessage('Enlace copiado.')).catch(()=>setMessage('Selecciona y copia el enlace del campo.'))}>Copiar enlace</button><p>Consulta los datos recibidos en Exámenes → Formatos postulaciones. Abrir esta ventana no envía mensajes.</p></>:!message&&<p>Cargando estado…</p>}</section>;
}
