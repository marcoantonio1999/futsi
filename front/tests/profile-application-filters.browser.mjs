import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),queries=[];
  await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional'));
  await page.route('**/api/**',async route=>{
   assert.equal(route.request().method(),'GET');const url=new URL(route.request().url());let data;
   if(url.pathname==='/api/auth/me/')data={role:'collaborator',section_permissions:['veronica_only']};
   else if(url.pathname==='/api/recruitment-exams/')data={results:[]};
   else if(url.pathname==='/api/recruitment-profiles/'){queries.push(Object.fromEntries(url.searchParams));data={results:[],page:1,count:0,filters:{graded_count:0,top_threshold:null}};}
   else throw new Error('Unexpected API request: '+url.pathname);
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5209/#/examenes/perfiles');
  await page.getByRole('button',{name:'Filtros',exact:true}).click();
  for(const [label,value] of [['Edad declarada mínima','25'],['Edad declarada máxima','35'],['Sueldo mensual deseado mínimo (MXN)','12000'],['Sueldo mensual deseado máximo (MXN)','20000'],['Experiencia declarada mínima (años)','2'],['Experiencia declarada máxima (años)','5']]) {
   const input=page.getByLabel(label,{exact:true});await input.fill(value);assert((await input.boundingBox()).height>=44);
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.getByRole('button',{name:'Filtrar perfiles',exact:true}).click();
  for(const [key,value] of Object.entries({edad_min:'25',edad_max:'35',sueldo_min:'12000',sueldo_max:'20000',experiencia_min:'2',experiencia_max:'5'}))assert.equal(queries.at(-1)[key],value);
  await page.getByRole('button',{name:'Filtros',exact:true}).click();
  assert.equal(await page.getByLabel('Experiencia declarada mínima (años)',{exact:true}).inputValue(),'2');
  await context.close();
 }
 console.log('Filtros de solicitud: 320, 390 y escritorio OK');
} finally {await browser.close();}
