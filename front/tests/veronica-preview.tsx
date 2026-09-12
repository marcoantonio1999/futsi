import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { VeronicaPanel } from '../src/features/voice-agent/VeronicaPanel';
import '../src/features/voice-agent/communications.css';
if (!import.meta.env.DEV) throw new Error('Vista previa solo disponible en desarrollo.');

const chat={id:1,phone:'+525500000001',name:'Contacto de prueba',opted_out:false,last_message_at:new Date().toISOString()};
let sent:any[]=[];
window.fetch=async (input,init)=>{
  const url=String(input);let data:any;
  if(url.includes('/veronica/inbox/'))data={conversations:[chat],has_more:false};
  else if(url.includes('/veronica/history/'))data={messages:[{id:1,body:'Hola, me interesa recibir la información.',direction:'inbound',created_at:new Date().toISOString(),status:'',error_codes:[]},...sent],can_reply:true,window_end:new Date(Date.now()+86400000).toISOString(),has_more:false};
  else if(url.includes('/veronica/templates/'))data={templates:[{name:'reclutamiento_primer_mensaje',language:'es',text:'Texto ficticio para revisar la interfaz. No es la plantilla real.',status:'APPROVED',sendable:true,reason:''},{name:'pendiente_de_ejemplo',language:'es',text:'Pendiente',status:'PENDING',sendable:false,reason:''}],next_cursor:''};
  else if(url.includes('/veronica/upload/'))data={media_token:'mock-upload'};
  else if(url.includes('/veronica/send/')){const body=JSON.parse(String(init?.body));sent.push({id:sent.length+2,body:body.kind==='text'?body.body:body.kind==='document'?'[PDF] Prueba simulada':'[Plantilla] Prueba simulada',direction:'outbound',created_at:new Date().toISOString(),status:'accepted',error_codes:[]});data={conversation_id:1,status:'accepted',detail:'',message_id:'mock'};}
  else throw new Error('La vista previa bloquea cualquier petición externa');
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
createRoot(document.getElementById('root')!).render(<React.StrictMode><div style={{padding:24,fontFamily:'system-ui',background:'#f7faf8',minHeight:'100vh'}}><p role="status">VISTA PREVIA · Datos ficticios · No envía mensajes reales</p><div className="communications"><VeronicaPanel token="preview"/></div></div></React.StrictMode>);
