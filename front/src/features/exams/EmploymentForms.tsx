import {useEffect,useRef,useState,type FormEvent} from 'react';
import {API_URL,apiRequest} from '../../api';
import logo from './assets/employment-bpower-logo.jpg';
import './exams.css';
import './EmploymentForms.css';

type Field={key:string;label:string;required:boolean;kind:string;sensitive:boolean};
type Group={title:string;fields:Field[]};
type Section={title:string;description?:string;fields?:Field[];groups?:Group[]};
type Schema={title:string;sections:Section[]};
type Candidate={id:number;name:string;email:string;phone:string;exam_title:string};
type Application={id:number;name:string;email:string;phone:string;position:string;submitted_at:string;receipt:string;link_status:string;attempt_id:number|null;exam_title:string|null;seen:boolean;seen_at:string|null;seen_by:string|null;fields?:Record<string,string>;candidates?:Candidate[]};
type ApplicationPage={public_url:string;sections:Section[];count:number;page:number;results:Application[]};
const errorText=(e:unknown)=>e instanceof Error?e.message:'No se pudo completar la operación.';
const statusLabel=(s:string)=>({linked:'Vinculado a examen',pending:'Sin examen coincidente',review:'Revisar coincidencia'}[s]||s);
const allFields=(sections:Section[])=>sections.flatMap(s=>s.fields||s.groups!.flatMap(g=>g.fields));

