// Local fixtures only; every API call is intercepted. No real edits/deletions.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='C:/Users/daniel/Documents/marco/mexprod/tmp/outputs/tournament-edit';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{for(const width of [320,390,1440]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],writes=[];
 let tournament={id:1,name:'Torneo ficticio',site:1,billing_type:'weekly_match',football_format:'fut6',starts_on:'2026-10-23',expected_weeks:12,is_active:true};
 let fail=true,hold=null;
 page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()==='PATCH'){
   assert.equal(path,'/api/player-enrollments/tournaments/1/');writes.push(request.postDataJSON());
   if(hold)await hold;
   if(fail)return route.fulfill({status:400,json:{football_format:['Error ficticio de validación']}});
   tournament={...tournament,...request.postDataJSON()};return route.fulfill({json:tournament});
  }
  assert.equal(request.method(),'GET','No DELETE, POST, or unrequested action');
  return route.fulfill({json:path.endsWith('/catalog/')?{sites:[{id:1,name:'Sede ficticia'}],tournaments:[tournament],teams:[{id:1,name:'Equipo ficticio',tournament:1,is_active:true}],deletable_tournament_ids:[1]}:{results:[],count:0}});
 });
 await page.goto('http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/tournament-overview');
 const edit=()=>page.getByRole('button',{name:`Editar torneo ${tournament.name}`,exact:true});
 await edit().waitFor();assert.equal(await page.getByRole('button',{name:/Eliminar torneo/}).count(),0);
 assert((await edit().boundingBox()).height>=44);
 await edit().click();const dialog=page.getByRole('dialog',{name:'Editar torneo',exact:true});await dialog.waitFor();
 assert.equal(await dialog.locator('[name=name]').inputValue(),'Torneo ficticio');
 await dialog.locator('[name=name]').fill('Torneo actualizado');
 await dialog.locator('[name=starts_on]').fill('2026-12-01');
 await dialog.locator('[name=expected_weeks]').fill('18');
 await dialog.locator('[name=football_format]').selectOption('fut7');
 await dialog.locator('[name=billing_type]').selectOption('full_tournament');
 await page.screenshot({path:`${output}/edit-${width}.png`});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
 const save=dialog.getByRole('button',{name:'Guardar cambios',exact:true});assert((await save.boundingBox()).height>=44);
 await save.click();await dialog.getByRole('alert').filter({hasText:'Error ficticio de validación'}).waitFor();
 assert.equal(writes.length,1);assert.equal(await dialog.locator('[name=name]').inputValue(),'Torneo actualizado');
 fail=false;let release;hold=new Promise(resolve=>{release=resolve;});
 await save.click();await dialog.getByRole('button',{name:'Guardando…',exact:true}).waitFor();
 assert(await dialog.getByRole('button',{name:'Cerrar formulario',exact:true}).isDisabled());
 release();hold=null;await dialog.waitFor({state:'hidden'});await edit().waitFor();
 assert.equal(writes.length,2);
 assert.deepEqual(writes[1],{name:'Torneo actualizado',site:1,starts_on:'2026-12-01',expected_weeks:18,football_format:'fut7',billing_type:'full_tournament',is_active:true});
 await edit().click();await dialog.locator('[name=is_active]').selectOption('false');await save.click();await dialog.waitFor({state:'hidden'});
 await page.locator('.tournament-directory-filters select').nth(1).selectOption('inactive');await edit().waitFor();
 await edit().click();assert.equal(await dialog.locator('[name=is_active]').inputValue(),'false');
 await dialog.locator('[name=is_active]').selectOption('true');await save.click();await dialog.waitFor({state:'hidden'});
 await page.locator('.tournament-directory-filters select').nth(1).selectOption('active');await edit().waitFor();
 await edit().click();await dialog.locator('[name=name]').fill('Cambio cancelado');await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
 assert.equal(writes.length,4);assert.equal(tournament.name,'Torneo actualizado');
 assert.equal(await page.getByRole('button',{name:/Eliminar torneo/}).count(),0);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({width,editAllFields:true,errorRetainsValues:true,closeAndReopen:true,cancelNoWrite:true,noDelete:true,noRealWrites:true,noOverflow:true}));await page.close();
}}finally{await browser.close();}
