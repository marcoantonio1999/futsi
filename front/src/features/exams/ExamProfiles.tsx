import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from '../../api';
import { filterQuery } from './ExamResultFilters';
import { readProfileForm, type FormText } from './readProfileForm';
import { ExamCVImport } from './ExamCVImport';
import { ExamFiltersModal } from './ExamFiltersModal';
import './ExamProfiles.css';

type Profile = { id: number; name: string; email: string; phone: string; exam_id: number; exam_title: string; score: number | null; grading_status: string; position: string; position_source?: 'exam' | 'saved'; has_cv: boolean; has_form: boolean; matched_keywords: string[]; cv_text?: string; form_text?: string; form_fields?: Record<string,string> };
type Page = { count: number; page: number; results: Profile[]; filters: { graded_count: number; top_threshold: number | null } };
type ExamOption = { id:number; title:string };
type ImportRow = { name:string; data?:FormText; match_status:string; candidate:Profile|null; candidates:Profile[]; chosen:string; search:string; error:string; saved:boolean };
const initial = { exam:'', q:'', position:'', keywords:'', keyword_mode:'all', form_q:'', has_cv:'', has_form:'', ordering:'score_desc', top:'', min_score:'' };
const errorText = (e:unknown) => e instanceof Error ? e.message : 'No se pudo completar la operación.';
const matchLabel = (status:string) => ({matched:'Coincidencia de contacto',ambiguous:'Varias coincidencias',conflict:'Correo y teléfono no coinciden',unmatched:'Sin coincidencia',manual:'Selección manual'}[status] || status);
const comparableTitle=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleLowerCase('es');
function Postulation({profile:p}:{profile:Profile}) {
  const title=p.position.trim()||p.exam_title.trim()||'Sin postulación';
  const different=p.exam_title.trim()&&comparableTitle(title)!==comparableTitle(p.exam_title);
  return <span className="exam-profile-postulation"><strong>{title}</strong>{different&&<><br/><small>Evaluación: {p.exam_title}</small></>}</span>;
}