export function PublicEmploymentForm({examToken=''}:{examToken?:string}) {
  const [schema,setSchema]=useState<Schema|null>(null),[fields,setFields]=useState<Record<string,string>>({});
  const [consent,setConsent]=useState(false),[sensitiveConsent,setSensitiveConsent]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [received,setReceived]=useState<{receipt:string;submitted_at:string}|null>(null);
  const [examTitle,setExamTitle]=useState('');
  const key=useRef(crypto.randomUUID()),sending=useRef(false);
  useEffect(()=>{
    document.title='Solicitud de empleo · BPower Academy';
    let active=true;
    Promise.all([fetch(`${API_URL}/public-employment-form/`).then(async r=>{if(!r.ok)throw new Error('No se pudo cargar el formulario. Recarga para volver a intentar.');return r.json() as Promise<Schema>;}),
      examToken?fetch(`${API_URL}/public-exams/${encodeURIComponent(examToken)}/`).then(async r=>{if(!r.ok)throw new Error('El enlace de la evaluación no es válido.');return r.json() as Promise<{title:string}>;}):Promise.resolve(null)])
      .then(([form,exam])=>{if(active){setSchema(form);if(exam){setExamTitle(exam.title);setFields(f=>({...f,puesto_solicitado:exam.title}));}}})
      .catch(e=>{if(active)setError(errorText(e));});
    return()=>{active=false;};
  },[examToken]);
  async function submit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();if(sending.current)return;sending.current=true;setBusy(true);setError('');
    try{
      const response=await fetch(`${API_URL}/public-employment-form/`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields,consent,sensitive_consent:sensitiveConsent,submit_key:key.current,exam_token:examToken,website:new FormData(e.currentTarget).get('website')||''})});
      const data=await response.json();if(!response.ok)throw new Error(data.detail||'No se pudo guardar. Tus datos siguen aquí; intenta de nuevo cuando tengas conexión.');
      setReceived(data);setFields({});window.scrollTo({top:0});
    }catch(e){setError(errorText(e));}finally{sending.current=false;setBusy(false);}
  }
  const input=(f:Field)=><label key={f.key}>{f.label}{f.required?' *':f.sensitive?' (opcional)':''}<input name={f.key} type={f.kind} maxLength={['puesto_solicitado','nombres','apellido_paterno','apellido_materno','firma_solicitante'].includes(f.key)?180:f.key==='correo'?254:2000} required={f.required} value={fields[f.key]||''} readOnly={f.key==='puesto_solicitado'&&Boolean(examTitle)} autoComplete={f.key==='correo'?'email':f.key==='telefono'?'tel':f.key==='nombres'?'given-name':'off'} onChange={e=>setFields({...fields,[f.key]:e.target.value})}/></label>;
  return <main className="exam-app employment-public"><div className="employment-sheet"><header className="employment-banner"><img src={logo} alt="BPower Academy"/><div><h1>Solicitud de empleo</h1><p>Tu perfil · Tu experiencia</p></div></header>
    {error&&<p className="exam-error" role="alert">{error}</p>}
    {received?<section className="employment-receipt"><h2>Gracias. Recibimos tu postulación.</h2><p>Tu información se guardó correctamente. Recursos Humanos podrá revisarla; no necesitas enviar un PDF.</p><p>Folio: <strong>{received.receipt}</strong></p><p>{new Date(received.submitted_at).toLocaleString('es-MX')}</p><p>Ya puedes cerrar esta página.</p></section>:schema?<form onSubmit={submit}><p>Completa tus datos. Los campos con * son obligatorios. No necesitas crear una cuenta ni adjuntar archivos.</p><p>La información se comparte únicamente con Recursos Humanos de BPower para revisar tu postulación. No incluyas números de identificación, datos bancarios ni información de otras personas sin su autorización.</p>
      <div className="employment-honeypot" aria-hidden="true"><label>Sitio web<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
      {schema.sections.map((section,i)=><section className="employment-section" key={section.title}><h2><span>{String(i+1).padStart(2,'0')}</span>{section.title}</h2>{section.description&&<p>{section.description}</p>}
        {section.fields?<div className="employment-fields">{section.fields.filter(f=>!f.sensitive).map(input)}</div>:section.groups?.map(group=><fieldset className="employment-group" key={group.title}><legend>{group.title}</legend><div className="employment-fields">{group.fields.map(input)}</div></fieldset>)}
        {section.fields?.some(f=>f.sensitive)&&<details className="employment-optional"><summary>Datos personales opcionales</summary><p>Puedes dejar todos estos campos vacíos. Si decides proporcionarlos, autoriza expresamente su tratamiento. No se usan para calificar el examen ni para decisiones automáticas de contratación.</p><div className="employment-fields">{section.fields.filter(f=>f.sensitive).map(input)}</div></details>}
      </section>)}
      <label className="exam-consent"><input type="checkbox" checked={consent} required onChange={e=>setConsent(e.target.checked)}/><span>Autorizo a BPower Academy y su equipo de Recursos Humanos a guardar mis datos para revisar y dar seguimiento a esta postulación. Declaro que la información proporcionada es correcta.</span></label>
      {schema.sections.some(s=>s.fields?.some(f=>f.sensitive&&fields[f.key]))&&<label className="exam-consent"><input type="checkbox" checked={sensitiveConsent} required onChange={e=>setSensitiveConsent(e.target.checked)}/><span>Autorizo expresamente el tratamiento de los datos personales sensibles y opcionales que decidí proporcionar, exclusivamente para la revisión de esta postulación.</span></label>}
      <p>Tu nombre al final identifica al solicitante; no constituye una firma de contrato laboral.</p><button className="exam-primary" disabled={busy}>{busy?'Enviando…':'Enviar postulación'}</button><p className="exam-muted">No cierres la página hasta ver la confirmación. Si falla el envío, se mostrará el error; no se reintenta automáticamente.</p>
    </form>:!error&&<p role="status">Cargando formulario…</p>}
    <footer>B·POWER ACADEMY <span>bpoweracademy.mx</span></footer>
  </div></main>;
}

function ApplicationSeen({row,busy,onChange}:{row:Application;busy:boolean;onChange:(seen:boolean)=>void}) {
  return <div className="employment-seen"><label><input type="checkbox" aria-label={`Ya visto: ${row.name}`} checked={Boolean(row.seen)} disabled={busy} onChange={e=>onChange(e.target.checked)}/><span>Ya visto</span></label>{row.seen_at&&<p className="exam-muted">Marcado por {row.seen_by||'Recursos Humanos'} · {new Date(row.seen_at).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})} (CDMX)</p>}</div>;
}

