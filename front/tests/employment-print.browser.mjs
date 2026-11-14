import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const schema=await (await fetch('https://futsi.onrender.com/api/public-employment-form/')).json();
const fields=Object.fromEntries(schema.sections.flatMap(s=>s.fields||s.groups.flatMap(g=>g.fields)).map((f,i)=>[f.key,`Respuesta ficticia ${i+1}`]));
fields.empleo_1_separacion='Respuesta extensa de ejemplo. '.repeat(30)+'FIN DE RESPUESTA';
fields.software='<img src=x onerror=alert(1)> Excel';
const row={id:10,name:'Persona ficticia',position:'Auxiliar',email:'a@example.invalid',phone:'5500000000',submitted_at:'2026-11-10T18:00:00Z',receipt:'folio-ficticio',link_status:'pending',fields,candidates:[],seen:false};
try{for(const width of [320,390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
 await page.addInitScript(()=>{localStorage.setItem('futsi_token','fake');const open=window.open.bind(window);window.open=(...args)=>{const child=open(...args);if(child)child.print=()=>{};return child;};});
 await page.route('**/api/**',async route=>{const u=new URL(route.request().url());let data;if(u.pathname==='/api/auth/me/')data={role:'collaborator',section_permissions:['veronica_only']};else if(u.pathname==='/api/recruitment-exams/')data={results:[]};else if(u.pathname==='/api/recruitment-applications/')data={public_url:'https://example.invalid',sections:schema.sections,count:1,page:1,results:[row]};else if(u.pathname==='/api/recruitment-applications/10/')data=row;else throw Error(u.pathname);await route.fulfill({json:data});});
 await page.goto('http://127.0.0.1:5210/#/examenes/formatos-postulaciones');
 await page.getByRole('button',{name:'Ver todos los datos'}).click();
 const print=page.getByRole('button',{name:'Imprimir',exact:true});assert((await print.boundingBox()).height>=44);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const popupPromise=page.waitForEvent('popup');await print.click();const popup=await popupPromise;
 await popup.getByText('FIN DE RESPUESTA',{exact:false}).waitFor();
 await popup.waitForFunction(()=>{const img=document.querySelector('header img');return img?.complete && img.naturalWidth>0;});
 assert.equal(await popup.locator('.field').count(),Object.keys(fields).length);assert.equal(await popup.locator('img').count(),1);assert(await popup.getByText('<img src=x onerror=alert(1)> Excel',{exact:false}).count());
 if(width===1440)await popup.pdf({path:'C:/Users/daniel/Documents/marco/mexprod/tmp/employment-print-qa.pdf',format:'Letter',printBackground:true,preferCSSPageSize:true});
 await context.close();
}console.log('Impresión, texto completo y móvil: OK');}finally{await browser.close();}
