import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
const field=(key,label,required=false,kind='text',sensitive=false)=>({key,label,required,kind,sensitive});
const fields=[field('puesto_solicitado','Puesto que solicita',true),field('sueldo_deseado','Sueldo mensual deseado',true),field('nombres','Nombre(s)',true),field('apellido_paterno','Apellido paterno',true),field('correo','Correo electrónico',true,'email'),field('telefono','Teléfono',true,'tel'),field('edad','Edad',true,'text',true),field('sexo','Sexo',false,'text',true),field('firma_solicitante','Nombre completo del solicitante',true)];
try {for(const width of [320,390,1440]){
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();let submitted;
 await page.route('**/api/public-employment-form/**',async route=>{
  if(route.request().method()==='GET')await route.fulfill({json:{title:'Solicitud de empleo',sections:[{title:'Datos',fields}]}});
  else {submitted=route.request().postDataJSON();await route.fulfill({json:{receipt:'test',submitted_at:'2026-11-10T12:00:00Z'}});}
 });
 await page.goto('http://127.0.0.1:5210/#/postulacion');
 for(const [name,value] of [['Puesto que solicita *','Auxiliar'],['Nombre(s) *','Persona'],['Apellido paterno *','Prueba'],['Correo electrónico *','persona@example.invalid'],['Teléfono *','5500000000'],['Nombre completo del solicitante *','Persona Prueba']])await page.getByLabel(name,{exact:true}).fill(value);
 await page.getByRole('checkbox',{name:/Autorizo a BPower Academy/}).check();
 assert(await page.getByLabel('Sueldo mensual deseado *',{exact:true}).evaluate(e=>e.required));
 assert(await page.getByLabel('Edad *',{exact:true}).evaluate(e=>e.required));
 await page.getByRole('button',{name:'Enviar postulación'}).click();assert.equal(submitted,undefined);
 await page.getByLabel('Sueldo mensual deseado *',{exact:true}).fill('15000');
 await page.getByLabel('Edad *',{exact:true}).fill('29');
 await page.getByRole('checkbox',{name:/Autorizo expresamente el tratamiento/}).check();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole('button',{name:'Enviar postulación'}).click();await page.getByRole('heading',{name:'Gracias. Recibimos tu postulación.'}).waitFor();
 assert.equal(submitted.fields.sueldo_deseado,'15000');assert.equal(submitted.fields.edad,'29');assert(!submitted.fields.sexo);await context.close();
}console.log('Edad y sueldo obligatorios: 320, 390 y escritorio OK');}finally{await browser.close();}
