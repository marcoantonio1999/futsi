// GET-only fictional data: never grades, edits or creates real participants.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=new URL('../../../outputs/exam-filter-modals/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) for(const kind of ['evaluations','profiles']) {
  const profiles=kind==='profiles';
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[],queries=[];
  let failNext=false;
  const exam={id:2,title:'Evaluación ficticia',instructions:'Prueba local',duration_minutes:60,questions:[{id:'1',kind:'choice',prompt:'Pregunta ficticia',options:['A','B']}],answer_key:{1:0},public_token:'ficticio',accepting:true,attempt_count:2};
  const person={id:10,name:'Participante ficticio',email:'prueba@example.invalid',phone:'5500000000',started_at:'2026-10-22T18:00:00Z',submitted_at:'2026-10-22T18:10:00Z',elapsed_seconds:600,over_time:false,grading_status:'graded',grading:{score:8,model:'deterministic',questions:{}},snapshot:exam,answers:{1:0}};
  const profile={id:10,name:person.name,email:person.email,phone:person.phone,exam_id:2,exam_title:exam.title,score:8,grading_status:'graded',position:exam.title,has_cv:false,has_form:false,matched_keywords:[]};
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('futsi_token','fictional-read-only'));
  await page.route('**/api/**',async route=>{
   const request=route.request();assert.equal(request.method(),'GET');
   const url=new URL(request.url());let data;
   if(url.pathname==='/api/auth/me/') data={role:'collaborator',section_permissions:['veronica_only']};
   else if(url.pathname==='/api/recruitment-exams/') data={results:[exam]};
   else if(url.pathname==='/api/recruitment-exams/2/' || url.pathname==='/api/recruitment-profiles/') {
    queries.push(Object.fromEntries(url.searchParams));
    if(failNext){failNext=false;await route.fulfill({status:503,json:{detail:'Fallo de prueba al filtrar.'}});return;}
    data=profiles?{results:[profile],page:Number(url.searchParams.get('page')||1),count:51,filters:{graded_count:51,top_threshold:null}}:
      {exam,results:[person],page:Number(url.searchParams.get('page')||1),count:51};
   } else throw new Error(`Unexpected API read ${url.pathname}`);
   await route.fulfill({json:data});
  });
  await page.goto(`http://127.0.0.1:5209/#/examenes/${profiles?'perfiles':'evaluaciones'}`);
  if(!profiles) await page.getByRole('button',{name:'Ver respuestas',exact:true}).click();
  const toggle=page.getByRole('button',{name:'Filtros',exact:true});
  const modal=page.locator('dialog.exam-filter-modal');
  await toggle.waitFor();assert.equal(await modal.isVisible(),false);
  assert.equal(queries.at(-1).ordering,'score_desc','highest grade must be the default on initial load');
  assert.equal(await toggle.getAttribute('aria-haspopup'),'dialog');
  assert.equal(await toggle.getAttribute('aria-controls'),await modal.getAttribute('id'));
  assert((await toggle.boundingBox()).height>=44);
  const previousOverflow=await page.evaluate(()=>document.body.style.overflow);
  const before=queries.length;
  await toggle.focus();await toggle.press('Enter');await modal.waitFor({state:'visible'});
  assert(await modal.evaluate(el=>el.matches(':modal')));assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  assert(await page.getByRole('dialog',{name:profiles?'Filtros de perfiles':'Filtros de evaluaciones',exact:true}).isVisible());
  for(let i=0;i<20;i++){await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement===document.body || !!document.activeElement?.closest('dialog.exam-filter-modal')),'background controls must remain inert');}
  await modal.getByRole('button',{name:'Cerrar',exact:true}).focus();
  await toggle.evaluate(el=>el.focus());
  assert(await page.evaluate(()=>!!document.activeElement?.closest('dialog.exam-filter-modal')),'background cannot receive focus while the modal is open');
  const search=profiles?'Buscar persona':'Buscar participante';
  await page.getByLabel(search,{exact:true}).fill('Prueba');
  await page.getByLabel(profiles?'Ordenar perfiles':'Ordenar por',{exact:true}).selectOption('score_desc');
  await page.getByLabel(profiles?'Selección de notas':'Selección',{exact:true}).selectOption('10');
  await page.getByLabel(profiles?'Nota mínima':'Calificación mínima',{exact:true}).fill('7');
  if(profiles){
   await page.getByLabel('Examen',{exact:true}).selectOption('2');
   await page.getByLabel('Puesto solicitado',{exact:true}).fill('Auxiliar');
   await page.getByLabel('Cargar palabras clave (TXT)',{exact:true}).setInputFiles({name:'claves.txt',mimeType:'text/plain',buffer:Buffer.from('excel\npython')});
   await page.getByLabel('Coincidencias de conocimientos',{exact:true}).selectOption('any');
   await page.getByLabel('Datos del formato',{exact:true}).fill('licenciatura');
   await page.getByLabel('Texto de CV',{exact:true}).selectOption('yes');
   await page.getByLabel('Formato de empleo',{exact:true}).selectOption('yes');
  }else{
   await page.getByLabel('Estado',{exact:true}).selectOption('graded');
   await page.getByLabel('Calificación máxima',{exact:true}).fill('10');
  }
  const close=modal.getByRole('button',{name:'Cerrar',exact:true});
  assert((await close.boundingBox()).height>=44);
  await close.click();await modal.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.body.style.overflow),previousOverflow);
  assert(await toggle.evaluate(el=>el===document.activeElement));
  await toggle.click();await modal.waitFor({state:'visible'});
  assert.equal(await page.getByLabel(search,{exact:true}).inputValue(),'Prueba');
  assert.equal(queries.length,before,'opening, closing and drafts never query the server');
  await modal.locator('.exam-filter-modal-content').evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:fileURLToPath(new URL(`${kind}-${width}.png`,output)),fullPage:false});
  const bounds=await modal.boundingBox();assert(bounds.x>=0 && bounds.width<=width && bounds.height<=950);
  const apply=modal.getByRole('button',{name:profiles?'Filtrar perfiles':'Aplicar filtros',exact:true});
  await apply.click();await modal.waitFor({state:'hidden'});
  assert(await page.getByText('Filtros aplicados',{exact:true}).isVisible());
  const expected=profiles?{exam:'2',q:'Prueba',position:'Auxiliar',keywords:'excel, python',keyword_mode:'any',form_q:'licenciatura',has_cv:'yes',has_form:'yes',ordering:'score_desc',top:'10',min_score:'7',page:'1'}:
   {ordering:'score_desc',top:'10',q:'Prueba',status:'graded',min_score:'7',max_score:'10',page:'1'};
  assert.deepEqual(queries.at(-1),expected);
  await page.getByRole('button',{name:profiles?'Perfiles siguientes':'Siguiente',exact:true}).click();
  await page.getByText('Página 2 de 2',{exact:true}).waitFor();assert.equal(queries.at(-1).top,'10');assert.equal(queries.at(-1).page,'2');
  await toggle.click();await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
  assert(await toggle.evaluate(el=>el===document.activeElement));
  await toggle.click();failNext=true;await apply.click();
  await modal.getByRole('alert').waitFor();assert((await modal.getByRole('alert').innerText()).includes('Fallo de prueba al filtrar.'));
  assert(await modal.isVisible());assert.equal(await page.getByLabel(search,{exact:true}).inputValue(),'Prueba');
  const afterFailure=queries.length;await page.waitForTimeout(350);assert.equal(queries.length,afterFailure,'no automatic retry');
  await apply.click();await modal.waitFor({state:'hidden'});
  await toggle.click();
  await modal.getByRole('button',{name:profiles?'Limpiar filtros de perfiles':'Limpiar filtros',exact:true}).click();
  await modal.waitFor({state:'hidden'});
  assert.deepEqual(queries.at(-1),profiles?{keyword_mode:'all',ordering:'score_desc',page:'1'}:{ordering:'score_desc',page:'1'});
  assert.equal(await page.getByText('Filtros aplicados',{exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.body.style.overflow),previousOverflow);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({kind,width,nativeModal:true,focusTrap:true,escapeAndClose:true,draftPreserved:true,applyRefreshesAndCloses:true,failureKeepsModal:true,clearRefreshesAndCloses:true,noWritesOrRetry:true,overflow:false}));
  await context.close();
 }
} finally {await browser.close();}
