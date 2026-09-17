import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import { AdminShell } from '../src/components/layout/AdminShell';
import { emptyData } from '../src/appState';
import type { User } from '../src/types';
if (!import.meta.env.DEV) throw new Error('Vista previa solo disponible en desarrollo.');

const open = new URLSearchParams(location.search).has('open');
const windowEnd = open ? new Date(Date.now()+86400000).toISOString() : null;
const chat={id:1,phone:'+525500000001',name:'Contacto de prueba',opted_out:false,last_message_at:new Date().toISOString(),can_reply:open,window_end:windowEnd};
let sent:any[]=[];
window.fetch=async (input,init)=>{
  const url=String(input);let data:any;
  if(url.includes('/veronica/inbox/'))data={conversations:Array.from({length:30},(_,i)=>({...chat,id:i+1,name:i ? `Contacto ${i+1}` : chat.name})),has_more:false};
  else if(url.includes('/veronica/history/'))data={messages:[...Array.from({length:60},(_,i)=>({id:i+1,body:`Mensaje de prueba ${i+1}. Hola, me interesa recibir la información.`,direction:i%2?'outbound':'inbound',created_at:new Date().toISOString(),status:i%2?'delivered':'',error_codes:[]})),...sent],can_reply:open,window_end:windowEnd,has_more:false};
  else if(url.includes('/veronica/auto-pdf/'))data={configured:true,enabled:true,filename:'Formulario de prueba.pdf',caption:'Completa el formulario.',updated_at:new Date().toISOString()};
  else if(url.includes('/veronica/templates/'))data={templates:[{name:'reclutamiento_primer_mensaje',language:'es',text:'Texto ficticio para revisar la interfaz. No es la plantilla real.',status:'APPROVED',sendable:true,reason:''},{name:'pendiente_de_ejemplo',language:'es',text:'Pendiente',status:'PENDING',sendable:false,reason:''}],next_cursor:''};
  else if(url.includes('/veronica/upload/'))data={media_token:'mock-upload'};
  else if(url.includes('/veronica/send/')){const body=JSON.parse(String(init?.body));sent.push({id:sent.length+61,body:body.kind==='text'?body.body:body.kind==='document'?'[PDF] Prueba simulada':'[Plantilla] Prueba simulada',direction:'outbound',created_at:new Date().toISOString(),status:'accepted',error_codes:[]});data={conversation_id:1,status:'accepted',detail:'',message_id:'mock'};}
  else throw new Error('La vista previa bloquea cualquier petición externa');
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
const user: User = { id: 1, username: 'veronica', email: '', first_name: 'Verónica', last_name: '', role: 'collaborator', primary_site: null, phone: '', avatar_url: '', coach_group_name: '', coach_hourly_rate: '0', section_permissions: ['veronica_only'], is_active: true };
const blocked = async () => { throw new Error('Esta vista local usa datos ficticios y bloquea cambios reales.'); };
const shellProps = {
  token: 'preview', user, data: emptyData, theme: 'light', loading: false, sectionLoading: null, loadedSections: ['communications'], message: 'Vista local · datos ficticios · no envía mensajes reales', error: '',
  onToggleTheme: () => {}, onLoadSection: async () => {}, onLogout: () => {}, onCreateRecord: blocked, onDeleteTournament: blocked, onDeleteGuardian: blocked, onDeleteStudent: blocked, onUpdateRecord: blocked, onCreateAndReturn: blocked, onUploadHistoricalImport: blocked, onCommitHistoricalImport: blocked, onCloseAttendanceSession: blocked, onPostAction: blocked, onDownloadFile: blocked, onUpdateMatchScore: blocked, onSaveStudentAssessment: blocked, onMarkAdultPlayer: blocked,
} as any;
createRoot(document.getElementById('root')!).render(<React.StrictMode><AdminShell {...shellProps} /></React.StrictMode>);
