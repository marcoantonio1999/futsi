import {useEffect,useRef,useState} from 'react';
import {apiRequest,ApiError} from '../../api';
import {readProfileCV,type CVText} from './readProfileCV';

type Candidate={id:number;name:string;exam_title:string};
type Match={match_status:string;candidate:Candidate|null;candidates:Candidate[];expected_cv_hash:string|null};
type Row={name:string;status:string;data?:CVText;match?:Match;error:string};
const labels:Record<string,string>={pending:'Sin procesar',matched:'Coincidencia única',saved:'Perfil actualizado',unchanged:'CV idéntico · sin cambios',unmatched:'Sin coincidencia',ambiguous:'Varias postulaciones coinciden',conflict:'Correo y teléfono no coinciden',ambiguous_contacts:'Varios contactos en el CV · revisar',duplicate:'Varios CV de esta carpeta coinciden con el mismo perfil',review:'Texto incompleto · revisar',error:'Error · no se reintenta automáticamente'};
const errorText=(e:unknown)=>e instanceof Error?e.message:'No se pudo completar la operación.';
const saved=(r:Row)=>r.status==='saved'||r.status==='unchanged';

export function ExamCVImport({token,exams,initialExam,onBusyChange,onUpdated,onClose}:{token:string;exams:{id:number;title:string}[];initialExam:string;onBusyChange:(busy:boolean)=>void;onUpdated:()=>Promise<void>;onClose:()=>void}) {
  const [exam,setExam]=useState(initialExam),[rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(''),[notice,setNotice]=useState(''),[error,setError]=useState(''),[filter,setFilter]=useState('all');
  const active=useRef(true),running=useRef(false),controller=useRef<AbortController|null>(null);
  useEffect(()=>{active.current=true;return()=>{active.current=false;controller.current?.abort();onBusyChange(false);};},[onBusyChange]);
  function publish(batch:Row[]){if(active.current)setRows([...batch]);}
  async function read(files:File[]) {
    if(running.current)return;
    const supported=files.filter(f=>/\.(pdf|txt)$/i.test(f.name)),ignored=files.length-supported.length;
    setError('');setNotice('');setFilter('all');
    if(!supported.length){setRows([]);setProgress('');setError('La selección no contiene CV en PDF o TXT.');return;}
    const batch:Row[]=supported.map(f=>({name:f.webkitRelativePath||f.name,status:'pending',error:''}));
    const cancellation=new AbortController();controller.current=cancellation;running.current=true;setBusy(true);onBusyChange(true);publish(batch);
    let stopped=false;
    try {
      for(let i=0;i<supported.length;i++) {
        if(!active.current||cancellation.signal.aborted){stopped=true;break;}
        const row=batch[i];setProgress(`Leyendo y buscando coincidencias: ${i+1} de ${supported.length}.`);
        try {
          row.data=await readProfileCV(supported[i]);
          if(cancellation.signal.aborted||!active.current){stopped=true;publish(batch);break;}
          if(row.data.warnings.length){row.status='review';row.error=row.data.warnings.join(' ');}
          else {
            row.match=await apiRequest<Match>('/recruitment-profiles/import-cv/',token,{method:'POST',signal:cancellation.signal,body:JSON.stringify({cv_text:row.data.cv_text,exam})});
            row.status=row.match.match_status;
          }
        }catch(e){row.status='error';row.error=cancellation.signal.aborted?'Carga detenida. Verifica el perfil antes de repetir un envío en curso.':errorText(e);if(cancellation.signal.aborted||(e instanceof ApiError&&[401,403].includes(e.status))){stopped=true;cancellation.abort();publish(batch);break;}}
        publish(batch);
      }
      // Preview the entire selection before any write, so duplicate files cannot
      // silently replace each other according to directory enumeration order.
      const counts=new Map<number,number>();
      for(const row of batch)if(row.status==='matched'&&row.match?.candidate)counts.set(row.match.candidate.id,(counts.get(row.match.candidate.id)||0)+1);
      for(const row of batch)if(row.status==='matched'&&row.match?.candidate&&(counts.get(row.match.candidate.id)||0)>1)row.status='duplicate';
      publish(batch);
      if(!stopped&&active.current) {
        const matches=batch.filter(r=>r.status==='matched');
        for(let i=0;i<matches.length;i++) {
          if(!active.current||cancellation.signal.aborted){stopped=true;break;}
          const row=matches[i];setProgress(`Actualizando perfiles: ${i+1} de ${matches.length}.`);
          try {
            const result=await apiRequest<{saved:boolean;unchanged:boolean}>('/recruitment-profiles/import-cv/',token,{method:'POST',signal:cancellation.signal,body:JSON.stringify({cv_text:row.data!.cv_text,exam,commit:true,expected_cv_hash:row.match!.expected_cv_hash})});
            row.status=result.unchanged?'unchanged':'saved';
          }catch(e){row.status='error';row.error=cancellation.signal.aborted?'Carga detenida. El resultado del envío en curso puede ser incierto; verifica el perfil antes de repetirlo.':errorText(e);if(cancellation.signal.aborted||(e instanceof ApiError&&[401,403].includes(e.status))){stopped=true;cancellation.abort();publish(batch);break;}}
          publish(batch);
        }
      }
      if(active.current) {
        const updated=batch.filter(r=>r.status==='saved').length,unchanged=batch.filter(r=>r.status==='unchanged').length;
        setProgress(stopped?'Carga detenida. No se enviarán más solicitudes.':'Carga finalizada.');
        setNotice(`${updated} perfiles actualizados; ${unchanged} CV idénticos; ${batch.filter(r=>!saved(r)).length} archivos sin asignar o para revisión. ${ignored} archivos de otros tipos omitidos.`);
        if(updated||unchanged)try{await onUpdated();}catch(e){setError(`Los resultados de la carga se conservaron, pero no se pudo actualizar la lista: ${errorText(e)}`);}
      }
    }finally{running.current=false;if(active.current){setBusy(false);onBusyChange(false);}}
  }
  const visible=rows.filter(r=>filter==='all'||(filter==='saved'?saved(r):!saved(r)));
  async function copy(row:Row){try{await navigator.clipboard.writeText(row.data!.cv_text);setNotice(`Texto copiado: ${row.name}`);}catch{setError('No se pudo usar el portapapeles. Abre «Ver texto extraído», selecciona el texto y cópialo manualmente.');}}
  return <section className="exam-card exam-cv-import" aria-label="Cargar CV por carpeta"><h2>Cargar CV en PDF o TXT</h2><p>Elige una carpeta y sus subcarpetas, o varios archivos. El PDF se lee en tu navegador: solo se envía y guarda su texto, nunca el archivo. Sin OCR, IA ni procesos en segundo plano.</p>
    <p>Al seleccionar los archivos, las coincidencias únicas por correo o teléfono actualizarán automáticamente el texto del CV anterior. Se conservan el formato de empleo, el puesto y la calificación. Los nombres de archivo no se usan para vincular personas.</p>
    <label>Postulación para la carga de CV<select disabled={busy} value={exam} onChange={e=>setExam(e.target.value)}><option value="">Todas · las coincidencias entre varias postulaciones requieren revisión</option>{exams.map(e=><option value={e.id} key={e.id}>{e.title}</option>)}</select></label>
    <label>Seleccionar carpeta de CV<input type="file" multiple {...{webkitdirectory:''}} disabled={busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void read(files);}}/></label>
    <label>Seleccionar CV sueltos PDF o TXT<input type="file" multiple accept=".pdf,.txt,application/pdf,text/plain" disabled={busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void read(files);}}/></label>
    <p className="exam-muted">Hasta 8 MB, 20 páginas y 80 000 caracteres por CV. Los escaneos sin texto, contactos ambiguos y CV duplicados para el mismo perfil no se asignan automáticamente. Los textos sin asignar permanecen solo en esta pestaña: cópialos antes de salir.</p>
    {progress&&<p role="status">{progress}</p>}{notice&&<p className="exam-notice" role="status">{notice}</p>}{error&&<p className="exam-error" role="alert">{error}</p>}
    {Boolean(rows.length)&&<label>Mostrar resultados de CV<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">Todos los archivos ({rows.length})</option><option value="pending">Sin asignar / para revisión ({rows.filter(r=>!saved(r)).length})</option><option value="saved">Actualizados / sin cambios ({rows.filter(saved).length})</option></select></label>}
    {visible.map(row=><article className="exam-import-row" key={row.name}><h3>{row.name}</h3><p><strong>{labels[row.status]||row.status}</strong>{row.match?.candidate?` · ${row.match.candidate.name} · ${row.match.candidate.exam_title}`:''}</p>{row.error&&<p className="exam-error" role="alert">{row.error}</p>}{row.data&&<><details><summary>Ver texto extraído del CV</summary><label>Texto extraído del CV<textarea aria-label="Texto extraído del CV" readOnly className="exam-profile-text" value={row.data.cv_text} onFocus={e=>e.target.select()}/></label></details><button type="button" onClick={()=>void copy(row)}>Copiar texto del CV</button>{!saved(row)&&<p className="exam-muted">Vero puede copiar este texto y pegarlo en el perfil correcto mediante «Ver / editar perfil». No se creó ni modificó otro perfil automáticamente.</p>}</>}</article>)}
    <div className="exam-actions">{busy&&<button type="button" onClick={()=>controller.current?.abort()}>Detener carga de CV</button>}<button type="button" disabled={busy} onClick={onClose}>Cerrar carga de CV</button></div>
  </section>;
}