export function ExamProfiles({ token, exams }: { token:string; exams:ExamOption[] }) {
  const [draft,setDraft]=useState(initial), [applied,setApplied]=useState(initial);
  const [rows,setRows]=useState<Page|null>(null), [detail,setDetail]=useState<Profile|null>(null);
  const [customPosition,setCustomPosition]=useState(false);
  const [busy,setBusy]=useState(false), [error,setError]=useState(''), [notice,setNotice]=useState('');
  const [imports,setImports]=useState<ImportRow[]>([]), [importOpen,setImportOpen]=useState(false);
  const [cvOpen,setCvOpen]=useState(false);
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [importProgress,setImportProgress]=useState<{total:number;done:number;ignored:number}|null>(null);
  async function run(fn:()=>Promise<void>) { setBusy(true);setError('');setNotice('');try { await fn(); } catch(e){setError(errorText(e));}finally{setBusy(false);} }
  async function load(filters=applied,page=1) { setRows(await apiRequest<Page>(`/recruitment-profiles/?${filterQuery({...filters,page})}`,token)); }
  useEffect(()=>{void run(()=>load(initial));},[token]);
  const change=(key:keyof typeof initial,value:string)=>setDraft(d=>({...d,[key]:value}));
  function apply(e:FormEvent) {e.preventDefault();if(busy)return;void run(async()=>{await load(draft);setApplied(draft);setFiltersOpen(false);});}
  async function open(id:number) {await run(async()=>{const p=await apiRequest<Profile>(`/recruitment-profiles/${id}/`,token);setCustomPosition(Boolean(p.position&&p.position!==p.exam_title));setDetail({...p,position:p.position||p.exam_title});});}
  async function save(e:FormEvent) {
    e.preventDefault();if(!detail)return;
    await run(async()=>{await apiRequest(`/recruitment-profiles/${detail.id}/`,token,{method:'POST',body:JSON.stringify({position:customPosition?detail.position:'',cv_text:detail.cv_text||'',form_text:detail.form_text||''})});setDetail(null);await load();setNotice('Perfil guardado. Solo texto; el examen y su calificación no cambiaron.');});
  }
  const updateImport=(index:number,patch:Partial<ImportRow>)=>setImports(items=>items.map((r,i)=>i===index?{...r,...patch}:r));
  async function readFiles(files:File[]) {
    const formats=files.filter(file=>/\.(pdf|txt)$/i.test(file.name));
    const ignored=files.length-formats.length;
    setImports([]);
    setImportProgress({total:formats.length,done:0,ignored});
    if(!formats.length){setNotice('');setError('No se encontraron formatos PDF o TXT en la selección.');return;}
    await run(async()=>{
      const batch:ImportRow[]=[];
      for(const file of formats){
        const row:ImportRow={name:file.webkitRelativePath||file.name,match_status:'',candidate:null,candidates:[],chosen:'',search:'',error:'',saved:false};
        try {
          row.data=await readProfileForm(file);
          const match=await apiRequest<Pick<ImportRow,'match_status'|'candidate'|'candidates'>>('/recruitment-profiles/import/',token,{method:'POST',body:JSON.stringify({...row.data,exam:applied.exam})});
          Object.assign(row,match);row.chosen=match.candidate?String(match.candidate.id):'';
        }catch(e){row.error=errorText(e);}
        batch.push(row);setImports([...batch]);
        setImportProgress({total:formats.length,done:batch.length,ignored});
      }
      setNotice('Lectura terminada. Revisa las coincidencias antes de guardar. Los archivos con error no se reintentan automáticamente.');
    });
  }
  async function lookup(index:number) {
    const row=imports[index];if(!row.search.trim()){setError('Escribe nombre, correo o teléfono para buscar.');return;}
    await run(async()=>{const page=await apiRequest<Page>(`/recruitment-profiles/?${filterQuery({q:row.search,exam:applied.exam})}`,token);updateImport(index,{candidates:page.results,chosen:'',candidate:null});});
  }
  async function commit(indexes:number[]) {
    await run(async()=>{
      let saved=0;
      for(const index of indexes){
        const row=imports[index];if(!row.data||!row.chosen||row.saved)continue;
        try{
          await apiRequest('/recruitment-profiles/import/',token,{method:'POST',body:JSON.stringify({...row.data,exam:applied.exam,attempt_id:Number(row.chosen),commit:true})});
          updateImport(index,{saved:true,error:''});saved++;
        }catch(e){updateImport(index,{error:errorText(e)});}
      }
      await load();setNotice(`${saved} formato(s) vinculados. Los errores quedan visibles y no se reintentan automáticamente.`);
    });
  }
  return <div className="exam-profiles">
    <div className="exam-actions"><button disabled={busy} className="exam-primary" onClick={()=>{setCvOpen(!cvOpen);setImportOpen(false);setDetail(null);}}>Cargar carpeta de CV</button><button disabled={busy} onClick={()=>{setImportOpen(!importOpen);setCvOpen(false);setDetail(null);}}>Cargar formatos de empleo</button><button disabled={busy} onClick={()=>void run(()=>load())}>Actualizar perfiles</button></div>
    <p className="exam-muted">Cada fila corresponde a una entrega de examen. El mismo candidato puede aparecer en evaluaciones diferentes, sin mezclar puestos ni notas. Los datos son privados de Recursos Humanos.</p>
    {error&&<p className="exam-error" role="alert">{error}</p>}{notice&&<p className="exam-notice" role="status">{notice}</p>}{busy&&<p role="status">Procesando…</p>}
    {cvOpen&&<ExamCVImport token={token} exams={exams} initialExam={applied.exam} onBusyChange={setBusy} onUpdated={()=>load()} onClose={()=>setCvOpen(false)}/>}
    {importOpen&&<section className="exam-card" aria-label="Importar formatos"><h2>Cargar formatos</h2><p>Selecciona PDF digitales llenados o archivos TXT. Se leen en tu navegador: solo se guardan sus campos y texto, no el PDF. No se utiliza IA ni OCR.</p><p className="exam-muted">Se buscan correo o teléfono del candidato entre las entregas{applied.exam?' del examen seleccionado':''}. Revisa antes de guardar. Cargar nuevamente un formato reemplaza solo su información de formato; conserva el CV, el examen y un puesto ya capturado.</p>
      <label>Seleccionar formatos PDF o TXT<input type="file" multiple accept=".pdf,.txt,application/pdf,text/plain" disabled={busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void readFiles(files);}} /></label>
      <label>Seleccionar carpeta de formatos<input type="file" multiple {...{webkitdirectory:''}} disabled={busy} onChange={e=>{const files=Array.from(e.target.files||[]);e.target.value='';if(files.length)void readFiles(files);}} /></label>
      <p className="exam-muted">La carpeta incluye sus subcarpetas. Se detectan todos los PDF y TXT y se leen uno por uno; los demás archivos se omiten. También puedes seleccionar varios archivos sueltos. Cada formato puede pesar hasta 8 MB.</p>
      {importProgress&&<p role="status">Formatos revisados: {importProgress.done} de {importProgress.total}. Archivos de otros tipos omitidos: {importProgress.ignored}.</p>}
      {imports.map((row,index)=><article className="exam-import-row" key={index}><h3>{row.name}</h3>{row.error&&<p className="exam-error" role="alert">{row.error}</p>}{row.saved?<p className="exam-notice">Guardado correctamente</p>:row.data&&<><p>{matchLabel(row.match_status)}{row.candidate?` · ${row.candidate.name} · ${row.candidate.exam_title}`:''}</p><details><summary>Ver texto extraído</summary><pre>{row.data.form_text}</pre></details><label>Buscar participante para vincular manualmente<input value={row.search} onChange={e=>updateImport(index,{search:e.target.value})} placeholder="Nombre, correo o teléfono" disabled={busy}/></label><button disabled={busy} onClick={()=>void lookup(index)}>Buscar participante</button><label>Participante del formato<select value={row.chosen} disabled={busy} onChange={e=>updateImport(index,{chosen:e.target.value})}><option value="">Selecciona una entrega</option>{row.candidates.map(p=><option key={p.id} value={p.id}>{p.name} · {p.email} · {p.exam_title}</option>)}</select></label><button disabled={busy||!row.chosen} onClick={()=>void commit([index])}>Confirmar y guardar formato</button></>}</article>)}
      <div className="exam-actions">{imports.some(r=>r.match_status==='matched'&&!r.saved&&r.chosen)&&<button className="exam-primary" disabled={busy} onClick={()=>void commit(imports.map((_,i)=>i).filter(i=>imports[i].match_status==='matched'&&!imports[i].saved&&Boolean(imports[i].chosen)))}>Guardar coincidencias revisadas</button>}<button disabled={busy} onClick={()=>setImportOpen(false)}>Cerrar carga de formatos</button></div>
    </section>}
    {detail?<form className="exam-card" onSubmit={save}><div className="exam-heading"><div><h2>{detail.name}</h2><p>{detail.email} · {detail.phone}</p><p>{customPosition?`${detail.exam_title} · `:''}{detail.score===null?'Por calificar':`Calificación: ${detail.score} / 10`}</p></div><button type="button" disabled={busy} onClick={()=>setDetail(null)}>Volver a perfiles</button></div>
      {customPosition?<><label>Puesto al que se postula<input maxLength={180} value={detail.position} onChange={e=>setDetail({...detail,position:e.target.value})}/></label><button type="button" disabled={busy} onClick={()=>{setCustomPosition(false);setDetail({...detail,position:detail.exam_title});}}>Usar el puesto del examen</button></>:<div className="exam-notice"><p>El puesto corresponde al examen: <strong>{detail.exam_title}</strong>. No necesitas capturarlo de nuevo.</p><button type="button" disabled={busy} onClick={()=>setCustomPosition(true)}>Asignar otro puesto</button></div>}
      <label>Texto del CV<textarea aria-label="Texto del CV" className="exam-profile-text" maxLength={80000} value={detail.cv_text||''} onChange={e=>setDetail({...detail,cv_text:e.target.value})} placeholder="Pega el texto del CV. No se necesita el archivo original." /></label>
      <label>Importar texto del CV (TXT)<input type="file" accept=".txt,text/plain" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(async()=>{if(file.size>320000)throw new Error('El TXT supera 320 KB.');const value=await file.text();if(value.length>80000)throw new Error('El CV supera 80 000 caracteres.');setDetail({...detail,cv_text:value});});}}/></label>
      <label>Texto del formato de empleo<textarea aria-label="Texto del formato de empleo" maxLength={60000} value={detail.form_text||''} onChange={e=>setDetail({...detail,form_text:e.target.value})}/></label>
      {Object.keys(detail.form_fields||{}).length>0&&<details><summary>Campos extraídos del formato</summary><dl className="exam-profile-fields">{Object.entries(detail.form_fields||{}).map(([k,v])=><div key={k}><dt>{k.replaceAll('_',' ')}</dt><dd>{v}</dd></div>)}</dl></details>}
      <p className="exam-muted">Mencionar una habilidad no demuestra dominio: estos filtros apoyan tu revisión, no deciden contrataciones.</p><button className="exam-primary" disabled={busy}>Guardar perfil</button>
    </form>:<><ExamFiltersModal title="Filtros de perfiles" open={filtersOpen} onOpenChange={setFiltersOpen} busy={busy} active={(Object.keys(initial) as (keyof typeof initial)[]).some(key=>applied[key]!==initial[key])} error={error}><form onSubmit={apply} className="exam-filter-panel" aria-label="Filtros de perfiles"><div className="exam-filter-grid">
      <label>Examen<select aria-label="Examen" value={draft.exam} onChange={e=>change('exam',e.target.value)}><option value="">Todos los exámenes</option>{exams.map(e=><option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
      <label>Buscar persona<input value={draft.q} onChange={e=>change('q',e.target.value)} placeholder="Nombre, correo o teléfono"/></label>
      <label>Puesto solicitado<input value={draft.position} onChange={e=>change('position',e.target.value)} placeholder="Ej. Auxiliar administrativo"/></label>
      <label>Conocimientos en el CV<input value={draft.keywords} onChange={e=>change('keywords',e.target.value)} placeholder="Excel, Python, atención al cliente"/></label>
      <label>Cargar palabras clave (TXT)<input type="file" accept=".txt,text/plain" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)void run(async()=>{if(file.size>10000)throw new Error('La lista de palabras supera 10 KB.');const terms=(await file.text()).split(/[,;\r\n]+/).map(v=>v.trim()).filter(Boolean);if(terms.length>20||terms.some(t=>t.length>80))throw new Error('Usa hasta 20 palabras o frases de máximo 80 caracteres.');setDraft(d=>({...d,keywords:terms.join(', ')}));});}}/></label>
      <label>Coincidencias de conocimientos<select aria-label="Coincidencias de conocimientos" value={draft.keyword_mode} onChange={e=>change('keyword_mode',e.target.value)}><option value="all">Todas las palabras o frases</option><option value="any">Cualquiera de ellas</option></select></label>
      <label>Datos del formato<input value={draft.form_q} onChange={e=>change('form_q',e.target.value)} placeholder="Ej. Inglés, licenciatura, Excel"/></label>
      <label>Ordenar perfiles<select aria-label="Ordenar perfiles" value={draft.ordering} onChange={e=>change('ordering',e.target.value)}><option value="score_desc">Calificación más alta</option><option value="score_asc">Calificación más baja</option><option value="newest">Más recientes</option><option value="name">Nombre</option></select></label>
      <label>Selección de notas<select aria-label="Selección de notas" value={draft.top} onChange={e=>change('top',e.target.value)}><option value="">Todos</option><option value="10">Mejor 10 % del examen elegido</option></select></label>
      <label>Nota mínima<input type="number" min="0" max="10" step="0.01" value={draft.min_score} onChange={e=>change('min_score',e.target.value)}/></label>
      <label>Texto de CV<select aria-label="Texto de CV" value={draft.has_cv} onChange={e=>change('has_cv',e.target.value)}><option value="">Con o sin CV</option><option value="yes">Solo con CV cargado</option></select></label>
      <label>Formato de empleo<select aria-label="Formato de empleo" value={draft.has_form} onChange={e=>change('has_form',e.target.value)}><option value="">Con o sin formato</option><option value="yes">Solo con formato cargado</option></select></label>
    </div><p className="exam-muted">Palabras separadas por comas; se busca su presencia literal, ignorando mayúsculas y acentos. El mejor 10 % incluye empates y solo compara entregas calificadas del mismo examen.</p><div className="exam-actions exam-filter-actions"><button className="exam-primary" disabled={busy}>Filtrar perfiles</button><button type="button" disabled={busy} onClick={()=>{setDraft(initial);void run(async()=>{await load(initial);setApplied(initial);setFiltersOpen(false);});}}>Limpiar filtros de perfiles</button></div></form></ExamFiltersModal>
    {rows&&<section className="exam-card"><p role="status">{rows.count} perfiles encontrados{rows.filters.top_threshold!==null?` · Corte del 10 %: ${rows.filters.top_threshold} / 10`:''}</p>
      <div className="exam-profile-cards">{rows.results.map(p=><article className="exam-profile-card" key={p.id}><h3>{p.name}</h3><p>{p.email}<br/>{p.phone}</p><p><Postulation profile={p}/></p><span className="exam-tag">{p.score===null?'Por calificar':`${p.score} / 10`}</span><p>{p.has_cv?'CV cargado':'Sin CV'} · {p.has_form?'Formato cargado':'Sin formato'}</p><div>{p.matched_keywords.map(k=><span className="exam-tag" key={k}>{k}</span>)}</div><button disabled={busy} onClick={()=>void open(p.id)}>Ver / editar perfil</button></article>)}</div>
      <div className="exam-table-wrap exam-profile-table"><table><thead><tr>{['Persona','Postulación','Calificación','Conocimientos encontrados','Documentación en texto','Perfil'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.results.map(p=><tr key={p.id}><td>{p.name}<br/><small>{p.email}<br/>{p.phone}</small></td><td><Postulation profile={p}/></td><td>{p.score===null?'Por calificar':`${p.score} / 10`}</td><td>{p.matched_keywords.length?p.matched_keywords.map(k=><span className="exam-tag" key={k}>{k}</span>):'—'}</td><td>{p.has_cv?'CV cargado':'Sin CV'}<br/>{p.has_form?'Formato cargado':'Sin formato'}</td><td><button disabled={busy} onClick={()=>void open(p.id)}>Ver / editar perfil</button></td></tr>)}</tbody></table></div>{!rows.results.length&&<p>No hay coincidencias con estos filtros.</p>}<div className="exam-actions"><button disabled={busy||rows.page===1} onClick={()=>void run(()=>load(applied,rows.page-1))}>Perfiles anteriores</button><span>Página {rows.page} de {Math.max(1,Math.ceil(rows.count/50))}</span><button disabled={busy||rows.page*50>=rows.count} onClick={()=>void run(()=>load(applied,rows.page+1))}>Perfiles siguientes</button></div></section>}</>}
  </div>;
}
