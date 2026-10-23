// Fictional GET-only fixtures. Never submits real exams, grades, PDFs or messages.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=new URL('../../../outputs/offline-exam-ui/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 for(const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:950}}),page=await context.newPage(),errors=[];
  const questions=['1','22','26','36'].map(id=>({id,kind:'choice',prompt:`Pregunta ficticia ${id}`,options:['Primera','Segunda','Tercera','Cuarta']}));
  const exam={id:2,title:'Evaluación ficticia',duration_minutes:60,questions,answer_key:{1:2,22:0,26:1,36:3},public_token:'fake',accepting:true,attempt_count:2};
  const common={exam_id:2,phone:'5500000000',started_at:null,submitted_at:'2026-10-20T06:00:00Z',elapsed_seconds:null,deadline_at:null,over_time:false,timed_out:false,snapshot:{...exam,duration_minutes:40},answers:{1:2},offline_import:{completed_on:'2026-10-20',imported_at:'2026-10-22T22:00:00Z',ambiguous_answers:{}}};
  const people=[{...common,id:10,name:'Persona PDF ficticia',email:'pdf@example.invalid',grading_status:'graded',grading:{score:8,model:'deterministic'}},
   {...common,id:11,name:'Persona PDF por revisar',email:'revision@example.invalid',grading_status:'review',grading:{review:true,error:'PDF con doble selección: requiere revisión manual, sin nota definitiva.'},offline_import:{...common.offline_import,ambiguous_answers:{22:['A','B'],26:['B','C'],36:['A','D']}}},
   {...common,id:12,name:'Persona PDF criterio confirmado',email:'confirmado@example.invalid',grading_status:'graded',grading:{score:9.75,review:false,accepted_multiple_answers:['22','26','36']},offline_import:{...common.offline_import,ambiguous_answers:{22:['A','B'],26:['B','C'],36:['A','D']}}}];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('futsi_token','fake-read-only'));
  await page.route('**/api/**',async route=>{
   assert.equal(route.request().method(),'GET');
   const path=new URL(route.request().url()).pathname;
   const data=path==='/api/auth/me/'?{role:'collaborator',section_permissions:['veronica_only']}:
    path==='/api/recruitment-exams/'?{results:[exam]}:
    path==='/api/recruitment-exams/2/'?{exam,results:people,count:2,page:1}:null;
   assert(data,`Unexpected ${path}`);await route.fulfill({json:data});
  });
  await page.goto('http://127.0.0.1:5210/#/examenes/evaluaciones');
  await page.getByRole('button',{name:'Ver respuestas',exact:true}).click();
  await page.getByText('Persona PDF ficticia',{exact:true}).waitFor();
  assert.equal(await page.getByText('Sin tiempo registrado',{exact:true}).count(),3);
  assert.equal(await page.getByText('Carga manual de PDF',{exact:true}).count(),3);
  assert.equal(await page.getByText('0 min 0 s',{exact:true}).count(),0);
  assert((await page.locator('tbody').innerText()).includes('20/10/2026'));
  assert((await page.locator('tbody').innerText()).includes('8 / 10'));
  await page.locator('tbody tr').filter({hasText:'Persona PDF por revisar'}).getByRole('button',{name:'Ver respuestas',exact:true}).click();
  await page.getByRole('heading',{name:'Persona PDF por revisar',exact:true}).waitFor();
  for(const text of ['Varias opciones marcadas: A, B. Requiere confirmación manual.','Varias opciones marcadas: B, C. Requiere confirmación manual.','Varias opciones marcadas: A, D. Requiere confirmación manual.']) assert(await page.getByText(text,{exact:true}).isVisible());
  const body=await page.locator('body').innerText();assert(!/Invalid Date|NaN|undefined|0 min 0 s/.test(body));
  assert(body.includes('Sin horas de inicio o entrega registradas'));
  await page.getByRole('button',{name:'Volver a participantes',exact:true}).click();
  await page.locator('tbody tr').filter({hasText:'Persona PDF criterio confirmado'}).getByRole('button',{name:'Ver respuestas',exact:true}).click();
  await page.getByRole('heading',{name:'Persona PDF criterio confirmado',exact:true}).waitFor();
  assert(await page.getByText('9.75 / 10',{exact:true}).isVisible());
  for(const marks of ['A, B','B, C','A, D']) assert(await page.getByText(`Varias opciones marcadas: ${marks}. Aceptada por criterio confirmado: incluye la opción correcta.`,{exact:true}).isVisible());
  assert.equal(await page.getByText(/Requiere confirmación manual/).count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  await page.getByRole('heading',{name:'Persona PDF criterio confirmado',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:fileURLToPath(new URL(`review-${width}.png`,output)),fullPage:true});
  console.log(JSON.stringify({width,originalDate:true,unknownTimeNotZero:true,ambiguousMarksPreserved:true,noInventedGrade:true,noWrites:true,overflow:false}));
  await context.close();
 }
} finally {await browser.close();}