export function EmploymentFormsAdmin({token,exams}:{token:string;exams:{id:number;title:string;public_token:string}[]}) {
  const [page,setPage]=useState<ApplicationPage|null>(null),[detail,setDetail]=useState<Application|null>(null);
  const [q,setQ]=useState(''),[position,setPosition]=useState(''),[status,setStatus]=useState(''),[seen,setSeen]=useState('');
  const [applied,setApplied]=useState({q:'',position:'',status:'',seen:''}),[linkExam,setLinkExam]=useState(''),[chosen,setChosen]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function run(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(errorText(e));}finally{setBusy(false);}}
  async function load(filters=applied,p=1){const query=new URLSearchParams({...filters,page:String(p)});const result=await apiRequest<ApplicationPage>(`/recruitment-applications/?${query}`,token);const last=Math.max(1,Math.ceil(result.count/50));if(p>last){await load(filters,last);return;}setPage(result);}
  useEffect(()=>{void run(()=>load({q:'',position:'',status:'',seen:''}));},[token]);
  async function markSeen(row:Application,value:boolean){await run(async()=>{
    const updated=await apiRequest<Application>(`/recruitment-applications/${row.id}/`,token,{method:'POST',body:JSON.stringify({seen:value})});
    setPage(p=>p?{...p,results:p.results.map(r=>r.id===updated.id?{...r,...updated}:r)}:p);
    setDetail(d=>d?.id===updated.id?{...d,...updated}:d);
    setNotice(updated.seen?'Postulación marcada como ya vista. No se envió ningún mensaje ni enlace de Zoom.':'Postulación marcada como sin ver.');
    try{await load(applied,page?.page||1);}catch(e){setError(`La marca se guardó, pero no se pudo actualizar la lista: ${errorText(e)} Actualiza manualmente; no se reintentará automáticamente.`);}
  });}
  const publicUrl=page?.public_url||'';
  const shareLink=publicUrl+(linkExam?'/'+linkExam:'');
  return <div className="employment-admin">{error&&<p role="alert" className="exam-error">{error}</p>}{notice&&<p role="status" className="exam-notice">{notice}</p>}{busy&&<p role="status">Procesando…</p>}
    <section className="exam-card"><h2>Enlace del formulario de empleo</h2><p>Soccer WA envía el enlace automáticamente cuando la persona responde a una plantilla de seguimiento de Vero, en lugar del PDF. También puedes copiarlo y compartirlo manualmente. No se reenvía a contactos anteriores al publicar.</p><label>Asociar el enlace a un examen (opcional)<select value={linkExam} onChange={e=>setLinkExam(e.target.value)}><option value="">Formulario general · permite capturar el puesto</option>{exams.map(e=><option key={e.id} value={e.public_token}>{e.title}</option>)}</select></label><label>Enlace para postulantes<input readOnly value={shareLink} onFocus={e=>e.target.select()}/></label><div className="exam-actions"><button disabled={busy||!publicUrl} onClick={()=>void run(async()=>{await navigator.clipboard.writeText(shareLink);setNotice('Enlace del formulario copiado.');})}>Copiar enlace del formulario</button>{publicUrl&&<a className="exam-button" href={shareLink} target="_blank" rel="noopener noreferrer">Abrir formulario</a>}<button disabled={busy} onClick={()=>void run(()=>load())}>Actualizar formatos</button></div></section>
    {detail?<section className="exam-card"><button onClick={()=>setDetail(null)}>Volver a formatos</button><h2>{detail.name}</h2><p>{detail.position} · {detail.email} · {detail.phone}</p><p>{new Date(detail.submitted_at).toLocaleString('es-MX')} · {statusLabel(detail.link_status)}</p><p>Folio: {detail.receipt}</p><ApplicationSeen row={detail} busy={busy} onChange={value=>void markSeen(detail,value)}/>{page?.sections.map(section=><section key={section.title} className="employment-section"><h3>{section.title}</h3><dl className="employment-data">{allFields([section]).map(f=><div key={f.key}><dt>{f.label}</dt><dd>{detail.fields?.[f.key]||'Sin proporcionar'}</dd></div>)}</dl></section>)}
      {detail.attempt_id?<p className="exam-notice">Vinculado a {detail.exam_title}. El CV y la calificación se conservaron.</p>:detail.candidates?.length?<><p>Revisa el contacto y el examen antes de vincular. No se reemplaza un formato ya capturado en el perfil.</p><label>Entrega de examen<select value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">Selecciona una entrega</option>{detail.candidates.map(a=><option key={a.id} value={a.id}>{a.name} · {a.email} · {a.phone} · {a.exam_title}</option>)}</select></label><button disabled={busy||!chosen} onClick={()=>void run(async()=>{setDetail(await apiRequest<Application>(`/recruitment-applications/${detail.id}/`,token,{method:'POST',body:JSON.stringify({attempt_id:Number(chosen)})}));await load();setNotice('Formato vinculado.');})}>Confirmar vínculo con el examen</button></>:<p className="exam-notice">La postulación ya está guardada. Cuando entregue un examen del mismo puesto con el mismo correo y teléfono, se buscará la coincidencia automáticamente.</p>}
    </section>:<><form className="exam-card" onSubmit={e=>{e.preventDefault();const filters={q,position,status,seen};setApplied(filters);void run(()=>load(filters));}}><div className="employment-fields"><label>Buscar en los datos del formato<input value={q} onChange={e=>setQ(e.target.value)} placeholder="Nombre, correo, teléfono, Excel, estudios…"/></label><label>Puesto solicitado<input value={position} onChange={e=>setPosition(e.target.value)}/></label><label>Vínculo con examen<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos</option><option value="linked">Vinculados</option><option value="pending">Sin examen coincidente</option><option value="review">Revisar coincidencia</option></select></label><label>Revisión de postulaciones<select aria-label="Revisión de postulaciones" value={seen} onChange={e=>setSeen(e.target.value)}><option value="">Todas</option><option value="no">Sin ver</option><option value="yes">Ya vistos</option></select></label></div><button className="exam-primary" disabled={busy}>Filtrar formatos</button></form>
      {page&&<section className="exam-card"><p role="status">{page.count} formatos recibidos</p><p className="exam-muted">Marca «Ya visto» cuando hayas revisado la postulación para coordinar la llamada. No confirma que se haya enviado Zoom ni envía mensajes.</p><div className="employment-applications">{page.results.map(r=><article key={r.id}><h2>{r.name}</h2><p><strong>{r.position}</strong></p><p>{r.email}<br/>{r.phone}</p><p>{new Date(r.submitted_at).toLocaleString('es-MX')}</p><span className="exam-tag">{statusLabel(r.link_status)}</span>{r.exam_title&&<p>{r.exam_title}</p>}<ApplicationSeen row={r} busy={busy} onChange={value=>void markSeen(r,value)}/><div><button disabled={busy} onClick={()=>void run(async()=>{setDetail(await apiRequest<Application>(`/recruitment-applications/${r.id}/`,token));setChosen('');})}>Ver todos los datos</button></div></article>)}</div>{!page.results.length&&<p>Aún no hay formatos con estos filtros.</p>}<div className="exam-actions"><button disabled={busy||page.page<=1} onClick={()=>void run(()=>load(applied,page.page-1))}>Formatos anteriores</button><span>Página {page.page} de {Math.max(1,Math.ceil(page.count/50))}</span><button disabled={busy||page.page*50>=page.count} onClick={()=>void run(()=>load(applied,page.page+1))}>Formatos siguientes</button></div></section>}
    </>}
  </div>;
}
