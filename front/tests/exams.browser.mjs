// Real local Django API, isolated SQLite, fictional applicants only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.EXAM_QA_URL || 'http://127.0.0.1:5187/';
assert(base.startsWith('http://127.0.0.1:'), 'This test must never write to production.');
const browser = await chromium.launch({headless: true, channel: 'chrome'});
const screenshots = process.env.EXAM_QA_OUTPUT || 'C:/Users/daniel/Documents/marco/mexprod/outputs';
async function noOverflow(page) {
  const g = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  assert(g.scroll <= g.width, JSON.stringify(g));
}
try {
 const admin = await browser.newPage({viewport:{width:1440,height:900}});
 const errors = []; admin.on('pageerror', e => errors.push(e.message));
 await admin.goto(base + '#/examenes');
 await admin.getByLabel('Usuario', {exact:true}).fill('exam_qa_vero');
 await admin.getByLabel('Contraseña', {exact:true}).fill('local-fictional-exam-test-2026');
 await admin.getByRole('button', {name:'Iniciar sesión',exact:true}).click();
 await admin.getByRole('button', {name:'Nuevo examen',exact:true}).waitFor();
 await admin.getByRole('button', {name:'Nuevo examen',exact:true}).click();
 await admin.getByRole('button', {name:/Usar evaluación Business/}).click();
 await admin.getByLabel('Nombre del examen',{exact:true}).fill('QA · Business Operations 40 preguntas');
 assert.equal(await admin.locator('fieldset').count(),40);
 for(const field of await admin.getByLabel('Respuesta correcta (privada)',{exact:true}).all()) await field.selectOption('0');
 await noOverflow(admin);
 await admin.screenshot({path:`${screenshots}/exam-editor-desktop.png`});
 const created = admin.waitForResponse(r=>r.url().endsWith('/recruitment-exams/') && r.request().method()==='POST');
 await admin.getByRole('button',{name:'Crear y obtener enlace',exact:true}).click();
 const exam = await (await created).json();
 assert(exam.public_token);
 const card = admin.locator('article').filter({hasText:'QA · Business Operations 40 preguntas'}).first();
 await card.getByRole('button',{name:'Ver respuestas',exact:true}).waitFor();
 await admin.screenshot({path:`${screenshots}/exam-admin-desktop.png`});
 for (const width of [320,390,1440]) {
  const context = await browser.newContext({viewport:{width,height:850}});
  const page = await context.newPage(); const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(base+'#/examen/'+exam.public_token);
  await page.getByLabel('Nombre completo',{exact:true}).fill(`Participante Ficticio ${width}`);
  await page.getByLabel('Correo electrónico',{exact:true}).fill(`qa-${width}@example.invalid`);
  await page.getByLabel('Teléfono',{exact:true}).fill('550000'+String(width).padStart(4,'0'));
  await page.getByRole('checkbox').check(); await noOverflow(page);
  await page.screenshot({path:`${screenshots}/exam-start-${width}.png`});
  await page.getByRole('button',{name:'Iniciar examen',exact:true}).click();
  await page.locator('#question-1').waitFor();
  await page.getByRole('button',{name:'Enviar examen',exact:true}).click();
  assert.equal(await page.locator('.exam-invalid').count(),40);
  await page.locator('#question-1 input[type=radio]').nth(1).check();
  page.on('dialog', d=>d.accept());
  await page.reload();
  await page.locator('#question-1').waitFor();
  assert(await page.locator('#question-1 input[type=radio]').nth(1).isChecked());
  for(let n=2;n<=40;n++) await page.locator(`#question-${n} input[type=radio]`).nth(n%4).check();
  await noOverflow(page);
  await page.locator('#question-1').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${screenshots}/exam-answer-${width}.png`});
  let apiCalls=0; const listener = r=>{if(r.url().includes('/public-exams/'))apiCalls++;}; page.on('request',listener);
  await page.waitForTimeout(2500); assert.equal(apiCalls,0,'Exam timer must not poll the API'); page.off('request',listener);
  await page.getByRole('button',{name:'Enviar examen',exact:true}).click();
  await page.getByRole('heading',{name:'Gracias. Recibimos tus respuestas.',exact:true}).waitFor();
  await noOverflow(page);
  await page.screenshot({path:`${screenshots}/exam-receipt-${width}.png`});
  assert.deepEqual(pageErrors,[]);
  await context.close(); console.log(JSON.stringify({width,questions:40,resume:true,validation:true,submitted:true,noPolling:true,overflow:false}));
 }
 await card.getByRole('button',{name:'Ver respuestas',exact:true}).click();
 await admin.locator('tbody tr').first().waitFor();
 assert.equal(await admin.locator('tbody tr').count(),3);
 for(const width of [320,390,1440]){
  await admin.setViewportSize({width,height:850}); await noOverflow(admin);
  await admin.screenshot({path:`${screenshots}/exam-results-${width}.png`});
 }
 await admin.getByRole('button',{name:'Ver respuestas',exact:true}).first().click();
 assert.equal(await admin.locator('article.exam-question').count(),40);
 await noOverflow(admin); assert.deepEqual(errors,[]);
 console.log('Vero login, template creation, 3 real local submissions, results and answer detail passed.');
} finally { await browser.close(); }
