// Synthetic records, intercepted GETs only, local PNG exports; no production writes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='C:/Users/daniel/Documents/marco/mexprod/tmp/outputs/disciplinary-presentation';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const row={id:7,player_name:'José Pérez López',offense:'Falta ficticia',reason:'Motivo ficticio de la decisión.',created_at:'2026-10-23T14:00:00Z',starts_on:'2026-10-25',ends_on:null,has_photo:true,status:'indefinite',site:'Sede privada',tournament:'Torneo privado',team:'Equipo privado',birth_date:'2000-01-01',applied_by:'Administrador privado',fine_amount:'500',payment_folio:'FOLIO-PRIVADO',appeal_reason:'CARTA PRIVADA'};
async function setup(width,{missingPhoto=false,long=false,finite=false}={}){
 const page=await browser.newPage({viewport:{width,height:900},acceptDownloads:true}),errors=[],requests=[];
 const record=long?{...row,player_name:'Nombre compuesto '.repeat(12),reason:'Motivo detallado '.repeat(130)}:finite?{...row,ends_on:'2026-11-15',status:'active'}:row;
 const photoWidth=width===320?600:width===390?1200:800,photoHeight=width===320?900:width===390?600:800;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.presentationDrawnText=[];window.presentationTextColors=[];window.presentationPhotoBounds=[];const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){window.presentationDrawnText.push(text);window.presentationTextColors.push(this.fillStyle);return original.call(this,text,...args);};const draw=CanvasRenderingContext2D.prototype.drawImage;CanvasRenderingContext2D.prototype.drawImage=function(img,...args){window.presentationPhotoBounds.push(args);return draw.call(this,img,...args);};});
 await page.route('**/api/**',route=>{
  const req=route.request(),path=new URL(req.url()).pathname;assert.equal(req.method(),'GET');requests.push(path);
  assert.equal(req.headers().authorization,'Token fictional');
  if(path.endsWith('/photo/'))return missingPhoto?route.fulfill({status:404,json:{detail:'Foto no disponible'}}):route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${photoWidth}" height="${photoHeight}" viewBox="0 0 600 900" preserveAspectRatio="none"><rect width="600" height="900" fill="#196c48"/><circle cx="300" cy="280" r="120" fill="#fae3c0"/><rect x="10" y="10" width="580" height="880" fill="none" stroke="white" stroke-width="12"/></svg>`});
  if(path.endsWith('/catalog/'))return route.fulfill({json:{sites:[],tournaments:[],teams:[]}});
  return route.fulfill({json:{results:[record],count:1,filters:{site:[],tournament:[],team:[]},can_manage_blacklist:false}});
 });
 await page.goto('http://127.0.0.1:5213/tests/enrollment-register-preview.html#/admin/inscripciones/commission');
 await page.getByRole('button',{name:'Presentación',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Sancionado',exact:true});await dialog.waitFor();
 assert.equal(await dialog.getByRole('heading',{name:'Sancionado',exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(185, 28, 28)');
 const card=dialog.getByRole('article',{name:'Ficha de presentación'});
 await card.getByRole('heading',{name:record.player_name,exact:true}).waitFor();
 const button=dialog.getByRole('button',{name:'Descargar imagen',exact:true});await button.waitFor();
 assert(await button.isEnabled());assert((await button.boundingBox()).height>=44);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
 if(!missingPhoto){const img=card.locator('img');assert.equal(await img.evaluate(el=>getComputedStyle(el).objectFit),'contain');assert.equal(await img.evaluate(el=>el.naturalWidth),photoWidth);assert(requests.filter(p=>p.endsWith('/photo/')).length>=1);}
 await page.screenshot({path:`${output}/photo-${width}${missingPhoto?'-missing':''}.png`});
 const text=await card.innerText();for(const hidden of ['Sede privada','Equipo privado','FOLIO-PRIVADO','Administrador privado','CARTA PRIVADA','500'])assert(!text.includes(hidden));
 const period=finite?'25/10/2026 – 15/11/2026':'25/10/2026 – Sin término',status=finite?'Vigente':'Sin término';
 for(const value of [record.tournament,record.offense,period,status])assert(text.includes(value));
 await card.locator('dd').last().scrollIntoViewIfNeeded();
 const lastField=await card.locator('dd').last().boundingBox(),footer=await dialog.locator('footer').boundingBox();
 assert(lastField.y+lastField.height<=footer.y+1,'last field stays reachable above pinned download button');
 await page.screenshot({path:`${output}/modal-${width}${long?'-long':''}${missingPhoto?'-missing':''}.png`});
 const downloaded=page.waitForEvent('download');await button.click();const file=await downloaded;assert(file.suggestedFilename().endsWith('.png'));await file.saveAs(`${output}/presentation-${width}${long?'-long':''}${missingPhoto?'-missing':''}.png`);
 const drawn=await page.evaluate(()=>window.presentationDrawnText);
 assert.equal(drawn.join('').replace(/\s/g,''),['Sancionado',record.player_name,'Torneo',record.tournament,'Sanción',record.offense,'Motivo',record.reason,'Periodo',period,'Estado',status,'Fecha','23/10/2026'].join('').replace(/\s/g,''));
 assert.equal(await page.evaluate(()=>window.presentationTextColors[0]),'#b91c1c');
 if(!missingPhoto){const [x,y,w,h]=await page.evaluate(()=>window.presentationPhotoBounds[0]);assert(Math.abs(w/h-photoWidth/photoHeight)<0.001);assert(w<=480&&h<=560&&x>=260&&y>=180);}
 await page.keyboard.press('Escape');assert.equal(await page.locator('dialog[open]').count(),0);
 assert(await page.getByRole('button',{name:'Presentación',exact:true}).evaluate(el=>el===document.activeElement));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({width,long,missingPhoto,finite,privatePhoto:true,allRequestedFields:true,png:true,noWrites:true,noOverflow:true}));
 await page.close();
}
try{for(const width of [320,390,1440])await setup(width,{finite:width===390});await setup(320,{missingPhoto:true,long:true});}finally{await browser.close();}
