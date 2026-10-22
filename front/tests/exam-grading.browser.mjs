// Local isolated DB only. Three explicitly requested tiny, real Luna calls.
import assert from 'node:assert/strict';
import {navigateExamSection} from './exam-admin-navigation.mjs';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const base='http://127.0.0.1:5187/';
try {
 for (const width of [320,390,1440]) {
  const context=await browser.newContext({viewport:{width,height:900}});
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'#/examenes');
  await page.getByLabel('Usuario',{exact:true}).fill('exam_qa_vero');
  await page.getByLabel('Contraseña',{exact:true}).fill('local-fictional-exam-test-2026');
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await navigateExamSection(page,'Crear examen');
  await page.getByLabel('Nombre del examen',{exact:true}).fill('QA Calificación '+width+' '+Date.now());
  await page.getByLabel('Enunciado',{exact:true}).fill('¿Cuánto es dos más dos?');
  await page.getByLabel('Opción A',{exact:true}).fill('Cuatro');
  await page.getByLabel('Opción B',{exact:true}).fill('Cinco');
  await page.getByRole('button',{name:'Agregar pregunta',exact:true}).click();
  await page.getByRole('group',{name:'Elegir tipo de pregunta'}).getByRole('button',{name:'Pregunta abierta',exact:true}).click();
  await page.locator('fieldset').nth(1).getByLabel('Enunciado',{exact:true}).fill('¿Cuál es la capital de Francia?');
  await page.getByLabel('Cargar clave de respuestas (JSON)',{exact:true}).setInputFiles({name:'clave-ficticia.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({'1':'A','2':'París es la capital de Francia; acepta Paris sin acento.'}))});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Respuesta correcta (privada)"]')?.value==='0');
  assert.equal(await page.getByRole('combobox',{name:/Respuesta correcta/}).inputValue(),'0');
  assert((await page.getByLabel('Respuesta esperada y criterios (privados)',{exact:true}).inputValue()).includes('París'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-key-${width}.png`});
  const created=page.waitForResponse(r=>r.url().endsWith('/recruitment-exams/')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Crear y obtener enlace',exact:true}).click();const response=await created;assert.equal(response.status(),201);const e=await response.json();
  const candidate=await context.newPage();await candidate.goto(base+'#/examen/'+e.public_token);
  await candidate.getByLabel('Nombre completo',{exact:true}).fill('Persona Ficticia');
  await candidate.getByLabel('Correo electrónico',{exact:true}).fill('qa@example.invalid');await candidate.getByLabel('Teléfono',{exact:true}).fill('5500000000');await candidate.getByRole('checkbox').check();
  const started=candidate.waitForResponse(r=>r.url().includes('/public-exams/')&&r.request().method()==='POST');
  await candidate.getByRole('button',{name:'Iniciar examen',exact:true}).click();const payload=JSON.stringify(await (await started).json());
  assert(!payload.includes('answer_key')&&!payload.includes('correct_answer')&&!payload.includes('París es'));
  await candidate.locator('#question-1 input[type=radio]').nth(0).check();await candidate.locator('#question-2 textarea').fill('Paris.');
  candidate.on('dialog',d=>d.accept());await candidate.getByRole('button',{name:'Enviar examen',exact:true}).click();await candidate.getByRole('heading',{name:'Gracias. Recibimos tus respuestas.',exact:true}).waitFor();
  await page.locator('article').filter({hasText:e.title}).getByRole('button',{name:'Ver respuestas',exact:true}).click();
  await page.getByText('Pendiente de calificar',{exact:true}).waitFor();page.on('dialog',d=>d.accept());
  await page.getByRole('button',{name:'Calificar todos los exámenes',exact:true}).click();
  await page.getByText('10 / 10',{exact:true}).waitFor({timeout:95000});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-grading-${width}.png`});
  await page.getByRole('button',{name:'Ver respuestas',exact:true}).click();
  assert((await page.locator('.exam-notice').allTextContents()).some(t=>t.includes('10 / 10')));
  assert.deepEqual(errors,[]); console.log(JSON.stringify({width,keyImport:true,keyPrivate:true,realLunaLow:true,score:10,overflow:false}));
  await context.close();
 }
} finally {await browser.close();}
