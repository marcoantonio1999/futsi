// GET-only fictional data, never grades or changes a real exam.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=new URL('../../../outputs/exam-filter-disclosure/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[],queries=[];
  const exam={id:2,title:'Evaluación ficticia',instructions:'Prueba local',duration_minutes:60,questions:[{id:'1',kind:'choice',prompt:'Pregunta ficticia',options:['A','B']}],answer_key:{1:0},public_token:'ficticio',accepting:true,attempt_count:2};
  const person={id:10,name:'Participante ficticio',email:'prueba@example.invalid',phone:'5500000000',started_at:'2026-10-22T18:00:00Z',submitted_at:'2026-10-22T18:10:00Z',elapsed_seconds:600,over_time:false,grading_status:'graded',grading:{score:8,model:'deterministic',questions:{}},snapshot:exam,answers:{1:0}};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional-read-only'));
  await page.route('**/api/**',async route=>{
   const request=route.request();assert.equal(request.method(),'GET');
   const url=new URL(request.url());let data;
   if(url.pathname==='/api/auth/me/') data={role:'collaborator',section_permissions:['veronica_only']};
   else if(url.pathname==='/api/recruitment-exams/') data={results:[exam]};
   else if(url.pathname==='/api/recruitment-exams/2/') {
    queries.push(Object.fromEntries(url.searchParams));
    data={exam,results:[person],page:Number(url.searchParams.get('page')||1),count:51};
   } else throw new Error(`Unexpected API read ${url.pathname}`);
   await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5209/#/examenes/evaluaciones');
  await page.getByRole('button',{name:'Ver respuestas',exact:true}).click();
  const toggle=page.getByRole('button',{name:'Filtros',exact:true}),form=page.getByRole('form',{name:'Filtros de evaluaciones',exact:true,includeHidden:true});
  await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  assert.equal(await form.isVisible(),false);assert.equal(await page.getByText('Participante ficticio',{exact:true}).isVisible(),true);
  assert.equal(await toggle.getAttribute('aria-controls'),await form.getAttribute('id'));
  assert((await toggle.boundingBox()).height>=44);
  await page.screenshot({path:fileURLToPath(new URL(`collapsed-${width}.png`,output)),fullPage:true});
  const before=queries.length;
  await toggle.focus();await toggle.press('Enter');
  assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert(await form.isVisible());
  await page.getByLabel('Buscar participante',{exact:true}).fill('Prueba');
  await page.getByLabel('Ordenar por',{exact:true}).selectOption('score_desc');
  await page.getByLabel('Selección',{exact:true}).selectOption('10');
  await page.getByLabel('Estado',{exact:true}).selectOption('graded');
  await page.getByLabel('Calificación mínima',{exact:true}).fill('7');
  await page.getByLabel('Calificación máxima',{exact:true}).fill('10');
  await toggle.click();assert.equal(await form.isVisible(),false);
  await toggle.press('Space');assert(await form.isVisible());
  assert.equal(await page.getByLabel('Buscar participante',{exact:true}).inputValue(),'Prueba');
  assert.equal(queries.length,before,'toggling and drafts do not query the server');
  await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();
  await page.getByText('Filtros aplicados',{exact:true}).waitFor();
  assert.deepEqual(queries.at(-1),{ordering:'score_desc',top:'10',q:'Prueba',status:'graded',min_score:'7',max_score:'10',page:'1'});
  await page.screenshot({path:fileURLToPath(new URL(`expanded-${width}.png`,output)),fullPage:true});
  await toggle.click();assert.equal(await form.isVisible(),false);assert(await page.getByText('Filtros aplicados',{exact:true}).isVisible());
  await page.getByRole('button',{name:'Siguiente',exact:true}).click();
  await page.getByText('Página 2 de 2',{exact:true}).waitFor();assert.equal(queries.at(-1).top,'10');assert.equal(queries.at(-1).page,'2');
  assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  await toggle.click();await page.getByRole('button',{name:'Limpiar filtros',exact:true}).click();
  await page.getByText('Página 1 de 2',{exact:true}).waitFor();
  assert.deepEqual(queries.at(-1),{ordering:'newest',page:'1'});
  assert.equal(await page.getByText('Filtros aplicados',{exact:true}).count(),0);
  assert.equal(await page.getByLabel('Buscar participante',{exact:true}).inputValue(),'');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,collapsedInitially:true,keyboard:true,draftPreserved:true,filtersAndPaginationUnchanged:true,activeIndicator:true,clearWorks:true,noWritesOrPolling:true,overflow:false}));
  await context.close();
 }
} finally {await browser.close();}
