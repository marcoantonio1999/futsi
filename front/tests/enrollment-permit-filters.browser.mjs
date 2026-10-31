import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [320,390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),requests=[];
 await page.route('**/api/**',r=>{const url=new URL(r.request().url());if(url.pathname.endsWith('/catalog/'))return r.fulfill({json:{sites:[],tournaments:[{id:1,name:'Torneo actual',is_active:true}],teams:[{id:1,name:'Equipo actual',tournament:1,is_active:true}]}});if(url.pathname.endsWith('/permits/')){requests.push(Object.fromEntries(url.searchParams));return r.fulfill({json:{results:[{id:21,folio:'P-000021',name:'Ana Jugadora',team:'Equipo histórico',tournament:'Torneo cerrado',issued_at:'2026-10-29T18:00:00Z',expires_at:'2026-10-30T18:00:00Z',terms:[],source:'local'}],count:45,filters:{tournaments:['Torneo cerrado','Torneo actual'],teams:['Equipo histórico','Otro equipo']}}});}return r.fulfill({json:{pending_validation_count:0,results:[],count:0}});});
 await page.goto('http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/permits');await page.getByRole('button',{name:'Ver permiso P-000021'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Permiso en línea',exact:true}).count(),0);const local=page.getByRole('button',{name:'Permiso local',exact:true});assert(await local.isDisabled());
 await page.getByLabel('Torneo',{exact:true}).selectOption('1');await page.getByLabel('Equipo',{exact:true}).selectOption('1');assert(await local.isEnabled());
 async function change(action,key,value){const pending=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/permits/')&&new URL(r.url()).searchParams.get(key)===value);await action();await pending;}
 await change(()=>page.getByRole('button',{name:'Siguiente',exact:true}).click(),'page','2');
 await change(()=>page.getByLabel('Buscar jugador o folio').fill('Ana'),'search','Ana');assert.equal(requests.at(-1).page,'1');
 await change(()=>page.getByLabel('Torneo del histórico',{exact:true}).selectOption('Torneo cerrado'),'tournament','Torneo cerrado');
 await change(()=>page.getByLabel('Equipo del histórico',{exact:true}).selectOption('Equipo histórico'),'team','Equipo histórico');
 await change(()=>page.getByLabel('Estado',{exact:true}).selectOption('expired'),'status','expired');
 await change(()=>page.getByLabel('Emitidos desde',{exact:true}).fill('2026-10-01'),'date_from','2026-10-01');
 await change(()=>page.getByLabel('Emitidos hasta',{exact:true}).fill('2026-10-30'),'date_to','2026-10-30');
 assert.deepEqual(requests.at(-1),{page:'1',status:'expired',search:'Ana',tournament:'Torneo cerrado',team:'Equipo histórico',date_from:'2026-10-01',date_to:'2026-10-30'});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));for(const field of await page.locator('.permit-history-filters input,.permit-history-filters select,.permit-history-filters button').all())assert((await field.boundingBox()).height>=44);
 if(process.env.TEST_OUTPUT)await page.screenshot({path:`${process.env.TEST_OUTPUT}/permisos-filtros-${width}.png`,fullPage:true});
 await change(()=>page.getByRole('button',{name:'Limpiar filtros',exact:true}).click(),'search','');assert.equal(requests.at(-1).page,'1');for(const key of ['search','tournament','team','status','date_from','date_to'])assert.equal(requests.at(-1)[key],'');
 console.log({width,localDefault:true,historyFilters:true,serverPagination:true,noOverflow:true});await page.close();
}}finally{await browser.close();}
