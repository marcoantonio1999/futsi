// Local intercepted requests only: no production links, registrations or messages.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=process.env.TEST_OUTPUT||'C:/Users/daniel/Documents/marco/mexprod/tmp/outputs/enrollment-local';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const url='http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/send';
const catalog={sites:[{id:1,name:'Sede ficticia'}],tournaments:[{id:1,name:'Torneo ficticio',site:1,is_active:true,football_format:'fut6'}],teams:[{id:1,name:'Equipo ficticio',tournament:1,is_active:true}]};
async function prepare(width){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],writes=[];
 const state={failInvitation:false,failSave:false,holdSave:null};
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(req.method()==='OPTIONS')return route.fulfill({status:204});
  if(req.method()==='POST'){
   writes.push({path,body:req.postData()});
   if(path.endsWith('/public/local-fictional/')){
    if(state.holdSave)await state.holdSave;
    return route.fulfill({status:state.failSave?400:201,json:state.failSave?{detail:'Error ficticio de guardado'}:{id:999999}});
   }
   assert.equal(path,'/api/player-enrollments/');
   return route.fulfill({status:state.failInvitation?400:201,json:state.failInvitation?{detail:'Sin cupo ficticio'}:{token:'local-fictional'}});
  }
  assert.equal(req.method(),'GET');
  return route.fulfill({json:path.includes('/public/')?{team:'Equipo ficticio',tournament:'Torneo ficticio',is_delegate:true,delegate_name:'',delegate_phone:'',terms:['Compromiso ficticio de prueba.']}:path.endsWith('/catalog/')?catalog:{results:[],count:0}});
 });
 await page.goto(url);
 const local=page.getByRole('button',{name:'Registro local',exact:true});
 await local.waitFor();assert(await local.isDisabled());
 await page.locator('.control-grid select').nth(0).selectOption('1');
 await page.locator('.control-grid select').nth(1).selectOption('1');
 return {page,local,writes,errors,state};
}
async function noOverflow(page){assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.locator('.local-enrollment-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));}
async function consent(page){
 await page.getByRole('button',{name:'Aceptar y continuar',exact:true}).click();
 await page.getByRole('alert').filter({hasText:'Completa o corrige'}).waitFor();
 await page.locator('[data-enrollment-field="accepted_terms_top"] input').check();
 await page.getByRole('button',{name:'Aceptar y continuar',exact:true}).click();
}
async function completeForm(page,minor=false){
 await consent(page);
 await page.getByRole('button',{name:'Siguiente',exact:true}).click();
 await page.locator('[data-enrollment-field="birth_date"].enrollment-invalid').waitFor();
 await page.locator('input[type=date][name=birth_date]').fill(minor?'2015-01-01':'2000-01-01');
 const pdf={name:'documento-ficticio.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nFICTICIO')};
 for(const field of (minor?['minor_credential','curp','guardian_ine_front','guardian_ine_back']:['ine_front','ine_back']))await page.locator(`[data-enrollment-field="${field}"] input[type=file]`).setInputFiles(pdf);
 await page.getByRole('button',{name:'Siguiente',exact:true}).click();
 // A synthetic PNG created locally, not a real player's photograph.
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=100;c.height=100;const ctx=c.getContext('2d');ctx.fillStyle='#bbb';ctx.fillRect(0,0,100,100);return c.toDataURL().split(',')[1];});
 await page.locator('[data-enrollment-field="player_photo"] input[type=file]').setInputFiles({name:'foto-ficticia.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 for(const [name,value] of Object.entries({given_names:'José',paternal_surname:'Pérez',maternal_surname:'López',phone:'5550000000'}))await page.locator(`input[name=${name}]`).fill(value);
 if(minor)await page.locator('input[name=guardian_name]').fill('Tutor ficticio');
 const canvas=page.locator(`[data-enrollment-field="${minor?'guardian_signature':'player_signature'}"] canvas`);await canvas.scrollIntoViewIfNeeded();const b=await canvas.boundingBox();
 await page.mouse.move(b.x+20,b.y+30);await page.mouse.down();await page.mouse.move(b.x+80,b.y+50,{steps:8});await page.mouse.up();
 await noOverflow(page);
}
try{
 for(const width of [320,390,1440]){for(const minor of [false,true]){
  const {page,local,writes,errors,state}=await prepare(width);
  await local.click();await page.getByRole('dialog',{name:'Registro local',exact:true}).waitFor();
  assert.equal(page.url(),url);assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0].body),{tournament_id:1,team_id:1,purpose:'enroll'});
  await noOverflow(page);
  assert((await page.getByRole('button',{name:'Cerrar registro local',exact:true}).boundingBox()).height>=44);
  await page.screenshot({path:`${output}/consent-${width}.png`,fullPage:true});
  page.once('dialog',dialog=>dialog.dismiss());await page.keyboard.press('Escape');assert(await page.getByRole('dialog',{name:'Registro local',exact:true}).isVisible());
  await completeForm(page,minor);
  assert.equal(await page.locator('.enrollment-wizard-signatures canvas').count(),1);
  assert.equal(await page.locator(`[data-enrollment-field="${minor?'player_signature':'guardian_signature'}"] canvas`).count(),0);
  assert.equal(await page.getByText('Esta es la primera inscripción del equipo. Esta persona quedará registrada como delegado.',{exact:true}).count(),1);
  assert.equal(await page.getByText(/Primero debe inscribirse el delegado/).count(),0);
  await page.screenshot({path:`${output}/signature-${minor?'minor':'adult'}-${width}.png`,fullPage:true});
  if(width===390){
   state.failSave=true;await page.getByRole('button',{name:'Confirmar inscripción',exact:true}).click();
   await page.getByRole('alert').filter({hasText:'Error ficticio de guardado'}).waitFor();
   assert.equal(await page.locator('input[name=given_names]').inputValue(),'José');
   assert.equal(writes.length,2);state.failSave=false;
  }
  let release;state.holdSave=new Promise(resolve=>{release=resolve;});
  await page.getByRole('button',{name:'Confirmar inscripción',exact:true}).click();
  await page.getByRole('button',{name:'Guardando…',exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'Cerrar registro local',exact:true}).isDisabled());
  release();await page.getByRole('heading',{name:'Inscripción recibida',exact:true}).waitFor();
  const body=writes.at(-1).body;
  for(const field of ['birth_date','accepted_terms','player_photo','given_names','paternal_surname','maternal_surname','phone',...(minor?['guardian_signature','guardian_name','minor_credential','curp','guardian_ine_front','guardian_ine_back']:['player_signature','ine_front','ine_back'])])assert(body.includes(`name="${field}"`),field);
  assert(!body.includes(`name="${minor?'player_signature':'guardian_signature'}"`));
  assert.equal(writes.length,width===390?3:2);
  await page.getByRole('button',{name:'Finalizar registro local',exact:true}).click();
  assert.equal(await page.locator('dialog[open]').count(),0);assert(await local.evaluate(el=>el===document.activeElement));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({width,minor,completeRegistration:true,consentDocumentsSignature:true,noNavigation:true,noOverflow:true,saveProtected:true,noRealWrites:true}));
  await page.close();
 }}
 const {page,local,writes,state,errors}=await prepare(390);
 state.failInvitation=true;await local.click();await page.getByText(/Sin cupo ficticio/).waitFor();assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(writes.length,1);
 state.failInvitation=false;await local.click();await page.getByRole('dialog',{name:'Registro local',exact:true}).waitFor();
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cerrar registro local',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);
 await page.getByRole('button',{name:'Crear enlace',exact:true}).click();await page.getByLabel('Enlace de inscripción',{exact:true}).waitFor();assert((await page.getByLabel('Enlace de inscripción',{exact:true}).inputValue()).endsWith('#/inscripcion/local-fictional'));
 assert.deepEqual(JSON.parse(writes.at(-1).body),{tournament_id:1,team_id:1,purpose:'enroll'});
 await page.goto(url.replace('/send','/withdraw'));await page.getByRole('heading',{name:'Nueva baja',exact:true,level:1}).waitFor();assert.equal(await page.getByRole('button',{name:'Registro local',exact:true}).count(),0);
 assert.deepEqual(errors,[]);console.log('Errors preserve form; capacity rejected; close confirmed; existing link and withdrawals unchanged.');await page.close();
}finally{await browser.close();}
