// Local synthetic roster only. Every API request is intercepted; no production writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='C:/Users/daniel/Documents/marco/mexprod/tmp/outputs/roster-identity-side';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const players=Array.from({length:17},(_,i)=>({id:i+1,name:`Jugador ficticio ${i+1} Apellido compuesto`,birth_date:'2000-01-01',team:'Equipo ficticio',team_id:11,tournament:'Liga ficticia',tournament_id:21,phone:'5500000000',phone_secondary:'',guardian_name:'',signed_at:'2026-10-23T12:00:00Z',terms_text:[],is_delegate:i===0,documents:[{id:i*2+1,kind:'player_photo'},...(i===16?[]:[{id:i*2+2,kind:'player_signature'}])]}));
const svg=id=>id%2?'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="110"><rect width="80" height="110" fill="#dde7ed"/><circle cx="40" cy="32" r="18" fill="#7c98aa"/><path d="M10 105 Q10 55 40 55 Q70 55 70 105" fill="#7c98aa"/></svg>':'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="50"><path d="M10 35 Q30 0 35 35 Q40 50 60 18 Q70 5 65 30 Q75 45 90 20 L105 35 L160 20" fill="none" stroke="#153a69" stroke-width="2"/></svg>';
players[0].sanctions=[{id:1,starts_on:'2026-10-23',ends_on:'2026-11-23',status:'active'}];
async function setup(page,{failPhoto=false,delayPhoto=false,slots=16}={}){
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  assert.equal(route.request().method(),'GET');const url=new URL(route.request().url());
  if(url.pathname.includes('/documents/')){
   const id=Number(url.pathname.split('/').filter(Boolean).at(-1));
   assert.equal(id%2,1,'Stored signatures must never be requested for the printed roster');
   if(id===1&&failPhoto)return route.fulfill({status:404,json:{detail:'Not found'}});
   if(id===1&&delayPhoto)await new Promise(resolve=>setTimeout(resolve,800));
   return route.fulfill({contentType:'image/svg+xml',body:svg(id)});
  }
  if(url.pathname.endsWith('/catalog/'))return route.fulfill({json:{sites:[{id:1,name:'Sede ficticia'}],tournaments:[{id:21,name:'Liga ficticia de prueba con categoría de nombre largo',site:1,max_players_per_team:slots}],teams:[{id:11,name:'Equipo ficticio con nombre largo para validar la impresión completa',tournament:21,is_active:true}]}});
  if(url.pathname.endsWith('/player-enrollments/'))return route.fulfill({json:{results:players,count:players.length}});
  return route.fulfill({json:{results:[],count:0}});
 });return errors;
}
try{
 for(const width of [320,390,1440]){
  const slots=width===320?12:width===390?14:16;
  const page=await browser.newPage({viewport:{width,height:950}}),errors=await setup(page,{delayPhoto:true,slots});
  await page.goto((process.env.TEST_ENROLLMENT_ORIGIN||'http://127.0.0.1:5218')+'/tests/enrollment-register-preview.html#/admin/inscripciones/history?equipo=11');
  const print=page.getByRole('button',{name:'Imprimir / guardar PDF',exact:true});
  await print.waitFor();assert(await print.isDisabled());await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Imprimir / guardar PDF')?.disabled);
  assert.equal(await page.locator('.photo-paper').count(),2);
  assert.equal(await page.locator('.roster-player-signature img').count(),0);
  assert.equal(await page.locator('.roster-player-signature').count(),slots*2);
  assert(await page.locator('.roster-player-signature').evaluateAll(elements=>elements.every(element=>element.textContent.trim()==='Firma'&&element.getBoundingClientRect().height>10)));
  assert.equal(await page.locator('.match-photo img').count(),17);
  assert.equal(await page.locator('.roster-dorsal').count(),slots*2);
  assert(await page.getByText('SANCIONADO',{exact:true}).isVisible());
  assert(await page.locator('.roster-name').first().evaluate(element=>element.scrollHeight<=element.clientHeight));
  assert.equal(await page.getByText('Firma no disponible',{exact:true}).count(),0);
  assert(await page.locator('.roster-print-help').isVisible());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.getByRole('button',{name:'Herramientas',exact:true}).count(),0);
  if(width<1024){
   await page.getByRole('button',{name:'Abrir secciones',exact:true}).click();
   await page.getByRole('button',{name:'Sábana',exact:true}).waitFor({state:'visible'});
   assert(await page.getByRole('button',{name:'Sábana',exact:true}).isVisible());
   assert((await page.getByRole('button',{name:'Sábana',exact:true}).boundingBox()).height>=44);
   await page.getByRole('button',{name:'Cerrar secciones',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.enrollment-admin-sidebar').getBoundingClientRect().right<=0);
  }
  await page.screenshot({path:`${output}/roster-${width}.png`,fullPage:true});
  if(width===1440){
   await page.pdf({path:`${output}/sabana-ficticia.pdf`,format:'A4',printBackground:true,margin:{top:'10mm',right:'10mm',bottom:'10mm',left:'10mm'}});
   for(const format of ['A4','Letter'])await page.pdf({path:`${output}/sabana-headers-${format}.pdf`,format,preferCSSPageSize:true,printBackground:true,displayHeaderFooter:true,headerTemplate:'<div style="font-size:9px">QA-BROWSER-HEADER</div>',footerTemplate:'<div style="font-size:9px">QA-BROWSER-FOOTER</div>'});
   await page.emulateMedia({media:'print'});await page.screenshot({path:`${output}/print-preview.png`,fullPage:true});
   assert.equal(await page.locator('.roster-print-help').isVisible(),false);
   for(const sheet of await page.locator('.photo-paper').all()){
    assert(await sheet.evaluate(element=>getComputedStyle(element).overflow==='visible'));
    assert(await sheet.evaluate(element=>Array.from(element.querySelectorAll('.match-player-box')).every(card=>card.getBoundingClientRect().bottom<=element.getBoundingClientRect().bottom)));
   }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,photos:17,storedSignatures:0,blankSignatureSpaces:true,pages:2,noPageOverflow:true,noTools:true}));await page.close();
 }
 const page=await browser.newPage();await setup(page,{failPhoto:true});
 await page.goto((process.env.TEST_ENROLLMENT_ORIGIN||'http://127.0.0.1:5218')+'/tests/enrollment-register-preview.html#/admin/inscripciones/tools?equipo=11&hoja=alineacion');
 await page.getByRole('alert').filter({hasText:'No se pudieron cargar todas'}).waitFor();
 assert(await page.getByRole('button',{name:'Imprimir / guardar PDF',exact:true}).isDisabled());
 assert.equal(await page.locator('.photo-paper').count(),2);
 console.log(JSON.stringify({failedPhotoBlocksPrint:true,oldAlignmentLinkOpensUnifiedRoster:true}));
}finally{await browser.close();}
