// Fake routes only: never resumes real batches or sends WhatsApp.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=new URL('../../../outputs/bulk-preflight/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();
  const requests=[],posts=[],errors=[];let fail=false;
  const job={id:'fake-lot',title:'Lote ficticio detenido',channel:'fake-vero',status:'paused',can_resume:true,
   detail:'Timeout de proveedor. No se repetirá el envío sin confirmar.',created_at:'2026-10-23T17:00:00Z',heartbeat_at:null,
   percent:75,processed:3,total:4,counts:{delivered:1,not_sent:1,pending:1,uncertain:1},template:{name:'fake_template',language:'es',text:'Hola'},
   quote:{total:null,note:'Prueba sin costo'},recipients:[
    {id:1,name:'Persona entregada',phone:'5500000001',status:'delivered',detail:''},
    {id:2,name:'Persona no enviada',phone:'5500000002',status:'not_sent',detail:'Consulta previa fallida; no hubo envío.'},
    {id:3,name:'Persona pendiente',phone:'5500000003',status:'pending',detail:''},
    {id:4,name:'Persona sin confirmar',phone:'5500000004',status:'uncertain',detail:'Timeout. No reenviar.'}],has_more:false};
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
   const request=route.request(),op=new URL(request.url()).pathname.split('/').filter(Boolean).at(-1);
   requests.push(op);
   if(request.method()==='POST') {assert.equal(op,'start');posts.push(request.postDataJSON());return route.fulfill({json:{...job,status:'queued'}});}
   if(fail && ['list','detail'].includes(op)) return route.fulfill({status:503,json:{detail:'Error de consulta ficticio; sin reintento.'}});
   const data=op==='channels'?{channels:[{channel:'fake-vero',label:'Verónica simulada'}]}:
    op==='catalog'?{templates:[],next_cursor:''}:op==='list'?{jobs:[job],has_more:false}:op==='detail'?job:null;
   assert(data,`Unexpected route ${op}`);return route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5208/tests/bulk-removal-preview.html');
  await page.getByRole('button',{name:'Lotes anteriores',exact:true}).click();
  await page.getByRole('button',{name:/Lote ficticio detenido/}).click();
  await page.getByText('Persona no enviada',{exact:true}).waitFor();
  const unsent=page.getByRole('row').filter({hasText:'Persona no enviada'});
  assert(await unsent.getByText('No enviado',{exact:true}).isVisible());
  assert.equal(await unsent.getByText('No entregado',{exact:true}).count(),0);
  assert(await page.getByRole('row').filter({hasText:'Persona entregada'}).getByText('Entregado',{exact:true}).isVisible());
  await page.clock.install();
  const before=requests.length;await page.clock.fastForward(60000);await page.waitForTimeout(50);assert.equal(requests.length,before);
  assert.equal(posts.length,0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const button=page.getByRole('button',{name:'Continuar pendientes',exact:true});assert((await button.boundingBox()).height>=44);
  await page.screenshot({path:fileURLToPath(new URL(`paused-${width}.png`,output)),fullPage:true});
  fail=true;await page.getByRole('button',{name:'Actualizar avance',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Lo mostrado puede estar desactualizado'}).waitFor();
  const failedCalls=requests.length;await page.clock.fastForward(60000);await page.waitForTimeout(50);assert.equal(requests.length,failedCalls);
  fail=false;page.once('dialog',dialog=>{assert(dialog.message().includes('1 envío(s) sin confirmar quedarán excluidos'));return dialog.accept();});await button.click();
  await page.getByText('Persona no enviada',{exact:true}).waitFor();
  assert.deepEqual(posts,[{id:'fake-lot',consent:true,review_confirmed:true,resume:true,exclude_uncertain:true}]);
  await page.clock.fastForward(60000);await page.waitForTimeout(50);assert.equal(posts.length,1);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,noSentMislabeled:true,pausedHasNoPolling:true,failedReadsNeverRetry:true,onlyExplicitResume:true,noOverflow:true}));
  await context.close();
 }
}finally{await browser.close();}
