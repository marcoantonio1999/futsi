// Fictional contacts and real local API only.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const base='http://127.0.0.1:5187/';
try{
 for(const width of [320,390,1440]){
  const context=await browser.newContext({viewport:{width,height:900}});
  const admin=await context.newPage();await admin.goto(base+'#/examenes');
  await admin.getByLabel('Usuario',{exact:true}).fill('exam_qa_vero');await admin.getByLabel('Contraseña',{exact:true}).fill('local-fictional-exam-test-2026');
  await admin.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await admin.getByRole('button',{name:'Nuevo examen',exact:true}).click();
  await admin.getByLabel('Nombre del examen',{exact:true}).fill('QA Identidad y reloj '+width);
  await admin.locator('fieldset').getByRole('combobox').selectOption('open');await admin.getByLabel('Enunciado',{exact:true}).fill('Explica tu propuesta.');
  const created=admin.waitForResponse(r=>r.url().endsWith('/recruitment-exams/')&&r.request().method()==='POST');
  await admin.getByRole('button',{name:'Crear y obtener enlace',exact:true}).click();const e=await (await created).json();
  const page=await context.newPage();await page.clock.install();await page.goto(base+'#/examen/'+e.public_token);
  async function fill(target,email,phone){await target.getByLabel('Nombre completo',{exact:true}).fill('Persona Ficticia');await target.getByLabel('Correo electrónico',{exact:true}).fill(email);await target.getByLabel('Teléfono',{exact:true}).fill(phone);await target.getByRole('checkbox').check();await target.getByRole('button',{name:'Iniciar examen',exact:true}).click();}
  await fill(page,'qa@example.invalid','5500000000');await page.locator('#question-1').waitFor();
  const timer=page.getByTestId('exam-countdown');assert.equal(await timer.innerText(),'40:00');await page.clock.fastForward(1000);assert.equal(await timer.innerText(),'39:59');
  const duplicate=await context.newPage();await duplicate.goto(base+'#/examen/'+e.public_token);await fill(duplicate,'QA@EXAMPLE.INVALID','5511111111');
  await duplicate.getByRole('alert').filter({hasText:'ya fue iniciado'}).waitFor();assert.equal(await duplicate.locator('#question-1').count(),0);
  await page.clock.fastForward(40*60*1000);assert.equal(await timer.innerText(),'00:00');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-countdown-zero-${width}.png`});
  await page.locator('#question-1 textarea').fill('Respuesta ficticia.');page.on('dialog',d=>d.accept());
  await page.getByRole('button',{name:'Enviar examen',exact:true}).click();await page.getByRole('heading',{name:'Gracias. Recibimos tus respuestas.',exact:true}).waitFor();
  await duplicate.reload();await fill(duplicate,'QA@EXAMPLE.INVALID','5511111111');await duplicate.getByRole('alert').filter({hasText:'No es posible realizarlo dos veces'}).waitFor();
  await duplicate.reload();await fill(duplicate,'otra-persona@example.invalid','+52 (55) 0000-0000');await duplicate.getByRole('alert').filter({hasText:'No es posible realizarlo dos veces'}).waitFor();
  assert(await duplicate.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await duplicate.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-repeat-blocked-${width}.png`});
  assert.equal(await page.title(),'Exámenes BPower');assert(await page.locator('.exam-brand img').isVisible());
  console.log(JSON.stringify({width,emailDuplicate:true,phoneDuplicate:true,ongoingCannotRestart:true,countdownZero:true,logo:true,overflow:false}));
  await context.close();
 }
}finally{await browser.close();}
