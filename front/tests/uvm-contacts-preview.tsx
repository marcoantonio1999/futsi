// Synthetic, development-only fixture. All fetches are intercepted; never sends messages.
import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { BulkTemplatesPanel } from '../src/features/voice-agent/BulkTemplatesPanel';
if (!import.meta.env.DEV) throw new Error('Development fixture only');
const contacts = Array.from({ length: 130 }, (_, n) => ({ id: n+1, ordinal: n+1, phone: '55'+String(n+1).padStart(8,'0'), name: n % 3 ? `Contacto de prueba ${n+1}` : '', footballer: `Alumno ejemplo ${n+1}`, age: '8 años mencionados', relationship: n%2 ? 'Prospecto' : 'Alumno probable', interest: 'Academia', confidence: 'Alta', priority: '', last_date: '2026-08-31', consent_source: 'No comprobado', needs_review: n%3===0, sensitive: false, no_contact: n===1, selectable: n!==1, last_status: null, in_active_job: false, notes: '', manually_blocked: false, source_no_contact: n===1, source_data: { Contacto: 'Nombre original', Mensajes: 12 }, evidence: { Resumen: 'Solicitó información sobre entrenamientos y horarios.', 'Evidencia principal': '¿Cuáles son los horarios?', 'Razón de clasificación': 'Consulta de información, sin inscripción confirmada.' }, audios: [{ Archivo: 'ejemplo.opus', Transcripción: 'Quiero conocer los horarios.' }] }));
const template = { name: 'invitacion_uvm', language: 'es', category: 'MARKETING', text: 'Hola {{1}}, te invitamos a entrenar con nosotros. Responde si te interesa.', sendable: true, parameters: [{ key: 'body:1', label: 'Nombre del destinatario', contact_name: true }] };
let job: any = null;
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin); const op = url.pathname.split('/').filter(Boolean).at(-1);
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  if (op === 'channels') return Response.json({ channels: [{ channel: 'demo-uvm', label: 'UVM · prueba', contact_directory: 'uvm' }, { channel: 'demo-franco', label: 'Franco Academia · prueba' }] });
  if (op === 'catalog') return Response.json({ templates: [template], next_cursor: '' });
  if (op === 'list') return Response.json({ jobs: job ? [job] : [], has_more: false });
  if (op === 'contacts') {
    let rows = contacts.filter(c => !url.searchParams.get('relationship') || c.relationship===url.searchParams.get('relationship'));
    if (url.searchParams.get('selectable_only') === 'true') rows=rows.filter(c => c.selectable);
    const offset=Number(url.searchParams.get('offset')||0), limit=Number(url.searchParams.get('limit')||50);
    return Response.json({ contacts: rows.slice(offset,offset+limit), total: rows.length, dataset_total: contacts.length, has_more: offset+limit<rows.length, facets: { relationship: ['Prospecto','Alumno probable'], interest:['Academia'],confidence:['Alta'],consent_source:['No comprobado'] }, source_file:'Excel de prueba UVM.xlsx' });
  }
  if (op === 'contact-detail') return Response.json(contacts.find(c => c.id===Number(url.searchParams.get('contact_id'))));
  if (op === 'contact-update') { const c=contacts.find(c => c.id===body.contact_id)!; Object.assign(c,body); return Response.json(c); }
  if (op === 'contact-select') { const rows=contacts.filter(c => body.contact_ids.includes(c.id)); return Response.json({ phones: rows.map(c=>c.phone), names: Object.fromEntries(rows.map(c=>[c.phone,c.name])), contact_ids:rows.map(c=>c.id), count:rows.length,duplicates:0,invalid:[],needs_review_count:rows.filter(c=>c.needs_review).length,unverified_consent_count:rows.length }); }
  if (op === 'create') { job={id:body.request_id,title:template.name,channel:body.channel,status:'draft',detail:'',created_at:new Date().toISOString(),percent:0,processed:0,total:body.phones.length,counts:{pending:body.phones.length},template,quote:{total:(body.phones.length*.0305).toFixed(4),unit:'.0305',currency:'USD',category:'MARKETING',note:'Solo simulación, no se realiza ningún envío.',verified_on:'2026-09-15',source:'https://whatsappbusiness.com/'},directory:{dataset:'uvm',needs_review_count:1,unverified_consent_count:body.phones.length},recipients:body.phones.map((phone:string,id:number)=>({id,phone,name:body.names[phone],status:'pending'})),has_more:false}; return Response.json(job); }
  if (op === 'detail') return Response.json(job);
  if (op === 'start') { job.status='completed'; job.processed=job.total;job.percent=100;job.counts={delivered:job.total};job.recipients.forEach((r:any)=>{r.status='delivered';});return Response.json(job); }
  return Response.json({ detail: 'Acción no simulada; bloqueada sin contactar al servidor.' }, { status:400 });
};
createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1300,margin:'auto',padding:24}}><p>SIMULACIÓN · sin envíos ni cargos</p><BulkTemplatesPanel token="mock" kind="academy" /></main>);
