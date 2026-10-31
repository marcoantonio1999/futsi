import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const built=await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {SanctionActions} from './src/features/enrollments/SanctionAppeal'; import './src/features/enrollments/enrollments.css'; import './src/features/enrollments/enrollmentAdmin.css'; import './src/features/enrollments/enrollmentButtons.css'; import './src/features/tournaments/tournaments.css'; createRoot(document.getElementById('root')).render(<main className="enrollment-page operator-page"><SanctionActions row={{id:1,player_name:'Jugador de prueba',status:'active',appeal_status:'pending',starts_on:'2026-10-01',ends_on:'2026-11-15'}} token="fixture" admin onSaved={()=>{}}/></main>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'qa',jsx:'automatic',define:{'import.meta.env':'{}'}});
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
 for(const width of [320,390,1440]) {
  const page=await browser.newPage({viewport:{width,height:900}});
  const submissions=[];
  await page.route('**/*',route=>{
   if(route.request().url().includes('/decision/')) {submissions.push(route.request().postDataJSON());return route.fulfill({json:{completed:true}});}
   return route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>'});
  });
  await page.goto('http://localhost/');
  await page.addStyleTag({content:built.outputFiles.find(f=>f.path.endsWith('.css')).text});
  await page.addScriptTag({content:built.outputFiles.find(f=>f.path.endsWith('.js')).text});
  await page.getByRole('button',{name:'Aceptar apelación',exact:true}).click();
  const dialog=page.getByRole('dialog');
  assert.equal(await dialog.locator('textarea').count(),0);
  assert.match(await dialog.innerText(),/16 nov 2026/);
  await page.getByRole('checkbox',{name:'Modificar fecha de regreso'}).check();
  const date=page.getByLabel('Nueva fecha de regreso',{exact:true});
  assert.equal(await date.getAttribute('min'),'2026-10-02');
  await date.fill('2026-11-01');
  assert((await date.boundingBox()).height>=44);
  assert.equal(await page.locator('input[name=return_on]').inputValue(),'2026-11-01');
  assert((await dialog.boundingBox()).width<=width);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.APPEAL_QA_OUTPUT) await page.screenshot({path:`${process.env.APPEAL_QA_OUTPUT}/appeal-return-${width}.png`});
  await dialog.getByRole('button',{name:'Aceptar apelación',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(submissions.length,1);
  assert.equal(submissions[0].return_on,'2026-11-01');
  assert.equal(submissions[0].reason,undefined);
  await page.getByRole('button',{name:'Aceptar apelación',exact:true}).click();
  assert.equal(await page.getByRole('checkbox',{name:'Modificar fecha de regreso'}).isChecked(),false);
  await page.getByRole('dialog').getByRole('button',{name:'Aceptar apelación',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.equal(submissions[1].return_on,undefined);
  console.log(`PASS ${width}px: edited date, inclusive boundary UI, no reason, unchanged date option, no overflow`);
  await page.close();
 }

 const appealBundle=await build({stdin:{contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {SanctionActions} from './src/features/enrollments/SanctionAppeal'; createRoot(document.getElementById('root')).render(<SanctionActions row={{id:1,player_name:'Jugador',status:'active',appeal_status:'none'}} token="fixture" admin={false} onSaved={()=>{}}/>);`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,outdir:'qa',jsx:'automatic',define:{'import.meta.env':'{}'}});
 const appealPage=await browser.newPage({viewport:{width:390,height:900}});const appealPosts=[];
 await appealPage.route('**/*',route=>{if(route.request().method()==='POST'){appealPosts.push(route.request().postData());return route.fulfill({status:201,json:{completed:true}});}return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'});});
 await appealPage.goto('http://localhost/');await appealPage.addScriptTag({content:appealBundle.outputFiles.find(f=>f.path.endsWith('.js')).text});await appealPage.getByRole('button',{name:'Apelar sanción',exact:true}).click();
 assert.equal(await appealPage.locator('textarea').count(),0);
 await appealPage.locator('input[type=file]').setInputFiles({name:'carta.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
 await appealPage.getByAltText('Vista previa de la carta de apelación').waitFor();await appealPage.getByRole('dialog').getByRole('button',{name:'Apelar sanción',exact:true}).click();await appealPage.getByRole('dialog').waitFor({state:'hidden'});
 assert.equal(appealPosts.length,1);assert(!appealPosts[0].includes('name="reason"'));assert(appealPosts[0].includes('name="letter"'));console.log('PASS: appeal uploads its letter without a reason field');await appealPage.close();
} finally {await browser.close();}
