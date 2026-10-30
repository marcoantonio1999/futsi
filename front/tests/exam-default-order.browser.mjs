// Fictional GET-only fixtures: no production candidates or grades are changed.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const page=await browser.newPage({viewport:{width,height:950}}),queries=[],errors=[];
  const exam={id:2,title:'Evaluación ficticia',duration_minutes:60,questions:[],answer_key:{},public_token:'fictional',accepting:true,attempt_count:2};
  const person={id:1,name:'Participante ficticio',email:'test@example.invalid',phone:'5500000000',started_at:'2026-10-22T18:00:00Z',submitted_at:'2026-10-22T18:10:00Z',elapsed_seconds:600,grading_status:'graded',grading:{score:9,questions:{}},snapshot:exam,answers:{}};
  await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional-read-only'));
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
   assert.equal(route.request().method(),'GET');
   const url=new URL(route.request().url());let data;
   if(url.pathname==='/api/auth/me/') data={role:'collaborator',section_permissions:['veronica_only']};
   else if(url.pathname==='/api/recruitment-exams/') data={results:[exam]};
   else if(url.pathname==='/api/recruitment-exams/2/') {
    queries.push(Object.fromEntries(url.searchParams));
    data={exam,results:[person],page:Number(url.searchParams.get('page')||1),count:51};
   } else throw new Error(`Unexpected request ${url.pathname}`);
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5209/#/examenes/evaluaciones');
  await page.getByRole('button',{name:'Ver respuestas',exact:true}).click();
  const toggle=page.getByRole('button',{name:'Filtros',exact:true});
  await toggle.waitFor();assert.equal(queries.at(-1).ordering,'score_desc');
  await toggle.click();
  const ordering=page.getByLabel('Ordenar por',{exact:true});
  assert.equal(await ordering.inputValue(),'score_desc');
  await ordering.selectOption('newest');
  await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();
  await page.locator('dialog.exam-filter-modal').waitFor({state:'hidden'});
  assert.equal(queries.at(-1).ordering,'newest');
  await toggle.click();
  await page.getByRole('button',{name:'Limpiar filtros',exact:true}).click();
  await page.locator('dialog.exam-filter-modal').waitFor({state:'hidden'});
  assert.equal(queries.at(-1).ordering,'score_desc');
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();
  await page.getByText('Página 2 de 2',{exact:true}).waitFor();
  assert.equal(queries.at(-1).ordering,'score_desc');
  assert.equal(queries.at(-1).page,'2');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,highestGradeDefault:true,manualOrder:true,resetRestoresDefault:true,pagination:true,overflow:false}));
  await page.close();
 }
} finally {await browser.close();}
