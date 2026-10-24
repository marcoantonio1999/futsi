// Synthetic fixtures only; no production credentials, documents, or writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='C:/Users/daniel/Documents/marco/mexprod/tmp/outputs/player-enrollment-sheet-side';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const participation=id=>({id:`enrollment:${id}`,team:`Equipo ${id}`,tournament:'Liga ficticia',site:'Sede',status:'Activo',is_active:true,is_delegate:false,signed_at:'2026-10-20T12:00:00Z',withdrawn_at:null});
try {for(const width of [320,390,1440]) {for(const minor of [false,true]){
 const page=await browser.newPage({viewport:{width,height:950}}),errors=[],documents=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{
  assert.equal(route.request().method(),'GET');const url=new URL(route.request().url());
  if(url.pathname.includes('/documents/')){documents.push(url.pathname);return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')});}
  if(url.pathname.endsWith('/players/'))return route.fulfill({json:{results:[{id:'fictional',name:'Jugador ficticio',birth_date:'2000-01-01',is_active:true,legacy:false,participations:[participation(101),participation(102)]},{id:'legacy',name:'Ficha anterior',birth_date:null,is_active:true,legacy:true,participations:[{...participation(103),id:'player:103'}]}],count:2,page:1,totals:{total:2,active:2,inactive:0,participations:3,legacy:1},filters:{sites:[],tournaments:[],teams:[]}}});
  if(url.searchParams.has('enrollment_id')) {assert.equal(url.searchParams.get('enrollment_id'),'102');return route.fulfill({json:{results:[{id:102,identity_type:minor?'minor':'ine',name:'Jugador ficticio',team:'Equipo 102',tournament:'Liga ficticia',birth_date:'2000-01-01',phone:'5500000000',phone_secondary:'',guardian_name:'',signed_at:'2026-10-20T12:00:00Z',terms_text:['Compromiso de ejemplo.'],documents:[{id:1,kind:'ine_front'},{id:2,kind:'ine_back'},{id:3,kind:'player_photo'},{id:4,kind:'player_signature'},{id:5,kind:'guardian_signature'}]}]}});}
  return route.fulfill({json:{sites:[],tournaments:[],teams:[],results:[],count:0}});
 });
 await page.goto('http://127.0.0.1:5212/tests/enrollment-register-preview.html#/admin/inscripciones/players');
 const button=page.getByRole('button',{name:'Ver hoja de inscripción de Jugador ficticio, Equipo 102, Liga ficticia',exact:true});
 await button.waitFor();assert.equal(documents.length,0);assert((await button.boundingBox()).height>=44);
 assert(await page.getByText('Ficha anterior sin hoja de inscripción firmada.',{exact:true}).isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`${output}/directory-${width}.png`,fullPage:true});
 await button.click();await page.getByRole('img',{name:minor?'Firma del tutor':'Firma del jugador',exact:true}).waitFor();
 assert.equal(await page.getByRole('img').count(),4);
 assert(!documents.some(path=>path.endsWith(`/${minor?4:5}/`)));
 assert(await page.getByText('Compromiso de ejemplo.',{exact:true}).isVisible());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`${output}/sheet-${minor?'minor':'adult'}-${width}.png`,fullPage:true});
 await page.getByRole('button',{name:'Volver a jugadores',exact:true}).click();await button.waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({width,minor,correctSheet:true,privateDocuments:documents.length,noWrites:true,overflow:false,back:true}));await page.close();
}}} finally {await browser.close();}
