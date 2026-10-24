// Mocked local GETs only. Never creates real registrations or links.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output='C:/Users/daniel/Documents/marco/mexprod/tmp/outputs/enrollment-register';await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {for(const width of [320,390,1440]) {
 const page=await browser.newPage({viewport:{width,height:950}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{assert.equal(route.request().method(),'GET');return route.fulfill({json:{sites:[],tournaments:[],teams:[],results:[],count:0}});});
 await page.goto('http://127.0.0.1:5211/tests/enrollment-register-preview.html#/admin/inscripciones/send');
 await page.getByRole('heading',{name:'Registrar',exact:true,level:1}).waitFor();
 assert.equal(await page.getByText('Enviar enlace',{exact:true}).count(),0);
 assert(await page.getByRole('heading',{name:'Registrar',exact:true,level:2}).isVisible());
 await page.getByText('Primero crea un torneo en la subsección «Crear torneo» del menú izquierdo.',{exact:true}).waitFor();
 if(width<1024)await page.getByRole('button',{name:'Abrir secciones',exact:true}).click();
 const button=page.getByRole('button',{name:'Registrar',exact:true});await button.waitFor({state:'visible'});assert((await button.boundingBox()).height>=44);
 await page.screenshot({path:`${output}/menu-${width}.png`,fullPage:true});
 await button.click();
 assert(page.url().includes('/inscripciones/send'));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({width,registerLabel:true,sameAction:true,touch44:true,overflow:false,noWrites:true}));await page.close();
}} finally {await browser.close();}
