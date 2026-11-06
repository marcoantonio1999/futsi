import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),queries=[];
  const exam={id:2,title:'Evaluación ficticia',instructions:'',duration_minutes:60,questions:[],answer_key:{},public_token:'fictional',accepting:true,attempt_count:1};
  const person={id:10,name:'Persona ficticia',email:'a@example.invalid',phone:'5500000000',started_at:'2026-11-04T18:00:00Z',submitted_at:'2026-11-04T18:10:00Z',elapsed_seconds:600,grading_status:'graded',grading:{score:8,questions:{}},snapshot:exam,answers:{}};
  await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional'));
  await page.route('**/api/**',async route=>{
   assert.equal(route.request().method(),'GET');const url=new URL(route.request().url());let data;
   if(url.pathname==='/api/auth/me/')data={role:'collaborator',section_permissions:['veronica_only']};
   else if(url.pathname==='/api/recruitment-exams/')data={results:[exam]};
   else if(url.pathname==='/api/recruitment-exams/2/'){queries.push(Object.fromEntries(url.searchParams));data={exam,results:[person],page:1,count:1};}
   else throw new Error('Unexpected API request: '+url.pathname);
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5209/#/examenes/evaluaciones');
  await page.getByRole('button',{name:'Ver respuestas',exact:true}).click();
  await page.getByRole('button',{name:'Filtros',exact:true}).click();
  const first=page.getByLabel('Primera fase: mínimo sobre 10'),second=page.getByLabel('Segunda fase: mínimo sobre 30');
  await first.fill('8');await second.fill('24');
  assert((await first.boundingBox()).height>=44);assert((await second.boundingBox()).height>=44);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/phase-filter-${width}.png`});
  await page.getByRole('button',{name:'Aplicar filtros'}).click();
  assert.equal(queries.at(-1).first_min_score,'8');assert.equal(queries.at(-1).second_min_score,'24');
  await page.getByRole('button',{name:'Filtros',exact:true}).click();
  assert.equal(await first.inputValue(),'8');assert.equal(await second.inputValue(),'24');
  await context.close();
 }
 console.log('Filtros combinados: 320, 390 y escritorio OK');
} finally {await browser.close();}
