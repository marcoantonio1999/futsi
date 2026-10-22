// End-to-end on isolated local SQLite only. No provider calls or real applicants.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base='http://127.0.0.1:5199';
const python='C:/Users/daniel/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const db='C:/Users/daniel/Documents/marco/mexprod/tmp/exam-timeout-qa.sqlite3';
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const admin=await browser.newPage();
  await admin.goto(base+'/#/examenes');
  await admin.getByLabel('Usuario',{exact:true}).fill('exam_timeout_qa');
  await admin.getByLabel('Contraseña',{exact:true}).fill('fictional-local-exam-2026');
  await admin.getByRole('button',{name:'Iniciar sesión',exact:true}).click();
  await admin.getByRole('heading',{name:'Mis exámenes',exact:true}).waitFor();
  const token=await admin.evaluate(()=>localStorage.getItem('futsi_token'));
  const questions=Array.from({length:40},(_,i)=>({kind:'choice',prompt:`Pregunta ficticia ${i+1}`,options:['Correcta','Incorrecta']}));
  const created=await admin.request.post(base+'/api/recruitment-exams/',{headers:{Authorization:'Token '+token},data:{title:'QA cierre automático',duration_minutes:60,questions,answer_key:Object.fromEntries(questions.map((_,i)=>[String(i+1),0]))}});
  assert.equal(created.status(),201); const exam=await created.json();
  for(const width of [320,390,1440]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage(); await page.clock.install();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/#/examen/'+exam.public_token);
    await page.getByLabel('Nombre completo',{exact:true}).fill('Participante Ficticio');
    await page.getByLabel('Correo electrónico',{exact:true}).fill(`timeout-${width}@example.invalid`);
    await page.getByLabel('Teléfono',{exact:true}).fill('550000'+String(width).padStart(4,'0'));
    await page.getByRole('checkbox').check();
    const started=page.waitForResponse(r=>r.url().includes('/public-exams/'+exam.public_token+'/')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Iniciar examen',exact:true}).click();
    const attempt=await (await started).json();
    assert.equal(attempt.snapshot.duration_minutes,60);
    assert.equal(await page.getByTestId('exam-countdown').innerText(),'60:00');
    const draft=page.waitForResponse(r=>r.url().endsWith('/public-exams/attempt/')&&r.request().method()==='POST');
    await page.locator('#question-1 input[type=radio]').first().check();
    assert.equal((await (await draft).json()).saved,true);
    const clipboard=await page.locator('#question-1').evaluate(element=>{
      return ['copy','cut','paste','contextmenu','dragstart'].map(type=>{
        const event=new Event(type,{bubbles:true,cancelable:true});
        element.dispatchEvent(event);return {type,blocked:event.defaultPrevented};
      });
    });
    assert(clipboard.every(result=>result.blocked));
    assert(await page.evaluate(()=>{const event=new Event('copy',{bubbles:true,cancelable:true});document.dispatchEvent(event);return event.defaultPrevented;}));
    assert.equal(await page.locator('#question-1 h2').evaluate(element=>getComputedStyle(element).userSelect),'none');
    let calls=0;const listener=r=>{if(r.url().includes('/public-exams/'))calls++;};page.on('request',listener);
    await page.clock.fastForward(3000); assert.equal(calls,0,'No idle network polling');
    execFileSync(python,['-c',"import sqlite3,sys,datetime; p=sys.argv[1]; assert p.endswith('exam-timeout-qa.sqlite3'); c=sqlite3.connect(p); c.execute('UPDATE recruitment_exam_attempts SET started_at=? WHERE access_token=?',((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=3601)).isoformat(),sys.argv[2])); c.commit(); c.close()",db,attempt.access_token]);
    if(width===390)await page.route('**/public-exams/attempt/',route=>route.request().method()==='GET'?route.abort():route.continue());
    await page.clock.fastForward(3600000);
    if(width===390) {
      await page.getByRole('button',{name:'Confirmar cierre',exact:true}).waitFor();
      assert(await page.locator('#question-1 input[type=radio]').first().isDisabled());
      const before=calls;await page.clock.fastForward(15000);assert.equal(calls,before,'No automatic retry after failed expiry confirmation');
      await page.unroute('**/public-exams/attempt/');
      await page.getByRole('button',{name:'Confirmar cierre',exact:true}).click();
    }
    await page.getByRole('heading',{name:'Gracias por tu tiempo. El tiempo del examen terminó.',exact:true}).waitFor();
    assert.equal(await page.locator('input[type=radio]').count(),0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const receipt=await admin.request.get(base+'/api/public-exams/attempt/',{headers:{Authorization:'Exam '+attempt.access_token}});
    const saved=await receipt.json();assert(saved.timed_out);assert.deepEqual(saved.answers,{'1':0});assert.equal(saved.elapsed_seconds,3600);
    const late=await admin.request.post(base+'/api/public-exams/attempt/',{headers:{Authorization:'Exam '+attempt.access_token},data:{action:'draft',answers:{'1':1,'2':0}}});
    assert.deepEqual((await late.json()).answers,{'1':0});
    await page.screenshot({path:`C:/Users/daniel/Documents/marco/mexprod/outputs/exam-auto-close-${width}.png`});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,sixtyMinutes:true,partialAnswersPreserved:true,autoClosed:true,lateChangesRejected:true,clipboardBlocked:true,idlePolling:false,overflow:false,failureWithoutRetry:width===390}));
    await context.close();
  }
  const openCreated=await admin.request.post(base+'/api/recruitment-exams/',{headers:{Authorization:'Token '+token},data:{title:'QA respuesta escrita sin pegado',duration_minutes:60,questions:[{kind:'open',prompt:'Explica tu propuesta.'}],answer_key:{'1':'Una propuesta clara.'}}});
  const openExam=await openCreated.json();
  const openPage=await browser.newPage({viewport:{width:390,height:900}});
  await openPage.goto(base+'/#/examen/'+openExam.public_token);
  await openPage.getByLabel('Nombre completo',{exact:true}).fill('Persona Ficticia');
  await openPage.getByLabel('Correo electrónico',{exact:true}).fill('clipboard@example.invalid');
  await openPage.getByLabel('Teléfono',{exact:true}).fill('5500099999');
  assert(await openPage.getByLabel('Correo electrónico',{exact:true}).evaluate(element=>element.dispatchEvent(new Event('paste',{bubbles:true,cancelable:true}))),'Contact details must still allow paste');
  await openPage.getByRole('checkbox').check();await openPage.getByRole('button',{name:'Iniciar examen',exact:true}).click();
  const textarea=openPage.locator('#question-1 textarea');await textarea.fill('Respuesta escrita por la persona.');
  assert(await textarea.evaluate(element=>{const event=new Event('paste',{bubbles:true,cancelable:true});element.dispatchEvent(event);return event.defaultPrevented;}));
  assert.equal(await textarea.inputValue(),'Respuesta escrita por la persona.');
  console.log(JSON.stringify({openAnswerPasteBlocked:true,contactFieldsPasteAllowed:true}));
} finally {await browser.close();}
