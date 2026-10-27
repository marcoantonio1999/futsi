import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {for(const width of [320,390,1440]) for(const direct of [false,true]) {
 const page=await browser.newPage({viewport:{width,height:900}});const writes=[];let release;let fail=true;
 const held=new Promise(resolve=>release=resolve);
 await page.route('https://fictional.r2.cloudflarestorage.com/**',r=>r.fulfill({status:200}));
 await page.route('**/api/**',async r=>{const req=r.request(),path=new URL(req.url()).pathname;
 if(req.method()==='OPTIONS')return r.fulfill({status:204});
 if(req.method()==='POST'){
 if(path.endsWith('/uploads/'))return r.fulfill({json:{files:req.postDataJSON().files.map(f=>({kind:f.kind,url:'https://fictional.r2.cloudflarestorage.com/signature',headers:{'Content-Type':f.mime},receipt:'signature-receipt'}))}});
 writes.push({path,body:req.postData()});
 if(path==='/api/player-enrollments/')return r.fulfill({json:{token:'local-test'}});
 assert.equal(path,'/api/player-enrollments/withdrawal/local-test/');
 if(fail)return r.fulfill({status:400,json:{detail:'Error de prueba'}});
 await held;return r.fulfill({json:{completed:true}});
 }
 if(path.endsWith('/catalog/'))return r.fulfill({json:{sites:[],tournaments:[{id:1,name:'Torneo prueba',is_active:true}],teams:[{id:1,name:'Equipo prueba',tournament:1,is_active:true}]}});
 if(path.includes('/withdrawal/'))return r.fulfill({json:{team:'Equipo prueba',tournament:'Torneo prueba',direct_upload:direct,players:[{id:1,name:'Jugador uno',can_withdraw:true},{id:2,name:'Jugador sancionado',can_withdraw:false}]}});
 return r.fulfill({json:{results:[],count:0}});
 });
 const url='http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/withdraw';
 await page.goto(url);const local=page.getByRole('button',{name:'Baja local',exact:true});await local.waitFor();assert(await local.isDisabled());
 await page.locator('.control-grid select').nth(0).selectOption('1');await page.locator('.control-grid select').nth(1).selectOption('1');await local.click();
 const dialog=page.getByRole('dialog',{name:'Baja local',exact:true});await dialog.waitFor();assert.equal(page.url(),url);assert.equal(JSON.parse(writes[0].body).purpose,'withdraw');
 assert(await page.getByLabel('Dar de baja a Jugador sancionado',{exact:true}).isDisabled());await page.getByLabel('Dar de baja a Jugador uno',{exact:true}).check();
 const submit=page.getByRole('button',{name:'Firmar y confirmar 1 baja(s)',exact:true});assert(await submit.isDisabled());
 await page.getByLabel('Confirmo la baja de todos',{exact:false}).check();
 const canvas=page.locator('canvas');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();await page.mouse.move(box.x+15,box.y+20);await page.mouse.down();await page.mouse.move(box.x+100,box.y+55,{steps:8});await page.mouse.up();
 await submit.click();await page.getByRole('alert').filter({hasText:'Error de prueba'}).waitFor();fail=false;
 await submit.click();await page.getByRole('button',{name:'Guardando bajas…'}).waitFor();assert(await page.getByRole('button',{name:'Cerrar baja local'}).isDisabled());
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth));
 if(process.env.TEST_OUTPUT)await page.screenshot({path:`${process.env.TEST_OUTPUT}/baja-local-${width}-${direct}.png`,fullPage:true});
 release();await page.getByRole('status').filter({hasText:'1 baja(s) firmada(s)'}).waitFor();
 const body=writes.at(-1).body;if(direct){const data=JSON.parse(body);assert(data.uploaded_documents.includes('signature-receipt'));}else assert(body.includes('name="withdrawal_signature"'));
 await page.getByRole('button',{name:'Finalizar baja local',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);assert(await local.evaluate(e=>e===document.activeElement));
 assert((await local.boundingBox()).height>=44);console.log({width,direct,signedWithdrawal:true,noOverflow:true});await page.close();
}}finally{await browser.close();}
