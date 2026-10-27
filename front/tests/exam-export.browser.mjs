// Fictional GET-only UI fixtures: no real applicants, grading or messages.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=new URL('../../../outputs/exam-export-ui/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage();
  const exported=[],errors=[];let fail=false;
  const exam={id:2,title:'Evaluación ficticia',duration_minutes:60,questions:[],answer_key:{1:0},public_token:'fake',accepting:true,attempt_count:61};
  await page.addInitScript(()=>localStorage.setItem('futsi_token','fake-read-only'));
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',async route=>{
   const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET');
   if(url.pathname==='/api/recruitment-exams/export/') {
    exported.push(url.search);
    return route.fulfill(fail?{status:500,json:{detail:'No se pudo crear el Excel de prueba.'}}:
     {status:200,contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers:{'Content-Disposition':'attachment; filename="evaluaciones-prueba.xlsx"'},body:Buffer.from('fictional-download-fixture')});
   }
   const data=url.pathname==='/api/auth/me/'?{role:'collaborator',section_permissions:['veronica_only']}:
    url.pathname==='/api/recruitment-exams/'?{results:[exam]}:
    url.pathname==='/api/recruitment-exams/2/'?{exam,results:[],count:61,page:1}:null;
   assert(data,`Unexpected ${url.pathname}`);await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5210/#/examenes/evaluaciones');
  let button=page.getByRole('button',{name:'Exportar Excel',exact:true});
  await button.waitFor();
  let download=page.waitForEvent('download');await button.click();let file=await download;
  // Cross-origin APIs need not expose Content-Disposition; the safe fallback works.
  assert(['todos-los-examenes.xlsx','evaluaciones-prueba.xlsx'].includes(file.suggestedFilename()));
  await file.saveAs(fileURLToPath(new URL(`download-${width}.fixture`,output)));
  assert.equal(await readFile(await file.path(),'utf8'),'fictional-download-fixture');
  assert.deepEqual(exported,['']);
  await page.getByRole('button',{name:'Ver respuestas',exact:true}).click();
  await page.getByText('61 participantes · 60 minutos de referencia',{exact:true}).waitFor();
  download=page.waitForEvent('download');await button.click();await download;
  assert.deepEqual(exported,['','?exam=2&ordering=newest']);
  await page.getByRole('button',{name:'Filtros',exact:true}).click();
  await page.getByLabel('Buscar participante',{exact:true}).fill('Persona & prueba');
  await page.getByLabel('Habilidad',{exact:true}).selectOption('sales');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert(await page.getByLabel('Habilidad',{exact:true}).evaluate(el=>el.getBoundingClientRect().height>=44));
  await page.screenshot({path:fileURLToPath(new URL(`filters-${width}.png`,output)),fullPage:true});
  await page.getByLabel('Ordenar por',{exact:true}).selectOption('score_desc');
  await page.getByLabel('Selección',{exact:true}).selectOption('10');
  await page.getByLabel('Estado',{exact:true}).selectOption('graded');
  await page.getByLabel('Calificación mínima',{exact:true}).fill('7');
  await page.getByLabel('Calificación máxima',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Aplicar filtros',exact:true}).click();
  await page.getByRole('dialog',{name:'Filtros de evaluaciones',exact:true}).waitFor({state:'hidden'});
  download=page.waitForEvent('download');await button.click();await download;
  const selected=new URLSearchParams(exported.at(-1));
  assert.deepEqual(Object.fromEntries(selected),{exam:'2',skill:'sales',ordering:'score_desc',top:'10',q:'Persona & prueba',status:'graded',min_score:'7',max_score:'10'});
  assert(!selected.has('page'));
  // Draft edits do not change the exported selection until applied.
  await page.getByRole('button',{name:'Filtros',exact:true}).click();
  await page.getByLabel('Buscar participante',{exact:true}).fill('No aplicado');
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  download=page.waitForEvent('download');await button.click();await download;
  assert.equal(exported.at(-1),exported.at(-2));
  const style=await button.evaluate(element=>({background:getComputedStyle(element).backgroundColor,height:element.getBoundingClientRect().height,icon:element.querySelectorAll('svg').length}));
  assert(['rgb(16, 124, 65)','rgb(11, 99, 51)'].includes(style.background));assert(style.height>=44);assert.equal(style.icon,1);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:fileURLToPath(new URL(`export-${width}.png`,output)),fullPage:true});
  fail=true;await button.click();await page.getByRole('alert').filter({hasText:'No se pudo crear el Excel de prueba.'}).waitFor();
  await page.getByRole('button',{name:'Exportar Excel',exact:true}).waitFor({state:'visible'});
  assert.equal(exported.length,5);assert.equal(exported.at(-1),exported.at(-2));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({width,greenExcelButton:true,appliedFiltersAndAllPages:true,globalAndPerExamDownloads:true,errorsVisible:true,noWrites:true,noOverflow:true}));
  await context.close();
 }
}finally{await browser.close();}
