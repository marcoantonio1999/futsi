// All API calls intercepted; never sends WhatsApp or creates real jobs.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=new URL('../../../outputs/bulk-recipient-removal/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[],created=[];
  let allHistory=false;
  page.on('pageerror',e=>errors.push(e.message));
  const phones=Array.from({length:53},(_,i)=>String(5500001000+i));
  const parameters=[{key:'body:1',label:'Nombre',contact_name:true},{key:'body:2',label:'Plataforma'}];
  const template={name:'seguimiento_demo',language:'es',text:'Hola {{1}}, sobre {{2}}',sendable:true,category:'MARKETING',parameters};
  const values=Object.fromEntries(phones.map((phone,i)=>[phone,{'body:1':`Persona ${i}`,'body:2':i===52?'':'Indeed'}]));
  await page.route('**/api/**',async route=>{
   const request=route.request(),op=new URL(request.url()).pathname.split('/').filter(Boolean).at(-1);
   let data;
   if(op==='channels') data={channels:[{channel:'fake-vero',label:'Vero · simulado'}]};
   else if(op==='catalog') data={templates:[template],next_cursor:''};
   else if(op==='import') data={phones,count:phones.length,duplicates:0,invalid:[],names:Object.fromEntries(phones.map((p,i)=>[p,`Persona ${i}`])),parameter_values:values,
    sent_history:Object.fromEntries((allHistory?phones:phones.slice(0,2)).map(p=>[p,{sent_at:'2026-10-16T18:00:00Z'}])),filters:Object.fromEntries(phones.map(p=>[p,{platform:'Indeed',vacancy_type:'Auxiliar'}])),
    ...(width===390?{file_contacts:phones.map((phone,i)=>({phone,name:`Persona ${i}`,campaign_status:'',mutual_interaction:'',pending_response:'',academy_relationship:'',league_relevance:'',age_bucket:'',started_by:'',period:'',year:'',month:'',team_responded:''})),file_facets:{},file_profile:'generic'}:{})};
   else if(op==='create') {
    const payload=request.postDataJSON();created.push(payload);
    data={id:payload.request_id,status:'draft',total:payload.phones.length};
   } else throw new Error(`Unexpected API operation: ${op}`);
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5208/tests/bulk-removal-preview.html');
  await page.getByRole('button',{name:'seguimiento demo',exact:true}).click();
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('button',{name:'Excel',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'ficticios.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('mocked-import-only')});
  await page.getByRole('button',{name:'Leer archivo y mostrar filtros',exact:true}).click();
  if(width===390) await page.getByRole('button',{name:'Revisar 53 destinatarios',exact:true}).click();
  await page.getByText('53 destinatarios seleccionados · 0 quitados de este lote',{exact:true}).waitFor();
  const confirm=page.getByRole('button',{name:'Confirmar destinatarios',exact:true});
  assert.equal(await confirm.isEnabled(),false); // required field on last page
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();
  await page.getByRole('button',{name:`Quitar ${phones[52]} de este lote`,exact:true}).click();
  await page.getByText('52 destinatarios seleccionados · 1 quitados de este lote',{exact:true}).waitFor();
  assert(await confirm.isEnabled()); // removed row no longer blocks required fields
  await page.getByRole('button',{name:'Quitar los que ya recibieron una plantilla',exact:true}).click();
  await page.getByText('50 destinatarios seleccionados · 3 quitados de este lote',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Siguiente',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:`Quitar ${phones[0]} de este lote`,exact:true}).count(),0);
  await page.getByLabel(`Nombre de ${phones[2]}`,{exact:true}).fill('Nombre corregido');
  await page.getByRole('button',{name:'Restaurar quitados',exact:true}).click();
  await page.getByText('53 destinatarios seleccionados · 0 quitados de este lote',{exact:true}).waitFor();
  assert.equal(await page.getByLabel(`Nombre de ${phones[2]}`,{exact:true}).inputValue(),'Nombre corregido');
  await page.getByRole('button',{name:'Quitar los que ya recibieron una plantilla',exact:true}).click();
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();
  await page.getByRole('button',{name:`Quitar ${phones[52]} de este lote`,exact:true}).click();
  await confirm.click();
  await page.getByRole('dialog').getByRole('button',{name:'Confirmar y enviar a 50 contactos',exact:true}).waitFor();
  assert.deepEqual(created[0].phones,phones.slice(2,52));
  for(const field of ['names','recipient_parameters','filters']) assert.deepEqual(Object.keys(created[0][field]),phones.slice(2,52));
  assert.equal(created[0].names[phones[2]],'Nombre corregido');
  assert.equal(created[0].recipient_parameters[phones[2]]['body:1'],'Nombre corregido');
  await page.getByRole('button',{name:'Volver sin enviar',exact:true}).click();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const remove=page.getByRole('button',{name:`Quitar ${phones[2]} de este lote`,exact:true});
  const box=await remove.boundingBox();assert(box.height>=44);
  await remove.click();await confirm.click();
  await page.getByRole('dialog').getByRole('button',{name:'Confirmar y enviar a 49 contactos',exact:true}).waitFor();
  assert.notEqual(created[1].request_id,created[0].request_id);
  assert.deepEqual(created[1].phones,phones.slice(3,52));
  await page.getByRole('button',{name:'Volver sin enviar',exact:true}).click();
  await page.getByRole('region',{name:'Destinatarios seleccionados',exact:true}).evaluate(el=>{el.scrollLeft=0;});
  await page.locator('.bulk-wizard>.bulk-card').evaluate(el=>{el.scrollTop=0;});
  await page.getByRole('heading',{name:'Nuevo envío masivo',exact:true}).scrollIntoViewIfNeeded();
  await page.locator('.bulk-wizard>.bulk-card').evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:new URL(`review-${width}.png`,output).pathname.replace(/^\/(\w:)/,'$1'),fullPage:false});
  // Reloading recipient input resets exclusions; excluding everybody blocks create.
  allHistory=true;
  await page.getByRole('button',{name:'Regresar a cargar destinatarios',exact:true}).click();
  await page.locator('input[type=file]').setInputFiles({name:'otros-ficticios.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('mocked-import-only')});
  await page.getByRole('button',{name:'Leer archivo y mostrar filtros',exact:true}).click();
  if(width===390) await page.getByRole('button',{name:'Revisar 53 destinatarios',exact:true}).click();
  await page.getByText('53 destinatarios seleccionados · 0 quitados de este lote',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Quitar los que ya recibieron una plantilla',exact:true}).click();
  await page.getByText('0 destinatarios seleccionados · 53 quitados de este lote',{exact:true}).waitFor();
  assert.equal(await confirm.isEnabled(),false);
  assert.equal(created.length,2);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,excelRemoval:true,pagination:true,restoreEdits:true,payloadPruned:true,newRequestId:true,emptyBlocked:true,noSends:true,noHorizontalPageOverflow:true}));
  await context.close();
 }
} finally {await browser.close();}
