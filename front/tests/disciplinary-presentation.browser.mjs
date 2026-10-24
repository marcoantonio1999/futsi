// Synthetic records, intercepted GETs only, local PNG exports; no production writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='C:/Users/daniel/Documents/marco/mexprod/tmp/outputs/disciplinary-presentation';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const row={id:7,player_name:'José Pérez López',offense:'Falta ficticia',reason:'Motivo ficticio de la decisión.',created_at:'2026-10-23T14:00:00Z',starts_on:'2026-10-25',ends_on:null,has_photo:true,status:'indefinite',site:'Sede privada',tournament:'Torneo privado',team:'Equipo privado',birth_date:'2000-01-01',applied_by:'Administrador privado',fine_amount:'500',payment_folio:'FOLIO-PRIVADO',appeal_reason:'CARTA PRIVADA'};
async function setup(width,{missingPhoto=false,long=false}={}){
 const page=await browser.newPage({viewport:{width,height:900},acceptDownloads:true}),errors=[],requests=[];
 const record=long?{...row,player_name:'Nombre compuesto '.repeat(12),reason:'Motivo detallado '.repeat(130)}:row;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.presentationDrawnText=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.presentationDrawnText.push(text);return original.call(this,text,...args);};});
 await page.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;assert.equal(req.method(),'GET');requests.push(path);
  assert.equal(req.headers().authorization,'Token fictional');
  if(path.endsWith('/photo/'))return missingPhoto?route.fulfill({status:404,json:{detail:'Foto no disponible'}}):route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#196c48"/><circle cx="96" cy="75" r="42" fill="#fae3c0"/></svg>'});
  if(path.endsWith('/catalog/'))return route.fulfill({json:{sites:[],tournaments:[],teams:[]}});
  return route.fulfill({json:{results:[record],count:1,filters:{site:[],tournament:[],team:[]},can_manage_blacklist:false}});
 });
 await page.goto('http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/commission');
 await page.getByRole('button',{name:'Presentación',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Presentación',exact:true});await dialog.waitFor();
 const card=dialog.getByRole('article',{name:'Ficha de presentación'});
 await card.getByRole('heading',{name:record.player_name,exact:true}).waitFor();
 const button=dialog.getByRole('button',{name:'Descargar imagen',exact:true});await button.waitFor();
 assert(await button.isEnabled());assert((await button.boundingBox()).height>=44);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
 const text=await card.innerText();for(const hidden of ['Sede privada','Torneo privado','Equipo privado','FOLIO-PRIVADO','Administrador privado','CARTA PRIVADA','500'])assert(!text.includes(hidden));
 await page.screenshot({path:`${output}/modal-${width}${long?'-long':''}${missingPhoto?'-missing':''}.png`});
 const downloaded=page.waitForEvent('download');await button.click();const file=await downloaded;assert(file.suggestedFilename().endsWith('.png'));await file.saveAs(`${output}/presentation-${width}${long?'-long':''}${missingPhoto?'-missing':''}.png`);
 const drawn=await page.evaluate(()=>window.presentationDrawnText);
 assert.equal(drawn.join('').replace(/\s/g,''),[record.player_name,'Motivo',record.reason,'Fecha','23/10/2026'].join('').replace(/\s/g,''));
 await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
 assert(await page.getByRole('button',{name:'Presentación',exact:true}).evaluate(el=>el===document.activeElement));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({width,long,missingPhoto,privatePhoto:true,onlyFourFields:true,png:true,noWrites:true,noOverflow:true}));
 await page.close();
}
try{for(const width of [320,390,1440])await setup(width);await setup(320,{missingPhoto:true,long:true});}finally{await browser.close();}
