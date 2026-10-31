import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
async function draw(page){const canvas=page.getByLabel('Firma del jugador obligatoria',{exact:true});await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();await page.mouse.move(box.x+15,box.y+20);await page.mouse.down();await page.mouse.move(box.x+120,box.y+75,{steps:9});await page.mouse.up();}
try{for(const width of [320,390,1440])for(const mode of ['local','online']){
 const page=await browser.newPage({viewport:{width,height:900}}),writes=[],errors=[];let created=false,fail=true,release;const hold=new Promise(r=>release=r);
 page.on('pageerror',e=>errors.push(e.message));
 const row={id:1,folio:'P-000001',name:'Jugador de prueba',team:'Equipo prueba',tournament:'Torneo prueba',issued_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),status:'active',source:mode,terms:['Aviso de juego bajo protesta.','Válido por 24 horas.','Acepto jugar bajo mi propio riesgo.']};
 await page.route('**/api/**',async r=>{const req=r.request(),path=new URL(req.url()).pathname;
 if(req.method()==='OPTIONS')return r.fulfill({status:204});
 if(req.method()==='POST'){
 if(path.endsWith('/invitations/'))return r.fulfill({status:201,json:{token:'public-test'}});
 writes.push({path,body:req.postData(),auth:req.headers().authorization});if(fail)return r.fulfill({status:400,json:{detail:'Error de prueba'}});await hold;created=true;return r.fulfill({status:201,json:row});}
 if(path.endsWith('/photo/')||path.endsWith('/signature/'))return r.fulfill({contentType:'image/png',body:png});
 if(path.includes('/public/'))return r.fulfill({json:{team:'Equipo prueba',tournament:'Torneo prueba',terms:row.terms}});
 if(path.endsWith('/catalog/'))return r.fulfill({json:{sites:[],tournaments:[{id:1,name:'Torneo prueba',is_active:true}],teams:[{id:1,name:'Equipo prueba',tournament:1,is_active:true}]}});
 if(path.endsWith('/permits/'))return r.fulfill({json:{results:created?[row]:[],count:created?1:0}});
 return r.fulfill({json:{results:[],count:0}});
 });
 if(mode==='local'){
 await page.goto('http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/permits');await page.getByRole('heading',{name:'Permisos de 24 horas',exact:true}).waitFor();
 if(width<768){const menu=page.getByRole('button',{name:'Abrir secciones'});await menu.click();await page.getByRole('button',{name:'Permisos de 24 horas',exact:true}).click();assert.equal(await menu.getAttribute('aria-expanded'),'false');}
 await page.getByLabel('Torneo',{exact:true}).selectOption('1');await page.getByLabel('Equipo',{exact:true}).selectOption('1');
 assert.equal(await page.getByRole('button',{name:'Permiso en línea',exact:true}).count(),0);
 await page.getByRole('button',{name:'Permiso local',exact:true}).click();await page.getByRole('dialog',{name:'Permiso local',exact:true}).waitFor();
 page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');assert(await page.getByRole('dialog',{name:'Permiso local',exact:true}).isVisible());
 }else await page.goto('http://127.0.0.1:5213/tests/enrollment-permit-preview.html#/permiso/public-test');
 await page.getByLabel('Nombre completo del jugador').fill('Jugador de prueba');await page.getByLabel('Foto del jugador',{exact:true}).setInputFiles({name:'foto.png',mimeType:'image/png',buffer:png});
 const emit=page.getByRole('button',{name:'Firmar y emitir permiso de 24 horas',exact:true});assert(await emit.isDisabled());
 await page.getByLabel('He leído y acepto las condiciones del permiso.',{exact:true}).check();assert(await emit.isDisabled());await draw(page);
 await emit.click();await page.getByRole('alert').filter({hasText:'Error de prueba'}).waitFor();assert.equal(await page.getByLabel('Nombre completo del jugador').inputValue(),'Jugador de prueba');fail=false;
 await emit.click();await page.getByRole('button',{name:'Emitiendo permiso…'}).waitFor();if(mode==='local')assert(await page.getByRole('button',{name:'Cerrar permiso local'}).isDisabled());release();
 await page.getByText('PERMISO · P-000001',{exact:true}).waitFor();await page.waitForFunction(()=>Array.from(document.querySelectorAll('.permit-ticket img')).every(i=>i.complete));
 assert(await page.getByRole('button',{name:'Imprimir permiso',exact:true}).isEnabled());assert.equal(await page.locator('.permit-signed img').count(),1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const body=writes[1].body;assert(body.includes('name="signature"'));assert(body.includes('name="accepted"'));assert(body.includes('name="photo"'));assert(!body.includes('name="expires_at"'));if(mode==='online')assert(!writes[1].auth);
 if(process.env.TEST_OUTPUT)await page.screenshot({path:`${process.env.TEST_OUTPUT}/permiso-firmado-${mode}-${width}.png`,fullPage:true});
 await page.emulateMedia({media:'print'});assert(await page.locator('.permit-ticket').isVisible());assert(Math.abs((await page.locator('.permit-ticket').boundingBox()).width-680.3)<3);assert.equal(await page.locator('.permit-signed img').count(),1);
 if(process.env.TEST_OUTPUT&&width===1440)await page.screenshot({path:`${process.env.TEST_OUTPUT}/permiso-impresion-${mode}.png`,fullPage:true});
 await page.emulateMedia({media:'screen'});
 if(mode==='local'){await page.getByRole('button',{name:'Finalizar permiso local',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);await page.getByRole('button',{name:'Ver permiso P-000001'}).click();await page.getByRole('button',{name:'Imprimir permiso',exact:true}).waitFor();}
 assert.deepEqual(errors,[]);console.log({width,mode,signatureRequired:true,printWithSignature:true,noOverflow:true,noRealWrites:true});await page.close();
}}finally{await browser.close();}
